// ==================== scanner.js ====================
// MAC Terminal — Full scanner + live market data
// v3.0 — all tickers clickable, cache-bust on every load

'use strict';

/* ─────────────────────────────────────────
   0. UNIVERSE — symbols rendered as cards
───────────────────────────────────────── */
const UNIVERSE = [
  // Mega-cap tech
  { sym: 'AAPL',  name: 'Apple' },
  { sym: 'MSFT',  name: 'Microsoft' },
  { sym: 'NVDA',  name: 'NVIDIA' },
  { sym: 'GOOG',  name: 'Alphabet' },
  { sym: 'AMZN',  name: 'Amazon' },
  { sym: 'META',  name: 'Meta' },
  { sym: 'TSLA',  name: 'Tesla' },
  { sym: 'AVGO',  name: 'Broadcom' },
  { sym: 'ORCL',  name: 'Oracle' },
  { sym: 'CRM',   name: 'Salesforce' },
  // Financials
  { sym: 'JPM',   name: 'JPMorgan' },
  { sym: 'GS',    name: 'Goldman' },
  { sym: 'MS',    name: 'Morgan Stanley' },
  { sym: 'BAC',   name: 'Bank of America' },
  { sym: 'BRK-B', name: 'Berkshire' },
  // Health
  { sym: 'LLY',   name: 'Eli Lilly' },
  { sym: 'UNH',   name: 'UnitedHealth' },
  { sym: 'JNJ',   name: 'J&J' },
  // Energy / Industrials
  { sym: 'XOM',   name: 'Exxon' },
  { sym: 'CAT',   name: 'Caterpillar' },
  { sym: 'GE',    name: 'GE Aerospace' },
  // Consumer
  { sym: 'COST',  name: 'Costco' },
  { sym: 'WMT',   name: 'Walmart' },
  { sym: 'NKE',   name: 'Nike' },
  // ETFs
  { sym: 'SPY',   name: 'S&P 500 ETF' },
  { sym: 'QQQ',   name: 'Nasdaq ETF' },
  { sym: 'IWM',   name: 'Russell 2000' },
  { sym: 'GLD',   name: 'Gold ETF' },
  { sym: 'TLT',   name: '  20yr Treasury' },
  { sym: 'VIX',   name: 'Volatility Idx' },
];

/* ─────────────────────────────────────────
   1. TICKER BAR SYMBOLS
───────────────────────────────────────── */
const TICKER_SYMS = ['SPY','QQQ','IWM','DIA','VIX','GLD','TLT','AAPL','MSFT','NVDA','TSLA','META','AMZN','GOOG','JPM','GS','BRK-B'];

/* ─────────────────────────────────────────
   2. CONSTANTS
───────────────────────────────────────── */
const BATCH   = 10;          // symbols per fetch
const REFRESH = 60_000;      // ms between auto-refreshes
const BASE    = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';

/* ─────────────────────────────────────────
   3. STATE
───────────────────────────────────────── */
let scannerData = [];         // flat array of quote objects
let sortKey     = 'changePercent';
let sortDir     = -1;         // -1 desc
let filterText  = '';
let filterSector= '';
let currentTab  = 'scanner';

/* ─────────────────────────────────────────
   4. YAHOO FINANCE FETCH  (cache-busted)
───────────────────────────────────────── */
async function fetchQuotes(syms) {
  const cb  = Date.now();                          // ← cache-bust token
  const url = `${BASE}${syms.join(',')}&_cb=${cb}`;
  try {
    const res  = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return (json?.quoteResponse?.result ?? []);
  } catch { return []; }
}

async function fetchAll(symList) {
  const results = [];
  for (let i = 0; i < symList.length; i += BATCH) {
    const batch = symList.slice(i, i + BATCH);
    const data  = await fetchQuotes(batch);
    results.push(...data);
  }
  return results;
}

/* ─────────────────────────────────────────
   5. FORMATTERS
───────────────────────────────────────── */
const fmt$ = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const fmtM   = v => {
  if (v == null) return '—';
  if (v >= 1e12) return '$' + (v/1e12).toFixed(2) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(1) + 'M';
  return '$' + Number(v).toLocaleString();
};
const fmtVol = v => {
  if (v == null) return '—';
  if (v >= 1e9)  return (v/1e9).toFixed(2) + 'B';
  if (v >= 1e6)  return (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3)  return (v/1e3).toFixed(0) + 'K';
  return v.toString();
};
const cls = v => v == null ? '' : v >= 0 ? 'up' : 'dn';

/* ─────────────────────────────────────────
   6. TICKER BAR
───────────────────────────────────────── */
function renderTickerBar(quotes) {
  const bar = document.getElementById('tickerBar');
  if (!bar) return;
  bar.innerHTML = quotes.map(q => {
    const sym = q.symbol;
    const chg = q.regularMarketChangePercent;
    const cls2 = chg >= 0 ? 'up' : 'dn';
    const sign = chg >= 0 ? '+' : '';
    return `<span class="ticker-chip" data-sym="${sym}">
      <span class="sym">${sym}</span>
      <span class="chg ${cls2}">${sign}${chg != null ? chg.toFixed(2) : '0.00'}%</span>
    </span>`;
  }).join('');
}

/* ─────────────────────────────────────────
   7. UNIVERSE GRID
───────────────────────────────────────── */
function renderUniverse(quotes) {
  const grid = document.getElementById('universeGrid');
  if (!grid) return;
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  grid.innerHTML = UNIVERSE.map(u => {
    const q   = map[u.sym] || {};
    const chg = q.regularMarketChangePercent;
    const px  = q.regularMarketPrice;
    const dir = chg == null ? '' : chg >= 0 ? 'up' : 'dn';
    const sign= chg >= 0 ? '+' : '';
    return `
      <button class="universe-chip" data-sym="${u.sym}" type="button">
        <span class="u-sym">${u.sym}</span>
        <span class="u-name">${u.name}</span>
        <span class="u-chg ${dir}">${px != null ? fmt$(px) : '—'} <span style="font-size:0.65rem">${chg != null ? sign+chg.toFixed(2)+'%' : ''}</span></span>
      </button>`;
  }).join('');
}

/* ─────────────────────────────────────────
   8. WATCHLIST
───────────────────────────────────────── */
const WATCHLIST = ['AAPL','NVDA','MSFT','TSLA','META','AMZN'];

function renderWatchlist(quotes) {
  const el = document.getElementById('watchlistBody');
  if (!el) return;
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  el.innerHTML = WATCHLIST.map(sym => {
    const q   = map[sym] || {};
    const px  = q.regularMarketPrice;
    const chg = q.regularMarketChangePercent;
    const dir = chg == null ? '' : chg >= 0 ? 'up' : 'dn';
    const sign= chg >= 0 ? '+' : '';
    return `<div class="watchlist-row" data-sym="${sym}">
      <div class="wl-left">
        <span class="wl-sym">${sym}</span>
        <span class="wl-name">${q.longName || q.shortName || ''}</span>
      </div>
      <div class="wl-right">
        <span class="wl-price">${px != null ? fmt$(px) : '—'}</span>
        <span class="wl-chg ${dir}">${chg != null ? sign+chg.toFixed(2)+'%' : '—'}</span>
      </div>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   9. SCANNER TABLE
───────────────────────────────────────── */
const SCANNER_SYMS = [
  'AAPL','MSFT','NVDA','GOOG','AMZN','META','TSLA','AVGO','ORCL','CRM',
  'ADBE','NOW','NFLX','AMD','INTC','QCOM','TXN','MU','AMAT','LRCX',
  'JPM','GS','MS','BAC','WFC','C','BLK','AXP','COF','USB',
  'LLY','UNH','JNJ','ABBV','MRK','BMY','PFE','AMGN','GILD','REGN',
  'XOM','CVX','COP','SLB','EOG','PXD','OXY','VLO','MPC','PSX',
  'CAT','GE','HON','MMM','DE','LMT','RTX','NOC','BA','GD',
  'COST','WMT','TGT','HD','LOW','MCD','SBUX','NKE','PG','KO',
  'SPY','QQQ','IWM','DIA','GLD','SLV','TLT','HYG','XLF','XLE',
  'BRK-B','V','MA','PYPL','SQ','COIN','HOOD','SOFI'
];

function applyFilter(data) {
  let d = [...data];
  if (filterText) {
    const q = filterText.toLowerCase();
    d = d.filter(r => r.symbol.toLowerCase().includes(q) ||
                      (r.longName || '').toLowerCase().includes(q));
  }
  if (filterSector) d = d.filter(r => (r.sector || '') === filterSector);
  return d;
}

function sortData(data) {
  return [...data].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) va = -Infinity;
    if (vb == null) vb = -Infinity;
    return sortDir * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

function renderScanner(data) {
  const tbody = document.getElementById('scannerBody');
  if (!tbody) return;
  const rows = sortData(applyFilter(data));
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted)">No results</td></tr>'; return; }
  tbody.innerHTML = rows.map(q => {
    const sym   = q.symbol;
    const price = q.regularMarketPrice;
    const chg   = q.regularMarketChange;
    const pct   = q.regularMarketChangePercent;
    const vol   = q.regularMarketVolume;
    const avgV  = q.averageDailyVolume3Month;
    const mc    = q.marketCap;
    const hi52  = q.fiftyTwoWeekHigh;
    const lo52  = q.fiftyTwoWeekLow;
    const volRatio = (vol && avgV) ? (vol/avgV).toFixed(2) : '—';
    const distHi   = (price && hi52) ? (((hi52-price)/hi52)*100).toFixed(1)+'%' : '—';
    const dirCls   = cls(pct);
    return `<tr data-sym="${sym}">
      <td class="sym-col">${sym}</td>
      <td class="num">${fmt$(price)}</td>
      <td class="num ${dirCls}">${chg != null ? (chg>0?'+':'')+chg.toFixed(2) : '—'}</td>
      <td class="num ${dirCls}">${fmtPct(pct)}</td>
      <td class="num">${fmtVol(vol)}</td>
      <td class="num">${volRatio}</td>
      <td class="num">${fmtM(mc)}</td>
      <td class="num">${fmt$(hi52)}</td>
      <td class="num">${distHi}</td>
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────
   10. HEATMAP
───────────────────────────────────────── */
const HEATMAP_SYMS = [
  'AAPL','MSFT','NVDA','GOOG','AMZN','META','TSLA','AVGO',
  'JPM','GS','BAC','LLY','UNH','XOM','CVX','CAT'
];

const heatColor = pct => {
  if (pct == null) return 'hsl(220,15%,30%)';
  const clamped = Math.max(-5, Math.min(5, pct));
  if (clamped >= 0) {
    const l = 35 - clamped * 4;
    return `hsl(142,${55 + clamped*6}%,${l}%)`;
  } else {
    const l = 35 + clamped * 4;
    return `hsl(0,${55 + Math.abs(clamped)*6}%,${l}%)`;
  }
};

function renderHeatmap(quotes) {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  grid.innerHTML = HEATMAP_SYMS.map(sym => {
    const q   = map[sym] || {};
    const pct = q.regularMarketChangePercent;
    const bg  = heatColor(pct);
    const sign= pct != null && pct >= 0 ? '+' : '';
    return `<div class="heatmap-cell" data-sym="${sym}" style="background:${bg}">
      <span class="h-sym">${sym}</span>
      <span class="h-chg">${pct != null ? sign+pct.toFixed(2)+'%' : '—'}</span>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   11. STAT CARDS  (top row)
───────────────────────────────────────── */
function renderStats(quotes) {
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  const spy = map['SPY'] || {};
  const qqq = map['QQQ'] || {};
  const vix = map['VIX'] || {};

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setCls = (id, val) => { const el = document.getElementById(id); if (el) { el.className = ''; el.classList.add(val >= 0 ? 'up' : 'dn'); } };

  set('statSpyPrice',  fmt$(spy.regularMarketPrice));
  set('statSpyChg',    fmtPct(spy.regularMarketChangePercent));
  setCls('statSpyChg', spy.regularMarketChangePercent);

  set('statQqqPrice',  fmt$(qqq.regularMarketPrice));
  set('statQqqChg',    fmtPct(qqq.regularMarketChangePercent));
  setCls('statQqqChg', qqq.regularMarketChangePercent);

  set('statVixPrice',  vix.regularMarketPrice != null ? Number(vix.regularMarketPrice).toFixed(2) : '—');
  set('statVixChg',    fmtPct(vix.regularMarketChangePercent));
  setCls('statVixChg', vix.regularMarketChangePercent);

  // Advances/Declines from scanner universe
  const scanQuotes = quotes.filter(q => SCANNER_SYMS.includes(q.symbol));
  const adv = scanQuotes.filter(q => (q.regularMarketChangePercent ?? 0) >= 0).length;
  const dec = scanQuotes.filter(q => (q.regularMarketChangePercent ?? 0) < 0).length;
  set('statAdv', adv);
  set('statDec', dec);
}

/* ─────────────────────────────────────────
   12. MACRO BAR
───────────────────────────────────────── */
function renderMacro(quotes) {
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  const MACRO_MAP = [
    { id: 'macroDxy',  sym: 'DX-Y.NYB', label: 'DXY' },
    { id: 'macroGold', sym: 'GLD',       label: 'Gold' },
    { id: 'macroOil',  sym: 'USO',       label: 'Oil' },
    { id: 'macroBtc',  sym: 'BTC-USD',   label: 'BTC' },
    { id: 'macroTlt',  sym: 'TLT',       label: '10yr Bond' },
    { id: 'macroVix',  sym: 'VIX',       label: 'VIX' },
  ];

  MACRO_MAP.forEach(({ id, sym }) => {
    const q   = map[sym] || {};
    const px  = q.regularMarketPrice;
    const pct = q.regularMarketChangePercent;
    const elV = document.getElementById(id + 'Val');
    const elC = document.getElementById(id + 'Chg');
    if (elV) elV.textContent = px != null ? (sym === 'BTC-USD' ? '$'+Math.round(px).toLocaleString() : px.toFixed(2)) : '—';
    if (elC) {
      elC.textContent = fmtPct(pct);
      elC.className   = 'macro-sub ' + (pct != null ? (pct >= 0 ? 'up' : 'dn') : '');
    }
  });
}

/* ─────────────────────────────────────────
   13. SENTIMENT BARS
───────────────────────────────────────── */
function renderSentiment(quotes) {
  const scanQ = quotes.filter(q => SCANNER_SYMS.includes(q.symbol));
  const total = scanQ.length || 1;
  const adv   = scanQ.filter(q => (q.regularMarketChangePercent ?? 0) >= 0).length;
  const dec   = total - adv;
  const advPct = ((adv / total) * 100).toFixed(0);
  const decPct = ((dec / total) * 100).toFixed(0);

  const aboveMA = scanQ.filter(q => q.regularMarketPrice != null &&
                                    q.fiftyDayAverage != null &&
                                    q.regularMarketPrice > q.fiftyDayAverage).length;
  const abovePct = ((aboveMA / total) * 100).toFixed(0);

  const vol50 = scanQ.filter(q => q.regularMarketVolume != null &&
                                  q.averageDailyVolume3Month != null &&
                                  q.regularMarketVolume > q.averageDailyVolume3Month).length;
  const volPct = ((vol50 / total) * 100).toFixed(0);

  const rows = [
    { id: 'sentAdv',    val: advPct,   fill: 'var(--green)' },
    { id: 'sentDec',    val: decPct,   fill: 'var(--red)'   },
    { id: 'sentAbove',  val: abovePct, fill: 'var(--blue)'  },
    { id: 'sentVolume', val: volPct,   fill: 'var(--amber)' },
  ];
  rows.forEach(({ id, val, fill }) => {
    const fillEl = document.getElementById(id + 'Fill');
    const valEl  = document.getElementById(id + 'Val');
    if (fillEl) { fillEl.style.width = val + '%'; fillEl.style.background = fill; }
    if (valEl)  valEl.textContent = val + '%';
  });
}

/* ─────────────────────────────────────────
   14. NEWS  (static placeholder — wire to API later)
───────────────────────────────────────── */
const NEWS = [
  { headline: 'Fed holds rates steady; Powell signals patience on cuts', source: 'Reuters',   time: '2h ago' },
  { headline: 'NVDA beats Q4 estimates; data-center revenue surges 112%',source: 'Bloomberg', time: '3h ago' },
  { headline: 'S&P 500 closes at record high driven by tech rally',       source: 'WSJ',       time: '4h ago' },
  { headline: 'Apple unveils next-gen silicon; stock gains 2.8% AH',      source: 'CNBC',      time: '5h ago' },
  { headline: 'Treasury yields pull back as inflation data cools',        source: 'FT',        time: '6h ago' },
  { headline: 'China GDP beats forecasts; EMs see broad-based rally',     source: 'Reuters',   time: '8h ago' },
];

function renderNews() {
  const el = document.getElementById('newsFeed');
  if (!el) return;
  el.innerHTML = NEWS.map(n => `
    <div class="news-item">
      <span class="news-headline">${n.headline}</span>
      <span class="news-meta"><span class="news-source">${n.source}</span><span>${n.time}</span></span>
    </div>`).join('');
}

/* ─────────────────────────────────────────
   15. SORT HEADERS
───────────────────────────────────────── */
function bindSortHeaders() {
  document.querySelectorAll('[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = -1; }
      renderScanner(scannerData);
      document.querySelectorAll('[data-sort]').forEach(h => h.classList.remove('active-sort'));
      th.classList.add('active-sort');
    });
  });
}

/* ─────────────────────────────────────────
   16. FILTER CONTROLS
───────────────────────────────────────── */
function bindFilterControls() {
  const input = document.getElementById('scannerSearch');
  const sel   = document.getElementById('sectorFilter');
  const reset = document.getElementById('resetFilters');

  if (input) input.addEventListener('input',  e => { filterText   = e.target.value; renderScanner(scannerData); });
  if (sel)   sel.addEventListener('change',   e => { filterSector = e.target.value; renderScanner(scannerData); });
  if (reset) reset.addEventListener('click',  ()=> {
    filterText = ''; filterSector = '';
    if (input) input.value = '';
    if (sel)   sel.value   = '';
    renderScanner(scannerData);
  });
}

/* ─────────────────────────────────────────
   17. TABS
───────────────────────────────────────── */
function bindTabs() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('[data-panel]').forEach(p => {
        p.style.display = p.dataset.panel === currentTab ? '' : 'none';
      });
    });
  });
}

/* ─────────────────────────────────────────
   18. ALL SYMBOLS LIST  (for bulk fetch)
───────────────────────────────────────── */
const ALL_SYMS = [...new Set([
  ...TICKER_SYMS,
  ...UNIVERSE.map(u => u.sym),
  ...WATCHLIST,
  ...SCANNER_SYMS,
  ...HEATMAP_SYMS,
  'DX-Y.NYB', 'USO', 'BTC-USD', 'VIX',
])];

/* ─────────────────────────────────────────
   19. MAIN REFRESH LOOP
───────────────────────────────────────── */
async function refresh() {
  const quotes = await fetchAll(ALL_SYMS);
  if (!quotes.length) return;    // silent fail — keep stale data

  // Update scanner dataset (full universe)
  const scannerSymSet = new Set(SCANNER_SYMS);
  scannerData = quotes.filter(q => scannerSymSet.has(q.symbol));

  renderTickerBar(quotes.filter(q => TICKER_SYMS.includes(q.symbol)));
  renderStats(quotes);
  renderWatchlist(quotes);
  renderHeatmap(quotes);
  renderUniverse(quotes);
  renderMacro(quotes);
  renderSentiment(quotes);
  renderScanner(scannerData);

  // Timestamp
  const ts = document.getElementById('lastUpdated');
  if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

/* ─────────────────────────────────────────
   20. INIT
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderNews();
  bindSortHeaders();
  bindFilterControls();
  bindTabs();

  refresh();
  setInterval(refresh, REFRESH);

  // Theme toggle
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const html  = document.documentElement;
      const theme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', theme);
      localStorage.setItem('mac_theme', theme);
    });
  }
  // Restore saved theme
  const saved = localStorage.getItem('mac_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
});
