// ==================== api.js ====================
// Polygon.io and Alpha Vantage API wrapper functions.
// getOptionsSnapshot is also here (uses polyGet).

// ==================== POLYGON API ====================
// All Polygon calls route through the server-side proxy.
// The Polygon key is stored as a Supabase secret — never exposed to the client.
async function polyGet(path) {
  var session = window._currentSession;
  if (!session || !session.access_token) {
    throw new Error('Please log in to use market data.');
  }
  var resp = await fetch(EDGE_FN_BASE + '/polygon-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token,
      'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
    },
    body: JSON.stringify({ path: path })
  });
  var data = await resp.json();
  if (!resp.ok) {
    var errMsg = (data && data.error) ? data.error : ('Polygon proxy error ' + resp.status);
    throw new Error(errMsg);
  }
  return data;
}

async function getSnapshots(tickers) {
  const d = await polyGet('/v2/snapshot/locale/us/markets/stocks/tickers?tickers=' + tickers.join(','));
  const map = {};
  (d.tickers || []).forEach(t => map[t.ticker] = t);
  return map;
}

async function getDailyBars(ticker, days) {
  if (!days) days = 60;
  const now = new Date();
  const to = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  const fd = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const from = fd.getFullYear() + '-' + String(fd.getMonth()+1).padStart(2,'0') + '-' + String(fd.getDate()).padStart(2,'0');
  const d = await polyGet('/v2/aggs/ticker/' + ticker + '/range/1/day/' + from + '/' + to + '?adjusted=true&sort=asc&limit=' + days);
  return d.results || [];
}

// ==================== ALPHA VANTAGE API ====================
async function alphaGet(fn, params) {
  if (!params) params = '';
  const url = ALPHA + '?function=' + fn + '&' + params + '&apikey=' + ALPHA_KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error('AlphaVantage ' + r.status);
  return r.json();
}

// ==================== TECHNICAL HELPERS ====================

// ==================== POLYGON NEWS API ====================
async function getPolygonNews(tickers, limit) {
  if (!limit) limit = 20;
  var path = '/v2/reference/news?limit=' + (limit + 15) + '&order=desc&sort=published_utc';
  if (tickers && tickers.length) path += '&ticker=' + tickers.join(',');
  const d = await polyGet(path);
  // Filter out non-English articles (CJK characters, etc.)
  const isEnglish = (text) => !/[\u3000-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/.test(text || '');
  return (d.results || []).filter(a => isEnglish(a.title) && isEnglish(a.description)).slice(0, limit);
}


// ==================== OPTIONS SNAPSHOT ====================
async function getOptionsSnapshot(ticker) {
  try {
    const path = '/v3/snapshot/options/' + ticker + '?limit=250';
    const d = await polyGet(path);
    return d.results || [];
  } catch (e) { return []; }
}
