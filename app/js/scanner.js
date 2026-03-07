// ==================== scanner.js ====================
// Unified setup scanner (Top Ideas style):
//   Scans entire US market, filters to ~150 candidates, scores on
//   SMA compression + alignment + extension + volume + momentum.
//
// Layer 1: Universe builder — filters all US stocks to ~top 150 candidates
// Layer 2: Unified scoring — Top Ideas style (compression, alignment, extension, RVol, day change)
// Layer 3: Day Trade scanner — ORB (Opening Range Breakout) strategy

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_scanner_universe';
var SCANNER_CACHE_VERSION = 2;
var SCANNER_RESULTS_KEY = 'mac_scan_results';
var DAYTRADE_CACHE_KEY = 'mac_daytrade_results';
var DAYTRADE_UNIVERSE_KEY = 'mac_daytrade_universe';

// ORB uses 15-minute opening range exclusively

// Known ETF tickers to exclude (common ones that sneak through)
var KNOWN_ETFS = [
  'SPY','QQQ','IWM','DIA','VOO','VTI','VIXY','UUP','GLD','SLV','TLT','HYG','LQD',
  'XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH',
  'EWJ','EWZ','EWY','EWG','EWH','EWA','EWT','EWC','EWU','EWS','EWW','EWQ',
  'FXI','MCHI','KWEB','INDA','VWO','EEM','EFA','IEMG','VEA','VGK',
  'ARKK','ARKW','ARKF','ARKG','ARKQ','ARKX',
  'SOXX','IGV','IBB','XBI','XOP','OIH','KRE','KBE','XRT','JETS','PAVE',
  'ITA','XAR','HACK','SKYY','BOTZ','ICLN','TAN','URNM','LIT','REMX',
  'SOXL','SOXS','TQQQ','SQQQ','UPRO','SPXU','LABU','LABD','UVXY','SVXY',
  'SPXL','SPXS','TNA','TZA','FAS','FAZ','NUGT','DUST','JNUG','JDST',
  'BND','AGG','IEF','SHY','VCSH','VCIT','BNDX','EMB','JNK','MUB',
  'VNQ','MORT','HOMZ','IYR','XLRE',
  'USO','UNG','DBA','DBC','PDBC','GSG','WEAT','CORN','CPER',
  'RSP','SPLG','SCHD','VIG','DVY','SDY','NOBL','VYM','HDV',
  'QLD','PSQ','SH','SDS','DOG','DXD','RWM','TWM',
  'IBIT','BITO','GBTC','ETHE','FBTC',
  'GDX','GDXJ','SIL','SILJ','PPLT','PALL','GLTR',
  'COWZ','DIVO','JEPI','JEPQ','XYLD','QYLD','RYLD',
  'AMLP','MLPA','SRVR','NERD','SOCL','SUBZ','BETZ','PEJ',
  'PBJ','MJ','YOLO','MSOS','BUZZ','VPN','CLOU','WCLD','BUG',
  'FTEC','FHLC','FNCL','FENY','FDIS','FIDU','FREL','FUTY','FMAT','FCOM','FSTA',
  'IVV','IJR','IJH','MDY','IWB','IWF','IWD','IWN','IWO','IWP','IWS',
  'VBK','VBR','VTV','VUG','VOE','VOT','VTWO','VXUS','VMBS'
];

// Local date string (YYYY-MM-DD)
function localDateStr(d) {
  if (!d) d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ==================== CACHE HELPERS ====================

// Clean up legacy cache key from older versions
try { localStorage.removeItem('mac_momentum_top100'); } catch(e) {}

function getMomentumCache() {
  try {
    var raw = localStorage.getItem(SCANNER_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function saveMomentumCache(data) {
  try { localStorage.setItem(SCANNER_CACHE_KEY, JSON.stringify(data)); } catch(e) {}
}

function isMomentumCacheFresh() {
  var cache = getMomentumCache();
  if (!cache || !cache.date || cache.version !== SCANNER_CACHE_VERSION) return false;
  var today = localDateStr();
  return cache.date === today || cache.date === getLastTradingDay();
}

function getLastTradingDay() {
  var d = new Date();
  if (d.getDay() >= 1 && d.getDay() <= 5) {
    var etHour = parseInt(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }));
    if (etHour < 17) d.setDate(d.getDate() - 1);
  }
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

// ==================== RETRY WRAPPERS ====================

async function polyGetRetry(path, maxRetries) {
  if (!maxRetries) maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await polyGet(path);
    } catch(e) {
      var is429 = e.message && e.message.indexOf('429') !== -1;
      var isNetwork = e.message && (e.message.indexOf('Failed to fetch') !== -1 || e.message.indexOf('NetworkError') !== -1);
      if ((is429 || isNetwork) && attempt < maxRetries - 1) {
        var wait = Math.pow(2, attempt + 1) * 1000;
        await new Promise(function(r) { setTimeout(r, wait); });
        continue;
      }
      throw e;
    }
  }
}

async function getDailyBarsRetry(ticker, days) {
  if (!days) days = 60;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDailyBars(ticker, days);
    } catch(e) {
      var is429 = e.message && e.message.indexOf('429') !== -1;
      var isNetwork = e.message && (e.message.indexOf('Failed to fetch') !== -1 || e.message.indexOf('NetworkError') !== -1);
      if ((is429 || isNetwork) && attempt < 2) {
        var wait = Math.pow(2, attempt + 1) * 1000;
        await new Promise(function(r) { setTimeout(r, wait); });
        continue;
      }
      throw e;
    }
  }
}

// ==================== LAYER 1: UNIVERSE BUILDER ====================
// Goal: Find ~150 stocks that are IN an uptrend but NOT yet extended.
// These are the stocks most likely to offer playable setups soon.

async function buildMomentumUniverse(statusFn) {
  if (!statusFn) statusFn = function() {};

  statusFn('Fetching all US stocks...');

  var lastDay = getLastTradingDay();
  var groupedData;
  try {
    groupedData = await polyGetRetry('/v2/aggs/grouped/locale/us/market/stocks/' + lastDay + '?adjusted=true');
  } catch(e) {
    throw new Error('Failed to fetch grouped daily data: ' + e.message);
  }

  var allStocks = groupedData.results || [];
  if (allStocks.length === 0) {
    throw new Error('No market data returned for ' + lastDay + '. Market may be closed.');
  }

  statusFn('Got ' + allStocks.length + ' tickers. Filtering...');

  // Filter: price > $5, volume > 500K, common stocks, no ETFs
  var etfSet = {};
  KNOWN_ETFS.forEach(function(t) { etfSet[t] = true; });

  var filtered = allStocks.filter(function(s) {
    if (!s.T || !s.c || !s.v) return false;
    if (s.c < 20) return false;
    if (s.v < 1000000) return false;
    if (s.T.length > 5) return false;
    if (/[.-]/.test(s.T)) return false;
    if (etfSet[s.T]) return false;           // Exclude known ETFs
    return true;
  });

  statusFn('Filtered to ' + filtered.length + ' stocks. Scoring...');

  // Sort by dollar volume (highest liquidity first) and take top 100
  filtered.sort(function(a, b) { return (b.v * b.c) - (a.v * a.c); });
  filtered = filtered.slice(0, 100);

  // Fetch 60-day bars and score each candidate
  var scored = [];
  var batchSize = 25;
  var failCount = 0;

  for (var i = 0; i < filtered.length; i += batchSize) {
    var batch = filtered.slice(i, i + batchSize);
    var promises = batch.map(function(stock) {
      return getDailyBarsRetry(stock.T, 60).then(function(bars) {
        return { ticker: stock.T, bars: bars, latestClose: stock.c, latestVol: stock.v };
      }).catch(function() { failCount++; return null; });
    });
    var results = await Promise.all(promises);
    results.forEach(function(r) {
      if (!r || !r.bars || r.bars.length < 20) return;
      var score = calcUniverseScore(r.bars, r.latestClose);
      if (score.total > 0) {
        scored.push({
          ticker: r.ticker,
          price: r.latestClose,
          volume: r.latestVol,
          score: score.total,
          range5: score.range5,
          range10: score.range10,
          extFromSma20: score.extFromSma20,
          aboveSMAs: score.aboveSMAs,
          volDryUp: score.volDryUp,
          distToBreakout: score.distToBreakout,
          pullbackDepth: score.pullbackDepth,
          atr14: score.atr14,
          bars: null
        });
      }
    });

    var progress = Math.min(i + batchSize, filtered.length);
    var pct = Math.round(progress / filtered.length * 100);
    statusFn('Scoring... ' + progress + '/' + filtered.length + ' (' + pct + '%)');

    if (i + batchSize < filtered.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  // Sort by score, take top 150
  scored.sort(function(a, b) { return b.score - a.score; });
  var topN = scored.slice(0, 150);

  var cacheData = {
    version: SCANNER_CACHE_VERSION,
    date: localDateStr(),
    ts: Date.now(),
    count: topN.length,
    totalScanned: allStocks.length,
    filteredCount: filtered.length,
    tickers: topN
  };
  saveMomentumCache(cacheData);

  var failNote = failCount > 0 ? ' (' + failCount + ' tickers skipped due to errors)' : '';
  statusFn('Done! ' + topN.length + ' candidates identified.' + failNote);
  return cacheData;
}

// ==================== NEW UNIVERSE SCORING ====================
// Rewards: compression, trend, volume dry-up, proximity to breakout
// Penalizes: extension from 20 SMA, already-ran stocks

function calcUniverseScore(bars, currentPrice) {
  var closes = bars.map(function(b) { return b.c; });
  var highs = bars.map(function(b) { return b.h; });
  var lows = bars.map(function(b) { return b.l; });
  var volumes = bars.map(function(b) { return b.v; });
  var len = closes.length;
  if (len < 20) return { total: 0 };

  function sma(arr, period) {
    if (arr.length < period) return null;
    var sum = 0; for (var i = arr.length - period; i < arr.length; i++) sum += arr[i]; return sum / period;
  }

  var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);

  // ── HARD FILTERS ──

  // ATR14 (for data, no minimum filter)
  var _atr14 = 0;
  if (len >= 15) {
    var _trS = 0;
    for (var _ai = len - 14; _ai < len; _ai++) {
      var _tr = highs[_ai] - lows[_ai];
      if (_ai > 0) _tr = Math.max(_tr, Math.abs(highs[_ai] - closes[_ai - 1]), Math.abs(lows[_ai] - closes[_ai - 1]));
      _trS += _tr;
    }
    _atr14 = _trS / 14;
  }

  // Range data (for display, not filtering)
  var recent5H = Math.max.apply(null, highs.slice(-5));
  var recent5L = Math.min.apply(null, lows.slice(-5));
  var range5 = ((recent5H - recent5L) / currentPrice) * 100;
  var recent10H = Math.max.apply(null, highs.slice(-10));
  var recent10L = Math.min.apply(null, lows.slice(-10));
  var range10 = ((recent10H - recent10L) / currentPrice) * 100;

  // ── SCORING (Top Ideas style — 5 factors, max ~100) ──

  // 1. SMA Compression (0-30) — spread between 10/20 SMA
  var spread = sma10 && sma20 ? Math.abs(sma10 - sma20) / currentPrice * 100 : 99;
  if (spread > 5) return { total: 0 }; // skip if SMAs too far apart
  var ptsCompress = spread <= 1 ? 30 : spread <= 2 ? 22 : spread <= 3 ? 15 : spread <= 5 ? 8 : 0;

  // 2. SMA Alignment (0-25)
  var ptsAlign = 0;
  var aboveBoth = sma10 && currentPrice > sma10 && sma20 && currentPrice > sma20;
  if (aboveBoth) ptsAlign += 15;
  if (sma50 && currentPrice > sma50) ptsAlign += 10;

  // 3. Extension (−5 to +25)
  var extFromSma20 = sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0;
  var ptsExt = extFromSma20 <= 2 ? 25 : extFromSma20 <= 4 ? 18 : extFromSma20 <= 6 ? 10 : extFromSma20 <= 8 ? 4 : -5;

  // 4. Relative Volume (0-10) — last bar vol vs 20d avg
  var avgVol20 = sma(volumes, 20);
  var lastVol = volumes[len - 1] || 0;
  var rvol = avgVol20 > 0 && lastVol > 0 ? lastVol / avgVol20 : 0;
  var ptsVol = (rvol >= 2) ? 10 : (rvol >= 1.5) ? 7 : (rvol >= 1) ? 4 : 0;

  // 5. Day Change (0-5)
  var dayChg = len >= 2 && closes[len - 2] > 0 ? ((currentPrice - closes[len - 2]) / closes[len - 2]) * 100 : 0;
  var ptsMom = dayChg > 1 ? 5 : dayChg > 0 ? 2 : 0;

  var total = Math.round(Math.min(100, Math.max(0, ptsCompress + ptsAlign + ptsExt + ptsVol + ptsMom)));

  var atr14 = _atr14 > 0 ? _atr14 : null;

  return {
    total: total,
    spread: Math.round(spread * 10) / 10,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    extFromSma20: Math.round(extFromSma20 * 10) / 10,
    aboveSMAs: (aboveBoth ? 2 : 0) + (sma50 && currentPrice > sma50 ? 1 : 0) + '/3',
    volDryUp: Math.round(rvol * 100),
    distToBreakout: 0,
    pullbackDepth: 0,
    atr14: atr14
  };
}


// ==================== MARKET HOURS HELPERS ====================

function isScannerMarketHours() {
  var now = new Date();
  var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && h >= 4 && h < 17;
}

function isMarketOpenNow() {
  var now = new Date();
  var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
}


// ==================== LAYER 2: SETUP ANALYSIS ====================
// Analyzes the cached universe and categorizes into Early Breakouts vs Pullback Entries

async function runSetupScan(statusFn) {
  if (!statusFn) statusFn = function() {};

  var cache = getMomentumCache();
  if (!cache || !cache.tickers || cache.tickers.length === 0) {
    throw new Error('No universe cached. Run a full scan first.');
  }

  var tickers = cache.tickers.map(function(t) { return t.ticker; });

  // Fetch live snapshots
  statusFn('Fetching live data for ' + tickers.length + ' stocks...');
  var allSnapshots = {};
  var snapBatchSize = 50;
  for (var si = 0; si < tickers.length; si += snapBatchSize) {
    var snapBatch = tickers.slice(si, si + snapBatchSize);
    try {
      var snapMap = await getSnapshots(snapBatch);
      for (var key in snapMap) {
        if (snapMap.hasOwnProperty(key)) allSnapshots[key] = snapMap[key];
      }
    } catch(e) {}
    var sp = Math.min(si + snapBatchSize, tickers.length);
    statusFn('Fetching snapshots... ' + sp + '/' + tickers.length);
  }

  // Fetch daily bars for analysis
  statusFn('Analyzing setups...');
  var allBars = {};
  var barBatchSize = 20;
  for (var bi = 0; bi < tickers.length; bi += barBatchSize) {
    var barBatch = tickers.slice(bi, bi + barBatchSize);
    var barPromises = barBatch.map(function(ticker) {
      return getDailyBarsRetry(ticker, 60).then(function(bars) {
        return { ticker: ticker, bars: bars };
      }).catch(function() { return { ticker: ticker, bars: [] }; });
    });
    var barResults = await Promise.all(barPromises);
    barResults.forEach(function(r) { allBars[r.ticker] = r.bars; });
    var bp = Math.min(bi + barBatchSize, tickers.length);
    statusFn('Fetching bars... ' + bp + '/' + tickers.length);
    if (bi + barBatchSize < tickers.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  // Fetch market cap + industry from Polygon ticker details
  statusFn('Fetching ticker details...');
  var allMarketCap = {};
  var allIndustry = {};
  var allType = {}; // 'CS' (stock), 'ETF', 'ADRC', etc.
  var mcBatchSize = 25;
  for (var mi = 0; mi < tickers.length; mi += mcBatchSize) {
    var mcBatch = tickers.slice(mi, mi + mcBatchSize);
    var mcPromises = mcBatch.map(function(ticker) {
      return polyGet('/v3/reference/tickers/' + ticker).then(function(d) {
        var r = d.results || {};
        return { ticker: ticker, mc: r.market_cap || null, industry: r.sic_description || null, type: r.type || null };
      }).catch(function() { return { ticker: ticker, mc: null, industry: null, type: null }; });
    });
    var mcResults = await Promise.all(mcPromises);
    mcResults.forEach(function(r) { if (r.mc) allMarketCap[r.ticker] = r.mc; if (r.industry) allIndustry[r.ticker] = r.industry; if (r.type) allType[r.ticker] = r.type; });
    var mp = Math.min(mi + mcBatchSize, tickers.length);
    statusFn('Fetching market cap... ' + mp + '/' + tickers.length);
    if (mi + mcBatchSize < tickers.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  var marketOpen = isMarketOpenNow();
  var etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var etTimeStr = etNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  var setups = [];
  var allScores = {}; // Track scores for ALL universe tickers (same formula)
  var allMcap = {}; // Market cap for all tickers
  var allAtr = {}; // ATR for all tickers
  var allIndust = {}; // Industry for all tickers
  var allTickerType = {}; // Type: CS=stock, ETF, ADRC, etc.

  statusFn('Scoring setups...');

  // Helper: compute setup score for any ticker (Top Ideas style — 5 factors, max ~100)
  function calcSetupScore(ticker) {
    var snap = allSnapshots[ticker];
    var bars = allBars[ticker];
    if (!snap || !snap.prevDay || !snap.prevDay.c) return null;
    if (!bars || bars.length < 20) return null;

    var prevClose = snap.prevDay.c;
    var curPrice = 0, curVol = 0;
    if (snap.day && snap.day.c && snap.day.c > 0) {
      curPrice = snap.day.c;
      curVol = snap.day.v || 0;
    } else {
      curPrice = snap.lastTrade ? snap.lastTrade.p : prevClose;
    }
    if (curPrice <= 0) return null;

    var closes = bars.map(function(b) { return b.c; });
    var volumes = bars.map(function(b) { return b.v; });

    function sma(arr, period) {
      if (arr.length < period) return null;
      var s = 0; for (var i = arr.length - period; i < arr.length; i++) s += arr[i]; return s / period;
    }

    var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    if (!sma20 || !sma10) return null;

    // 1. SMA Compression (0-30)
    var spread = Math.abs(sma10 - sma20) / curPrice * 100;
    var ptsCompress = spread <= 1 ? 30 : spread <= 2 ? 22 : spread <= 3 ? 15 : spread <= 5 ? 8 : 0;

    // 2. SMA Alignment (0-25)
    var ptsAlign = 0;
    if (curPrice > sma10 && curPrice > sma20) ptsAlign += 15;
    if (sma50 && curPrice > sma50) ptsAlign += 10;

    // 3. Extension (-5 to +25)
    var ext = ((curPrice - sma20) / sma20) * 100;
    var ptsExt = ext <= 2 ? 25 : ext <= 4 ? 18 : ext <= 6 ? 10 : ext <= 8 ? 4 : -5;

    // 4. Relative Volume (0-10)
    var avgVol20 = sma(volumes, 20);
    var rvol = (avgVol20 > 0 && curVol > 0) ? curVol / avgVol20 : 0;
    var ptsVol = (rvol >= 2) ? 10 : (rvol >= 1.5) ? 7 : (rvol >= 1) ? 4 : 0;

    // 5. Day Change (0-5)
    var changePct = ((curPrice - prevClose) / prevClose) * 100;
    var ptsMom = changePct > 1 ? 5 : changePct > 0 ? 2 : 0;

    return Math.round(Math.min(100, Math.max(0, ptsCompress + ptsAlign + ptsExt + ptsVol + ptsMom)));
  }

  // Score ALL universe tickers + compute ATR + store market cap
  tickers.forEach(function(ticker) {
    var sc = calcSetupScore(ticker);
    if (sc != null) allScores[ticker] = sc;

    // Market cap + industry + type
    if (allMarketCap[ticker]) allMcap[ticker] = allMarketCap[ticker];
    if (allIndustry[ticker]) allIndust[ticker] = allIndustry[ticker];
    if (allType[ticker]) allTickerType[ticker] = allType[ticker];

    // ATR from bars
    var bars = allBars[ticker];
    if (bars && bars.length >= 15) {
      var trSum = 0;
      for (var ai = bars.length - 14; ai < bars.length; ai++) {
        var tr = bars[ai].h - bars[ai].l;
        if (ai > 0) {
          tr = Math.max(tr, Math.abs(bars[ai].h - bars[ai - 1].c), Math.abs(bars[ai].l - bars[ai - 1].c));
        }
        trSum += tr;
      }
      allAtr[ticker] = Math.round((trSum / 14) * 100) / 100;
    }
  });

  // RSI helper
  function calcRSI(closes, period) {
    period = period || 14;
    if (closes.length < period + 1) return 50;
    var gains = 0, losses = 0;
    for (var ri = closes.length - period; ri < closes.length; ri++) {
      var diff = closes[ri] - closes[ri - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    var avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    var rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // Now build setup cards — check ALL 4 strategies per ticker
  tickers.forEach(function(ticker) {
    var snap = allSnapshots[ticker];
    var bars = allBars[ticker];
    if (!snap || !snap.prevDay || !snap.prevDay.c) return;
    if (!bars || bars.length < 20) return;

    var prevClose = snap.prevDay.c;
    var curPrice = 0, curVol = 0;
    if (snap.day && snap.day.c && snap.day.c > 0) {
      curPrice = snap.day.c;
      curVol = snap.day.v || 0;
    } else {
      curPrice = snap.lastTrade ? snap.lastTrade.p : prevClose;
    }
    if (curPrice <= 0) return;

    var changePct = ((curPrice - prevClose) / prevClose) * 100;

    var closes = bars.map(function(b) { return b.c; });
    var highs = bars.map(function(b) { return b.h; });
    var lows = bars.map(function(b) { return b.l; });
    var volumes = bars.map(function(b) { return b.v; });
    var len = closes.length;

    function sma(arr, period) {
      if (arr.length < period) return null;
      var s = 0; for (var i = arr.length - period; i < arr.length; i++) s += arr[i]; return s / period;
    }
    function arrMax(arr, fromIdx) { var m = -Infinity; for (var i = fromIdx; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }
    function arrMin(arr, fromIdx) { var m = Infinity; for (var i = fromIdx; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; }

    var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    if (!sma20 || !sma10) return;

    var spread = Math.abs(sma10 - sma20) / curPrice * 100;
    var ext = ((curPrice - sma20) / sma20) * 100;
    var avgVol20val = sma(volumes, 20) || 1;
    var avgVol5 = sma(volumes, 5) || avgVol20val;
    var baseVolRatio = avgVol5 / avgVol20val;
    var rvol = (curVol > 0) ? curVol / avgVol20val : 0;
    var recent5H = arrMax(highs, Math.max(0, len - 5));
    var recent5L = arrMin(lows, Math.max(0, len - 5));
    var range5 = ((recent5H - recent5L) / curPrice) * 100;
    var recent10H = arrMax(highs, Math.max(0, len - 10));
    var recent10L = arrMin(lows, Math.max(0, len - 10));
    var range10 = ((recent10H - recent10L) / curPrice) * 100;
    var high20 = arrMax(highs, Math.max(0, len - 20));
    var recentHigh = arrMax(highs, Math.max(0, len - 20));
    var pullbackDepth = recentHigh > 0 ? ((recentHigh - curPrice) / recentHigh) * 100 : 0;
    var aboveBoth = curPrice > sma10 && curPrice > sma20;
    var aboveSma50 = !!(sma50 && curPrice > sma50);
    var smaStacked = !!(sma10 > sma20 && sma50 && sma20 > sma50);
    var aboveSMAsCount = (curPrice > sma10 ? 1 : 0) + (curPrice > sma20 ? 1 : 0) + (aboveSma50 ? 1 : 0);
    var nearSma10 = sma10 && Math.abs(curPrice - sma10) / curPrice * 100 <= 2;
    var nearSma20 = Math.abs(curPrice - sma20) / curPrice * 100 <= 2;

    // ════════════════════════════════════════════
    // STRATEGY 1: EARLY BREAKOUT (Compression)
    // ════════════════════════════════════════════
    if (spread <= 5) {
      var ebScore = allScores[ticker] || 0;
      if (ebScore >= 30) {
        var ptsCompress = spread <= 1 ? 30 : spread <= 2 ? 22 : spread <= 3 ? 15 : spread <= 5 ? 8 : 0;
        var ptsAlign = 0;
        if (aboveBoth) ptsAlign += 15;
        if (aboveSma50) ptsAlign += 10;
        var ptsExt = ext <= 2 ? 25 : ext <= 4 ? 18 : ext <= 6 ? 10 : ext <= 8 ? 4 : -5;
        var ptsVol = (rvol >= 2) ? 10 : (rvol >= 1.5) ? 7 : (rvol >= 1) ? 4 : 0;
        var ptsMom = changePct > 1 ? 5 : changePct > 0 ? 2 : 0;
        var ebThesis = '';
        if (spread <= 2) ebThesis += 'Tight compression (' + spread.toFixed(1) + '%). ';
        if (aboveBoth) ebThesis += 'Above 10/20 SMA. ';
        if (ext <= 2) ebThesis += 'Near base (' + ext.toFixed(1) + '%). ';
        if (rvol >= 1.5) ebThesis += rvol.toFixed(1) + 'x volume. ';
        if (changePct > 1) ebThesis += 'Up ' + changePct.toFixed(1) + '% today.';
        var ebAtr = allAtr[ticker] || (curPrice * 0.02);
        var ebStop = curPrice - ebAtr; // 1 ATR stop
        var ebRiskAmt = curPrice - ebStop;
        var ebTarget = curPrice + ebRiskAmt * 2.5; // 2.5R first target
        var ebRisk = curPrice > 0 ? (ebRiskAmt / curPrice) * 100 : 0;
        setups.push({
          ticker: ticker, category: 'EARLY BREAKOUT', price: curPrice, prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100, score: ebScore,
          thesis: ebThesis.trim(), spread: Math.round(spread * 10) / 10,
          ext: Math.round(ext * 10) / 10, rvol: rvol ? Math.round(rvol * 10) / 10 : null,
          range5: Math.round(range5 * 10) / 10, aboveBoth: aboveBoth, aboveSma50: aboveSma50,
          entryPrice: curPrice, stopPrice: ebStop, targetPrice: ebTarget,
          riskPct: Math.round(ebRisk * 10) / 10, atr: ebAtr,
          rMultiple: 2.5,
          mgmt: 'Move stop to break-even after 1-2 days or +5% move. Trail stop, don\'t sell into strength.',
          components: { tightness: ptsCompress, volumeDryUp: ptsAlign, breakoutProximity: ptsExt, volumeSurge: ptsVol }
        });
      }
    }

    // ════════════════════════════════════════════
    // STRATEGY 2: PULLBACK ENTRY
    // ════════════════════════════════════════════
    if (pullbackDepth >= 3 && pullbackDepth <= 18 && aboveSma50) {
      var pbSignals = [];
      // Pullback quality (0-30)
      var pbDepthPts = 0;
      if (pullbackDepth >= 4 && pullbackDepth <= 8) { pbDepthPts = 30; pbSignals.push('Healthy pullback (' + pullbackDepth.toFixed(1) + '% from high)'); }
      else if (pullbackDepth >= 3 && pullbackDepth <= 12) { pbDepthPts = 22; pbSignals.push('Pulling back (' + pullbackDepth.toFixed(1) + '%)'); }
      else { pbDepthPts = 10; pbSignals.push('Deep pullback (' + pullbackDepth.toFixed(1) + '%)'); }
      // Support level (0-25)
      var pbSupport = 0;
      if (nearSma10 && nearSma20) { pbSupport = 25; pbSignals.push('Holding 10 & 20 SMA'); }
      else if (nearSma20) { pbSupport = 22; pbSignals.push('Holding 20 SMA ($' + sma20.toFixed(2) + ')'); }
      else if (nearSma10) { pbSupport = 18; pbSignals.push('At 10 SMA'); }
      else if (sma50 && Math.abs(curPrice - sma50) / curPrice * 100 <= 2) { pbSupport = 12; pbSignals.push('At 50 SMA'); }
      // Volume decline (0-20)
      var pbVolDry = 0;
      if (baseVolRatio <= 0.5) { pbVolDry = 20; pbSignals.push('Vol fading (' + Math.round(baseVolRatio * 100) + '% avg)'); }
      else if (baseVolRatio <= 0.7) { pbVolDry = 14; pbSignals.push('Volume declining'); }
      else if (baseVolRatio <= 0.85) { pbVolDry = 6; }
      // Trend intact (0-15)
      var pbTrend = 0;
      if (smaStacked) { pbTrend = 15; pbSignals.push('SMAs stacked bullish'); }
      else if (aboveSMAsCount >= 2) { pbTrend = 10; }
      else if (aboveSma50) { pbTrend = 5; }

      var pbScore = Math.round(Math.max(0, pbDepthPts + pbSupport + pbVolDry + pbTrend));
      if (pbScore >= 40 && pbSupport >= 12) {
        var pbAtr = allAtr[ticker] || (curPrice * 0.02);
        var pbStop = curPrice - pbAtr; // 1 ATR stop
        var pbRiskAmt = curPrice - pbStop;
        var pbTarget = curPrice + pbRiskAmt * 2.5; // 2.5R first target
        var pbRisk = curPrice > 0 ? (pbRiskAmt / curPrice) * 100 : 0;
        setups.push({
          ticker: ticker, category: 'PULLBACK', price: curPrice, prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100, score: pbScore,
          description: pbSignals.join(' \u00b7 '), pullbackDepth: Math.round(pullbackDepth * 10) / 10,
          range5: Math.round(range5 * 10) / 10, rvol: rvol ? Math.round(rvol * 10) / 10 : null,
          entryPrice: curPrice, stopPrice: pbStop, targetPrice: pbTarget,
          riskPct: Math.round(pbRisk * 10) / 10, atr: pbAtr,
          rMultiple: 2.5,
          mgmt: 'Move stop to break-even after 1-2 days or +5% move. Trail stop using 10 SMA.',
          components: { pullbackQuality: pbDepthPts, supportLevel: pbSupport, volumeDecline: pbVolDry, trendIntact: pbTrend }
        });
      }
    }

    // ════════════════════════════════════════════
    // STRATEGY 3: MEAN REVERSION
    // ════════════════════════════════════════════
    var rsi14 = calcRSI(closes);
    if (pullbackDepth >= 8 && pullbackDepth <= 25 && rsi14 <= 40 && sma50 && curPrice > sma50 * 0.95) {
      var mrSignals = [];
      // Oversold (0-30)
      var mrOversold = 0;
      if (rsi14 <= 25) { mrOversold = 30; mrSignals.push('RSI deeply oversold (' + Math.round(rsi14) + ')'); }
      else if (rsi14 <= 30) { mrOversold = 25; mrSignals.push('RSI oversold (' + Math.round(rsi14) + ')'); }
      else if (rsi14 <= 35) { mrOversold = 18; mrSignals.push('RSI approaching oversold (' + Math.round(rsi14) + ')'); }
      else { mrOversold = 10; mrSignals.push('RSI weak (' + Math.round(rsi14) + ')'); }
      // Pullback quality (0-30)
      var mrDepthPts = 0;
      if (pullbackDepth >= 10 && pullbackDepth <= 18) { mrDepthPts = 30; mrSignals.push('Healthy reversion zone (' + pullbackDepth.toFixed(1) + '% from high)'); }
      else if (pullbackDepth >= 8 && pullbackDepth <= 22) { mrDepthPts = 22; mrSignals.push('Pulling into support (' + pullbackDepth.toFixed(1) + '%)'); }
      else { mrDepthPts = 12; mrSignals.push('Deep selloff (' + pullbackDepth.toFixed(1) + '%)'); }
      // Volume declining (0-20)
      var mrVolDry = 0;
      if (baseVolRatio <= 0.5) { mrVolDry = 20; mrSignals.push('Selling exhaustion (vol ' + Math.round(baseVolRatio * 100) + '% of avg)'); }
      else if (baseVolRatio <= 0.7) { mrVolDry = 14; mrSignals.push('Volume fading'); }
      else if (baseVolRatio <= 0.85) { mrVolDry = 6; }
      // Trend intact (0-20)
      var mrTrend = 0;
      if (sma50 && curPrice > sma50) {
        mrTrend += 10;
        if (nearSma20) { mrTrend += 5; mrSignals.push('Holding 20 SMA'); }
        else if (nearSma10) { mrTrend += 5; mrSignals.push('At 10 SMA'); }
        if (sma50 && Math.abs(curPrice - sma50) / curPrice * 100 <= 2) { mrTrend += 5; mrSignals.push('At 50 SMA'); }
      } else if (sma50 && curPrice > sma50 * 0.95) {
        mrTrend += 5; mrSignals.push('Near 50 SMA support');
      }

      var mrScore = Math.round(Math.max(0, mrOversold + mrDepthPts + mrVolDry + mrTrend));
      if (mrScore >= 40) {
        var mrAtr = allAtr[ticker] || (curPrice * 0.02);
        var mrStop = curPrice - mrAtr * 0.75; // 0.75 ATR (tighter — mean reversion snaps back fast)
        var mrRiskAmt = curPrice - mrStop;
        var mrTarget = Math.max(sma20, curPrice + mrRiskAmt * 2); // 20 SMA or 2R, whichever is higher
        var mrRisk = curPrice > 0 ? (mrRiskAmt / curPrice) * 100 : 0;
        setups.push({
          ticker: ticker, category: 'MEAN REVERSION', price: curPrice, prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100, score: mrScore,
          description: mrSignals.join(' \u00b7 '), rsi14: Math.round(rsi14),
          pullbackDepth: Math.round(pullbackDepth * 10) / 10,
          range5: Math.round(range5 * 10) / 10, relativeVol: Math.round(rvol * 10) / 10,
          entryPrice: curPrice, stopPrice: mrStop, targetPrice: mrTarget,
          riskPct: Math.round(mrRisk * 10) / 10, atr: mrAtr,
          rMultiple: 2,
          mgmt: 'Quick trade — take profit at 20 SMA. If it gaps up, sell into the move.',
          components: { pullbackQuality: mrDepthPts, oversold: mrOversold, volumeDecline: mrVolDry, trendIntact: mrTrend }
        });
      }
    }

    // ════════════════════════════════════════════
    // STRATEGY 4: MOMENTUM BREAKOUT
    // ════════════════════════════════════════════
    var breakoutPct = high20 > 0 ? ((curPrice - high20) / high20) * 100 : -99;
    var lastBarVol = volumes[len - 1] || 0;
    var rvolRatio = lastBarVol / avgVol20val;
    if (breakoutPct >= -1 && smaStacked && rvolRatio >= 1.2) {
      var mbSignals = [];
      // Breakout strength (0-25)
      var mbBreakStr = 0;
      if (breakoutPct >= 3) { mbBreakStr = 25; mbSignals.push('Strong breakout (+' + breakoutPct.toFixed(1) + '% above 20d high)'); }
      else if (breakoutPct >= 1) { mbBreakStr = 22; mbSignals.push('Breaking out (+' + breakoutPct.toFixed(1) + '% above 20d high)'); }
      else if (breakoutPct >= 0) { mbBreakStr = 18; mbSignals.push('At 20d high ($' + high20.toFixed(2) + ')'); }
      else { mbBreakStr = 12; mbSignals.push('Approaching 20d high (' + breakoutPct.toFixed(1) + '%)'); }
      // Volume surge (0-25)
      var mbVolSurge = 0;
      if (rvolRatio >= 3.0) { mbVolSurge = 25; mbSignals.push('Volume exploding (' + rvolRatio.toFixed(1) + 'x avg)'); }
      else if (rvolRatio >= 2.0) { mbVolSurge = 20; mbSignals.push('Strong volume (' + rvolRatio.toFixed(1) + 'x avg)'); }
      else if (rvolRatio >= 1.5) { mbVolSurge = 15; mbSignals.push('Above-avg volume (' + rvolRatio.toFixed(1) + 'x)'); }
      else { mbVolSurge = 8; }
      // SMA alignment (0-20)
      var mbSmaAlign = 15;
      mbSignals.push('SMAs stacked bullish (10>20>50)');
      if (sma50 && curPrice > sma50 * 1.05) mbSmaAlign = 20;
      // Base tightness (0-20)
      var mbTight = 0;
      if (range5 <= 3) { mbTight = 20; mbSignals.push('Tight base (' + range5.toFixed(1) + '% 5d range)'); }
      else if (range5 <= 5) { mbTight = 15; mbSignals.push('Compressed base (' + range5.toFixed(1) + '%)'); }
      else if (range5 <= 8) { mbTight = 8; }
      // Extension check (-10 to +10)
      var mbExt = 0;
      if (ext <= 3) mbExt = 10;
      else if (ext <= 5) mbExt = 5;
      else if (ext <= 8) mbExt = 0;
      else if (ext <= 12) mbExt = -5;
      else mbExt = -10;

      var mbScore = Math.round(Math.max(0, mbBreakStr + mbVolSurge + mbSmaAlign + mbTight + mbExt));
      if (mbScore >= 45) {
        var mbAtr = allAtr[ticker] || (curPrice * 0.02);
        var mbStop = curPrice - mbAtr * 0.75; // 0.75 ATR (tight — momentum should hold)
        var mbRiskAmt = curPrice - mbStop;
        var mbTarget = curPrice + mbRiskAmt * 3; // 3R — momentum trades aim for outliers
        var mbRisk = curPrice > 0 ? (mbRiskAmt / curPrice) * 100 : 0;
        setups.push({
          ticker: ticker, category: 'MOMENTUM BREAKOUT', price: curPrice, prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100, score: mbScore,
          description: mbSignals.join(' \u00b7 '),
          range5: Math.round(range5 * 10) / 10, relativeVol: Math.round(rvolRatio * 10) / 10,
          entryPrice: curPrice, stopPrice: mbStop, targetPrice: mbTarget,
          riskPct: Math.round(mbRisk * 10) / 10, atr: mbAtr,
          rMultiple: 3,
          mgmt: 'Move stop to break-even after +5%. Trail using 10 SMA — let outliers run 20-30R.',
          components: { breakoutStrength: mbBreakStr, volumeSurge: mbVolSurge, smaAlignment: mbSmaAlign, baseTightness: mbTight }
        });
      }
    }
  });

  // Sort each strategy separately, take top 15 per strategy
  var stratGroups = {};
  setups.forEach(function(s) {
    var cat = s.category || 'EARLY BREAKOUT';
    if (!stratGroups[cat]) stratGroups[cat] = [];
    stratGroups[cat].push(s);
  });
  var topSetups = [];
  Object.keys(stratGroups).forEach(function(cat) {
    stratGroups[cat].sort(function(a, b) { return b.score - a.score; });
    topSetups = topSetups.concat(stratGroups[cat].slice(0, 15));
  });

  var resultData = {
    date: localDateStr(),
    ts: Date.now(),
    mode: marketOpen ? 'live' : 'eod',
    etTime: etTimeStr,
    setups: topSetups,
    allScores: allScores,
    allMcap: allMcap,
    allAtr: allAtr,
    allIndust: allIndust,
    allTickerType: allTickerType
  };

  try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(resultData)); } catch(e) {}

  statusFn('Found ' + setups.length + ' setups.');
  return resultData;
}


// ==================== LAYER 3: DAY TRADE SCANNER (ORB) ====================
// Finds gappers, calculates 15-min opening range, scores for ORB setups.

var _dayTradeAutoTimer = null;

function getTodayDateStr() {
  var d = new Date();
  var et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getFullYear() + '-' + String(et.getMonth()+1).padStart(2,'0') + '-' + String(et.getDate()).padStart(2,'0');
}

function getETNow() {
  var d = new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isAfterORB() {
  var et = getETNow();
  return et.getHours() > 9 || (et.getHours() === 9 && et.getMinutes() >= 45);
}

function isPreMarket() {
  var et = getETNow();
  var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
  return d > 0 && d < 6 && h >= 4 && (h < 9 || (h === 9 && m < 30));
}

// Build day trade universe — find today's gappers
async function buildDayTradeUniverse(statusFn) {
  if (!statusFn) statusFn = function(){};

  statusFn('Fetching previous close data...');

  // Get previous trading day closes
  var prevDay = getLastTradingDay();
  var groupedData;
  try {
    groupedData = await polyGetRetry('/v2/aggs/grouped/locale/us/market/stocks/' + prevDay + '?adjusted=true');
  } catch(e) {
    throw new Error('Failed to fetch grouped daily data: ' + e.message);
  }

  var allStocks = groupedData.results || [];
  if (allStocks.length === 0) throw new Error('No market data for ' + prevDay);

  // Build previous close map
  var prevCloseMap = {};
  var etfSet = {};
  KNOWN_ETFS.forEach(function(t) { etfSet[t] = true; });

  allStocks.forEach(function(s) {
    if (!s.T || !s.c || !s.v) return;
    if (s.c < 20) return;
    if (s.v < 500000) return;
    if (s.T.length > 5) return;
    if (/[.-]/.test(s.T)) return;
    if (etfSet[s.T]) return;
    prevCloseMap[s.T] = { close: s.c, volume: s.v };
  });

  var tickers = Object.keys(prevCloseMap);
  statusFn('Fetching live snapshots for ' + tickers.length + ' stocks...');

  // Fetch live snapshots in batches
  var allSnapshots = {};
  var snapBatchSize = 50;
  for (var si = 0; si < tickers.length; si += snapBatchSize) {
    var snapBatch = tickers.slice(si, si + snapBatchSize);
    try {
      var snapMap = await getSnapshots(snapBatch);
      for (var key in snapMap) {
        if (snapMap.hasOwnProperty(key)) allSnapshots[key] = snapMap[key];
      }
    } catch(e) {}
    if (si + snapBatchSize < tickers.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  statusFn('Calculating gaps...');

  // Calculate gap % for each
  var gappers = [];
  tickers.forEach(function(ticker) {
    var snap = allSnapshots[ticker];
    var prev = prevCloseMap[ticker];
    if (!snap || !prev) return;

    var curPrice = 0;
    if (snap.day && snap.day.c && snap.day.c > 0) {
      curPrice = snap.day.c;
    } else if (snap.lastTrade && snap.lastTrade.p) {
      curPrice = snap.lastTrade.p;
    } else if (snap.min && snap.min.c) {
      curPrice = snap.min.c;
    }
    if (curPrice <= 0) return;

    var gapPct = ((curPrice - prev.close) / prev.close) * 100;
    if (Math.abs(gapPct) < 2) return; // Min 2% gap

    var curVol = (snap.day && snap.day.v) ? snap.day.v : 0;
    var rvol = prev.volume > 0 ? curVol / prev.volume : 0;

    gappers.push({
      ticker: ticker,
      prevClose: prev.close,
      curPrice: curPrice,
      gapPct: Math.round(gapPct * 100) / 100,
      direction: gapPct > 0 ? 'LONG' : 'SHORT',
      volume: curVol,
      prevVolume: prev.volume,
      rvol: Math.round(rvol * 100) / 100,
      absGap: Math.abs(gapPct)
    });
  });

  // Sort by |gap%| × rvol (combined strength), keep top 20
  gappers.sort(function(a, b) {
    return (b.absGap * Math.max(b.rvol, 1)) - (a.absGap * Math.max(a.rvol, 1));
  });
  gappers = gappers.slice(0, 20);

  var universeData = {
    date: getTodayDateStr(),
    ts: Date.now(),
    gappers: gappers
  };

  try { localStorage.setItem(DAYTRADE_UNIVERSE_KEY, JSON.stringify(universeData)); } catch(e) {}

  statusFn('Found ' + gappers.length + ' gappers.');
  return universeData;
}

// Calculate ORB (Opening Range Breakout) for a ticker
// Calculate 15-min ORB for a ticker
async function calcORBForTicker(ticker, today, timeframe) {
  try {
    // Always use 1-min candles for precise OR calculation (9:30-9:45)
    var data = await polyGetRetry('/v2/aggs/ticker/' + ticker + '/range/1/minute/' + today + '/' + today + '?adjusted=true&sort=asc&limit=500');
    var bars = data.results || [];
    if (bars.length === 0) return null;

    // Find bars in opening range (9:30-9:45 ET = first 15 minutes)
    var orBars = [];
    bars.forEach(function(b) {
      var d = new Date(b.t);
      var etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
      var parts = etStr.split(':');
      var h = parseInt(parts[0]), m = parseInt(parts[1]);
      var mins = h * 60 + m;
      if (mins >= 570 && mins < 585) orBars.push(b); // 9:30-9:44
    });

    if (orBars.length === 0) return null;

    // Opening range = high/low of first 15 minutes
    var orHigh = -Infinity, orLow = Infinity, orVolume = 0;
    orBars.forEach(function(b) {
      if (b.h > orHigh) orHigh = b.h;
      if (b.l < orLow) orLow = b.l;
      orVolume += (b.v || 0);
    });

    var orRange = orHigh - orLow;
    var orRangePct = orHigh > 0 ? (orRange / orHigh) * 100 : 0;

    // Fetch 15-min candles for breakout detection
    var confirmData = await polyGetRetry('/v2/aggs/ticker/' + ticker + '/range/15/minute/' + today + '/' + today + '?adjusted=true&sort=asc&limit=100');
    var confirmBars = (confirmData.results || []).filter(function(b) {
      var d = new Date(b.t);
      var etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
      var parts = etStr.split(':');
      var mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      return mins >= 585; // after 9:45 AM ET
    });

    // Use confirmation bar close for breakout detection (less noise than 1-min)
    var curPrice;
    var postORVol = 0;
    if (confirmBars.length > 0) {
      var lastConfirm = confirmBars[confirmBars.length - 1];
      curPrice = lastConfirm.c;
      confirmBars.forEach(function(b) { postORVol += (b.v || 0); });
    } else {
      // Fallback to 1-min last bar if no confirmation bars yet
      var lastBar = bars[bars.length - 1];
      curPrice = lastBar.c;
    }

    // Breakout detection on confirmation-timeframe price
    var breakoutType = 'none';
    var breakoutStrength = 0;

    if (curPrice > orHigh) {
      breakoutType = 'long';
      breakoutStrength = ((curPrice - orHigh) / orRange) * 100;
    } else if (curPrice < orLow) {
      breakoutType = 'short';
      breakoutStrength = ((orLow - curPrice) / orRange) * 100;
    }

    return {
      orHigh: Math.round(orHigh * 100) / 100,
      orLow: Math.round(orLow * 100) / 100,
      orRange: Math.round(orRange * 100) / 100,
      orRangePct: Math.round(orRangePct * 100) / 100,
      orVolume: orVolume,
      postORVol: postORVol,
      curPrice: Math.round(curPrice * 100) / 100,
      breakoutType: breakoutType,
      breakoutStrength: Math.round(breakoutStrength),
      barCount: bars.length,
      timeframe: timeframe || '15min'
    };
  } catch(e) {
    return null;
  }
}

// Score a day trade setup (max 100 pts)
// Score a day trade setup (max 100 pts)
function scoreDayTrade(gapper, orb, timeframe) {
  var score = 0;
  var components = {};

  // 1. Gap Magnitude (0-25)
  var absGap = Math.abs(gapper.gapPct);
  var ptsGap = absGap >= 6 ? 25 : absGap >= 4 ? 18 : absGap >= 2 ? 10 : 0;
  components.gap = ptsGap;
  score += ptsGap;

  // 2. Relative Volume (0-25)
  var ptsRvol = gapper.rvol >= 3 ? 25 : gapper.rvol >= 2 ? 18 : gapper.rvol >= 1.5 ? 12 : gapper.rvol >= 1 ? 6 : 0;
  components.rvol = ptsRvol;
  score += ptsRvol;

  // 3. ORB Breakout (0-20) — only if post-ORB
  var ptsBreakout = 0;
  if (orb) {
    if (orb.breakoutType !== 'none') {
      ptsBreakout = orb.breakoutStrength >= 50 ? 20 : orb.breakoutStrength >= 25 ? 15 : 10;
    }
  }
  components.breakout = ptsBreakout;
  score += ptsBreakout;

  // 4. OR Tightness (0-15)
  var ptsTight = 0;
  if (orb) {
    ptsTight = orb.orRangePct < 1 ? 15 : orb.orRangePct < 2 ? 10 : orb.orRangePct < 3 ? 5 : 0;
  }
  components.tightness = ptsTight;
  score += ptsTight;

  // 5. News Catalyst placeholder (0-15) — will be set by AI
  components.catalyst = 0;
  // (AI will fill this in later)

  score = Math.round(Math.min(100, Math.max(0, score)));

  return {
    score: score,
    components: components
  };
}

// Run the full day trade scan
async function runDayTradeScan(statusFn) {
  if (!statusFn) statusFn = function(){};

  // Step 1: Get or build gapper universe
  statusFn('Finding gappers...');
  var universe;
  try {
    var cached = localStorage.getItem(DAYTRADE_UNIVERSE_KEY);
    if (cached) {
      var parsed = JSON.parse(cached);
      var today = getTodayDateStr();
      if (parsed.date === today && Date.now() - parsed.ts < 15 * 60 * 1000) {
        universe = parsed;
      }
    }
  } catch(e) {}

  if (!universe) {
    universe = await buildDayTradeUniverse(statusFn);
  }

  if (!universe.gappers || universe.gappers.length === 0) {
    statusFn('No gappers found today.');
    var emptyResult = { date: getTodayDateStr(), ts: Date.now(), phase: 'no_gappers', setups: [], gappers: [] };
    try { localStorage.setItem(DAYTRADE_CACHE_KEY, JSON.stringify(emptyResult)); } catch(e) {}
    return emptyResult;
  }

  var gappers = universe.gappers;
  var today = getTodayDateStr();
  var afterORB = isAfterORB();
  var phase = afterORB ? 'post_orb' : 'pre_orb';

  // Step 2: If post-ORB, calculate ORB levels for each gapper
  var setups = [];

  if (afterORB) {
    statusFn('Calculating opening ranges...');
    var orbBatchSize = 5;
    for (var i = 0; i < gappers.length; i += orbBatchSize) {
      var batch = gappers.slice(i, i + orbBatchSize);
      var orbPromises = batch.map(function(g) {
        return calcORBForTicker(g.ticker, today, '15min').then(function(orb) {
          return { gapper: g, orb: orb };
        });
      });
      var orbResults = await Promise.all(orbPromises);

      orbResults.forEach(function(r) {
        if (!r.orb) return;
        var scored = scoreDayTrade(r.gapper, r.orb, '15min');
        if (scored.score < 30) return;

        // Direction based on breakout, fallback to gap direction
        var direction = r.orb.breakoutType !== 'none' ? (r.orb.breakoutType === 'long' ? 'LONG' : 'SHORT') : r.gapper.direction;

        // Trade levels
        var targetMult = 2.0;
        var entry = direction === 'LONG' ? r.orb.orHigh : r.orb.orLow;
        var stop = direction === 'LONG' ? r.orb.orLow : r.orb.orHigh;
        var risk = Math.abs(entry - stop);
        var target = direction === 'LONG' ? entry + (risk * targetMult) : entry - (risk * targetMult);

        setups.push({
          ticker: r.gapper.ticker,
          price: r.orb.curPrice,
          prevClose: r.gapper.prevClose,
          gapPct: r.gapper.gapPct,
          direction: direction,
          rvol: r.gapper.rvol,
          volume: r.gapper.volume,
          score: scored.score,
          components: scored.components,
          orHigh: r.orb.orHigh,
          orLow: r.orb.orLow,
          orRange: r.orb.orRange,
          orRangePct: r.orb.orRangePct,
          breakoutType: r.orb.breakoutType,
          breakoutStrength: r.orb.breakoutStrength,
          entryPrice: Math.round(entry * 100) / 100,
          stopPrice: Math.round(stop * 100) / 100,
          targetPrice: Math.round(target * 100) / 100,
          thesis: ''
        });
      });

      statusFn('Analyzing ORB... ' + Math.min(i + orbBatchSize, gappers.length) + '/' + gappers.length);
    }

    // Sort by score, keep top 5
    setups.sort(function(a, b) { return b.score - a.score; });
    setups = setups.slice(0, 5);

    // Step 3: Get news + AI thesis for top picks
    if (setups.length > 0) {
      statusFn('Fetching news for top picks...');
      var topTickers = setups.map(function(s) { return s.ticker; });

      // Fetch news for top tickers
      var newsMap = {};
      try {
        for (var ni = 0; ni < topTickers.length; ni++) {
          var news = await getPolygonNews([topTickers[ni]], 3);
          newsMap[topTickers[ni]] = news.map(function(n) { return n.title || ''; }).filter(function(t) { return t.length > 0; });
        }
      } catch(e) {}

      // Call AI proxy for thesis
      statusFn('Getting AI analysis...');
      try {
        var aiInput = setups.map(function(s) {
          return {
            ticker: s.ticker,
            gapPct: s.gapPct,
            direction: s.direction,
            rvol: s.rvol,
            orHigh: s.orHigh,
            orLow: s.orLow,
            orRangePct: s.orRangePct,
            breakoutType: s.breakoutType,
            price: s.price,
            news: newsMap[s.ticker] || []
          };
        });

        var session = window._currentSession;
        if (session && session.access_token) {
          var aiResp = await fetch(EDGE_FN_BASE + '/ai-proxy', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + session.access_token,
              'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
            },
            body: JSON.stringify({
              task: 'day_trade_scan',
              stocks: aiInput
            })
          });

          if (aiResp.ok) {
            var aiData = await aiResp.json();
            var aiText = '';
            if (aiData.content && aiData.content[0]) aiText = aiData.content[0].text || '';

            // Parse AI response
            try {
              var aiResult = JSON.parse(aiText);
              if (aiResult.picks && Array.isArray(aiResult.picks)) {
                aiResult.picks.forEach(function(pick) {
                  var match = setups.find(function(s) { return s.ticker === pick.ticker; });
                  if (match) {
                    match.thesis = pick.thesis || '';
                    if (pick.catalyst_score) {
                      match.components.catalyst = Math.min(15, parseInt(pick.catalyst_score) || 0);
                      match.score = Math.min(100, match.score + match.components.catalyst);
                    }
                  }
                });
                // Re-sort after AI scoring
                setups.sort(function(a, b) { return b.score - a.score; });
              }
            } catch(parseErr) {
              // AI didn't return valid JSON, just use what we have
              console.warn('[day-trade] AI parse error:', parseErr);
            }
          }
        }
      } catch(aiErr) {
        console.warn('[day-trade] AI analysis failed:', aiErr);
      }
    }
  } else {
    // Pre-ORB: show gappers as-is with basic scoring (no ORB data yet)
    gappers.forEach(function(g) {
      var scored = scoreDayTrade(g, null);
      setups.push({
        ticker: g.ticker,
        price: g.curPrice,
        prevClose: g.prevClose,
        gapPct: g.gapPct,
        direction: g.direction,
        rvol: g.rvol,
        volume: g.volume,
        score: scored.score,
        components: scored.components,
        orHigh: null,
        orLow: null,
        orRange: null,
        orRangePct: null,
        breakoutType: null,
        breakoutStrength: null,
        entryPrice: null,
        stopPrice: null,
        targetPrice: null,
        thesis: ''
      });
    });
    setups.sort(function(a, b) { return b.score - a.score; });
    setups = setups.slice(0, 5);
  }

  var resultData = {
    date: getTodayDateStr(),
    ts: Date.now(),
    phase: phase,
    setups: setups,
    gapperCount: gappers.length
  };

  try { localStorage.setItem(DAYTRADE_CACHE_KEY, JSON.stringify(resultData)); } catch(e) {}

  // Persist ORB setups to database for backtesting
  if (setups.length > 0 && typeof dbSaveDayTradeSetups === 'function') {
    dbSaveDayTradeSetups(setups, getTodayDateStr());
  }

  statusFn('Found ' + setups.length + ' day trade setups.');
  return resultData;
}

// Render a day trade card
function renderDayTradeCard(s, idx) {
  var detailId = 'dt-detail-' + idx;
  var sc = s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--blue)' : s.score >= 40 ? 'var(--amber)' : 'var(--text-muted)';
  var sbg = s.score >= 80 ? 'rgba(16,185,129,0.06)' : s.score >= 60 ? 'rgba(79,70,229,0.04)' : 'rgba(245,158,11,0.04)';
  var dirColor = s.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  var dirBg = s.direction === 'LONG' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';

  var html = '';
  html += '<div style="background:' + sbg + ';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px 16px;border-left:3px solid ' + sc + ';">';

  // Header: ticker, direction badge, price, score
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
  html += '<div style="display:flex;align-items:center;gap:6px;">';
  html += '<span class="ticker-link" style="font-size:14px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\'' + s.ticker + '\')">' + s.ticker + '</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:' + dirBg + ';color:' + dirColor + ';">' + s.direction + '</span>';
  html += '<span style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-secondary);">$' + s.price.toFixed(2) + '</span>';
  html += '</div>';
  // Score circle
  html += '<div class="score-circle" onclick="event.stopPropagation();var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';" title="Click for score breakdown">' + s.score + '</div>';
  html += '</div>';

  // Gap + RVol row
  var gapColor = s.gapPct >= 0 ? 'var(--green)' : 'var(--red)';
  html += '<div style="display:flex;gap:10px;font-size:12px;margin-bottom:6px;">';
  html += '<span style="color:' + gapColor + ';font-weight:700;font-family:var(--font-mono);">Gap ' + (s.gapPct >= 0 ? '+' : '') + s.gapPct.toFixed(1) + '%</span>';
  html += '<span style="color:var(--text-muted);font-family:var(--font-mono);">RVol ' + (s.rvol ? s.rvol.toFixed(1) + 'x' : '\u2014') + '</span>';
  if (s.orRangePct != null) {
    html += '<span style="color:var(--text-muted);font-family:var(--font-mono);">OR ' + s.orRangePct.toFixed(1) + '%</span>';
  }
  html += '</div>';

  // AI thesis
  if (s.thesis) {
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">' + s.thesis + '</div>';
  }

  // OR levels (if available)
  if (s.orHigh != null) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;padding:4px 6px;background:var(--bg-secondary);border-radius:3px;margin-bottom:4px;">';
    html += '<span style="color:var(--text-muted);">OR High <span style="font-family:var(--font-mono);font-weight:700;color:var(--green);">$' + s.orHigh.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">OR Low <span style="font-family:var(--font-mono);font-weight:700;color:var(--red);">$' + s.orLow.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">Range <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);">$' + s.orRange.toFixed(2) + '</span></span>';
    html += '</div>';
  }

  // Expandable detail section
  var comps = s.components || {};
  html += '<div id="' + detailId + '" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">';

  html += '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Score Breakdown</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:12px;margin-bottom:8px;">';
  html += renderComponentBar('Gap', comps.gap || 0, 25, 'var(--blue)');
  html += renderComponentBar('Rel Volume', comps.rvol || 0, 25, 'var(--blue)');
  html += renderComponentBar('Breakout', comps.breakout || 0, 20, 'var(--blue)');
  html += renderComponentBar('Tightness', comps.tightness || 0, 15, 'var(--blue)');
  html += renderComponentBar('Catalyst', comps.catalyst || 0, 15, 'var(--blue)');
  html += '</div>';

  // Trade levels (if post-ORB)
  if (s.entryPrice != null) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;font-family:var(--font-mono);margin-top:6px;">';
    html += '<span style="color:var(--text-muted);">Entry <span style="color:var(--blue);font-weight:700;">$' + s.entryPrice.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">Stop <span style="color:var(--red);font-weight:700;">$' + s.stopPrice.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">Target <span style="color:var(--green);font-weight:700;">$' + s.targetPrice.toFixed(2) + '</span></span>';
    html += '</div>';
  }

  html += '</div>'; // close detail
  html += '</div>'; // close card
  return html;
}

// Render day trade results section
function renderDayTradeResults(data) {
  var setups = data.setups || [];
  var html = '';

  if (setups.length === 0) {
    if (data.phase === 'pre_orb') {
      html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Waiting for market open to detect gappers...</div>';
    } else {
      html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">No day trade setups found. Check back during market hours.</div>';
    }
    return html;
  }

  html += '<div style="display:flex;flex-direction:column;gap:8px;">';
  setups.forEach(function(s, idx) {
    html += renderDayTradeCard(s, idx);
  });
  html += '</div>';

  return html;
}

// Run day trade scan from UI
async function runDayTradeScanUI() {
  var statusEl = document.getElementById('dt-scanner-status');
  var resultsEl = document.getElementById('dt-scan-results');

  if (statusEl) statusEl.textContent = 'Scanning...';

  try {
    var results = await runDayTradeScan(function(msg) {
      if (statusEl) statusEl.textContent = msg;
    });

    if (resultsEl) resultsEl.innerHTML = renderDayTradeResults(results);

    // Check for high-score alerts
    if (results.setups && results.setups.length > 0) {
      checkScannerAlerts(results.setups);
    }

    // Update phase label
    var phaseEl = document.getElementById('dt-phase-label');
    if (phaseEl) {
      if (results.phase === 'pre_orb') {
        phaseEl.innerHTML = '<span style="color:var(--amber);font-weight:700;">PRE-ORB</span> · Showing gappers';
      } else if (results.phase === 'post_orb') {
        phaseEl.innerHTML = '<span style="color:var(--green);font-weight:700;">POST-ORB</span> · Breakout analysis active';
      } else {
        phaseEl.innerHTML = '';
      }
    }

    if (statusEl) {
      var et = getETNow();
      statusEl.textContent = 'Updated ' + et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET';
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = 'Error: ' + e.message;
  }
}

// Auto-refresh day trade scanner every 15 min during market hours
function startDayTradeAutoRefresh() {
  if (_dayTradeAutoTimer) return;
  // Initial scan
  var cached = null;
  try {
    var raw = localStorage.getItem(DAYTRADE_CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch(e) {}
  var needsScan = !cached || cached.date !== getTodayDateStr() || Date.now() - cached.ts > 15 * 60 * 1000;
  if (needsScan) {
    setTimeout(function() { runDayTradeScanUI(); }, 3000);
  } else {
    // Render cached results
    var resultsEl = document.getElementById('dt-scan-results');
    if (resultsEl) resultsEl.innerHTML = renderDayTradeResults(cached);
    var phaseEl = document.getElementById('dt-phase-label');
    if (phaseEl) {
      if (cached.phase === 'pre_orb') phaseEl.innerHTML = '<span style="color:var(--amber);font-weight:700;">PRE-ORB</span> · Showing gappers';
      else if (cached.phase === 'post_orb') phaseEl.innerHTML = '<span style="color:var(--green);font-weight:700;">POST-ORB</span> · Breakout analysis active';
    }
    var statusEl = document.getElementById('dt-scanner-status');
    if (statusEl) statusEl.textContent = 'Cached · ' + new Date(cached.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  _dayTradeAutoTimer = setInterval(function() {
    var et = getETNow();
    var h = et.getHours(), m = et.getMinutes(), d = et.getDay();
    if (d > 0 && d < 6 && h >= 4 && h < 17) {
      runDayTradeScanUI();
    }
  }, 15 * 60 * 1000);
}


// ==================== UI: RENDER SCANNER TAB ====================

function renderScanner() {
  var container = document.getElementById('tab-scanner');
  if (!container) return;

  var cache = getMomentumCache();
  var scanResults = null;
  try { var sr = localStorage.getItem(SCANNER_RESULTS_KEY); if (sr) scanResults = JSON.parse(sr); } catch(e) {}
  var dtResults = null;
  try { var dr = localStorage.getItem(DAYTRADE_CACHE_KEY); if (dr) dtResults = JSON.parse(dr); } catch(e) {}

  var dataFreshness = getDataFreshnessLabel();

  var html = '';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:center;margin-bottom:8px;">';
  html += '<div style="text-align:center;"><div class="card-header-bar">Setup Scanner</div><div style="font-size:12px;color:var(--text-muted);font-weight:500;margin-top:1px;">Find the best swing and day trade setups across the market</div></div>';
  html += '</div>';

  // Hot strategy banner (from cached leaderboard data)
  try {
    var lbCache = localStorage.getItem('mac_strategy_leaderboard');
    if (lbCache) {
      var lb = JSON.parse(lbCache);
      var hotStrats = lb.filter(function(s) { return s.status === 'HOT'; });
      if (hotStrats.length > 0) {
        html += '<div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:8px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
        html += '<span style="font-size:11px;font-weight:700;color:var(--green);">HOT</span>';
        for (var hi = 0; hi < hotStrats.length && hi < 2; hi++) {
          var hs = hotStrats[hi];
          html += '<span style="font-size:12px;color:var(--text-secondary);">' + getStratLabel(hs.strategy) + ' is hitting <span style="font-weight:700;color:var(--green);">' + hs.winRate + '%</span> (' + hs.total + ' trades)</span>';
          if (hi === 0 && hotStrats.length > 1) html += '<span style="color:var(--text-muted);font-size:11px;">&middot;</span>';
        }
        html += '</div>';
      }
    }
  } catch(e) {}

  // Progress bar (shared, hidden during idle)
  html += '<div id="scanner-progress-wrap" style="display:none;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
  html += '<span id="scanner-status" style="font-size:14px;color:var(--text-muted);">Starting scan...</span>';
  html += '<span id="scanner-pct" style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">0%</span>';
  html += '</div>';
  html += '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">';
  html += '<div id="scanner-progress-bar" style="width:0%;height:100%;background:var(--blue);border-radius:2px;transition:width 0.3s ease;"></div>';
  html += '</div></div>';

  // ═══ SCREENING FUNNEL STATS ═══
  var allSetups = (scanResults && scanResults.setups) ? scanResults.setups : [];
  var ebSetups = allSetups.filter(function(s) { return s.category === 'EARLY BREAKOUT'; });
  var pbSetups = allSetups.filter(function(s) { return s.category === 'PULLBACK'; });
  var mrSetups = allSetups.filter(function(s) { return s.category === 'MEAN REVERSION'; });
  var mbSetups = allSetups.filter(function(s) { return s.category === 'MOMENTUM BREAKOUT'; });
  var uncatSetups = allSetups.filter(function(s) { return !s.category; });
  // If no categorized setups, treat all as early breakout (legacy client-side scan)
  if (ebSetups.length === 0 && uncatSetups.length > 0) ebSetups = uncatSetups;

  var scanMode = isScannerMarketHours() && isMomentumCacheFresh() ? 'live' : 'eod';
  var scanStatusHtml = '';
  if (scanMode === 'live') {
    scanStatusHtml = '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;"></span>Live</span> ';
  }
  scanStatusHtml += '<span style="font-size:11px;color:var(--text-muted);">' + dataFreshness + '</span>';

  html += '<div id="scanner-status-idle" style="margin-bottom:12px;">';
  if (cache) {
    html += '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">';
    html += scanStatusHtml + ' <span style="color:var(--text-muted);margin:0 4px;">&middot;</span> ';
    if (cache.totalScanned) {
      html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> scanned';
      html += '<span style="font-size:10px;margin:0 2px;">\u2192</span>';
    }
    html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
    if (allSetups.length > 0) {
      html += '<span style="font-size:10px;margin:0 2px;">\u2192</span>';
      html += '<span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);">' + allSetups.length + '</span> <span style="font-weight:600;color:var(--blue);">setups</span>';
      var breakdownParts = [];
      if (ebSetups.length) breakdownParts.push(ebSetups.length + ' EB');
      if (pbSetups.length) breakdownParts.push(pbSetups.length + ' PB');
      if (mrSetups.length) breakdownParts.push(mrSetups.length + ' MR');
      if (mbSetups.length) breakdownParts.push(mbSetups.length + ' MB');
      if (breakdownParts.length > 0) html += ' <span style="color:var(--text-muted);">(' + breakdownParts.join(', ') + ')</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  // ═══ 6-BOX STRATEGY GRID ═══
  html += '<div class="scanner-strategy-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;margin-bottom:16px;">';

  // ── BOX 1: Day Trade (ORB) ──
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:15px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Day Trade</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.1);color:var(--red);text-transform:uppercase;letter-spacing:.04em;">ORB 15m</span>';
  html += '</div>';
  html += '<button onclick="runDayTradeScanUI()" class="refresh-btn" style="padding:5px 12px;font-size:12px;">Scan</button>';
  html += '</div>';
  html += '<div id="dt-phase-label" style="font-size:11px;margin-top:4px;"></div>';
  html += '<div id="dt-scanner-status" style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + (dtResults ? 'Cached' : '') + '</div>';
  html += '</div>';
  // ORB Info
  html += '<div onclick="toggleStratInfo(\'dt\')" style="padding:6px 16px;background:rgba(239,68,68,0.05);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">';
  html += '<span style="font-size:11px;color:var(--red);">&#9432;</span><span style="font-size:11px;color:var(--text-muted);font-weight:600;">How it works</span>';
  html += '<span id="dt-info-arrow" style="margin-left:auto;font-size:10px;color:var(--text-muted);">\u25b6</span></div>';
  html += '<div id="dt-info-body" style="display:none;padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.5;">';
  html += '<b>Candidates:</b> Stocks gapping 2%+ from yesterday with above-average pre-market volume and news catalysts.<br>';
  html += '<b>Strategy:</b> Tracks the first 15 minutes of trading (9:30-9:45 AM) to establish the Opening Range. Buys breakouts above OR high, shorts breakdowns below OR low.<br>';
  html += '<b>Why it works:</b> Big gaps with institutional volume signal a catalyst. The opening range is a key battleground — a clean break often leads to a sustained move.<br>';
  html += '<b>Best in:</b> High-volatility, news-driven markets. Works best on earnings/catalyst days with clear direction.';
  html += '</div>';
  html += '<div id="dt-scan-results" style="padding:12px;">';
  if (dtResults && dtResults.setups && dtResults.setups.length > 0) {
    html += renderDayTradeResults(dtResults);
  } else {
    html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Finds gappers with volume + catalysts, then tracks 15-min opening range breakouts.</div>';
  }
  html += '</div>';
  html += '</div>';

  // ── BOX 2: Early Breakout ──
  html += renderStrategyBox({ id: 'early-breakout', title: 'Early Breakout', badge: 'Compression', badgeColor: 'var(--green)', badgeBg: 'rgba(16,185,129,0.1)', setups: ebSetups, scanData: scanResults, scanFn: 'runFullScanUI()', limit: 5,
    emptyText: 'Tight range + volume dry-up near breakout levels. Scan to find setups.',
    infoHtml: '<b>Candidates:</b> Top 100 US stocks by dollar volume. Filters for price > $20, volume > 1M, no ETFs.<br><b>Strategy:</b> Finds stocks where 10 & 20 SMA are squeezing together (compressing) with declining volume — a coiled spring ready to break. Scores based on tightness, SMA alignment, extension from base, and relative volume.<br><b>Risk mgmt:</b> Stop = 1 ATR below entry. Target = 2.5R. Move stop to break-even after 1-2 days or +5% move. Trail stop using 10 SMA — don\'t sell into strength, let winners run.<br><b>Why it works:</b> Compression = consolidation after a move. Tight ATR-based stops keep risk small while allowing the position room to breathe. Research shows halving stop width only drops win rate by ~1/3, roughly doubling expectancy.<br><b>Best in:</b> Any market. Hold 2-10 days. Risk 0.25% of account per trade.'
  });

  // ── BOX 3: Mean Reversion ──
  html += renderStrategyBox({ id: 'mean-reversion', title: 'Mean Reversion', badge: 'Oversold', badgeColor: '#a855f7', badgeBg: 'rgba(168,85,247,0.1)', setups: mrSetups, scanData: scanResults, scanFn: 'runFullScanUI()', limit: 5,
    emptyText: 'RSI oversold + deep pullback with intact uptrend. Scan to find setups.',
    infoHtml: '<b>Candidates:</b> Top 100 US stocks by dollar volume (price > $20, volume > 1M, no ETFs). Then filters for 8-25% pullback from recent high, RSI(14) \u2264 40, price still near 50 SMA.<br><b>Strategy:</b> Buys oversold bounces — stocks that pulled back hard but still have an intact uptrend. Entry at current price, target is 20 SMA or 2R (whichever is higher).<br><b>Risk mgmt:</b> Stop = 0.75 ATR below entry (tighter — mean reversion snaps back fast or it fails). Quick trade — take profit at 20 SMA. If it gaps up, sell into the move.<br><b>Why it works:</b> Stocks in uptrends revert to their moving average after pullbacks. RSI oversold + declining volume = sellers exhausted. Tight stops work here because if the bounce doesn\'t happen quickly, the thesis is wrong.<br><b>Best in:</b> Choppy, range-bound markets. Hold 1-5 days. Risk 0.25% of account per trade.'
  });

  // ── BOX 4: Momentum Breakout ──
  html += renderStrategyBox({ id: 'momentum-breakout', title: 'Momentum BRK', badge: 'Trend', badgeColor: '#f59e0b', badgeBg: 'rgba(245,158,11,0.1)', setups: mbSetups, scanData: scanResults, scanFn: 'runFullScanUI()', limit: 5,
    emptyText: 'New highs on volume surge with stacked SMAs. Scan to find setups.',
    infoHtml: '<b>Candidates:</b> Top 100 US stocks by dollar volume (price > $20, volume > 1M, no ETFs). Then filters for price at/above 20-day high, SMAs stacked bullish (10 > 20 > 50), relative volume \u2265 1.2x.<br><b>Strategy:</b> Rides the trend — buys stocks making new highs on strong volume with perfect trend alignment. Entry at current price, target 3R (outlier potential).<br><b>Risk mgmt:</b> Stop = 0.75 ATR below entry (tight — momentum should hold immediately). Move to break-even after +5%. Trail using 10 SMA and let outliers run 20-30R. These are the trades that make the year.<br><b>Why it works:</b> Stocks making new highs on volume with stacked SMAs have maximum institutional support. Tight stops with high R-targets mean you only need 30-40% win rate to be very profitable.<br><b>Best in:</b> Strong trending/bull markets. Hold 3-20+ days. Risk 0.2% of account — position for outliers.'
  });

  // ── BOX 5: Pullback Entry ──
  html += renderStrategyBox({ id: 'pullback-entry', title: 'Pullback Entry', badge: 'Support', badgeColor: 'var(--blue)', badgeBg: 'rgba(79,70,229,0.1)', setups: pbSetups, scanData: scanResults, scanFn: 'runFullScanUI()', limit: 5,
    emptyText: 'Healthy pullbacks finding support on key SMAs. Scan to find setups.',
    infoHtml: '<b>Candidates:</b> Top 100 US stocks by dollar volume (price > $20, volume > 1M, no ETFs). Then filters for 3-18% pullback from high, price above 50 SMA, finding support at 10 or 20 SMA.<br><b>Strategy:</b> Buys the dip in uptrending stocks — waits for a pullback to land on a key moving average with declining volume (weak selling pressure), then enters for the bounce.<br><b>Risk mgmt:</b> Stop = 1 ATR below entry. Target = 2.5R. Move stop to break-even after 1-2 days or +5% move. Trail stop using 10 SMA — the trend should resume if the thesis is right.<br><b>Why it works:</b> In uptrends, pullbacks to moving averages are where institutional buyers reload. Low volume on the pullback confirms sellers are done. ATR-based stops give the trade room to breathe without excessive risk.<br><b>Best in:</b> Healthy bull markets with orderly corrections. Hold 2-10 days. Risk 0.25% of account per trade.'
  });

  // ── BOX 6: Social Arbitrage ──
  var socialCache = null;
  try { var sc2 = localStorage.getItem('mac_social_arb_results'); if (sc2) socialCache = JSON.parse(sc2); } catch(e) {}
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:15px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Social Arbitrage</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.1);color:#a855f7;text-transform:uppercase;letter-spacing:.04em;">Beta</span>';
  html += '</div>';
  html += '<button onclick="runSocialArbitrageScanUI()" class="refresh-btn" style="padding:5px 12px;font-size:12px;" id="social-arb-scan-btn">Scan</button>';
  html += '</div>';
  html += '<div id="social-arb-status" style="font-size:11px;color:var(--text-muted);margin-top:4px;">' + (socialCache ? 'Cached (' + (socialCache.picks || []).length + ' picks)' : '') + '</div>';
  html += '</div>';
  // Social Arb Info
  html += '<div onclick="toggleStratInfo(\'social-arb\')" style="padding:6px 16px;background:rgba(168,85,247,0.05);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">';
  html += '<span style="font-size:11px;color:#a855f7;">&#9432;</span><span style="font-size:11px;color:var(--text-muted);font-weight:600;">How it works</span>';
  html += '<span id="social-arb-info-arrow" style="margin-left:auto;font-size:10px;color:var(--text-muted);">\u25b6</span></div>';
  html += '<div id="social-arb-info-body" style="display:none;padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.5;">';
  html += '<b>Candidates:</b> AI-driven scan of news headlines, Reddit discussions, and Google Trends for unusual buzz around consumer brands and products.<br>';
  html += '<b>Strategy:</b> Spots consumer trends before Wall Street prices them in. Looks for "sold out", "going viral", "everyone is buying" signals. Scores based on news volume, Reddit mentions, Google trend spikes, and price/volume confirmation.<br>';
  html += '<b>Why it works:</b> Retail consumers notice product trends weeks before analysts. Chris Camillo turned $20K into $42M using this edge. Social signals = real demand shifts.<br>';
  html += '<b>Best in:</b> Consumer-driven markets. Works year-round but strongest around product launches, viral moments, and seasonal demand shifts.';
  html += '</div>';
  html += '<div id="social-arb-results" style="padding:12px 16px;">';
  if (socialCache && socialCache.picks && socialCache.picks.length > 0) {
    html += renderSocialArbResults(socialCache);
  } else {
    html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Scans news, Reddit, and social buzz to spot consumer trends before Wall Street.</div>';
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // close scanner-strategy-grid

  // ── BACKTEST RESULTS CARD (full-width) ──
  var btCollapsed = localStorage.getItem('mac_backtest_collapsed') === 'true';
  html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:16px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Strategy Leaderboard</span>';
  html += '<select id="backtest-days-select" onchange="loadBacktestResults(parseInt(this.value))" style="font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;"><option value="7">7d</option><option value="30" selected>30d</option><option value="90">90d</option><option value="365">All</option></select>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:6px;">';
  html += '<button onclick="toggleBacktestCollapse()" style="padding:3px 8px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;" id="backtest-toggle">' + (btCollapsed ? 'Show' : 'Hide') + '</button>';
  html += '<button onclick="loadBacktestResults()" class="refresh-btn" style="padding:5px 12px;font-size:12px;">Refresh</button>';
  html += '</div>';
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Which strategy is working in the current market</div>';
  html += '</div>';
  html += '<div id="backtest-results" style="' + (btCollapsed ? 'display:none;' : '') + 'padding:12px 16px;">';
  html += '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px 0;">Loading backtest data...</div>';
  html += '</div>';
  html += '</div>';

  // Universe list (collapsible card)
  var universeCount = (cache && cache.tickers) ? cache.tickers.length : 0;
  var listCollapsed = localStorage.getItem('mac_universe_collapsed') === 'true';
  html += '<div class="card" style="margin-top:16px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleUniverse()" style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<span style="font-size:16px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Candidates</span>';
  if (universeCount > 0) html += '<span style="background:var(--blue);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">' + universeCount + '</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<span style="font-size:12px;color:var(--text-muted);">Filtered from full universe, ranked by compression score</span>';
  html += '<span id="universe-arrow" style="font-size:12px;color:var(--text-muted);">' + (listCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';
  html += '</div>';
  html += '<div id="universe-body" style="' + (listCollapsed ? 'display:none;' : '') + '">';
  if (universeCount > 0) {
    html += renderUniverseList(cache.tickers);
  } else {
    html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No data yet. Click Scan above.</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;
  loadWinRateBadge();
  loadBacktestResults();
}

function loadWinRateBadge() {
  if (typeof dbGetWinRate !== 'function') return;
  dbGetWinRate(null, 30).then(function(data) {
    var el = document.getElementById('swing-win-rate-badge');
    if (!el || !data || data.total < 5) return;
    var color = data.winRate >= 60 ? 'var(--green)' : data.winRate >= 45 ? 'var(--amber)' : 'var(--red)';
    var bg = data.winRate >= 60 ? 'var(--green-bg)' : data.winRate >= 45 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
    el.innerHTML = '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+bg+';color:'+color+';letter-spacing:.02em;">'+data.winRate+'% win ('+data.total+' trades, '+data.days+'d)</span>';
  }).catch(function(){});
}


// ==================== RENDER: STRATEGY BOX ====================

function renderStrategyBox(cfg) {
  var html = '';
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  // Header
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:15px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">' + cfg.title + '</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:' + cfg.badgeBg + ';color:' + cfg.badgeColor + ';text-transform:uppercase;letter-spacing:.04em;">' + cfg.badge + '</span>';
  html += '</div>';
  if (cfg.scanFn) {
    html += '<button onclick="' + cfg.scanFn + '" class="refresh-btn" style="padding:5px 12px;font-size:12px;">Scan</button>';
  }
  html += '</div>';
  html += '</div>';
  // Info section (collapsible)
  if (cfg.infoHtml) {
    html += '<div onclick="toggleStratInfo(\'' + cfg.id + '\')" style="padding:6px 16px;background:' + (cfg.badgeBg || 'rgba(128,128,128,0.05)') + ';border-bottom:1px solid var(--border);cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:11px;color:' + cfg.badgeColor + ';">&#9432;</span>';
    html += '<span style="font-size:11px;color:var(--text-muted);font-weight:600;">How it works</span>';
    html += '<span id="' + cfg.id + '-info-arrow" style="margin-left:auto;font-size:10px;color:var(--text-muted);">\u25b6</span>';
    html += '</div>';
    html += '<div id="' + cfg.id + '-info-body" style="display:none;padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.5;">';
    html += cfg.infoHtml;
    html += '</div>';
  }
  // Body
  var setups = cfg.setups || [];
  var limit = cfg.limit || 0;
  var displaySetups = limit && setups.length > limit ? setups.slice(0, limit) : setups;
  html += '<div id="' + cfg.id + '-results" style="padding:12px;">';
  if (displaySetups.length > 0) {
    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    displaySetups.forEach(function(s, idx) {
      html += renderSetupCard(s, cfg.id + '-' + idx, cfg.scanData);
    });
    html += '</div>';
    if (limit && setups.length > limit) {
      html += '<div style="text-align:center;margin-top:8px;">';
      html += '<button onclick="expandStrategyResults(\'' + cfg.id + '\')" class="refresh-btn" style="padding:6px 16px;font-size:12px;">View All ' + setups.length + ' Setups</button>';
      html += '</div>';
    }
  } else {
    html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">' + cfg.emptyText + '</div>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function expandStrategyResults(boxId) {
  var scanResults = null;
  try { var sr = localStorage.getItem(SCANNER_RESULTS_KEY); if (sr) scanResults = JSON.parse(sr); } catch(e) {}
  if (!scanResults) return;
  var catMap = { 'early-breakout': 'EARLY BREAKOUT', 'pullback-entry': 'PULLBACK', 'mean-reversion': 'MEAN REVERSION', 'momentum-breakout': 'MOMENTUM BREAKOUT' };
  var category = catMap[boxId];
  if (!category) return;
  var setups = (scanResults.setups || []).filter(function(s) { return s.category === category; });
  // Fallback for uncategorized setups in early-breakout box
  if (setups.length === 0 && boxId === 'early-breakout') {
    setups = (scanResults.setups || []).filter(function(s) { return !s.category; });
  }
  var el = document.getElementById(boxId + '-results');
  if (!el) return;
  var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  setups.forEach(function(s, idx) { html += renderSetupCard(s, boxId + '-' + idx, scanResults); });
  html += '</div>';
  el.innerHTML = html;
}


// ==================== RENDER: INDIVIDUAL SETUP CARD ====================
// Matches Top Ideas card style exactly — colored left border, tinted bg, compact layout

function renderSetupCard(s, idx, scanData) {
  var detailId = 'score-detail-' + idx;
  var cat = s.category || '';
  var borderColor = cat ? getStratColor(cat) : (s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--blue)' : s.score >= 40 ? 'var(--amber)' : 'var(--text-muted)');
  var sc = s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--blue)' : s.score >= 40 ? 'var(--amber)' : 'var(--text-muted)';
  var sbg = cat ? getStratBg(cat) : (s.score >= 80 ? 'rgba(16,185,129,0.06)' : s.score >= 60 ? 'rgba(79,70,229,0.04)' : 'rgba(245,158,11,0.04)');

  var html = '';
  html += '<div style="background:' + sbg + ';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px 16px;border-left:3px solid ' + borderColor + ';">';

  // Header: ticker, price, score circle
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
  html += '<div style="display:flex;align-items:center;gap:6px;">';
  html += '<span class="ticker-link" style="font-size:14px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\'' + s.ticker + '\')">' + s.ticker + '</span>';
  var _type = (scanData && scanData.allTickerType && scanData.allTickerType[s.ticker]) || '';
  var _typeLabel = _type === 'ETF' ? 'ETF' : 'Stock';
  var _typeBg = _type === 'ETF' ? 'var(--amber-bg)' : 'var(--blue-bg)';
  var _typeColor = _type === 'ETF' ? 'var(--amber)' : 'var(--blue)';
  html += '<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:' + _typeBg + ';color:' + _typeColor + ';">' + _typeLabel + '</span>';
  html += '<span style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:var(--text-secondary);">$' + s.price.toFixed(2) + '</span>';
  html += '</div>';
  // Score circle
  html += '<div class="score-circle" onclick="event.stopPropagation();var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';" title="Click for score breakdown">' + s.score + '</div>';
  html += '</div>';

  // Thesis / description
  var thesis = s.thesis || s.description || '';
  if (thesis) {
    html += '<div style="font-size:13px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">' + thesis + '</div>';
  }

  // Info row: Industry, ATR, Market Cap
  var _ind = (scanData && scanData.allIndust && scanData.allIndust[s.ticker]) || '';
  var _atr = (scanData && scanData.allAtr && scanData.allAtr[s.ticker]) || null;
  var _mc = (scanData && scanData.allMcap && scanData.allMcap[s.ticker]) || null;
  if (_ind || _atr || _mc) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;padding:4px 6px;background:var(--bg-secondary);border-radius:3px;">';
    if (_ind) html += '<span style="color:var(--text-muted);">' + _ind + '</span>';
    if (_atr) html += '<span style="color:var(--text-muted);">ATR <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">$' + _atr.toFixed(2) + '</span></span>';
    if (_mc) html += '<span style="color:var(--text-muted);">Mkt Cap <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">' + _fmtMcap(_mc) + '</span></span>';
    html += '</div>';
  }

  // ── Expandable detail (hidden, shown on score click) ──
  var comps = s.components || {};
  html += '<div id="' + detailId + '" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">';

  // Strategy-specific component bars
  html += '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Score Breakdown</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:12px;margin-bottom:8px;">';
  var barColor = cat ? getStratColor(cat) : 'var(--blue)';
  if (cat === 'PULLBACK') {
    html += renderComponentBar('Pullback Quality', comps.pullbackQuality || 0, 30, barColor);
    html += renderComponentBar('Support Level', comps.supportLevel || 0, 25, barColor);
    html += renderComponentBar('Vol Decline', comps.volumeDecline || 0, 20, barColor);
    html += renderComponentBar('Trend Intact', comps.trendIntact || 0, 15, barColor);
  } else if (cat === 'MEAN REVERSION') {
    html += renderComponentBar('Pullback Quality', comps.pullbackQuality || 0, 30, barColor);
    html += renderComponentBar('Oversold', comps.oversold || 0, 30, barColor);
    html += renderComponentBar('Vol Decline', comps.volumeDecline || 0, 20, barColor);
    html += renderComponentBar('Trend Intact', comps.trendIntact || 0, 20, barColor);
  } else if (cat === 'MOMENTUM BREAKOUT') {
    html += renderComponentBar('Breakout Str', comps.breakoutStrength || 0, 25, barColor);
    html += renderComponentBar('Vol Surge', comps.volumeSurge || 0, 25, barColor);
    html += renderComponentBar('SMA Align', comps.smaAlignment || 0, 20, barColor);
    html += renderComponentBar('Base Tight', comps.baseTightness || 0, 20, barColor);
  } else {
    // EARLY BREAKOUT or legacy compression
    html += renderComponentBar('Tightness', comps.tightness || comps.compression || 0, comps.tightness ? 35 : 30, barColor);
    html += renderComponentBar('Vol Dry-Up', comps.volumeDryUp || comps.alignment || 0, comps.volumeDryUp ? 20 : 25, barColor);
    html += renderComponentBar('Breakout Prox', comps.breakoutProximity || Math.max(0, comps.extension || 0), comps.breakoutProximity ? 25 : 25, barColor);
    html += renderComponentBar('Volume', comps.volumeSurge || comps.volume || 0, comps.volumeSurge ? 20 : 10, barColor);
  }
  html += '</div>';

  // Quick stats (show what's available)
  var statsHtml = '';
  if (s.spread != null) statsHtml += '<span>Spread ' + s.spread + '%</span>';
  if (s.ext != null) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>Ext ' + (s.ext >= 0 ? '+' : '') + s.ext + '%</span>';
  if (s.rvol || s.relativeVol) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>RVol ' + ((s.rvol || s.relativeVol || 0).toFixed ? (s.rvol || s.relativeVol).toFixed(1) : (s.rvol || s.relativeVol)) + 'x</span>';
  if (s.range5 != null) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>5d ' + s.range5 + '%</span>';
  if (s.riskPct != null) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>Risk ' + s.riskPct + '%</span>';
  if (s.rsi14) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>RSI ' + Math.round(s.rsi14) + '</span>';
  if (s.pullbackDepth) statsHtml += (statsHtml ? '<span>\u00b7</span>' : '') + '<span>Pullback ' + s.pullbackDepth.toFixed(1) + '%</span>';
  if (statsHtml) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);">';
    html += statsHtml;
    html += '</div>';
  }

  // Trade levels (if available)
  if (s.entryPrice && s.stopPrice && s.targetPrice) {
    var riskAmt = s.entryPrice - s.stopPrice;
    var rewardAmt = s.targetPrice - s.entryPrice;
    var rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : '—';
    html += '<div style="margin-top:8px;padding:8px 10px;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border);">';
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11px;font-family:var(--font-mono);align-items:center;">';
    html += '<span style="color:var(--text-muted);">Entry <span style="color:var(--text-secondary);font-weight:700;">$' + s.entryPrice.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">Stop <span style="color:var(--red);font-weight:700;">$' + s.stopPrice.toFixed(2) + '</span></span>';
    html += '<span style="color:var(--text-muted);">Target <span style="color:var(--green);font-weight:700;">$' + s.targetPrice.toFixed(2) + '</span></span>';
    if (s.riskPct) html += '<span style="color:var(--text-muted);">Risk <span style="color:var(--amber);font-weight:700;">' + s.riskPct + '%</span></span>';
    html += '<span style="color:var(--text-muted);">R:R <span style="color:var(--blue);font-weight:700;">' + rrRatio + ':1</span></span>';
    if (s.atr) html += '<span style="color:var(--text-muted);">ATR <span style="font-weight:700;">$' + s.atr.toFixed(2) + '</span></span>';
    html += '</div>';
    // Trade management tip
    if (s.mgmt) {
      html += '<div style="margin-top:5px;font-size:10px;color:var(--text-muted);line-height:1.4;border-top:1px solid var(--border);padding-top:5px;">';
      html += '<span style="color:var(--amber);font-weight:600;">MGMT</span> ' + s.mgmt;
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>'; // close detail
  html += '</div>'; // close card
  return html;
}


// ==================== COMPONENT BAR RENDERER ====================

function renderComponentBar(label, value, max, color) {
  var pct = Math.round((value / max) * 100);
  return '<div style="padding:3px 0;">' +
    '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">' +
    '<span style="color:var(--text-muted);">' + label + '</span>' +
    '<span style="color:var(--text-secondary);font-family:var(--font-mono);">' + value + '/' + max + '</span>' +
    '</div>' +
    '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">' +
    '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:2px;"></div>' +
    '</div></div>';
}


// ==================== UNIVERSE LIST ====================

var _universeListData = [];
var _universeSortCol = 'score';
var _universeSortAsc = false;

function _universeGetVal(t, col) {
  switch(col) {
    case 'score': return t.score || 0;
    case 'ticker': return (t.ticker || '').toUpperCase();
    case 'price': return t.price || 0;
    case 'mcap': return t.mcap || 0;
    case 'atr': return t.atr || 0;
    case 'range5': return t.range5 != null ? t.range5 : -999;
    case 'ext': return t.extFromSma20 != null ? t.extFromSma20 : -999;
    case 'vol': return t.volDryUp != null ? t.volDryUp : -999;
    case 'smas': return t.aboveSMAs === '3/3' ? 3 : t.aboveSMAs === '2/3' ? 2 : t.aboveSMAs === '1/3' ? 1 : 0;
    case 'brkout': return t.distToBreakout != null ? t.distToBreakout : -999;
    default: return 0;
  }
}

function sortUniverseBy(col) {
  if (_universeSortCol === col) {
    _universeSortAsc = !_universeSortAsc;
  } else {
    _universeSortCol = col;
    _universeSortAsc = (col === 'ticker'); // alpha defaults asc, numbers default desc
  }
  _rerenderUniverseRows();
}

function _fmtMcap(v) {
  if (!v) return '\u2014';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '$' + (v / 1e3).toFixed(0) + 'K';
}

var _univCols = '30px 46px 50px 68px 62px 50px 50px 48px 48px 44px 44px';

function _rerenderUniverseRows() {
  var tbody = document.getElementById('universe-tbody');
  if (!tbody) return;
  var list = _universeListData.slice();
  var col = _universeSortCol;
  var asc = _universeSortAsc;
  list.sort(function(a, b) {
    var va = _universeGetVal(a, col), vb = _universeGetVal(b, col);
    if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? va - vb : vb - va;
  });

  var html = '';
  list.forEach(function(t, idx) {
    var bg = idx % 2 === 0 ? '' : 'background:var(--bg-secondary);';
    var extColor = (t.extFromSma20 || 0) <= 3 ? 'var(--green)' : (t.extFromSma20 || 0) >= 8 ? 'var(--red)' : 'var(--text-muted)';
    var sc = t.score || 0;
    var scoreColor = sc >= 60 ? 'var(--green)' : sc >= 40 ? 'var(--blue)' : sc >= 20 ? 'var(--amber)' : 'var(--text-muted)';

    html += '<div style="display:grid;grid-template-columns:' + _univCols + ';gap:4px;padding:7px 14px;border-bottom:1px solid var(--border);font-size:12px;' + bg + 'align-items:center;">';
    html += '<span style="color:var(--text-muted);">' + (idx + 1) + '</span>';
    html += '<span style="font-weight:900;font-family:var(--font-mono);color:' + scoreColor + ';">' + sc + '</span>';
    html += '<span onclick="event.stopPropagation();openTVChart(\'' + t.ticker + '\')" title="Click for chart" class="ticker-link">' + t.ticker + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-secondary);">$' + t.price.toFixed(2) + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-muted);">' + _fmtMcap(t.mcap) + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-muted);">' + (t.atr != null ? '$' + t.atr.toFixed(2) : '\u2014') + '</span>';
    html += '<span style="color:var(--text-muted);">' + (t.range5 || '\u2014') + '%</span>';
    html += '<span style="color:' + extColor + ';">' + (t.extFromSma20 != null ? (t.extFromSma20 >= 0 ? '+' : '') + t.extFromSma20 + '%' : '\u2014') + '</span>';
    html += '<span style="color:var(--text-muted);">' + (t.volDryUp != null ? t.volDryUp + '%' : '\u2014') + '</span>';
    html += '<span style="color:' + (t.aboveSMAs === '3/3' ? 'var(--green)' : 'var(--text-muted)') + ';">' + (t.aboveSMAs || '\u2014') + '</span>';
    html += '<span style="font-size:11px;color:var(--text-muted);">' + (t.distToBreakout != null ? t.distToBreakout + '%' : '\u2014') + '</span>';
    html += '</div>';
  });
  tbody.innerHTML = html;

  // Update header arrows
  var headers = document.querySelectorAll('[data-univsort]');
  headers.forEach(function(h) {
    var c = h.getAttribute('data-univsort');
    var arrow = h.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = c === _universeSortCol ? (_universeSortAsc ? ' \u25B2' : ' \u25BC') : '';
  });
}

function renderUniverseList(tickers) {
  // Use setup scan data if available (consistent with setup cards)
  var setupScores = null, setupMcap = null, setupAtr = null;
  try {
    var sr = localStorage.getItem(SCANNER_RESULTS_KEY);
    if (sr) {
      var parsed = JSON.parse(sr);
      setupScores = parsed.allScores || null;
      setupMcap = parsed.allMcap || null;
      setupAtr = parsed.allAtr || null;
    }
  } catch(e) {}

  // Build list with best available score + mcap + atr
  _universeListData = tickers.map(function(t) {
    var s = (setupScores && setupScores[t.ticker] != null) ? setupScores[t.ticker] : (t.score || 0);
    var mc = (setupMcap && setupMcap[t.ticker]) ? setupMcap[t.ticker] : null;
    var atr = (setupAtr && setupAtr[t.ticker]) ? setupAtr[t.ticker] : (t.atr14 || null);
    return { ticker: t.ticker, price: t.price, range5: t.range5, extFromSma20: t.extFromSma20, volDryUp: t.volDryUp, aboveSMAs: t.aboveSMAs, distToBreakout: t.distToBreakout, score: s, mcap: mc, atr: atr };
  });

  // Initial sort
  _universeSortCol = 'score';
  _universeSortAsc = false;
  _universeListData.sort(function(a, b) { return b.score - a.score; });

  var html = '<div class="sc-table-wrap" style=""><div class="card" style="padding:0;overflow:hidden;">';

  // Header with clickable sort columns
  var headerStyle = 'cursor:pointer;user-select:none;';
  html += '<div style="display:grid;grid-template-columns:' + _univCols + ';gap:4px;padding:8px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">';
  html += '<span>#</span>';
  html += '<span data-univsort="score" onclick="sortUniverseBy(\'score\')" style="' + headerStyle + '">Score<span class="sort-arrow"> \u25BC</span></span>';
  html += '<span data-univsort="ticker" onclick="sortUniverseBy(\'ticker\')" style="' + headerStyle + '">Ticker<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="price" onclick="sortUniverseBy(\'price\')" style="' + headerStyle + '">Price<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="mcap" onclick="sortUniverseBy(\'mcap\')" style="' + headerStyle + '">MCap<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="atr" onclick="sortUniverseBy(\'atr\')" style="' + headerStyle + '">ATR<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="range5" onclick="sortUniverseBy(\'range5\')" style="' + headerStyle + '">5d %<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="ext" onclick="sortUniverseBy(\'ext\')" style="' + headerStyle + '">Ext<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="vol" onclick="sortUniverseBy(\'vol\')" style="' + headerStyle + '">Vol<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="smas" onclick="sortUniverseBy(\'smas\')" style="' + headerStyle + '">SMAs<span class="sort-arrow"></span></span>';
  html += '<span data-univsort="brkout" onclick="sortUniverseBy(\'brkout\')" style="' + headerStyle + '">Brkout<span class="sort-arrow"></span></span>';
  html += '</div>';

  // Body container for re-rendering
  html += '<div id="universe-tbody">';
  _universeListData.forEach(function(t, idx) {
    var bg = idx % 2 === 0 ? '' : 'background:var(--bg-secondary);';
    var extColor = (t.extFromSma20 || 0) <= 3 ? 'var(--green)' : (t.extFromSma20 || 0) >= 8 ? 'var(--red)' : 'var(--text-muted)';
    var sc = t.score || 0;
    var scoreColor = sc >= 60 ? 'var(--green)' : sc >= 40 ? 'var(--blue)' : sc >= 20 ? 'var(--amber)' : 'var(--text-muted)';

    html += '<div style="display:grid;grid-template-columns:' + _univCols + ';gap:4px;padding:7px 14px;border-bottom:1px solid var(--border);font-size:12px;' + bg + 'align-items:center;">';
    html += '<span style="color:var(--text-muted);">' + (idx + 1) + '</span>';
    html += '<span style="font-weight:900;font-family:var(--font-mono);color:' + scoreColor + ';">' + sc + '</span>';
    html += '<span onclick="event.stopPropagation();openTVChart(\'' + t.ticker + '\')" title="Click for chart" class="ticker-link">' + t.ticker + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-secondary);">$' + t.price.toFixed(2) + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-muted);">' + _fmtMcap(t.mcap) + '</span>';
    html += '<span style="font-family:var(--font-mono);color:var(--text-muted);">' + (t.atr != null ? '$' + t.atr.toFixed(2) : '\u2014') + '</span>';
    html += '<span style="color:var(--text-muted);">' + (t.range5 || '\u2014') + '%</span>';
    html += '<span style="color:' + extColor + ';">' + (t.extFromSma20 != null ? (t.extFromSma20 >= 0 ? '+' : '') + t.extFromSma20 + '%' : '\u2014') + '</span>';
    html += '<span style="color:var(--text-muted);">' + (t.volDryUp != null ? t.volDryUp + '%' : '\u2014') + '</span>';
    html += '<span style="color:' + (t.aboveSMAs === '3/3' ? 'var(--green)' : 'var(--text-muted)') + ';">' + (t.aboveSMAs || '\u2014') + '</span>';
    html += '<span style="font-size:11px;color:var(--text-muted);">' + (t.distToBreakout != null ? t.distToBreakout + '%' : '\u2014') + '</span>';
    html += '</div>';
  });
  html += '</div>';

  html += '</div></div>';
  return html;
}




// ==================== SINGLE SCAN BUTTON ====================

async function runFullScanUI() {
  // Disable all scan buttons in strategy boxes during scan
  var scanBtns = document.querySelectorAll('.scanner-strategy-grid .refresh-btn');
  var statusEl = document.getElementById('scanner-status');
  var pctEl = document.getElementById('scanner-pct');
  var barEl = document.getElementById('scanner-progress-bar');
  var progressWrap = document.getElementById('scanner-progress-wrap');
  var idleStatus = document.getElementById('scanner-status-idle');
  scanBtns.forEach(function(b) { b.disabled = true; });
  if (progressWrap) progressWrap.style.display = 'block';
  if (idleStatus) idleStatus.style.display = 'none';
  if (barEl) { barEl.style.background = 'var(--blue)'; }
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; }

  function updateProgress(msg, pct) {
    if (statusEl) statusEl.textContent = msg;
    if (pct !== undefined && pctEl) pctEl.textContent = pct + '%';
    if (pct !== undefined && barEl) barEl.style.width = pct + '%';
  }

  try {
    var cache = getMomentumCache();
    var hasFreshCache = cache && cache.tickers && cache.tickers.length > 0 && isMomentumCacheFresh();

    // Step 1: Build universe if needed
    if (!hasFreshCache) {
      // Try server cache first
      updateProgress('Checking for cached universe...', 5);
      var serverData = await getServerScanResults();
      if (serverData && serverData.momentum_universe && serverData.momentum_universe.tickers) {
        saveMomentumCache(serverData.momentum_universe);
        cache = serverData.momentum_universe;
        updateProgress('Loaded universe from server.', 20);
      } else {
        updateProgress('Building candidate universe...', 5);
        await buildMomentumUniverse(function(msg) {
          var match = msg.match(/(\d+)%/);
          var pct = match ? Math.round(5 + parseInt(match[1]) * 0.55) : undefined;
          updateProgress(msg, pct);
        });
        cache = getMomentumCache();
        updateProgress('Universe built! Analyzing setups...', 65);
      }
    } else {
      updateProgress('Universe cached. Analyzing setups...', 20);
    }

    // Update universe list
    var universeBody = document.getElementById('universe-body');
    if (universeBody && cache && cache.tickers) {
      universeBody.innerHTML = renderUniverseList(cache.tickers);
    }

    // Step 2: Run setup scan
    updateProgress('Running setup analysis...', 30);
    var results = await runSetupScan(function(msg) {
      var match = msg.match(/(\d+)\/(\d+)/);
      if (match) {
        var pct = 30 + Math.round(parseInt(match[1]) / parseInt(match[2]) * 65);
        updateProgress(msg, Math.min(pct, 98));
      } else {
        updateProgress(msg);
      }
    });

    updateProgress('Done!', 100);
    // Update all 4 strategy boxes with filtered results
    var allSetups = results.setups || [];
    var boxMap = {
      'early-breakout': allSetups.filter(function(s) { return s.category === 'EARLY BREAKOUT' || !s.category; }),
      'pullback-entry': allSetups.filter(function(s) { return s.category === 'PULLBACK'; }),
      'mean-reversion': allSetups.filter(function(s) { return s.category === 'MEAN REVERSION'; }),
      'momentum-breakout': allSetups.filter(function(s) { return s.category === 'MOMENTUM BREAKOUT'; })
    };
    Object.keys(boxMap).forEach(function(boxId) {
      var el = document.getElementById(boxId + '-results');
      if (!el) return;
      var setups = boxMap[boxId];
      if (setups.length > 0) {
        var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
        setups.slice(0, 5).forEach(function(s, idx) { html += renderSetupCard(s, boxId + '-' + idx, results); });
        html += '</div>';
        if (setups.length > 5) {
          html += '<div style="text-align:center;margin-top:8px;">';
          html += '<button onclick="expandStrategyResults(\'' + boxId + '\')" class="refresh-btn" style="padding:6px 16px;font-size:12px;">View All ' + setups.length + ' Setups</button>';
          html += '</div>';
        }
        el.innerHTML = html;
      } else {
        el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">No setups found for this strategy.</div>';
      }
    });

    setTimeout(function() {
      if (progressWrap) progressWrap.style.display = 'none';
      if (idleStatus) {
        var setupCount = allSetups.length;
        var funnelHtml = '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">';
        if (cache.totalScanned) {
          funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> scanned';
          funnelHtml += '<span style="font-size:10px;margin:0 2px;">\u2192</span>';
        }
        funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
        if (setupCount > 0) {
          funnelHtml += '<span style="font-size:10px;margin:0 2px;">\u2192</span>';
          funnelHtml += '<span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);">' + setupCount + '</span> <span style="font-weight:600;color:var(--blue);">setups</span>';
          var parts = [];
          if (boxMap['early-breakout'].length) parts.push(boxMap['early-breakout'].length + ' EB');
          if (boxMap['pullback-entry'].length) parts.push(boxMap['pullback-entry'].length + ' PB');
          if (boxMap['mean-reversion'].length) parts.push(boxMap['mean-reversion'].length + ' MR');
          if (boxMap['momentum-breakout'].length) parts.push(boxMap['momentum-breakout'].length + ' MB');
          if (parts.length) funnelHtml += ' <span style="color:var(--text-muted);">(' + parts.join(', ') + ')</span>';
        }
        funnelHtml += '</div>';
        idleStatus.innerHTML = funnelHtml;
        idleStatus.style.display = 'block';
      }
    }, 1500);

  } catch(e) {
    updateProgress('Error: ' + e.message, 0);
    if (barEl) barEl.style.background = 'var(--red)';
    if (statusEl) statusEl.style.color = 'var(--red)';
  }

  scanBtns.forEach(function(b) { b.disabled = false; });
}


// ==================== SUPABASE SCAN CACHE ====================

async function getServerScanResults() {
  var sb = window.supabaseClient;
  if (!sb) return null;
  var lastDay = getLastTradingDay();
  try {
    var resp = await sb.from('scan_results').select('*').eq('scan_date', lastDay).maybeSingle();
    if (resp.data) return resp.data;
  } catch(e) { console.warn('[scanner] Supabase cache check failed:', e); }
  return null;
}

async function triggerServerScan() {
  try {
    var resp = await fetch('https://urpblscayyeadecozgvo.supabase.co/functions/v1/daily-scanner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return await resp.json();
  } catch(e) {
    console.warn('[scanner] Server scan trigger failed:', e);
    return null;
  }
}


// ==================== SCANNER ALERTS ====================

var _alertedSetups = {};

function checkScannerAlerts(setups) {
  if (localStorage.getItem('mac_scanner_alerts') !== 'true') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  setups.forEach(function(s) {
    if (s.score < 70) return;
    if (_alertedSetups[s.ticker]) return;
    _alertedSetups[s.ticker] = true;

    var dirStr = s.direction === 'LONG' ? 'breaking out' : 'breaking down';
    var gapStr = (s.gapPct >= 0 ? '+' : '') + s.gapPct.toFixed(1) + '% gap';
    var body = s.ticker + ' ' + dirStr + ' (' + gapStr + ', score ' + s.score + ')';

    var n = new Notification('ORB Alert: ' + s.ticker, {
      body: body,
      tag: 'orb-' + s.ticker
    });

    n.onclick = function() {
      window.focus();
      if (typeof openTVChart === 'function') openTVChart(s.ticker);
      n.close();
    };

    setTimeout(function() { n.close(); }, 8000);
  });
}

// ==================== TOGGLES ====================

function toggleStratInfo(id) {
  var body = document.getElementById(id + '-info-body'), arrow = document.getElementById(id + '-info-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '\u25bc' : '\u25b6';
}
function toggleDTInfo() { toggleStratInfo('dt'); }
function toggleSwingInfo() { toggleStratInfo('swing'); }

function toggleUniverse() {
  var body = document.getElementById('universe-body'), arrow = document.getElementById('universe-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
  try { localStorage.setItem('mac_universe_collapsed', hidden ? 'false' : 'true'); } catch(e) {}
}


// ==================== AUTO-BUILD (triggered when Scanner tab is opened) ====================
var _autoBuildRunning = false;

// Called by tabs.js when user clicks Scanner tab — NOT on page load.
// This prevents 100+ Polygon API calls on every page load for a tab the user may never visit.
function scannerAutoBuild() {
  (async function() {
    if (!window._currentSession) return;

    // Try server cache
    try {
      var serverData = await getServerScanResults();
      if (serverData && serverData.momentum_universe && serverData.momentum_universe.tickers) {
        saveMomentumCache(serverData.momentum_universe);
        if (serverData.breakout_setups) {
          try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(serverData.breakout_setups)); } catch(e) {}
        }
        console.log('[scanner] Loaded universe from server cache.');
        return;
      }
    } catch(e) { console.warn('[scanner] Server cache check failed:', e); }

    if (isMomentumCacheFresh()) {
      console.log('[scanner] Local universe cache is fresh.');
      return;
    }

    if (_autoBuildRunning) return;
    _autoBuildRunning = true;
    console.log('[scanner] Universe stale. Auto-building in background...');

    var idleStatus = document.getElementById('scanner-status-idle');
    if (idleStatus) idleStatus.textContent = 'Auto-building candidate universe...';

    try {
      await buildMomentumUniverse(function(msg) {
        console.log('[scanner] ' + msg);
        if (idleStatus) idleStatus.textContent = msg;
      });
      console.log('[scanner] Auto-build complete.');
      if (idleStatus) {
        var cache = getMomentumCache();
        if (cache) {
          var _fhtml = '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">';
          if (cache.totalScanned) {
            _fhtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> scanned';
            _fhtml += '<span style="font-size:10px;">\u2192</span>';
          }
          _fhtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates'
            + ' · <span style="color:var(--blue);font-weight:600;">Click Scan for setups</span></div>';
          idleStatus.innerHTML = _fhtml;
        }
      }
      var cache = getMomentumCache();
      var universeBody = document.getElementById('universe-body');
      if (universeBody && cache && cache.tickers) {
        universeBody.innerHTML = renderUniverseList(cache.tickers);
      }
    } catch(e) {
      console.warn('[scanner] Auto-build failed:', e);
      if (idleStatus) idleStatus.textContent = 'Auto-build failed: ' + e.message;
    }
    _autoBuildRunning = false;
  })();
}


// ==================== BACKTEST RESULTS ====================

var _backtestShowAll = false;

function toggleBacktestCollapse() {
  var body = document.getElementById('backtest-results');
  var btn = document.getElementById('backtest-toggle');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (btn) btn.textContent = isHidden ? 'Hide' : 'Show';
  try { localStorage.setItem('mac_backtest_collapsed', isHidden ? 'false' : 'true'); } catch(e) {}
}

function toggleBacktestShowAll() {
  _backtestShowAll = !_backtestShowAll;
  var sel = document.getElementById('backtest-days-select');
  var days = sel ? parseInt(sel.value) : 30;
  loadBacktestResults(days);
}

async function loadBacktestResults(days) {
  if (!days) {
    var sel = document.getElementById('backtest-days-select');
    days = sel ? parseInt(sel.value) : 30;
  }
  var container = document.getElementById('backtest-results');
  if (!container) return;
  if (typeof dbGetBacktestResults !== 'function') {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">Sign in to view backtest results</div>';
    return;
  }
  container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">Loading...</div>';
  try {
    var data = await dbGetBacktestResults(days);
    if (!data || data.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">No backtest data yet. Results appear after the nightly backtester runs.</div>';
      return;
    }
    container.innerHTML = renderBacktestResults(data);
  } catch(e) {
    console.warn('[backtest] Load failed:', e);
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">Failed to load backtest data.</div>';
  }
}

function getStratLabel(strat) {
  var labels = {
    'EARLY BREAKOUT': 'Early Breakout', 'PULLBACK': 'Pullback',
    'MEAN REVERSION': 'Mean Reversion', 'MOMENTUM BREAKOUT': 'Momentum BRK',
    'ORB_BREAKOUT': 'ORB Breakout'
  };
  return labels[strat] || strat;
}

function getStratColor(strat) {
  var colors = {
    'EARLY BREAKOUT': 'var(--green)', 'PULLBACK': 'var(--blue)',
    'MEAN REVERSION': '#a855f7', 'MOMENTUM BREAKOUT': '#f59e0b',
    'ORB_BREAKOUT': 'var(--red)'
  };
  return colors[strat] || 'var(--text-muted)';
}

function getStratBg(strat) {
  var bgs = {
    'EARLY BREAKOUT': 'rgba(16,185,129,0.1)', 'PULLBACK': 'rgba(79,70,229,0.1)',
    'MEAN REVERSION': 'rgba(168,85,247,0.1)', 'MOMENTUM BREAKOUT': 'rgba(245,158,11,0.1)',
    'ORB_BREAKOUT': 'rgba(239,68,68,0.1)'
  };
  return bgs[strat] || 'rgba(128,128,128,0.1)';
}

function calcEdgeStats(trades) {
  // Calculate expectancy, profit factor, win rate for an array of backtest trades
  var wins = 0, losses = 0, pending = 0, total = trades.length;
  var winRSum = 0, lossRSum = 0;
  var maxMoveSum = 0, maxMoveCount = 0;

  for (var i = 0; i < trades.length; i++) {
    var r = trades[i];
    var isWin = r.hit_target && !r.hit_stop;
    var isLoss = r.hit_stop;

    if (r.max_move_pct != null) { maxMoveSum += r.max_move_pct; maxMoveCount++; }

    if (!isWin && !isLoss) { pending++; continue; }

    // Compute R-multiple for this trade
    var entry = r.entry_price, target = r.target_price, stop = r.stop_price;
    var risk = 0, reward = 0;
    if (r.direction === 'SHORT') {
      risk = Math.abs(stop - entry);
      reward = Math.abs(entry - target);
    } else {
      risk = Math.abs(entry - stop);
      reward = Math.abs(target - entry);
    }
    var rMultiple = risk > 0 ? reward / risk : 1;

    if (isWin) { wins++; winRSum += rMultiple; }
    else if (isLoss) { losses++; lossRSum += 1; } // Loss is always -1R
  }

  var decided = wins + losses;
  var winRate = decided > 0 ? Math.round((wins / decided) * 100) : 0;
  var avgWinR = wins > 0 ? winRSum / wins : 0;
  var avgLossR = losses > 0 ? lossRSum / losses : 1;
  // Expectancy = (Win% × AvgWinR) - (Loss% × AvgLossR)
  var expectancy = decided > 0 ? ((wins / decided) * avgWinR) - ((losses / decided) * avgLossR) : 0;
  var profitFactor = lossRSum > 0 ? winRSum / lossRSum : (winRSum > 0 ? 999 : 0);
  var avgMove = maxMoveCount > 0 ? maxMoveSum / maxMoveCount : 0;

  // Confidence based on decided trades
  var confidence = decided >= 30 ? 'HIGH' : decided >= 15 ? 'MED' : 'LOW';

  return {
    wins: wins, losses: losses, pending: pending, total: total, decided: decided,
    winRate: winRate, expectancy: expectancy, profitFactor: profitFactor,
    avgMove: avgMove, confidence: confidence
  };
}

function toggleRegimeBreakdown(stratIdx) {
  var el = document.getElementById('regime-breakdown-' + stratIdx);
  if (!el) return;
  var arrow = document.getElementById('regime-arrow-' + stratIdx);
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (arrow) arrow.textContent = '▾';
  } else {
    el.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
  }
}

function renderBacktestResults(data) {
  // Group trades by strategy
  var stratTrades = {};
  var totalWins = 0, totalLosses = 0, totalPending = 0;

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var strat = r.strategy || 'UNKNOWN';
    if (!stratTrades[strat]) stratTrades[strat] = [];
    stratTrades[strat].push(r);

    var isWin = r.hit_target && !r.hit_stop;
    var isLoss = r.hit_stop;
    if (isWin) totalWins++;
    else if (isLoss) totalLosses++;
    else totalPending++;
  }

  // Build leaderboard with edge stats
  var leaderboard = [];
  for (var s in stratTrades) {
    var stats = calcEdgeStats(stratTrades[s]);
    var status = 'OK';
    if (stats.decided < 5) status = 'NEW';
    else if (stats.expectancy > 0 && stats.winRate >= 55) status = 'EDGE';
    else if (stats.winRate >= 60) status = 'HOT';
    else if (stats.winRate < 45) status = 'COLD';

    // Regime breakdown
    var regimeStats = {};
    var hasRegime = false;
    for (var ri = 0; ri < stratTrades[s].length; ri++) {
      var regime = stratTrades[s][ri].market_regime;
      if (regime) {
        hasRegime = true;
        if (!regimeStats[regime]) regimeStats[regime] = [];
        regimeStats[regime].push(stratTrades[s][ri]);
      }
    }

    leaderboard.push({
      strategy: s, winRate: stats.winRate, wins: stats.wins, losses: stats.losses,
      pending: stats.pending, total: stats.total, decided: stats.decided,
      avgMove: stats.avgMove, status: status,
      expectancy: stats.expectancy, profitFactor: stats.profitFactor,
      confidence: stats.confidence, regimeStats: regimeStats, hasRegime: hasRegime
    });
  }
  // Sort by expectancy (edge) first, then win rate
  leaderboard.sort(function(a, b) {
    if (a.decided < 3 && b.decided >= 3) return 1;
    if (b.decided < 3 && a.decided >= 3) return -1;
    if (Math.abs(b.expectancy - a.expectancy) > 0.01) return b.expectancy - a.expectancy;
    return b.winRate - a.winRate;
  });

  // Cache leaderboard for hot strategy banner
  try { localStorage.setItem('mac_strategy_leaderboard', JSON.stringify(leaderboard)); } catch(e) {}

  var totalAll = totalWins + totalLosses + totalPending;
  var decidedAll = totalWins + totalLosses;
  var overallWR = decidedAll > 0 ? Math.round((totalWins / decidedAll) * 100) : 0;
  var overallColor = overallWR >= 60 ? 'var(--green)' : overallWR >= 45 ? 'var(--amber)' : 'var(--red)';
  var overallStats = calcEdgeStats(data);

  var html = '';

  // ── Overall stats bar ──
  html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:10px 14px;margin-bottom:12px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<span style="font-size:11px;color:var(--text-muted);">Overall:</span>';
  html += '<span style="font-size:16px;font-weight:900;color:' + overallColor + ';font-family:var(--font-mono);">' + overallWR + '%</span>';
  var expColor = overallStats.expectancy > 0 ? 'var(--green)' : overallStats.expectancy < 0 ? 'var(--red)' : 'var(--text-muted)';
  html += '<span style="font-size:11px;color:var(--text-muted);">Exp:</span><span style="font-size:13px;font-weight:800;color:' + expColor + ';font-family:var(--font-mono);">' + (overallStats.expectancy >= 0 ? '+' : '') + overallStats.expectancy.toFixed(2) + 'R</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px;font-size:11px;font-family:var(--font-mono);">';
  html += '<span style="color:var(--green);font-weight:700;">' + totalWins + 'W</span>';
  html += '<span style="color:var(--red);font-weight:700;">' + totalLosses + 'L</span>';
  if (totalPending > 0) html += '<span style="color:var(--amber);font-weight:700;">' + totalPending + 'P</span>';
  html += '<span style="color:var(--text-muted);">' + totalAll + ' total</span>';
  html += '</div>';
  html += '</div>';
  // Win rate bar
  html += '<div style="height:5px;background:var(--bg-primary);border-radius:3px;overflow:hidden;">';
  if (decidedAll > 0) {
    html += '<div style="width:' + (totalWins / decidedAll * 100) + '%;height:100%;background:' + overallColor + ';border-radius:3px;"></div>';
  }
  html += '</div>';
  html += '</div>';

  // ── Strategy Leaderboard ──
  // Column headers
  html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 12px;margin-bottom:4px;">';
  html += '<span style="width:16px;"></span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:110px;text-align:center;">Strategy</span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:40px;text-align:right;">Win%</span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:50px;text-align:right;">Expect</span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:40px;text-align:right;">PF</span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:55px;text-align:center;">Trades</span>';
  html += '<span style="font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;min-width:40px;text-align:center;">Conf</span>';
  html += '</div>';

  html += '<div style="margin-bottom:12px;">';
  for (var k = 0; k < leaderboard.length; k++) {
    var lb = leaderboard[k];
    var lbColor = getStratColor(lb.strategy);
    var lbBg = getStratBg(lb.strategy);

    // Status badge
    var statusBadge = '';
    if (lb.status === 'EDGE') statusBadge = '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:rgba(16,185,129,0.15);color:var(--green);">EDGE</span>';
    else if (lb.status === 'HOT') statusBadge = '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:rgba(16,185,129,0.15);color:var(--green);">HOT</span>';
    else if (lb.status === 'COLD') statusBadge = '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:rgba(239,68,68,0.15);color:var(--red);">COLD</span>';
    else if (lb.status === 'NEW') statusBadge = '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:rgba(128,128,128,0.15);color:var(--text-muted);">NEW</span>';

    var lbWrColor = lb.winRate >= 60 ? 'var(--green)' : lb.winRate >= 45 ? 'var(--amber)' : 'var(--red)';
    var lbExpColor = lb.expectancy > 0 ? 'var(--green)' : lb.expectancy < 0 ? 'var(--red)' : 'var(--text-muted)';
    var lbPfColor = lb.profitFactor >= 1.5 ? 'var(--green)' : lb.profitFactor >= 1.0 ? 'var(--amber)' : 'var(--red)';
    var confColor = lb.confidence === 'HIGH' ? 'var(--green)' : lb.confidence === 'MED' ? 'var(--amber)' : 'var(--text-muted)';
    var confBg = lb.confidence === 'HIGH' ? 'rgba(16,185,129,0.1)' : lb.confidence === 'MED' ? 'rgba(245,158,11,0.1)' : 'rgba(128,128,128,0.1)';

    // Regime expand arrow (only if data exists)
    var regimeArrow = lb.hasRegime ? '<span id="regime-arrow-' + k + '" style="font-size:10px;color:var(--text-muted);cursor:pointer;">▸</span>' : '';

    html += '<div style="border-radius:8px;margin-bottom:2px;background:' + (k === 0 ? 'var(--bg-secondary)' : 'transparent') + ';">';

    // Main row — clickable if regime data exists
    html += '<div onclick="' + (lb.hasRegime ? 'toggleRegimeBreakdown(' + k + ')' : '') + '" style="display:flex;align-items:center;gap:6px;padding:8px 12px;' + (lb.hasRegime ? 'cursor:pointer;' : '') + '">';
    // Rank + regime arrow
    html += '<span style="font-size:12px;font-weight:900;color:var(--text-muted);width:16px;text-align:center;font-family:var(--font-mono);display:flex;align-items:center;gap:2px;">' + regimeArrow + (k + 1) + '</span>';
    // Strategy badge
    html += '<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;background:' + lbBg + ';color:' + lbColor + ';min-width:110px;text-align:center;">' + getStratLabel(lb.strategy) + '</span>';
    // Win rate
    html += '<span style="font-size:14px;font-weight:900;color:' + lbWrColor + ';font-family:var(--font-mono);min-width:40px;text-align:right;">' + lb.winRate + '%</span>';
    // Expectancy
    html += '<span style="font-size:12px;font-weight:800;color:' + lbExpColor + ';font-family:var(--font-mono);min-width:50px;text-align:right;">' + (lb.expectancy >= 0 ? '+' : '') + lb.expectancy.toFixed(2) + 'R</span>';
    // Profit Factor
    var pfDisplay = lb.profitFactor >= 999 ? '∞' : lb.profitFactor.toFixed(1);
    html += '<span style="font-size:11px;font-weight:700;color:' + lbPfColor + ';font-family:var(--font-mono);min-width:40px;text-align:right;">' + pfDisplay + '</span>';
    // Trade count
    html += '<span style="font-size:11px;color:var(--text-muted);min-width:55px;text-align:center;">' + lb.decided + ' / ' + lb.total + '</span>';
    // Confidence badge
    html += '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:' + confBg + ';color:' + confColor + ';min-width:40px;text-align:center;">' + lb.confidence + '</span>';
    // Status
    html += statusBadge;
    html += '</div>';

    // Regime breakdown (hidden by default)
    if (lb.hasRegime) {
      html += '<div id="regime-breakdown-' + k + '" style="display:none;padding:0 12px 8px 40px;">';
      var regimeOrder = ['Bullish', 'Chop', 'Bearish'];
      var regimeColors = { 'Bullish': 'var(--green)', 'Chop': 'var(--amber)', 'Bearish': 'var(--red)' };
      var regimeIcons = { 'Bullish': '↑', 'Chop': '↔', 'Bearish': '↓' };

      // Find best regime by expectancy
      var bestRegime = null, bestExp = -999;
      for (var rr = 0; rr < regimeOrder.length; rr++) {
        var rName = regimeOrder[rr];
        if (lb.regimeStats[rName] && lb.regimeStats[rName].length >= 3) {
          var rStats = calcEdgeStats(lb.regimeStats[rName]);
          if (rStats.expectancy > bestExp) { bestExp = rStats.expectancy; bestRegime = rName; }
        }
      }

      for (var rk = 0; rk < regimeOrder.length; rk++) {
        var regime = regimeOrder[rk];
        var rTrades = lb.regimeStats[regime];
        if (!rTrades || rTrades.length === 0) continue;

        var rEdge = calcEdgeStats(rTrades);
        var rWrColor = rEdge.winRate >= 60 ? 'var(--green)' : rEdge.winRate >= 45 ? 'var(--amber)' : 'var(--red)';
        var rExpColor = rEdge.expectancy > 0 ? 'var(--green)' : rEdge.expectancy < 0 ? 'var(--red)' : 'var(--text-muted)';
        var isBest = regime === bestRegime;
        var isInsufficient = rEdge.decided < 3;

        var connector = rk === regimeOrder.length - 1 || (rk < regimeOrder.length - 1 && (!lb.regimeStats[regimeOrder[rk + 1]] || lb.regimeStats[regimeOrder[rk + 1]].length === 0)) ? '└' : '├';

        html += '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;' + (isInsufficient ? 'opacity:0.5;' : '') + '">';
        html += '<span style="color:var(--text-muted);font-family:var(--font-mono);width:12px;">' + connector + '</span>';
        html += '<span style="color:' + regimeColors[regime] + ';font-weight:700;min-width:70px;">' + regimeIcons[regime] + ' ' + regime + '</span>';

        if (isInsufficient) {
          html += '<span style="color:var(--text-muted);font-style:italic;">insufficient data (' + rEdge.decided + ' trades)</span>';
        } else {
          html += '<span style="font-weight:800;color:' + rWrColor + ';font-family:var(--font-mono);min-width:35px;text-align:right;">' + rEdge.winRate + '%</span>';
          html += '<span style="color:var(--text-muted);margin:0 2px;">|</span>';
          html += '<span style="font-weight:700;color:' + rExpColor + ';font-family:var(--font-mono);min-width:45px;text-align:right;">' + (rEdge.expectancy >= 0 ? '+' : '') + rEdge.expectancy.toFixed(2) + 'R</span>';
          html += '<span style="color:var(--text-muted);margin:0 2px;">|</span>';
          var rPfColor = rEdge.profitFactor >= 1.5 ? 'var(--green)' : rEdge.profitFactor >= 1.0 ? 'var(--amber)' : 'var(--red)';
          var rPfDisplay = rEdge.profitFactor >= 999 ? '∞' : rEdge.profitFactor.toFixed(1);
          html += '<span style="font-weight:600;color:' + rPfColor + ';font-family:var(--font-mono);min-width:30px;">PF ' + rPfDisplay + '</span>';
          html += '<span style="color:var(--text-muted);margin:0 2px;">|</span>';
          html += '<span style="color:var(--text-muted);">' + rEdge.decided + ' trades</span>';
          if (isBest) html += '<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;background:rgba(16,185,129,0.12);color:var(--green);margin-left:4px;">BEST</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
  }
  html += '</div>';

  // ── Key for new metrics ──
  html += '<div style="display:flex;flex-wrap:wrap;gap:12px;padding:6px 12px;margin-bottom:10px;font-size:10px;color:var(--text-muted);">';
  html += '<span><strong>Win%</strong> = targets hit</span>';
  html += '<span><strong>Expect</strong> = avg R per trade</span>';
  html += '<span><strong>PF</strong> = profit factor</span>';
  html += '<span><strong>Trades</strong> = decided/total</span>';
  html += '<span><strong>Conf</strong> = sample confidence</span>';
  html += '</div>';

  // ── Results table (collapsible) ──
  var visibleCount = _backtestShowAll ? data.length : Math.min(data.length, 15);

  html += '<div style="overflow-x:auto;">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="border-bottom:2px solid var(--border);">';
  var thStyle = 'padding:6px 8px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em;';
  html += '<th style="text-align:left;' + thStyle + '">Date</th>';
  html += '<th style="text-align:left;' + thStyle + '">Ticker</th>';
  html += '<th style="text-align:left;' + thStyle + '">Strategy</th>';
  html += '<th style="text-align:center;' + thStyle + '">Score</th>';
  html += '<th style="text-align:left;' + thStyle + '">Result</th>';
  html += '<th style="text-align:right;' + thStyle + '">Max Move</th>';
  html += '</tr></thead><tbody>';

  for (var j = 0; j < visibleCount; j++) {
    var row = data[j];
    var isW = row.hit_target && !row.hit_stop;
    var isL = row.hit_stop;
    var rowBg = isW ? 'rgba(16,185,129,0.04)' : isL ? 'rgba(239,68,68,0.04)' : 'transparent';
    var resultText, resultColor;
    if (isW) { resultText = 'Hit Target'; resultColor = 'var(--green)'; }
    else if (isL) { resultText = 'Stopped Out'; resultColor = 'var(--red)'; }
    else { resultText = 'Pending'; resultColor = 'var(--amber)'; }

    var dateStr = row.date || '';
    if (dateStr.length >= 10) { var parts = dateStr.split('-'); dateStr = parts[1] + '/' + parts[2]; }

    var sc = row.score || 0;
    var scColor = sc >= 80 ? 'var(--green)' : sc >= 60 ? 'var(--blue)' : sc >= 40 ? 'var(--amber)' : 'var(--text-muted)';
    var maxMoveStr = row.max_move_pct != null ? '+' + Number(row.max_move_pct).toFixed(1) + '%' : '-';
    var maxMoveColor = row.max_move_pct >= 5 ? 'var(--green)' : row.max_move_pct >= 2 ? 'var(--text-secondary)' : 'var(--text-muted)';

    html += '<tr style="border-bottom:1px solid var(--border);background:' + rowBg + ';">';
    html += '<td style="padding:5px 8px;color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">' + dateStr + '</td>';
    html += '<td style="padding:5px 8px;font-weight:700;color:var(--text-primary);">' + (row.ticker || '') + '</td>';
    html += '<td style="padding:5px 8px;"><span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;background:' + getStratBg(row.strategy) + ';color:' + getStratColor(row.strategy) + ';">' + getStratLabel(row.strategy) + '</span></td>';
    html += '<td style="padding:5px 8px;text-align:center;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:2px solid ' + scColor + ';font-size:9px;font-weight:900;color:' + scColor + ';font-family:var(--font-mono);">' + sc + '</span></td>';
    html += '<td style="padding:5px 8px;font-weight:700;font-size:11px;color:' + resultColor + ';">' + resultText + '</td>';
    html += '<td style="padding:5px 8px;text-align:right;font-family:var(--font-mono);font-weight:700;font-size:11px;color:' + maxMoveColor + ';">' + maxMoveStr + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  html += '</div>';

  if (data.length > 15) {
    html += '<div style="text-align:center;margin-top:8px;">';
    html += '<button onclick="toggleBacktestShowAll()" style="padding:4px 16px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;">' + (_backtestShowAll ? 'Show less' : 'Show all ' + data.length + ' results') + '</button>';
    html += '</div>';
  }

  return html;
}

// ==================== SOCIAL ARBITRAGE SCANNER ====================

var SOCIAL_ARB_CACHE_KEY = 'mac_social_arb_results';

// Toggle info panel
function toggleSocialArbInfo() {
  var body = document.getElementById('social-arb-info-body');
  var arrow = document.getElementById('social-arb-info-arrow');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.textContent = isHidden ? '\u25bc' : '\u25b6';
}

// Toggle collapse
function toggleSocialArbCollapse() {
  var body = document.getElementById('social-arb-results');
  var btn = document.getElementById('social-arb-toggle');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (btn) btn.textContent = isHidden ? 'Hide' : 'Show';
  try { localStorage.setItem('mac_social_arb_collapsed', isHidden ? 'false' : 'true'); } catch(e) {}
}

// UI wrapper for social arbitrage scan
async function runSocialArbitrageScanUI() {
  var btn = document.getElementById('social-arb-scan-btn');
  var statusEl = document.getElementById('social-arb-status');
  var resultsEl = document.getElementById('social-arb-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }

  try {
    var results = await runSocialArbitrageScan(function(msg) {
      if (statusEl) statusEl.textContent = msg;
    });
    if (results && results.picks && results.picks.length > 0) {
      try { localStorage.setItem(SOCIAL_ARB_CACHE_KEY, JSON.stringify(results)); } catch(e) {}
      if (resultsEl) resultsEl.innerHTML = renderSocialArbResults(results);
      if (statusEl) statusEl.textContent = 'Found ' + results.picks.length + ' picks';
    } else {
      if (statusEl) statusEl.textContent = 'No strong social signals found right now';
      if (resultsEl) resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">No strong social arbitrage signals detected. Try again later.</div>';
    }
  } catch(err) {
    console.error('[social-arb] Scan failed:', err);
    if (statusEl) statusEl.textContent = 'Scan failed: ' + err.message;
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
}

// Core scan logic
async function runSocialArbitrageScan(statusFn) {
  if (!statusFn) statusFn = function() {};

  // Step 1: Get a broad universe of tickers from the momentum cache or build one
  statusFn('Building scan universe...');
  var cache = getMomentumCache();
  var universe = [];
  if (cache && cache.tickers && cache.tickers.length > 0) {
    universe = cache.tickers.map(function(t) { return t.ticker; });
  } else {
    // Fallback: use a curated list of high-profile consumer-facing stocks
    universe = [
      'AAPL','AMZN','TSLA','NFLX','DIS','NKE','SBUX','MCD','COST','WMT',
      'TGT','LULU','CROX','ELF','CELH','DKNG','RBLX','SPOT','ABNB','UBER',
      'META','SNAP','PINS','ETSY','CHWY','DASH','BROS','CAVA','DUOL','HIMS',
      'PLTR','SHOP','SQ','PYPL','COIN','RIVN','LCID','GME','AMC','SOFI',
      'NVDA','AMD','MSFT','GOOGL','SMCI','MELI','NU','SE','BABA','JD'
    ];
  }

  // Cap at 50 tickers to stay within rate limits
  universe = universe.slice(0, 50);

  // Step 2: Fetch news volume for all tickers
  statusFn('Scanning news volume for ' + universe.length + ' stocks...');
  var newsData = [];
  try {
    var session = window._currentSession;
    if (session && session.access_token) {
      var newsResp = await fetch(EDGE_FN_BASE + '/social-scanner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
        },
        body: JSON.stringify({ task: 'news_volume', tickers: universe })
      });
      if (newsResp.ok) {
        var nd = await newsResp.json();
        newsData = nd.results || [];
      }
    }
  } catch(e) { console.warn('[social-arb] News volume fetch failed:', e); }

  // Step 3: Find tickers with above-average news volume
  var avgNews = 0;
  if (newsData.length > 0) {
    var totalArticles = newsData.reduce(function(s, d) { return s + d.articleCount; }, 0);
    avgNews = totalArticles / newsData.length;
  }

  // Tickers with 2x+ average news volume are candidates
  var hotTickers = newsData.filter(function(d) {
    return d.articleCount >= Math.max(avgNews * 2, 3);
  }).map(function(d) { return d.ticker; });

  // Also add tickers with any news if we have fewer than 10 candidates
  if (hotTickers.length < 10) {
    var extraTickers = newsData.filter(function(d) {
      return d.articleCount >= 2 && hotTickers.indexOf(d.ticker) === -1;
    }).sort(function(a, b) { return b.articleCount - a.articleCount; })
      .slice(0, 10 - hotTickers.length)
      .map(function(d) { return d.ticker; });
    hotTickers = hotTickers.concat(extraTickers);
  }

  if (hotTickers.length === 0) {
    statusFn('No stocks with unusual news volume found');
    return { picks: [] };
  }

  statusFn('Found ' + hotTickers.length + ' stocks with elevated buzz — checking Reddit...');

  // Step 4: Fetch Reddit mentions for hot tickers
  var redditData = [];
  try {
    var session = window._currentSession;
    if (session && session.access_token) {
      var redditResp = await fetch(EDGE_FN_BASE + '/social-scanner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
        },
        body: JSON.stringify({ task: 'reddit_mentions', tickers: hotTickers })
      });
      if (redditResp.ok) {
        var rd = await redditResp.json();
        redditData = rd.results || [];
      }
    }
  } catch(e) { console.warn('[social-arb] Reddit fetch failed:', e); }

  // Step 5: Fetch Google Trends data for hot tickers
  statusFn('Checking Google Trends for ' + hotTickers.length + ' stocks...');
  var trendsData = [];
  try {
    var session = window._currentSession;
    if (session && session.access_token) {
      var trendsResp = await fetch(EDGE_FN_BASE + '/social-scanner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
        },
        body: JSON.stringify({ task: 'google_trends', tickers: hotTickers })
      });
      if (trendsResp.ok) {
        var td = await trendsResp.json();
        trendsData = td.results || [];
      }
    }
  } catch(e) { console.warn('[social-arb] Google Trends fetch failed:', e); }

  // Step 6: Fetch snapshots for price/volume data
  statusFn('Getting price data...');
  var snapshots = {};
  try {
    snapshots = await getSnapshots(hotTickers);
  } catch(e) {}

  // Step 7: Score each ticker
  // Scoring model: News(0-25) + Reddit(0-20) + Google Trends(0-25) + Price(0-15) + Volume(0-15) = 100
  statusFn('Scoring ' + hotTickers.length + ' candidates...');
  var candidates = [];
  var newsMap = {};
  newsData.forEach(function(d) { newsMap[d.ticker] = d; });
  var redditMap = {};
  redditData.forEach(function(d) { redditMap[d.ticker] = d; });
  var trendsMap = {};
  trendsData.forEach(function(d) { trendsMap[d.ticker] = d; });

  for (var i = 0; i < hotTickers.length; i++) {
    var ticker = hotTickers[i];
    var news = newsMap[ticker] || { articleCount: 0, headlines: [] };
    var reddit = redditMap[ticker] || { totalMentions: 0, topPosts: [] };
    var trends = trendsMap[ticker] || { trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: 'flat', keyword: ticker };
    var snap = snapshots[ticker] || {};

    // Price data
    var price = 0, pricePct = 0, volumeRatio = 0;
    if (snap.day && snap.day.c > 0) price = snap.day.c;
    else if (snap.lastTrade && snap.lastTrade.p > 0) price = snap.lastTrade.p;
    else if (snap.prevDay && snap.prevDay.c > 0) price = snap.prevDay.c;

    if (snap.prevDay && snap.prevDay.c > 0 && price > 0) {
      pricePct = ((price - snap.prevDay.c) / snap.prevDay.c) * 100;
    }
    if (snap.day && snap.day.v > 0 && snap.prevDay && snap.prevDay.v > 0) {
      volumeRatio = snap.day.v / snap.prevDay.v;
    }

    // News Volume: 0-25 pts
    var newsScore = 0;
    if (news.articleCount >= 10) newsScore = 25;
    else if (news.articleCount >= 5) newsScore = Math.round(12 + (news.articleCount - 5) * 2.6);
    else newsScore = Math.round(news.articleCount * 2.4);

    // Reddit Mentions: 0-20 pts
    var redditScore = 0;
    if (reddit.totalMentions >= 20) redditScore = 20;
    else if (reddit.totalMentions >= 10) redditScore = Math.round(12 + (reddit.totalMentions - 10) * 0.8);
    else redditScore = Math.round(reddit.totalMentions * 1.2);

    // Google Trends: 0-25 pts (Camillo's key signal — search interest spikes)
    var trendScore = 0;
    if (trends.spikeRatio >= 2.0) trendScore = 25;       // 2x+ spike = max
    else if (trends.spikeRatio >= 1.5) trendScore = Math.round(15 + (trends.spikeRatio - 1.5) * 20);
    else if (trends.spikeRatio >= 1.2) trendScore = Math.round(8 + (trends.spikeRatio - 1.2) * 23);
    else if (trends.trendScore >= 50) trendScore = 5;     // High baseline interest
    // Bonus for uptrend direction
    if (trends.trending === 'up' && trendScore > 0) trendScore = Math.min(25, trendScore + 3);

    // Price Confirmation: 0-15 pts
    var priceScore = 0;
    var absPct = Math.abs(pricePct);
    if (absPct >= 5) priceScore = 15;
    else if (absPct >= 2) priceScore = Math.round(absPct * 3);

    // Volume Confirmation: 0-15 pts
    var volScore = 0;
    if (volumeRatio >= 3) volScore = 15;
    else if (volumeRatio >= 1.5) volScore = Math.round((volumeRatio - 1) * 7.5);

    var totalScore = Math.min(100, newsScore + redditScore + trendScore + priceScore + volScore);

    candidates.push({
      ticker: ticker,
      socialScore: totalScore,
      newsCount: news.articleCount,
      redditMentions: reddit.totalMentions,
      googleTrend: trends.trendScore,
      googleTrendSpike: trends.spikeRatio,
      googleTrendDir: trends.trending,
      googleKeyword: trends.keyword,
      pricePct: pricePct,
      volumeRatio: volumeRatio,
      price: price,
      headlines: news.headlines || [],
      topPosts: (reddit.topPosts || []).map(function(p) { return p.title; }),
      components: { news: newsScore, reddit: redditScore, trends: trendScore, price: priceScore, volume: volScore }
    });
  }

  // Sort by social score descending
  candidates.sort(function(a, b) { return b.socialScore - a.socialScore; });

  // Step 7: Send top candidates to AI for thesis generation
  var topCandidates = candidates.slice(0, 10);
  statusFn('AI analyzing ' + topCandidates.length + ' top candidates...');

  var picks = topCandidates.map(function(c) {
    return {
      ticker: c.ticker,
      socialScore: c.socialScore,
      newsCount: c.newsCount,
      redditMentions: c.redditMentions,
      pricePct: c.pricePct,
      volumeRatio: c.volumeRatio,
      price: c.price,
      headlines: c.headlines,
      topPosts: c.topPosts,
      components: c.components
    };
  });

  try {
    var session = window._currentSession;
    if (session && session.access_token) {
      var aiResp = await fetch(EDGE_FN_BASE + '/ai-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : ''
        },
        body: JSON.stringify({
          task: 'social_arbitrage_analysis',
          candidates: topCandidates
        })
      });

      if (aiResp.ok) {
        var aiData = await aiResp.json();
        var aiText = '';
        if (aiData.content && aiData.content[0]) aiText = aiData.content[0].text || '';

        try {
          var aiResult = JSON.parse(aiText);
          if (aiResult.picks && Array.isArray(aiResult.picks)) {
            // Merge AI analysis into our picks
            aiResult.picks.forEach(function(aiPick) {
              var match = picks.find(function(p) { return p.ticker === aiPick.ticker; });
              if (match) {
                match.catalyst = aiPick.catalyst || '';
                match.thesis = aiPick.thesis || '';
                match.signalStrength = aiPick.signalStrength || 0;
                match.saturation = aiPick.saturation || 'unknown';
                match.saturationNote = aiPick.saturationNote || '';
                match.triggerPhrases = aiPick.triggerPhrases || [];
                match.actionable = aiPick.actionable || false;
                match.timeframe = aiPick.timeframe || '';
              }
            });
          }
        } catch(parseErr) {
          console.warn('[social-arb] AI parse error:', parseErr);
        }
      }
    }
  } catch(e) {
    console.warn('[social-arb] AI analysis failed:', e);
  }

  statusFn('Scan complete');
  return { picks: picks, ts: Date.now() };
}

// Render social arbitrage results
function renderSocialArbResults(data) {
  var picks = data.picks || [];
  if (picks.length === 0) return '';

  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';

  picks.forEach(function(pick) {
    var scoreColor = pick.socialScore >= 60 ? 'var(--green)' : pick.socialScore >= 35 ? 'var(--amber)' : 'var(--text-muted)';
    var scoreBg = pick.socialScore >= 60 ? 'var(--green-bg)' : pick.socialScore >= 35 ? 'rgba(245,158,11,0.1)' : 'var(--bg-secondary)';
    var satColor = pick.saturation === 'early' ? 'var(--green)' : pick.saturation === 'mid' ? 'var(--amber)' : 'var(--red)';
    var satLabel = pick.saturation === 'early' ? 'Early' : pick.saturation === 'mid' ? 'Mid' : pick.saturation === 'late' ? 'Late' : '?';

    html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:12px;border:1px solid var(--border);">';

    // Header: ticker + score
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:15px;font-weight:700;font-family:var(--font-mono);color:var(--text-primary);">' + pick.ticker + '</span>';
    if (pick.actionable) {
      html += '<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(34,197,94,0.15);color:var(--green);text-transform:uppercase;">Actionable</span>';
    }
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + scoreBg + ';color:' + scoreColor + ';">' + pick.socialScore + '/100</span>';
    html += '</div>';
    html += '</div>';

    // Price + volume line
    var pctColor = pick.pricePct >= 0 ? 'var(--green)' : 'var(--red)';
    html += '<div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text-muted);margin-bottom:8px;">';
    html += '<span>$' + (pick.price || 0).toFixed(2) + '</span>';
    html += '<span style="color:' + pctColor + ';">' + (pick.pricePct >= 0 ? '+' : '') + (pick.pricePct || 0).toFixed(1) + '%</span>';
    if (pick.volumeRatio > 0) html += '<span>Vol: ' + pick.volumeRatio.toFixed(1) + 'x</span>';
    html += '</div>';

    // Signal breakdown bar
    var comp = pick.components || {};
    html += '<div style="display:flex;gap:2px;height:4px;border-radius:2px;overflow:hidden;margin-bottom:8px;">';
    html += '<div style="width:' + (comp.news || 0) + '%;background:#a855f7;" title="News: ' + (comp.news || 0) + '/25"></div>';
    html += '<div style="width:' + (comp.reddit || 0) + '%;background:#f97316;" title="Reddit: ' + (comp.reddit || 0) + '/20"></div>';
    html += '<div style="width:' + (comp.trends || 0) + '%;background:#06b6d4;" title="Google Trends: ' + (comp.trends || 0) + '/25"></div>';
    html += '<div style="width:' + (comp.price || 0) + '%;background:var(--green);" title="Price: ' + (comp.price || 0) + '/15"></div>';
    html += '<div style="width:' + (comp.volume || 0) + '%;background:var(--blue);" title="Volume: ' + (comp.volume || 0) + '/15"></div>';
    html += '<div style="flex:1;background:var(--bg-tertiary);"></div>';
    html += '</div>';

    // Signal counts
    var trendArrow = pick.googleTrendDir === 'up' ? '\u2197' : pick.googleTrendDir === 'down' ? '\u2198' : '\u2192';
    var trendColor = pick.googleTrendDir === 'up' ? 'var(--green)' : pick.googleTrendDir === 'down' ? 'var(--red)' : 'var(--text-muted)';
    html += '<div style="display:flex;gap:8px;font-size:11px;color:var(--text-muted);margin-bottom:8px;flex-wrap:wrap;">';
    html += '<span title="News articles">\ud83d\udcf0 ' + (pick.newsCount || 0) + '</span>';
    html += '<span title="Reddit mentions">\ud83d\udcac ' + (pick.redditMentions || 0) + '</span>';
    if (pick.googleTrend > 0 || pick.googleTrendSpike > 0) {
      html += '<span title="Google Trends: ' + (pick.googleKeyword || pick.ticker) + ' — Interest: ' + (pick.googleTrend || 0) + ', Spike: ' + (pick.googleTrendSpike || 0).toFixed(1) + 'x" style="color:' + trendColor + ';">\ud83d\udd0d ' + trendArrow;
      if (pick.googleTrendSpike >= 1.3) html += ' ' + pick.googleTrendSpike.toFixed(1) + 'x';
      html += '</span>';
    }
    html += '<span title="Investor saturation" style="color:' + satColor + ';">Sat: ' + satLabel + '</span>';
    if (pick.timeframe) html += '<span title="Timeframe">\u23f1 ' + pick.timeframe + '</span>';
    html += '</div>';

    // AI thesis
    if (pick.catalyst) {
      html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;"><strong>Catalyst:</strong> ' + pick.catalyst + '</div>';
    }
    if (pick.thesis) {
      html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.5;">' + pick.thesis + '</div>';
    }

    // Trigger phrases as tags
    if (pick.triggerPhrases && pick.triggerPhrases.length > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
      pick.triggerPhrases.forEach(function(phrase) {
        html += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.1);color:#a855f7;font-weight:600;">' + phrase + '</span>';
      });
      html += '</div>';
    }

    html += '</div>'; // close card
  });

  html += '</div>';

  // Legend
  html += '<div style="display:flex;gap:12px;margin-top:10px;font-size:10px;color:var(--text-muted);align-items:center;flex-wrap:wrap;">';
  html += '<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:2px;background:#a855f7;display:inline-block;"></span>News</span>';
  html += '<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:2px;background:#f97316;display:inline-block;"></span>Reddit</span>';
  html += '<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:2px;background:#06b6d4;display:inline-block;"></span>Trends</span>';
  html += '<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--green);display:inline-block;"></span>Price</span>';
  html += '<span style="display:flex;align-items:center;gap:3px;"><span style="width:8px;height:8px;border-radius:2px;background:var(--blue);display:inline-block;"></span>Volume</span>';
  html += '<span style="margin-left:auto;">Sat = Investor Saturation (Early is best)</span>';
  html += '</div>';

  return html;
}
