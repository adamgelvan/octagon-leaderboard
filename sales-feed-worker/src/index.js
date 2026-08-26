/**
 * CCG Sales Feed — Cloudflare Worker
 *
 * Serves the Octagon + War Room boards their deal list straight from the
 * HighLevel (LeadConnector) API, replacing the published Google Sheet.
 *
 * Output is a CSV with the exact same shape as the old sheet feed:
 *
 *     Created Date,Agent,Monthly Premium
 *     7/6/2026,Andres Solorzano,$152.06
 *
 * - "Sale" = any HighLevel contact whose Total Monthly Premium custom field
 *   is populated (agent read from the Agent custom field).
 * - Dates are the contact's dateAdded, converted to America/New_York.
 * - Window: last WINDOW_DAYS days (default 90) so the War Room time machine
 *   still has history to browse.
 * - Edge-cached for CACHE_SECONDS so two TVs polling every 15s cost one
 *   HighLevel sweep per minute.
 *
 * Secrets (wrangler secret put):  GHL_TOKEN, GHL_LOCATION_ID
 */

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

// Custom-field IDs (from the commission-audit pull, verified 2026-08-26)
const F_PREMIUM = "WOnvwmzith6jSX7wqKdX"; // Total Monthly Premium
const F_AGENT = "XqT4BXOkmZd5b2wThJRm";   // Agent (name as text)

const WINDOW_DAYS = 90;
const CACHE_SECONDS = 60;
const MAX_PAGES = 40; // 40 x 100 contacts — far above any 90-day volume

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Isolate-level cache — the Cache API is a no-op on *.workers.dev, so a
// warm isolate answers the TVs' 15s polls from memory between GHL sweeps.
let MEM = { at: 0, csv: null, rows: 0 };

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    // ---- /pulse: call-analytics dashboard data relay ------------------
    // The call pipeline POSTs its data.json here every cycle (bypassing the
    // ~5-min Google publish-to-web cache); the CCG HQ hub GETs it live.
    const url = new URL(request.url);
    if (url.pathname === "/pulse") {
      if (request.method === "POST") {
        if (request.headers.get("x-push-key") !== env.PULSE_PUSH_KEY)
          return new Response("forbidden", { status: 403 });
        const body = await request.text();
        try { JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
        await env.PULSE_KV.put("data", body);
        return new Response("ok", { headers: CORS });
      }
      if (request.method === "GET") {
        const data = await env.PULSE_KV.get("data");
        if (!data) return new Response("no data yet", { status: 404, headers: CORS });
        return new Response(data, {
          headers: {
            ...CORS,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      return new Response("method not allowed", { status: 405 });
    }

    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    // Serve strategy: warm isolate memory first; otherwise the shared
    // last-good copy in KV (instantly), refreshing from HighLevel in the
    // background. A HighLevel hiccup (rate limit, 5xx) never surfaces to the
    // boards — they'd otherwise fall back to the stale Google Sheet and
    // different TVs would show different numbers.
    const csvHeaders = (cache) => ({
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "x-feed-cache": cache,
    });

    if (MEM.csv && Date.now() - MEM.at < CACHE_SECONDS * 1000) {
      return new Response(MEM.csv, { headers: csvHeaders("hit") });
    }

    const kvCsv = await env.PULSE_KV.get("salescsv");
    if (kvCsv) {
      // serve the shared copy now, refresh behind the scenes
      MEM = { at: MEM.at, csv: kvCsv, rows: MEM.rows };
      ctx.waitUntil(refreshSales(env));
      return new Response(kvCsv, { headers: csvHeaders("kv") });
    }

    try {
      const csv = await refreshSales(env);
      return new Response(csv, { headers: csvHeaders("miss") });
    } catch (err) {
      return new Response("feed error: " + (err && err.message), {
        status: 502,
        headers: { ...CORS, "Cache-Control": "no-store" },
      });
    }
  },
};

/** Pull from HighLevel and update memory + the shared KV copy (only writing
 *  KV when the data actually changed). Throws on failure — callers that have
 *  a last-good copy just keep serving it. */
async function refreshSales(env) {
  const rows = await pullSales(env);
  const csv = toCSV(rows);
  const prev = MEM.csv;
  MEM = { at: Date.now(), csv, rows: rows.length };
  if (csv !== prev) {
    const stored = await env.PULSE_KV.get("salescsv");
    if (csv !== stored) await env.PULSE_KV.put("salescsv", csv);
  }
  return csv;
}

async function pullSales(env) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString();
  const rows = [];
  let searchAfter = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      locationId: env.GHL_LOCATION_ID,
      pageLimit: 100,
      filters: [
        { field: `customFields.${F_PREMIUM}`, operator: "exists" },
        { field: "dateAdded", operator: "range", value: { gte: since } },
      ],
      sort: [{ field: "dateAdded", direction: "desc" }],
    };
    if (searchAfter) body.searchAfter = searchAfter;

    const r = await fetch(BASE + "/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GHL_TOKEN}`,
        Version: API_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ccg-sales-feed/1.0",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`GHL ${r.status}: ${(await r.text()).slice(0, 200)}`);

    const data = await r.json();
    const contacts = data.contacts || [];
    for (const ct of contacts) {
      const custom = Object.fromEntries(
        (ct.customFields || []).map((c) => [c.id, c.value])
      );
      const agent = String(custom[F_AGENT] || "").trim();
      const premium = parseFloat(String(custom[F_PREMIUM] || "").replace(/[$,]/g, ""));
      if (!agent || !isFinite(premium) || premium <= 0) continue;
      rows.push({ date: easternMDY(ct.dateAdded), agent, premium });
    }
    if (!contacts.length) break;
    searchAfter = contacts[contacts.length - 1].searchAfter || data.searchAfter;
    if (!searchAfter) break;
  }
  // Boards expect oldest-first is irrelevant (they aggregate), but keep it tidy
  return rows.reverse();
}

/** UTC ISO timestamp -> M/D/YYYY in America/New_York (matches the old sheet) */
function easternMDY(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("month")}/${get("day")}/${get("year")}`;
}

function toCSV(rows) {
  // Every field quoted, gviz-style — the War Room's parser only reads quoted cells.
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [`${q("Created Date")},${q("Agent")},${q("Monthly Premium")}`];
  for (const r of rows) {
    lines.push(`${q(r.date)},${q(r.agent)},${q("$" + r.premium.toFixed(2))}`);
  }
  return lines.join("\n") + "\n";
}
