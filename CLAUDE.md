# CLAUDE.md — MAC Terminal Project Guide

> This file gives AI assistants full context on the MAC Terminal project.
> Read this COMPLETELY before making any changes.
> **Last updated: March 2, 2026**

---

## What Is This?

MAC Terminal (Market Action Center) is a **trading tools dashboard** — NOT a trading platform. Target audience: **beginner to intermediate traders**. It helps traders with:
- Morning market overview (regime, breadth direction, snapshot, catalysts, heatmap, economic calendar)
- Setup scanner (finds early breakouts + pullback entries before they move)
- Top Ideas (quick scan of 50 popular tickers for compression setups)
- AI trade journal (import CSV, get AI analysis)
- AI analysis tab (analyze individual trades)
- TradingView chart popup (click any ticker to see a daily chart)
- Watchlist with bias tracking (embedded in Overview, NOT a separate tab)

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
│       ├── overview.js      # Overview tab (Morning Mindset, Watchlist, Market Regime, Breadth Direction, Snapshot, Heatmap, Economic Calendar, Top Ideas, Themes)
│       ├── scanner.js       # Setup Scanner tab (Early Breakouts + Pullback Entries)
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

## Overview Tab (overview.js — 1618 lines)

The Overview tab is the main dashboard. Cards render top-to-bottom in this order:

1. **Morning Mindset** — AI-generated market outlook using regime, breadth, themes. **Must stay at the top.**
2. **Watchlist** — Embedded in Overview (NOT a separate tab). Shows user's tickers with bias (long/short/neutral), live prices, notes. Click ticker → TradingView chart.
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

## Setup Scanner (scanner.js — 1207 lines)

### Architecture
Two-layer system:
1. **Layer 1: Universe Builder** — Fetches Polygon grouped daily data for ALL US stocks, filters to top ~150 candidates by compression score
2. **Layer 2: Setup Analysis** — Deep-scores each candidate and categorizes into two groups

### Universe Filters (Layer 1)
- Price > $5
- Volume > 500K
- Ticker length ≤ 5 characters, no dots/dashes
- **ETF filter**: 100+ known ETF tickers excluded (SPY, QQQ, EWY, etc. — see `KNOWN_ETFS` array)
- Must be above 97% of 20 SMA (uptrend filter)

### Universe Scoring (Layer 1 — `calcUniverseScore`)
| Factor | Max Points | What It Measures |
|--------|-----------|-----------------|
| Tightness | 30 | 5-day and 10-day price range — tighter = better |
| Extension Penalty | -20 to +10 | Distance above 20 SMA — near base = good, extended = bad |
| Volume Dry-Up | 20 | 5-day avg volume vs 20-day avg — declining volume in base = good |
| Breakout Proximity | 20 | How close to 10-day high — near breakout = good |
| Trend Quality | 15 | SMA alignment (price > 10 > 20 > 50 SMA) |
| Pullback Bonus | 15 | 3-10% pullback to 10/20 SMA support |

### Buyout Filter
- Range5 < 0.8% = flatlined deal stock → excluded
- Gap >15% + post-gap range <3.5% → excluded
- **Threshold is 3.5%** — intentionally loose

### Two Categories (Layer 2)

**Early Breakouts** (blue accent):
- Stocks compressing in a tight base, haven't broken out yet
- Scored on: Tightness (35), Breakout Proximity (25), Volume Dry-Up (20), Extension adjustment (-20 to +10), Trend (10)
- Badges: "BASE", "NEAR BREAKOUT", "BREAKING OUT"

**Pullback Entries** (purple accent):
- Stocks that ran, pulled back 3-18% to SMA support, now bouncing
- Scored on: Pullback Quality (30), Support Level (25), Volume Decline on pullback (20), Trend Intact (15), Bounce Today (10)
- Shows support level (10 SMA, 20 SMA, 50 SMA)

### Scanner UI
- Cards show ticker (clickable → TradingView chart), price, % change, category badge, score circle
- Component bars visualize each scoring factor
- Quick stats line: 5d range, extension, RVol, breakout level (for breakouts) or dip %, support, SMAs (for pullbacks)
- Expandable detail section with thesis, trade levels (entry/stop/target)

### Scanner Caching
- Universe cached in localStorage (`mac_momentum_top100`) with timestamp
- Scan results cached in localStorage (`mac_scan_results`)
- Auto-builds universe on page load when cache is stale
- To force fresh scan: clear both localStorage keys

---

## TradingView Chart Popup (chart.js — 114 lines)

- Click any ticker symbol anywhere in the dashboard → modal popup with TradingView daily chart
- **15-minute delayed data** (free widget limitation) — noted in popup header
- Dark/light theme auto-detected
- Close via X button, clicking outside, or Escape key
- All clickable tickers have `title="Click for chart"` hover tooltip
- **First-time hint banner**: Shows once at bottom of screen "Tip: Click any ticker symbol to view its daily chart." Auto-dismisses after 8 seconds. Stored in localStorage (`mac_chart_hint_seen`).
- Tickers wired up in: Scanner cards, Top Ideas cards, Watchlist cards, Sector trend leaders, Theme tickers

---

## Top Ideas vs Scanner (they serve different purposes)

| | Top Ideas (Overview) | Scanner (Scanner tab) |
|---|---|---|
| Universe | Fixed ~50 popular tickers | Entire US market → top 150 |
| Looks for | SMA compression (10/20 spread) | Tight price bases + pullbacks to support |
| Rewards | Stocks already moving with volume | Stocks that are quiet and coiling |
| Results | Top 4 cards | Two lists: Early Breakouts + Pullbacks |
| Speed | Fast (50 tickers) | Slower (thousands → 150) |

---

## Caching & Deployment

### Vercel Cache
- `vercel.json` sets `Cache-Control: no-cache, must-revalidate` for all `/app/` files
- Script tags in `app/index.html` use `?v=YYYYMMDD` cache-busting params
- **When pushing JS updates, bump the `?v=` version** in `app/index.html` so browsers fetch fresh files
- `app/index.html` also has `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` meta tags

### Current version param: `?v=20260302`

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
- **Buyout filter threshold: 3.5%**
- **News headlines: only show tickers with 1-4 characters** (excludes foreign/OTC)
- **Extension filter:** Subtle text-only note in thesis section, no badges/colors
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

### Latest commit: `539ddfb` (March 2, 2026)

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
localStorage.removeItem('mac_momentum_top100');
localStorage.removeItem('mac_scan_results');
```
Then refresh and click Scan.
