// ==================== api.js ====================
// Polygon.io API wrapper functions.
// Polygon.io API wrapper functions.

// ==================== POLYGON CACHE ====================
// Cache Polygon responses in sessionStorage with TTL per endpoint type.
// Prevents redundant API calls on page reload / tab switching.
// Cache clears when browser tab is closed (sessionStorage).
// User can force-refresh via the Refresh button (sets _polyBypassCache flag).
var _polyCache = {};
var _polyBypassCache = false;

function _polyCacheTTL(path) {
  // Daily bars barely change — cache 15 min
  if (path.indexOf('/v2/aggs/') === 0) return 15 * 60 * 1000;
  // News — cache 10 min
  if (path.indexOf('/v2/reference/news') === 0) return 10 * 60 * 1000;
  // Snapshots — cache 5 min (breadth uses 15-min bars, 5-min staleness is fine)
  if (path.indexOf('/v2/snapshot/') === 0 || path.indexOf('/v3/snapshot/') === 0) return 5 * 60 * 1000;
  // Reference data — cache 30 min
  if (path.indexOf('/v2/reference/') === 0 || path.indexOf('/v3/reference/') === 0) return 30 * 60 * 1000;
  // Default — 2 min
  return 2 * 60 * 1000;
}

function _polyCacheKey(path) {
  return 'pc_' + path;
}

function _polyCacheGet(path) {
  if (_polyBypassCache) return null;
  var key = _polyCacheKey(path);
  // Check memory first
  var mem = _polyCache[key];
  if (mem && Date.now() < mem.exp) return mem.data;
  // Check sessionStorage
  try {
    var raw = sessionStorage.getItem(key);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && Date.now() < parsed.exp) {
        _polyCache[key] = parsed; // Warm memory cache
        return parsed.data;
      }
      sessionStorage.removeItem(key);
    }
  } catch(e) {}
  return null;
}

function _polyCacheSet(path, data) {
  var key = _polyCacheKey(path);
  var entry = { data: data, exp: Date.now() + _polyCacheTTL(path) };
  _polyCache[key] = entry;
  try { sessionStorage.setItem(key, JSON.stringify(entry)); } catch(e) {}
}

// Call this to clear all Polygon cache (used by Refresh button)
function clearPolyCache() {
  _polyCache = {};
  _polyBypassCache = true;
  try {
    var keys = [];
    for (var i = 0; i < sessionStorage.length; i++) {
      var k = sessionStorage.key(i);
      if (k && k.indexOf('pc_') === 0) keys.push(k);
    }
    keys.forEach(function(k) { sessionStorage.removeItem(k); });
  } catch(e) {}
  // Reset bypass flag after 1 second (so only the immediate refresh bypasses)
  setTimeout(function() { _polyBypassCache = false; }, 1000);
}

// ==================== POLYGON API ====================
// All Polygon calls route through the server-side proxy.
// The Polygon key is stored as a Supabase secret — never exposed to the client.
// Responses are cached client-side to reduce redundant calls.
// In-flight dedup: if the same path is already being fetched, reuse that promise.
var _polyInflight = {};

async function polyGet(path) {
  // Check cache first
  var cached = _polyCacheGet(path);
  if (cached) return cached;

  // Dedup: if this exact request is already in-flight, piggyback on it
  if (_polyInflight[path]) return _polyInflight[path];

  _polyInflight[path] = (async function() {
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

    // Cache the successful response
    _polyCacheSet(path, data);
    return data;
  })();

  try {
    return await _polyInflight[path];
  } finally {
    delete _polyInflight[path];
  }
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
