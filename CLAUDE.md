# CLAUDE.md — MAC Terminal Project Guide

> This file gives AI assistants full context on the MAC Terminal project.
> Read this before making any changes.

---

## What Is This?

MAC Terminal (Market Action Center) is a **trading tools dashboard** — NOT a trading platform. It helps stock traders with:
- Morning market overview (regime, breadth, snapshot, catalysts, heatmap)
- Momentum scanner (finds VCP / compression setups)
- AI trade journal (import CSV, get AI analysis)
- AI analysis tab (analyze individual trades)

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
| **Polygon API** | Stock market data (prices, candles, snapshots). PAID plan. Key stored in localStorage (client-side). |
| **Anthropic API (Claude)** | AI features — themes, trade analysis, journal coaching. Key is server-side only (via ai-proxy Edge Function). |
| **GitHub Actions** | Auto-deploys Edge Functions to Supabase when `supabase/functions/` changes. |

---

## Project Structure

```
MAC-TERMINAL/
├── index.html              # Landing page (marketing homepage)
├── style.css               # Landing page styles (uses CSS custom properties from here)
├── images/                 # Landing page screenshots
│   ├── preview-overview.jpg
│   └── preview-scanner.jpg
├── app/
│   ├── index.html          # Dashboard shell (tabs, layout)
│   ├── login.html          # Login page (Supabase auth)
│   ├── css/
│   │   └── styles.css      # Dashboard styles (all CSS variables, themes)
│   └── js/
│       ├── init.js          # App initialization
│       ├── tabs.js          # Tab switching logic
│       ├── config.js        # API URLs, Supabase config
│       ├── auth.js          # Supabase auth (sign in/out)
│       ├── overview.js      # Overview tab (Morning Mindset, Watchlist, Market Regime, Snapshot, Breadth, Heatmap, Catalysts, Top Ideas)
│       ├── scanner.js       # Momentum scanner (Action Center tab)
│       ├── tickers.js       # Stock universe for scanner (~1500-2000 tickers)
│       ├── journal.js       # Trade Journal tab (CSV import, AI recap, calendar)
│       ├── analysis.js      # Analysis tab (AI trade review)
│       ├── api.js           # Polygon API wrapper
│       ├── db.js            # Supabase database operations
│       ├── watchlist.js     # Watchlist management
│       ├── settings.js      # Settings panel
│       ├── account.js       # Account management
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
└── CNAME                    # Domain config for Vercel
```

---

## Design Rules

### Fonts
- **DM Serif Display** — Display/headings font
- **Inter** — Body/UI font
- **JetBrains Mono** — Code/data font

### Font Scale (current)
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
- Green: `#10B981` (positive), Red: `#EF4444` (negative)
- Market Regime card: **NO colored tinted backgrounds**. Use colored dot + colored text on clean card background.

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

---

## Scanner Logic

### How It Works
1. Loads ~1500-2000 stock tickers from `tickers.js`
2. Fetches 20-day price/volume data from Polygon API
3. Scores each stock on: Tightness (30pts), Volume Dry-Up (25pts), Breakout Proximity (25pts), Trend Quality (20pts)
4. Filters to stocks scoring 60+ out of 100
5. Displays setup cards with thesis, score breakdown, and trade levels (entry/stop/target)

### Performance Settings
- Universe scan: batch 25 tickers, 50ms delay between batches
- Breakout scan: batch 15 tickers, 50ms delay
- Skip universe rebuild if cache is fresh (`isMomentumCacheFresh()`)

### Buyout Filter
Excludes stocks that are likely buyout targets (they show false VCP patterns):
- Detects gaps >15% in a single day
- Checks if post-gap price range is <3.5% (excluding the gap day itself)
- If both conditions met → skip the stock
- **Threshold is 3.5%** — intentionally loose to prefer false positives over missed setups

### Scan Strategy
1. Check Supabase for server cache → if fresh, use it
2. Check localStorage for local cache → if fresh, use it
3. Otherwise, run client-side scan
4. Trigger server scan in background (doesn't block UI)

---

## User Preferences (DO NOT violate these)

- **No "Copy for Claude" buttons** anywhere
- **No Forex Factory** references
- **No auto/override button on Market Regime** — it should just be "auto"
- **No watchlist as separate tab** — it's embedded in Overview
- **No annual pricing model, no "best value" banners, no 7-day trial**
- **No paywall for now** — launch free, add paywall after 50-100 active users
- **Contact email:** support@marketactioncenter.com (NOT ssmakris@gmail.com)
- **Concept:** Simple, fast, easy to use. Drag and drop.
- **Minimize scrolling.** Highlight and simplify the 3 features (Overview, Scanner, Journal).
- **Extension filter:** Subtle text-only note in thesis section, no badges/colors
- **Present Q&A summary** (questions asked + proposed solutions) **BEFORE pushing any code changes**

---

## Git Workflow

1. All code is on the `main` branch
2. Push to `main` → Vercel auto-deploys the website
3. Push changes to `supabase/functions/` → GitHub Action auto-deploys Edge Functions to Supabase
4. **Always pull before pushing** to avoid conflicts

### Secrets (GitHub → Settings → Secrets)
- `SUPABASE_PROJECT_REF` — Supabase project reference ID
- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token

---

## API Keys (for reference, NOT to be committed)

API keys are stored in:
- **Polygon key:** localStorage (client-side, user enters in Settings)
- **Anthropic key:** Supabase Edge Function environment variable (server-side only)
- **Supabase anon key:** Hardcoded in `auth.js` (publishable, safe for client)
- **Supabase service role key:** Edge Function environment only (never client-side)

---

## Landing Page Structure

1. **Nav** — Logo + "Get Started Free" button + dark mode toggle
2. **Hero** — "Your Complete Trading Command Center" headline + "Try It Free" CTA
3. **3 Features** — Market Overview, Smart Scanners, AI Trade Journal (icon cards)
4. **Dashboard Preview** — Switchable screenshots (Overview / Scanner tabs)
5. **Footer** — Terms, Privacy, Disclaimer, Feedback links

---

## Common Tasks

### Adding a new card to Overview
1. Edit `app/js/overview.js`
2. Add HTML with the card-header-bar centering pattern
3. Add render logic in the appropriate function

### Modifying the scanner
1. Edit `app/js/scanner.js` for client-side changes
2. Edit `supabase/functions/daily-scanner/index.ts` for server-side changes
3. Push to main — both auto-deploy

### Updating the landing page
1. Edit `index.html` (root) for content/layout
2. Edit `style.css` (root) for landing page styles
3. Push to main — Vercel deploys

### Adding a new Edge Function
1. Create `supabase/functions/<name>/index.ts`
2. Update `.github/workflows/deploy-edge-functions.yml` to include the new function
3. Push to main — GitHub Action deploys it
