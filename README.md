# 🥊 THE OCTAGON — Sales Championship Leaderboard

A UFC fight-night themed live leaderboard for the office TV. It reads your public
Google Sheet, ranks agents by total monthly premium, and throws a party —
KO animations when someone climbs the ranks, rockets + memes + air horns when a
policy closes, rotating dashboards, sound FX, embers, and confetti.

## Run it on the TV

The app is three plain files — no build, no install, no server needed for the app
itself. But browsers block a page opened via `file://` from playing sound and
(sometimes) from fetching the sheet, so run it through a tiny local web server:

**Mac (Python is preinstalled):**
```bash
cd ~/Desktop/LEADERBOARD
python3 -m http.server 4173
```
Then open **http://localhost:4173** in Chrome, click **ENTER THE OCTAGON**, and press
**F** for fullscreen. Done.

> Tip: To have it survive reboots on a dedicated TV machine, set Chrome to launch
> `http://localhost:4173` in kiosk mode and add the `python3 -m http.server` command
> to login items.

## Controls (keyboard)

| Key | Action |
|-----|--------|
| **S** | Simulate a sale 🚀 (test the rocket/meme) |
| **K** | Simulate a knockout 🥊 (test the KO animation) |
| **D** | Toggle auto-demo mode (fires fake events every ~9s — great for a reveal) |
| **R** | Refresh data from the sheet now |
| **N** | Next dashboard |
| **F** | Fullscreen |
| **M** | Mute / unmute |
| **H** or **?** | Help overlay |

## How it works

- Polls the sheet every 15s via the CORS-friendly `gviz` CSV endpoint.
- Ranks by **total monthly premium** (secondary: policy count).
- **New sale** detected when an agent's policy count goes up → rocket + meme + air horn.
- **Rank up** detected when an agent passes someone → full-screen KO.
- All sound is synthesized in-browser (Web Audio) — no audio files to break.
- Rotating dashboards: Championship Standings → This Week's War (weekly leaderboard)
  → Tale of the Tape → Heaviest Hands (highest average premium, min 2 policies)
  → Biggest Deals (today & this week) → Knockout of the Night → Tonight's Fight Card
  → The Gate.
- "This week" = Monday–Sunday containing the most recent sale date.
- Leaderboards show **every** agent at once, fight-card style: the top 3 are the
  MAIN CARD (big podium rows), everyone else is on the PRELIMS (compact 2-column
  grid — switches to 3 columns automatically past ~11 agents). No scrolling.

## The War Room 📋 (`/warroom/`)

Second board, same data: a single full-screen weekly stats grid — one row per agent,
one column per day (Mon–Sun), each cell showing that day's premium + deal count,
plus WEEK TOTAL and WEEK AVG columns and a TEAM totals row. Today's column glows
red, each agent's best day is boxed in gold, this week's leader wears the belt.
No rotation — everything fits one TV screen (Chromecast-friendly).

**Time machine** — view any past week: add `?week=8/3` to the URL (also accepts
`8/3/2026` or `2026-08-03`), or press `←` / `→` to step between weeks and `Home`
(or `Esc`) to jump back to live. A purple banner marks past-week views, and bonus
celebrations are suppressed while browsing history so old numbers never re-fire.

When a new deal lands in the sheet it takes over the screen for **10 seconds**:
same meme pack as the champions board (shared `memes/` folder), the agent's name,
and the deal size, with a countdown bar — then back to the grid. Keys: S test deal,
M mute, F fullscreen, R refresh.

Deploying the `LEADERBOARD` folder deploys both boards: champions at `/`,
war room at `/warroom/`.

## Memes 🎭

Sale events show a real meme from the local `memes/` folder (classics included —
Stonks, Success Kid, Leo Cheers, Oprah, Surprised Pikachu…). **Drop any extra
.jpg/.png/.gif/.webp images or .mp4/.webm/.mov videos into `memes/` and they're
auto-discovered on the next page load** — office inside-jokes, photos of the agents,
video clips, whatever. Videos autoplay with sound (they follow the `M` mute toggle)
and stay on screen ~8s so the clip lands. Deleted or broken files are pruned
automatically at startup, and if a file ever fails mid-show the card falls back to
an emoji. No internet needed once the folder is populated.

- Best video format: **.mp4 (H.264)** — plays everywhere. iPhone `.mov` files often
  use HEVC, which many browsers can't decode (they'll just be skipped); convert those
  to .mp4 first (or ask Claude — ffmpeg one-liner).
- Keep clips short (3–8s) — the card shows for ~8 seconds.
- After changing the folder, regenerate the manifest (needed for the hosted site):
  ```
  cd memes && ls -1 | grep -Ei '\.(png|jpe?g|gif|webp|mp4|webm|mov)$' \
    | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin]))" > manifest.json
  ```

## Configuration

Edit the `CONFIG` block at the top of `app.js`:

```js
const CONFIG = {
  SHEET_ID: "1h5B_KDge0e-SYI9LfjkFPXgxDLZAsFpL_O2bsbjAfog",
  GID: "416393424",
  POLL_MS: 15000,     // how often to re-check the sheet
  ROTATE_MS: 15000,   // seconds each dashboard stays up
  DEMO_AUTO_MS: 9000, // auto-demo event interval
};
```

The sheet must stay shared as **"Anyone with the link can view"** for the TV to read it.

## Files

- `index.html` — markup + splash screen
- `styles.css` — all the fight-night styling & animations
- `app.js` — data polling, ranking, event detection, sound, and FX engine
