# MAC Terminal — Full Project State

> **Last updated:** March 3, 2026, 2:45 PM MST
> **Purpose:** Comprehensive project briefing for onboarding AI assistants. Read fully before making changes.

---

## What Is MAC Terminal?

**MAC Terminal (Market Action Center)** is a **trading tools dashboard** — NOT a trading platform. Target audience: **beginner to intermediate traders**.

**Core Features:**
- **Overview tab** — Morning market outlook (regime, breadth, snapshot, catalysts, heatmap, economic calendar, top ideas, themes)
- **Scanner tab** — Setup scanner that finds early breakouts + pullback entries before they move
- **Trade Journal tab** — Import CSV from any broker, get AI-powered trade analysis
- **Analysis tab** — AI-generated end-of-day market analysis with chat interface
- **Watchlist** — Embedded in Overview (NOT a separate tab), with bias tracking (long/short/neutral)
- **TradingView chart popup** — Click any ticker anywhere to see a daily chart (15-min delayed)

**Links:**
- Live site: https://marketactioncenter.com
- Dashboard: https://marketactioncenter.com/app/
- Repo: https://github.com/lifeofcammy/MAC-Terminal (branch: `main`)

---

## Tech Stack

| Service | Purpose | Details |
|---------|---------|---------|
| **Vercel** | Static hosting | Auto-deploys from GitHub `main` branch |
| **Supabase** | Auth + Database | Email + Google sign-in, cloud storage (watchlist, journal, analysis, settings) |
| **Supabase Edge Functions** | Server-side logic | `ai-proxy`, `daily-scanner`, `polygon-proxy` — auto-deployed via GitHub Actions |
| **Polygon API** | Market data | Prices, candles, snapshots, grouped daily. PAID plan: Options Starter ($29/m) + Stocks Starter ($29/m) |
| **Anthropic API (Claude)** | AI features | Themes, trade analysis, journal coaching. Key is server-side only (via `ai-proxy`) |
| **TradingView** | Charts | Free embeddable widget, 15-min delayed. Loaded on-demand |
| **GitHub Actions** | CI/CD | Auto-deploys Edge Functions when `supabase/functions/` changes on push to `main` |

**Infrastructure IDs:**
- Supabase project ref: `urpblscayyeadecozgvo`
- Supabase URL: `https://urpblscayyeadecozgvo.supabase.co`
- Supabase anon key: `sb_publishable_83TVqX2bbCJnXMlW6rGP0A_yu_9o77w` (publishable, safe for client)

---

## Folder/File Structure

```
MAC-TERMINAL/
├── index.html                  # Landing page (marketing homepage)
├── style.css                   # Landing page styles
├── images/                     # Landing page screenshots
│   ├── preview-overview.jpg
│   └── preview-scanner.jpg
├── vercel.json                 # Vercel config (cache headers + CORS proxy rewrite)
├── CNAME                       # Custom domain config
├── CLAUDE.md                   # AI assistant project guide (348 lines)
├── FONT_RULES.md               # Typography reference
│
├── app/                        # === THE DASHBOARD ===
│   ├── index.html              # Dashboard shell (tabs, layout, script tags with ?v= cache busting)
│   ├── login.html              # Login page (Supabase auth)
│   ├── scanner.js              # (duplicate/legacy — real one is in app/js/)
│   ├── css/
│   │   └── styles.css          # All dashboard styles (CSS variables, light + dark themes)
│   └── js/                     # Frontend JavaScript modules (load order matters!)
│       ├── auth.js             #  59 lines — Supabase auth guard, session management
│       ├── config.js           #  34 lines — API URLs, callAIProxy() helper
│       ├── db.js               # 271 lines — Supabase CRUD layer (cloud sync + localStorage fallback)
│       ├── tickers.js          #  43 lines — Stock universe helper
│       ├── utils.js            #  46 lines — Shared helpers (formatters, etc.)
│       ├── account.js          #  17 lines — Account management
│       ├── chart.js            # 114 lines — TradingView chart popup + first-time hint
│       ├── api.js              # 145 lines — Polygon API wrapper (polyGet, polyGetRetry, getDailyBars, getSnapshots)
│       ├── overview.js         # 1618 lines — Overview tab (all 10 cards)
│       ├── watchlist.js        #  45 lines — Watchlist management functions
│       ├── scanner.js          # 1214 lines — Setup Scanner (universe builder + deep scoring)
│       ├── journal.js          # 1118 lines — Trade Journal (CSV import, AI recap, calendar view)
│       ├── analysis.js         # 1000 lines — Analysis tab (AI market analysis + chat)
│       ├── analysis-seed.js    # 214 lines — Sample analysis data for first-time users
│       ├── tabs.js             #  58 lines — Tab switching logic
│       ├── settings.js         #  57 lines — Settings panel
│       ├── feedback.js         # 134 lines — User feedback (stored in Supabase)
│       └── init.js             #  19 lines — App initialization entry point
│
├── supabase/
│   ├── config.toml             # Supabase project config
│   ├── migrations/
│   │   └── create_feedback_table.sql   # Not yet applied — feedback uses user_settings as fallback
│   └── functions/              # === EDGE FUNCTIONS (Deno/TypeScript) ===
│       ├── ai-proxy/
│       │   └── index.ts        # 307 lines — Proxies Anthropic API. Tasks: generate_analysis, analysis_chat
│       ├── daily-scanner/
│       │   └── index.ts        # 963 lines — Background scanner (grouped daily approach, CPU-optimized)
│       └── polygon-proxy/
│           └── index.ts        # 137 lines — Proxies Polygon API (key stays server-side)
│
├── .github/workflows/
│   └── deploy-edge-functions.yml   # Auto-deploy Edge Functions on push (only deploys daily-scanner currently)
│
├── terms.html                  # Terms of service
├── privacy.html                # Privacy policy
├── disclaimer.html             # Trading disclaimer
└── .gitignore                  # Only ignores supabase/.temp/
```

**Total codebase:** ~7,600 lines across all files.

---

## Script Load Order (Critical!)

Scripts in `app/index.html` load synchronously in this exact order. Dependencies flow top-to-bottom:

```
1. auth.js      — Supabase client init, auth guard
2. config.js    — API endpoints, callAIProxy()
3. db.js        — Database layer (needs auth.js)
4. tickers.js   — Stock universe
5. utils.js     — Shared helpers
6. account.js   — Account management
7. chart.js     — TradingView popup
8. api.js       — Polygon API wrapper
9. overview.js  — Overview tab (needs api.js, db.js)
10. watchlist.js — Watchlist (needs db.js)
11. scanner.js  — Scanner tab (needs api.js, tickers.js)
12. journal.js  — Journal tab (needs db.js, config.js)
13. analysis.js — Analysis tab (needs db.js, config.js)
14. analysis-seed.js — Sample data
15. tabs.js     — Tab switching
16. settings.js — Settings panel
17. feedback.js — Feedback widget
18. init.js     — Final initialization
```

**Cache busting:** Each script tag has `?v=YYYYMMDD` suffix. Current versions vary (20260302 to 20260303h). **When pushing JS updates, bump the `?v=` param** in `app/index.html`.

---

## Supabase Database Schema

### Tables (7 total, all under `public` schema)

All user-facing tables use `user_id` (UUID from Supabase Auth) as the primary key or part of a composite key. Row-Level Security (RLS) is enabled — users can only read/write their own data.

#### 1. `watchlist`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | PK, references auth.users |
| tickers | jsonb | Array of watchlist ticker objects (symbol, bias, notes) |
| updated_at | timestamptz | Auto-set on upsert |

#### 2. `journal_entries`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | PK, references auth.users |
| entries | jsonb | Array of trade entry objects |
| updated_at | timestamptz | Auto-set on upsert |

#### 3. `analysis`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | Composite PK with date |
| date | text | YYYY-MM-DD format |
| data | jsonb | Full analysis JSON (market context, movers, probability map, etc.) |
| updated_at | timestamptz | Auto-set on upsert |

#### 4. `calendar_summaries`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | PK, references auth.users |
| summaries | jsonb | Calendar summary data keyed by date |
| updated_at | timestamptz | Auto-set on upsert |

#### 5. `recap_data`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | Composite PK with date |
| date | text | YYYY-MM-DD format |
| csv_data | text | Raw CSV trade data |
| html_recap | text | AI-generated HTML recap |
| updated_at | timestamptz | Auto-set on upsert |

#### 6. `user_settings`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | PK, references auth.users |
| account_size | text | Trading account size |
| risk_pct | text | Risk percentage per trade |
| preferences | jsonb | Misc preferences (also used as feedback fallback) |
| updated_at | timestamptz | Auto-set on upsert |

#### 7. `scan_results`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto-generated |
| scan_date | date | The date of the scan (YYYY-MM-DD) |
| momentum_universe | jsonb | Full universe data (100 tickers with scores, prices, SMA data) |
| early_breakouts | jsonb | Scored early breakout setups |
| pullback_entries | jsonb | Scored pullback entry setups |

> **Note:** The `feedback` table has a migration file (`create_feedback_table.sql`) but has NOT been applied yet. Feedback currently stores in the `user_settings.preferences` JSONB column as a workaround.

### Auth
- **Supabase Auth** handles all authentication
- Providers: Email/password + Google OAuth
- **9 users** currently registered
- Session tokens (JWT) are used to authenticate Edge Function calls

---

## Edge Functions (Server-Side)

### 1. `ai-proxy` (307 lines)
- **Purpose:** Secure proxy for Anthropic Claude API calls
- **Security:** Validates Supabase JWT, rate limits (20 calls/hour/user), builds prompts server-side
- **Tasks:**
  - `generate_analysis` — Generates end-of-day market analysis (model: claude-sonnet-4, 4096 tokens)
  - `analysis_chat` — Chat with AI about a day's analysis (model: claude-sonnet-4, 1000 tokens)
- **Env vars:** `ANTHROPIC_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### 2. `daily-scanner` (963 lines)
- **Purpose:** Background scanner that runs server-side to pre-compute scan results
- **Architecture:** Fetches 30 trading days of Polygon grouped-daily data (~45 API calls), builds ticker maps, filters universe, scores candidates
- **Optimizations (latest):**
  - 30 days lookback (was 60) — reduces map insertions from 600K+ to ~300K
  - Early filtering during map building (skips >5 char tickers, dots/dashes, known ETFs)
  - `arrMax`/`arrMin` loop helpers replace `Math.max(...spread)` to avoid stack overflow
  - Batch size 3 (was 5) for grouped-daily fetches
- **Endpoint:** `POST /functions/v1/daily-scanner?force=true`
- **Env vars:** `POLYGON_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Constraint:** Supabase Edge Functions have 2s CPU limit, 150s wall clock, 256MB memory
- **Status:** Latest optimizations pushed, awaiting deployment + testing

### 3. `polygon-proxy` (137 lines)
- **Purpose:** Secure proxy for Polygon.io API calls (key stays server-side)
- **Security:** Validates Supabase JWT, rate limits (5 req/sec/user), whitelist of allowed Polygon paths
- **Allowed endpoints:** `/v2/aggs/`, `/v2/snapshot/`, `/v3/snapshot/`, `/v2/reference/news`, `/v2/reference/tickers`, `/v3/reference/`
- **Env vars:** `POLYGON_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

---

## Frontend Architecture Deep Dive

### Overview Tab (`overview.js` — 1618 lines)
Cards render top-to-bottom in this order:
1. **Morning Mindset** — AI-generated market outlook. **Must stay at the top.**
2. **Watchlist** — Embedded in Overview (NOT separate tab). Bias tracking, live prices.
3. **Market Regime** — SPY vs 20 SMA. Risk-On/Risk-Off. No colored backgrounds, no override button.
4. **Breadth Direction** — % stocks up vs down. Green/red stacked bars. Auto-refreshes every 15 min.
5. **Market Snapshot** — SPY/QQQ/IWM/VIX prices and % changes.
6. **Industry Heat Check** — Sector ETF performance with top movers.
7. **Top Headlines** — Polygon news, filtered to US stocks only (max 4-char tickers).
8. **Economic Calendar** — From Forex Factory via Vercel rewrite proxy. USD Medium+High impact events.
9. **Top Ideas** — Quick scan of ~50 popular tickers for SMA compression setups. Shows top 4 cards.
10. **Themes** — AI-generated market themes from biggest movers + news.

**Auto-refresh during market hours:** Regime + Breadth + Snapshot every 15 min. Breadth has fast-first-refresh (3 min on page load).

### Scanner Tab (`scanner.js` — 1214 lines)
Two-layer system:

**Layer 1: Universe Builder**
- Fetches Polygon grouped daily data for ALL US stocks
- Filters: Price >$5, Volume >500K, Ticker ≤5 chars, no dots/dashes, excludes 100+ known ETFs, above 97% of 20 SMA
- Scores on: Tightness (30pts), Extension (-20 to +10), Volume Dry-Up (20), Breakout Proximity (20), Trend Quality (15), Pullback Bonus (15)
- Top ~150 candidates pass to Layer 2

**Layer 2: Setup Analysis** — categorizes into:
- **Early Breakouts** (blue accent): Tight base, near breakout. Badges: "BASE", "NEAR BREAKOUT", "BREAKING OUT"
- **Pullback Entries** (purple accent): Ran up, pulled back 3-18% to SMA support, now bouncing

**Buyout Filter:** Range5 <0.8% = flatlined deal stock (excluded). Gap >15% + post-gap range <3.5% = excluded.

**Caching:** Universe + scan results cached in localStorage with timestamps.

### Trade Journal (`journal.js` — 1118 lines)
- Calendar view with monthly P&L grid
- Drill into any day → drop CSV or paste trades → get AI analysis
- Supports any broker CSV format
- AI generates: P&L summary, behavioral analysis, coaching insights
- Data persisted to Supabase `recap_data` table

### Analysis Tab (`analysis.js` — 1000 lines)
- Date navigation (arrows + dropdown)
- 3 sub-sections: Summary, Setups, Review
- AI chat interface — ask questions about any day's analysis
- Generates analysis via `ai-proxy` Edge Function
- First-time users see seed data from `analysis-seed.js`

### Data Layer (`db.js` — 271 lines)
- **Dual-layer:** Supabase (cloud) + localStorage (fast cache)
- When logged in: reads/writes Supabase with localStorage as cache
- When logged out: falls back to localStorage only
- On first login: `migrateLocalToCloud()` pushes any localStorage data to Supabase

---

## Deployment Pipeline

```
Push to main branch
    ├── Vercel auto-deploys static site (index.html, app/*, css, js)
    └── GitHub Actions deploys Edge Functions (if supabase/functions/* changed)
```

### Vercel Config (`vercel.json`)
- Cache-Control: `no-cache, must-revalidate` for all `/app/` files
- Rewrite: `/api/econ-calendar` → Forex Factory JSON (CORS proxy)

### GitHub Actions (`.github/workflows/deploy-edge-functions.yml`)
- Triggers on push to `main` when `supabase/functions/**` changes
- Currently only deploys `daily-scanner`
- Requires secrets: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`
- **Known issue:** GitHub PAT lacks `workflow` scope, so the workflow file itself needs manual push

### Manual Deploy (when needed)
```bash
supabase functions deploy daily-scanner --no-verify-jwt --project-ref urpblscayyeadecozgvo
```

---

## API Keys & Secrets

| Key | Storage Location | Notes |
|-----|-----------------|-------|
| Polygon API key | Supabase Edge Function env (`POLYGON_API_KEY`) | Server-side only for `daily-scanner` and `polygon-proxy` |
| Anthropic API key | Supabase Edge Function env (`ANTHROPIC_KEY`) | Server-side only for `ai-proxy` |
| Supabase anon key | Hardcoded in `auth.js` | Publishable (safe for client) |
| Supabase service role key | Edge Function env only | Never expose client-side |
| Supabase URL | Hardcoded | `https://urpblscayyeadecozgvo.supabase.co` |
| GitHub Secrets | `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` | For GitHub Actions Edge Function deploy |

---

## Design System

### Fonts
- **DM Serif Display** — Headings/display (20px card headers, tagline)
- **Inter** — Body/UI (14px body, 12px labels)
- **JetBrains Mono** — Code/data/tickers (14px)

### Colors
- Primary blue: `#2563EB`
- Green (positive): `#10B981`, Red (negative): `#EF4444`, Amber (warning): `#F59E0B`
- Light + dark mode via CSS variables in `:root` and `[data-theme="dark"]`

### Key UI Patterns
- Card header centering: flex:1 spacers on left/right, flex:none on header text
- Tagline: "Simplify Your Trading" — 20px, blue, DM Serif Display
- Sectors always show ETF symbol AND name (e.g., "XLF Financials")
- Market Regime: NO colored backgrounds — colored dot + colored text on clean card
- Clickable tickers: call `openTVChart('TICKER')`, have `title="Click for chart"`, `cursor:pointer`

---

## User Preferences (DO NOT Violate)

- No "Copy for Claude" buttons anywhere
- No Forex Factory references in UI
- No auto/override button on Market Regime — just "auto"
- No watchlist as separate tab — embedded in Overview
- No annual pricing, no "best value" banners, no 7-day trial
- No paywall for now — launch free, add paywall after 50-100 active users
- Contact: support@marketactioncenter.com
- Morning Mindset must stay at top of Overview
- News headlines: only show tickers with 1-4 characters
- Extension filter: subtle text-only note in thesis, no badges/colors
- Buyout filter threshold: 3.5%
- Keep overview sections lean — max ~10 items
- Minimize scrolling

---

## Git Workflow

1. All code on `main` branch (no feature branches currently in use)
2. Push to `main` → Vercel auto-deploys website + GitHub Actions deploys Edge Functions
3. **Always pull before pushing** to avoid conflicts
4. **Bump `?v=` param** in `app/index.html` when pushing JS updates
5. Present Q&A summary (questions + proposed solutions) BEFORE pushing code changes
6. User prefers direct git pushes to GitHub over drag-and-drop

### Current `?v=` Versions (as of March 3, 2026)
- styles.css: `?v=20260302b`
- auth.js: `?v=20260302`
- config.js: `?v=20260303h`
- db.js: `?v=20260303h`
- tickers.js, utils.js, account.js, chart.js, overview.js, watchlist.js, journal.js, feedback.js: `?v=20260302`
- api.js: `?v=20260303h`
- scanner.js: `?v=20260303g`
- analysis.js: `?v=20260303h`
- analysis-seed.js: `?v=20260303`
- tabs.js: `?v=20260303d`
- settings.js: `?v=20260303h`
- init.js: `?v=20260303d`

---

## What's Been Built (Complete)

- [x] Landing page with feature previews
- [x] Auth system (email + Google, Supabase)
- [x] Overview tab with all 10 cards (Mindset, Watchlist, Regime, Breadth, Snapshot, Heatmap, Headlines, Calendar, Top Ideas, Themes)
- [x] Scanner tab (universe builder + deep scoring, Early Breakouts + Pullback Entries)
- [x] Trade Journal (CSV import, AI recap, calendar grid, export/import)
- [x] Analysis tab (AI generation, date navigation, chat interface)
- [x] TradingView chart popup (click any ticker)
- [x] Cloud sync (Supabase DB with localStorage cache)
- [x] Dark/light theme toggle
- [x] Settings panel
- [x] Feedback widget
- [x] Server-side AI proxy (rate-limited, prompt-controlled)
- [x] Server-side Polygon proxy (rate-limited, path-whitelisted)
- [x] Daily scanner Edge Function (grouped-daily approach, CPU-optimized)
- [x] GitHub Actions auto-deploy for Edge Functions
- [x] Terms, privacy, disclaimer pages

## What's Still To Do / Known Issues

1. **Daily scanner deployment + testing** — Latest CPU optimizations pushed (commit `4c3274f`), needs user to deploy via CLI and test. If 2s CPU limit still hit, may need to reduce to 20 days or split into multi-step.
2. **pg_cron for daily scanner at 9:15 AM ET** — Needs Supabase dashboard setup to auto-trigger scanner each morning.
3. **GitHub Actions workflow file** — Needs manual push (GitHub PAT lacks `workflow` scope). Currently only deploys `daily-scanner`, should also deploy `ai-proxy` and `polygon-proxy`.
4. **Feedback table** — Migration exists but not applied. Using `user_settings.preferences` JSONB as workaround.
5. **Landing page screenshot** — Still shows old "Momentum Scanner" label; needs updated screenshot.
6. **Paywall** — Not implemented yet. Plan: launch free, add paywall after 50-100 active users.
7. **50 SMA limitation** — With 30-day lookback, 50 SMA returns null. Scoring handles this gracefully but trend quality points are slightly reduced.

---

## Recent Changes Log

| Date | What Changed | Commit |
|------|-------------|--------|
| Mar 3, 2026 | Daily scanner CPU optimization: 60→30 days, early filtering, arrMax/arrMin helpers, batch 3 | `4c3274f` |
| Mar 2, 2026 | Fixed variable shadowing bug (`results`→`batchResults` + `dayBars`) | previous |
| Mar 2, 2026 | Rewrote daily-scanner from 3000+ individual API calls to grouped-daily (~45 calls) | previous |
| Mar 2, 2026 | Various config.js, db.js, analysis.js, settings.js updates | previous |

---

## Key Engineering Decisions

1. **Client-side Polygon calls (most features)** — The dashboard makes Polygon API calls directly from the browser for real-time data (overview, scanner UI). The `polygon-proxy` exists for features that need server-side access.
2. **Server-side AI calls** — All Anthropic API calls go through `ai-proxy` to keep the key secret and enforce rate limits + prompt templates.
3. **localStorage as fast cache** — Every DB operation writes to both Supabase and localStorage. Reads try Supabase first, fall back to localStorage. This provides offline-like speed.
4. **No bundler/framework** — Pure vanilla JS with synchronous `<script>` tags. Simple, no build step, but load order matters.
5. **Edge Functions on free tier** — 2s CPU limit, 150s wall clock, 256MB memory. The daily scanner is the most resource-intensive function and has been heavily optimized for this constraint.

---

## Coordination Rules (Multi-AI Workflow)

**Perplexity** (has GitHub, Supabase, Vercel access):
- Deployments, code pushes, database migrations, debugging live issues
- Works on feature branches when possible

**Claude** (no access to infrastructure):
- Isolated components, code logic, architecture decisions, code reviews
- User copies code back and forth

**Ground Rules:**
- Don't edit the same files simultaneously — check with the user first
- Commit frequently for rollback points
- When merging Claude's code, don't overwrite without confirmation
- After major changes, provide updated summary for Claude
