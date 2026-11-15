# LifeOS Android design (reference for Claude Code)

This folder is the phone design for LifeOS. It is what the Android app (LifeOS-Mobile) should look like and how it behaves.
- `shots/`: PNG of every phone page (390 x 844 at 2x) and interaction states (`state-*.png`: agent panel, conversation mode, new task sheet; `state-agent-attach-menu.png` shows the panel only, the menu did not open in the capture).
- `pages/`: the clickable prototype. Run `python -m http.server 4222` inside `pages/`, open `http://localhost:4222/Phone.dc.html` (or any `*Phone.dc.html`) in a browser. `support.js` is the tiny runtime they need. In the real app these same pages are served by the dashboard server and read live vault data.
- The prototype data is sample data. The app version replaces it with the vault.

## Look
- Dark only. Background `#121212`, cards `#1A1A1A` with `#333` hairline borders, raised chips and buttons `#222222`. Text `#F5F5F5` (primary), `#E0E0E0`/`#D0D0D0`, muted `#8A8A8A`/`#9A9A9A`.
- Almost no colour. Greys and white. Small green dot for low priority; accents are used sparingly.
- Fonts: Space Grotesk (headings, 500-700), IBM Plex Sans (body), IBM Plex Mono (clock, numbers, small caps labels). Body 14 px, labels 12.5-13.5 px, tiny caps 10.5 px.
- Shapes: cards radius 16, inner tiles and inputs 12, pills 999, big sheets 24-32. 16 px side padding. Thin 1 px icons (outline style).
- Bottom: a floating pill navigation bar, always visible: Home, Areas (grid icon), centre black circle with a white dot = R.E.N.E.E. the agent, Knowledge (book icon), Performance (bars icon). The active item has a lighter pill behind it.
- Sub pages (Tasks, Calendar, Finances, Health, Mma, Projects, Spiritual, Work, Areas, Knowledge, Performance): back arrow top left, big title, a mono caps subtitle ("1 OPEN · 1 OVERDUE"), then cards. A round "+" button floats bottom right where it adds something.

## Screens (all in `shots/`)
Home (`Phone`): large live clock with AM/PM, full date, "FOCUS" line (type today's focus), month card with week strip (prev/next, tap the title to show or hide the full month), Overview tiles (Today, Schedule, Projects, All Tasks), Habits (five round icons, tap to tick, "0/5" count, tap the title to show or hide the weekly streak view), Tasks card (+ to add, grouped Overdue / Today / Upcoming, done tasks are hidden), Captures (free text), Reflections (free text), quick links to Gmail, Drive, Canvas and Calendar.
Other pages: `AreasPhone` (grid of life areas, each opens its page), `TasksPhone`, `CalendarPhone`, `FinancesPhone`, `HealthPhone`, `MmaPhone`, `PerformancePhone`, `ProjectsPhone`, `SpiritualPhone`, `WorkPhone`, `KnowledgePhone`.

## How it behaves
- Navigation: tapping a nav item or an Areas card opens that page. Back arrow returns. The nav bar stays on every page.
- Tasks: "+" opens a rounded sheet over the blurred page (`state-new-task-sheet.png`) with New task (title), Due date, Time, a Low / Medium / High priority switch, then Cancel and Add task. Checking a task completes it and it disappears from lists.
- Agent (R.E.N.E.E.): tap the centre circle to open a sheet that covers most of the screen (`state-agent-panel.png`), tap X to close. Press and hold the circle for about half a second to start dictating (words fill the text field), release to stop. This is wired in the prototype (`agentDown` / `agentUp` in `Phone.dc.html`, 550 ms timer; the browser's own speech recognition does the listening). Inside: a header with her name, an empty state with three quick prompts ("What's due today?", "Plan my day", "Summarize this week"), a message list, and a bottom bar with "+" (attach), a text field, a mic button (dictate into the field) and a send arrow. When the field is empty the send arrow becomes a waveform button that starts conversation mode.
- Attach: "+" opens a small menu above the bar with three rows: Take photo, Photos, Files (no screenshot of it; the pill-shaped menu is `#222222` with a `#333` border, 190 px wide). Picked files show as removable chips above the field. They are uploaded to the vault (photos to `10 Resources/Photos`, documents to `10 Resources/PDFs`).
- Conversation mode (`state-conversation-mode.png`): a full-sheet screen with one big black orb. Orb states: Listening (white ring, your words appear below), Working (thin grey ring), Speaking (grey ring; tap to interrupt). Under the orb: "Voice: <name> · change" and an "End" button. After she speaks, it listens again by itself until you press End.
- She is read only and says so: "Reads your vault · Searches the web · Read only".
- Errors show as a small grey line under the orb or above the field (mic blocked, vault not connected, still answering).

## What the native Android app adds
Everything above is the same WebView content. The native parts: real speech recognition and speech output (the prototype uses the browser's), camera and file picker, a reliable native version of the long-press on the orb, a Sync button (hold a place for it in the Areas or Home header; no design yet), and Android back-button handling (back closes the agent sheet first, then goes up a page).

## Liquid glass and animation (in the page code, not visible in screenshots)
Screenshots are still frames, so read these from `pages/Phone.dc.html` (CSS block near the top, plus the inline styles).
- **Glass:** the new-task sheet, the agent sheet and the bottom-bar popover menu (`navOpen`, shown when a bar item opens its menu) use `backdrop-filter: blur(24px) saturate(170%)` over a translucent dark fill with a thin light border. The page behind a sheet is dimmed and blurred (`blur(3px)`). On Android this needs a recent WebView; if it is missing, fall back to a solid `#1A1A1A` fill.
- **Entrances (springy):** `agIn` (agent sheet, 0.5 s: rises 28 px, scales from 0.8, blur 10 px to 0, small overshoot), `lgIn` (glass sheets and menus, 0.46 s, same idea), `lgItem` (menu items pop in one after another with a staggered delay, 0.5 s), `lgFade` (backdrop fade, 0.22 s). Easing is `cubic-bezier(0.34, 1.4, 0.64, 1)` (spring overshoot).
- **Page change:** `pgFade` (0.45 s) and `pgUp` (content rises 8 px and fades in, 0.35-0.4 s, easing `cubic-bezier(0.2, 0.7, 0.2, 1)`).
- **Press feedback:** buttons ease transform, opacity, background and border over 0.15-0.18 s (small scale-down on press).
- **Reduced motion:** with `prefers-reduced-motion`, all of the above are switched off. Keep that (Android "remove animations" setting).
- **Orb:** the conversation-mode orb changes ring thickness, halo and dot size between Listening, Working and Speaking (see `TALK` in the page script).
