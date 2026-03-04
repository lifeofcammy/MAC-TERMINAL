# CLAUDE.md — MAC Terminal Project Guide

> This file gives AI assistants full context on the MAC Terminal project.
> Read this COMPLETELY before making any changes.
> **Last updated: March 4, 2026**

---

## What Is This?

MAC Terminal (Market Action Center) is a **trading tools dashboard** — NOT a trading platform. Target audience: **beginner to intermediate traders**. It helps traders with:
- Morning market overview (regime, breadth direction, snapshot, catalysts, heatmap, economic calendar)
- Setup scanner (finds compression setups with momentum across the full US market)
- Top Ideas (quick scan of 50 popular tickers for compression setups)
- AI trade journal (import CSV, get AI analysis)
- AI analysis tab (analyze individual trades)
- TradingView chart popup (click any ticker to see a daily chart with exchange-aware routing)
- Watchlist (embedded in Overview, NOT a separate tab)

**Live site:** https://marketactioncenter.com  
**Dashboard:** https://marketactioncenter.com/app/  
**Repo:** https://github.com/lifeofcammy/MAC-TERMINAL

---

## Tech Stack

| Service | Purpose |
|---------|---------|
| **Vercel** | Hosts the website. Auto-deploys from GitHub `main` branch. |
| **Supabase** | Auth (email + Google sign-in), cloud database (watchlist, journal, analysis). |
| **Supabase Edge Functions** | `ai-proxy` (routes AI calls to Anthropic securely), `daily-scanner` (background scan). Auto-deployed via GitHub Actions. |
| **Polygon API** | Stock market data (prices, candles, snapshots, grouped daily). PAID plan. Key stored in localStorage (client-side). |
| **Anthropic API (Claude)** | AI features — themes, trade analysis, journal coaching. Key is server-side only (via ai-proxy Edge Function). |
| **TradingView** | Free embeddable chart widget (15-min delayed). Loaded on-demand when user clicks a ticker. |
| **GitHub Actions** | Auto-deploys Edge Functions to Supabase when `supabase/functions/` changes. |

---

## Project Structure

```
MAC-TERMINAL/
├── index.html              # Landing page (marketing homepage)
├── style.css               # Landing page styles
├── images/                 # Landing page screenshots
├── vercel.json             # Vercel config (cache headers + rewrites)
├── app/
│   ├── index.html          # Dashboard shell (tabs, layout, script tags with ?v= cache busting)
│   ├── login.html          # Login page (Supabase auth)
│   ├── css/
│   │   └── styles.css      # Dashboard styles (all CSS variables, light + dark themes)
│   └── js/
│       ├── init.js          # App initialization
│       ├── tabs.js          # Tab switching logic
│       ├── config.js        # API URLs, Supabase config
│       ├── auth.js          # Supabase auth guard (redirects to login if not signed in)
│       ├── chart.js         # TradingView chart popup + first-time hint banner
│       ├── overview.js      # Overview tab (Morning Mindset, Watchlist, Market Regime, Breadth Direction, Snapshot, Heat Check, Headlines, Calendar, Top Ideas, Themes)
│       ├── scanner.js       # Setup Scanner tab (compression setups, Top Ideas-style scoring)
│       ├── tickers.js       # Stock universe helper
│       ├── journal.js       # Trade Journal tab (CSV import, AI recap, calendar)
│       ├── analysis.js      # Analysis tab (AI trade review — 3 sub-tabs: Summary, Setups, Review)
│       ├── api.js           # Polygon API wrapper (polyGet, polyGetRetry, getDailyBars, getSnapshots, getPolygonNews)
│       ├── db.js            # Supabase database operations (cloud sync for watchlist, journal, analysis, preferences)
│       ├── watchlist.js     # Watchlist management functions
│       ├── settings.js      # Settings panel (API key entry)
│       ├── account.js       # Account management
│       ├── feedback.js      # User feedback (stores in Supabase preferences JSONB)
│       └── utils.js         # Shared helpers
├── supabase/
│   ├── config.toml          # Supabase project config
│   └── functions/
│       ├── ai-proxy/index.ts       # Routes AI requests to Anthropic (verify_jwt=false)
│       └── daily-scanner/index.ts  # Background scanner (verify_jwt=false)
├── .github/
│   └── workflows/
│       └── deploy-edge-functions.yml  # Auto-deploy Edge Functions on push
├── terms.html               # Terms of service
├── privacy.html             # Privacy policy
├── disclaimer.html          # Trading disclaimer
└── CLAUDE.md                # This file
```

---

## Design Rules

### Fonts
- **DM Serif Display** — Display/headings font
- **Inter** — Body/UI font
- **JetBrains Mono** — Code/data/ticker font

### Font Scale
| Size | Usage |
|------|-------|
| 20px | Card headers (DM Serif Display), section titles, tabs, tagline |
| 16px | MAC Terminal title in nav |
| 14px | Body text, tickers, prices, buttons |
| 12px | Labels, timestamps, "Market Action Center" subtitle |

### Colors
- Light and dark mode supported (toggle in nav)
- CSS variables defined in `app/css/styles.css` (`:root` and `[data-theme="dark"]`)
- Primary blue: `#2563EB`
- Green: `#10B981` (positive), Red: `#EF4444` (negative), Amber: `#F59E0B` (neutral/warning)
- **Market Regime card: NO colored tinted backgrounds. Use colored dot + colored text on clean card background.**

### Centering Pattern
Card headers use **flex:1 spacers** on left and right with **flex:none** on the header text for true centering:
```html
<div class="card-header-bar">
  <span style="flex:1"></span>
  <span style="flex:none">Header Text</span>
  <span style="flex:1;display:flex;justify-content:flex-end;gap:6px;">
    <!-- buttons go here -->
  </span>
</div>
```

### Tagline
"Simplify Your Trading" — 20px, blue (#2563EB), DM Serif Display

### Sectors
**Whenever referencing sectors, always show both the ETF symbol AND the name** (e.g., "XLF Financials", "XLE Energy", "XLK Technology").

---

## Overview Tab (overview.js — 2318 lines)

The Overview tab is the main dashboard. Cards render top-to-bottom in this order:

1. **Morning Mindset** — AI-generated market outlook using regime, breadth, themes. **Must stay at the top.**
2. **Watchlist** — Embedded in Overview (NOT a separate tab). Shows user's tickers with live prices, notes. All cards blue accent (no bias). Click ticker → TradingView chart.
3. **Market Regime** — SPY vs 20 SMA. Shows Risk-On/Risk-Off with colored dot + text. **NO colored backgrounds. NO override button/dropdown — just "auto".**
4. **Breadth Direction** — Tracks % of stocks up vs down throughout the day. Green/red stacked bars over time. Shows "Expanding"/"Contracting" with arrow. Auto-refreshes every 15 min. History persisted in sessionStorage.
5. **Market Snapshot** — SPY/QQQ/IWM/VIX prices and % changes.
6. **Industry Heat Check** — Sector ETF performance with top movers per sector.
7. **Top Headlines** — Polygon news filtered to US stocks only (**max 4-character ticker symbols** to exclude foreign/OTC).
8. **Economic Calendar** — Auto-fetched from Forex Factory via Vercel rewrite (CORS proxy). Shows USD Medium+High impact events grouped by day.
9. **Top Ideas** — Quick scan of ~50 popular tickers. Scores based on SMA compression, extension, relative volume. Shows top 4 as cards.
10. **Themes** — AI-generated market themes using biggest movers + news context.

### Key functions in overview.js:
- `fetchBreadthData()` — Fetches all stock snapshots, calculates up/down/flat %
- `recordBreadthReading()` — Records breadth data point, dedup guard (2 min), stores in sessionStorage
- `renderBreadthTimeline()` — Renders green/red direction bars with expanding/contracting label
- `runQuickScan()` — Scans 50 popular tickers for Top Ideas
- `generateThemes()` — Scans movers, fetches news, sends to AI for theme analysis
- `loadEconCalendar()` — Fetches economic calendar, caches 4hr, renders horizontal day grid
- `refreshWatchlistUI()` — Renders watchlist cards with live prices

### Auto-refresh (during market hours):
- Regime + Breadth + Snapshot refresh every 15 minutes
- Breadth has fast-first-refresh (3 min timeout on page load) + catch-up logic for stale readings >14 min

---

## Setup Scanner (scanner.js — 1200 lines)

### Architecture
Two-layer system using **Top Ideas-style scoring** across the broader US market:
1. **Layer 1: Universe Builder** — Fetches Polygon grouped daily data for ALL US stocks, pre-filters, takes top 100 by dollar volume, scores each, keeps top 150 candidates
2. **Layer 2: Setup Analysis** — Deep-scores each candidate using the same 5-factor system as Top Ideas, returns top 20 setups

### Universe Pre-Filters (Layer 1)
- Price ≥ $20
- Volume ≥ 1M shares/day
- Ticker length ≤ 5 characters, no dots/dashes
- **ETF filter**: 100+ known ETF tickers excluded (SPY, QQQ, EWY, etc. — see `KNOWN_ETFS` array)
- **Top 100 by dollar volume** (price × volume) — ensures only liquid, well-known names

### Scoring (Both Layers — Top Ideas Style, max ~100 pts)
| Factor | Max Points | What It Measures |
|--------|-----------|-----------------|
| SMA Compression | 30 | Spread between 10 and 20 SMA as % of price — tighter = better |
| SMA Alignment | 25 | Above 10+20 SMA = +15, above 50 SMA = +10 |
| Extension | 25 | Distance above 20 SMA — ≤2%=25, ≤4%=18, ≤6%=10, ≤8%=4, >8%=-5 |
| Relative Volume | 10 | Today's volume vs 20-day average — ≥2x=10, ≥1.5x=7, ≥1x=4 |
| Day Change | 5 | Up >1%=5, up >0%=2 |

- Minimum score: **30** to appear in results
- Maximum spread: **5%** (SMA10 vs SMA20) — wider = skip
- Cap results at **20** setups

### Scanner UI
- Single list of cards (blue accent for all — no categories)
- Cards show: ticker (clickable → TradingView chart), price, % change, score circle
- Component bars: Compression, Alignment, Extension, RVol, Momentum
- Quick stats: Spread %, Extension %, RVol, Day Change
- Thesis text: "Tight compression (X%). Above 10/20 SMA. Near base (X%). Xx volume."
- Trade levels: Entry = price, Stop = SMA20 × 0.98, Target = price + 2× risk
- Expandable detail section

### Scanner Caching
- Universe cached in localStorage (`mac_scanner_universe`) with timestamp
- Scan results cached in localStorage (`mac_scan_results`)
- Auto-builds universe on page load when cache is stale
- Legacy key `mac_momentum_top100` auto-cleaned on load
- To force fresh scan: clear both localStorage keys

---

## TradingView Chart Popup (chart.js — 412 lines)

- Click any ticker symbol anywhere in the dashboard → modal popup with TradingView daily chart
- **Exchange-aware routing**: Looks up exchange via Polygon `/v3/reference/tickers/{ticker}`, prefixes symbol (e.g., `NYSE:WES`, `NASDAQ:AAPL`)
- MIC code mapping: XNAS/XNGS/XNMS→NASDAQ, XNYS→NYSE, ARCX→NYSE_ARCA, XASE→AMEX
- **15-minute delayed data** (free widget limitation) — noted in popup header
- Dark/light theme auto-detected
- Close via X button, clicking outside, or Escape key
- All clickable tickers have `title="Click for chart"` hover tooltip
- **First-time hint banner**: Shows once at bottom of screen "Tip: Click any ticker symbol to view its daily chart." Auto-dismisses after 8 seconds. Stored in localStorage (`mac_chart_hint_seen`).
- Tickers wired up in: Scanner cards, Top Ideas cards, Watchlist cards, Sector trend leaders, Theme tickers

---

## Top Ideas vs Scanner (same scoring, different universe)

| | Top Ideas (Overview) | Scanner (Scanner tab) |
|---|---|---|
| Universe | Fixed ~50 popular tickers | Top 100 US stocks by dollar volume |
| Scoring | 5-factor (compression, alignment, extension, RVol, day change) | Same 5-factor scoring |
| Filters | Spread < 5%, score ≥ 30 | Same filters |
| Results | Top 4 cards | Top 20 cards |
| Speed | Fast (50 tickers) | Slower (full market → 100 → score) |

---

## Caching & Deployment

### Vercel Cache
- `vercel.json` sets `Cache-Control: no-cache, must-revalidate` for all `/app/` files
- Script tags in `app/index.html` use `?v=YYYYMMDD` cache-busting params
- **When pushing JS updates, bump the `?v=` version** in `app/index.html` so browsers fetch fresh files
- `app/index.html` also has `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` meta tags

### Current version param: `?v=20260304o` (scanner), `?v=20260304m` (tabs)

---

## API Keys & Credentials

| Key | Storage | Notes |
|-----|---------|-------|
| Polygon API | localStorage (client-side) | User enters in Settings. PAID plan. |
| Anthropic API | Supabase Edge Function env var | Server-side only. Set via Supabase dashboard. |
| Supabase anon key | Hardcoded in auth.js | Publishable key (safe for client). |
| Supabase service role | Edge Function env only | Never expose client-side. |
| Supabase URL | Hardcoded | `https://urpblscayyeadecozgvo.supabase.co` |
| GitHub PAT | Used for pushes | Owner manages this — do not commit to repo. |

---

## User Preferences (DO NOT violate these)

- **No "Copy for Claude" buttons** anywhere
- **No Forex Factory** references in UI
- **No auto/override button on Market Regime** — it should just be "auto"
- **No watchlist as separate tab** — it's embedded in Overview
- **No annual pricing model, no "best value" banners, no 7-day trial**
- **No paywall for now** — launch free, add paywall after 50-100 active users
- **Contact email:** support@marketactioncenter.com (NOT ssmakris@gmail.com)
- **Concept:** Simple, fast, easy to use. Drag and drop.
- **Minimize scrolling.** Highlight and simplify the 3 features (Overview, Scanner, Journal).
- **Morning Mindset must stay at the top** of Overview
- **Keep overview sections lean** — max ~10 items, remove repeat concepts
- **Whenever referencing sectors, always have the ETF symbol AND name** (e.g., "XLF Financials")
- **Market Regime: NO colored tinted backgrounds** — colored dot + colored text on clean card
- **News headlines: only show tickers with 1-4 characters** (excludes foreign/OTC)
- **Present Q&A summary** (questions asked + proposed solutions) **BEFORE pushing any code changes**
- **User prefers direct git pushes** to GitHub over drag-and-drop

---

## Git Workflow

1. All code is on the `main` branch
2. Push to `main` → Vercel auto-deploys the website
3. Push changes to `supabase/functions/` → GitHub Action auto-deploys Edge Functions to Supabase
4. **Always pull before pushing** to avoid conflicts
5. **Bump `?v=` param** in `app/index.html` script tags when pushing JS updates

### Secrets (GitHub → Settings → Secrets)
- `SUPABASE_PROJECT_REF` — Supabase project reference ID
- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token

### Latest commit: `3377013` (March 4, 2026)

---

## Pending / Known Issues

1. **pg_cron for daily scanner at 9:15 AM ET** — Needs Supabase dashboard access to set up
2. **`.github/workflows/deploy-edge-functions.yml`** — Needs manual push (GitHub PAT lacks `workflow` scope)
3. **Supabase `feedback` table** — Not yet created; using preferences JSONB column as workaround
4. **Landing page preview screenshot** — Still shows old "Momentum Scanner" label; needs updated screenshot

---

## Common Tasks

### Adding a new card to Overview
1. Edit `app/js/overview.js`
2. Add HTML with the card-header-bar centering pattern
3. Add render logic in the appropriate function

### Modifying the scanner
1. Edit `app/js/scanner.js` for client-side changes
2. Edit `supabase/functions/daily-scanner/index.ts` for server-side changes
3. Bump `?v=` in `app/index.html`
4. Push to main — both auto-deploy

### Adding a clickable ticker
All clickable tickers should:
1. Call `openTVChart('TICKER')` on click
2. Have `title="Click for chart"` for hover tooltip
3. Have `cursor:pointer` style
4. Use `event.stopPropagation()` if inside a clickable parent

### Updating the landing page
1. Edit `index.html` (root) for content/layout
2. Edit `style.css` (root) for landing page styles
3. Push to main — Vercel deploys

### Adding a new Edge Function
1. Create `supabase/functions/<name>/index.ts`
2. Update `.github/workflows/deploy-edge-functions.yml` to include the new function
3. Push to main — GitHub Action deploys it

### Forcing a fresh scan for testing
In browser console:
```js
localStorage.removeItem('mac_scanner_universe');
localStorage.removeItem('mac_scan_results');
```
Then refresh and click Scan.
