// ==================== api.js ====================
// Polygon.io and Alpha Vantage API wrapper functions.
// getOptionsSnapshot is also here (uses polyGet).

// ==================== POLYGON API ====================
async function polyGet(path) {
  if (!POLYGON_KEY) {
    throw new Error('Polygon API key not set. Click the ⚙️ gear icon in the header to add your key.');
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = POLY + path + sep + 'apiKey=' + POLYGON_KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Polygon ${r.status}: ${path}`);
  return r.json();
}

async function getSnapshots(tickers) {
  const d = await polyGet(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}`);
  const map = {};
  (d.tickers || []).forEach(t => map[t.ticker] = t);
  return map;
}

async function getDailyBars(ticker, days = 60) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const d = await polyGet(`/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=${days}`);
  return d.results || [];
}

async function get4HBars(ticker, days = 90) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const d = await polyGet(`/v2/aggs/ticker/${ticker}/range/4/hour/${from}/${to}?adjusted=true&sort=asc&limit=5000`);
  return d.results || [];
}

async function get2HBars(ticker, days = 60) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const d = await polyGet(`/v2/aggs/ticker/${ticker}/range/2/hour/${from}/${to}?adjusted=true&sort=asc&limit=5000`);
  return d.results || [];
}

async function get1HBars(ticker, days = 30) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const d = await polyGet(`/v2/aggs/ticker/${ticker}/range/1/hour/${from}/${to}?adjusted=true&sort=asc&limit=5000`);
  return d.results || [];
}


// ==================== ALPHA VANTAGE API ====================
async function alphaGet(fn, params = '') {
  const url = `${ALPHA}?function=${fn}&${params}&apikey=${ALPHA_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`AlphaVantage ${r.status}`);
  return r.json();
}

// ==================== TECHNICAL HELPERS ====================

// ==================== POLYGON NEWS API ====================
async function getPolygonNews(tickers, limit = 20) {
  let path = `/v2/reference/news?limit=${limit + 15}&order=desc&sort=published_utc`;
  if (tickers && tickers.length) path += `&ticker=${tickers.join(',')}`;
  const d = await polyGet(path);
  // Filter out non-English articles (CJK characters, etc.)
  const isEnglish = (text) => !/[\u3000-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/.test(text || '');
  return (d.results || []).filter(a => isEnglish(a.title) && isEnglish(a.description)).slice(0, limit);
}


// ==================== MORNING MINDSET TOGGLE ====================

// --- Options Flow API ---
// --- Options Flow API ---
async function getOptionsSnapshot(ticker) {
  try {
    const path = '/v3/snapshot/options/' + ticker + '?limit=250';
    const d = await polyGet(path);
    return d.results || [];
  } catch (e) { return []; }
}
