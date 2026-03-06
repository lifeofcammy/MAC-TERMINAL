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

  // Now build setup cards (with additional filters + full data)
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

    function sma(arr, period) {
      if (arr.length < period) return null;
      var s = 0; for (var i = arr.length - period; i < arr.length; i++) s += arr[i]; return s / period;
    }

    var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    if (!sma20 || !sma10) return;

    var spread = Math.abs(sma10 - sma20) / curPrice * 100;
    if (spread > 5) return;

    var ext = ((curPrice - sma20) / sma20) * 100;

    var rvol = null;
    var avgVol20 = sma(volumes, 20);
    if (avgVol20 > 0 && curVol > 0) rvol = curVol / avgVol20;

    var recent5H = Math.max.apply(null, highs.slice(-5));
    var recent5L = Math.min.apply(null, lows.slice(-5));
    var range5 = ((recent5H - recent5L) / curPrice) * 100;

    var score = allScores[ticker] || 0;
    if (score < 30) return;

    // SMA Alignment (for thesis + card data)
    var aboveBoth = curPrice > sma10 && curPrice > sma20;

    // Component scores (for card display — Top Ideas style, 5 factors)
    var ptsCompress = spread <= 1 ? 30 : spread <= 2 ? 22 : spread <= 3 ? 15 : spread <= 5 ? 8 : 0;
    var ptsAlign = 0;
    if (aboveBoth) ptsAlign += 15;
    if (sma50 && curPrice > sma50) ptsAlign += 10;
    var ptsExt = ext <= 2 ? 25 : ext <= 4 ? 18 : ext <= 6 ? 10 : ext <= 8 ? 4 : -5;
    var ptsVol = (rvol && rvol >= 2) ? 10 : (rvol && rvol >= 1.5) ? 7 : (rvol && rvol >= 1) ? 4 : 0;
    var ptsMom = changePct > 1 ? 5 : changePct > 0 ? 2 : 0;

    // ── THESIS ──
    var thesis = '';
    if (spread <= 2) thesis += 'Tight compression (' + spread.toFixed(1) + '%). ';
    if (aboveBoth) thesis += 'Above 10/20 SMA. ';
    if (ext <= 2) thesis += 'Near base (' + ext.toFixed(1) + '%). ';
    else if (ext > 8) thesis += 'Extended (' + ext.toFixed(1) + '%). ';
    if (rvol && rvol >= 1.5) thesis += rvol.toFixed(1) + 'x volume. ';
    if (changePct > 1) thesis += 'Up ' + changePct.toFixed(1) + '% today. ';

    // ── TRADE LEVELS ──
    var stopPrice = sma20 * 0.98;
    var targetPrice = curPrice + (curPrice - stopPrice) * 2;
    var riskPct = curPrice > 0 ? ((curPrice - stopPrice) / curPrice) * 100 : 0;

    setups.push({
      ticker: ticker,
      price: curPrice,
      prevClose: prevClose,
      changePct: Math.round(changePct * 100) / 100,
      score: score,
      thesis: thesis.trim(),
      spread: Math.round(spread * 10) / 10,
      ext: Math.round(ext * 10) / 10,
      rvol: rvol ? Math.round(rvol * 10) / 10 : null,
      range5: Math.round(range5 * 10) / 10,
      aboveBoth: aboveBoth,
      aboveSma50: !!(sma50 && curPrice > sma50),
      entryPrice: curPrice,
      stopPrice: stopPrice,
      targetPrice: targetPrice,
      riskPct: Math.round(riskPct * 10) / 10,
      components: {
        compression: ptsCompress,
        alignment: ptsAlign,
        extension: ptsExt,
        volume: ptsVol,
        momentum: ptsMom
      }
    });
  });

  setups.sort(function(a, b) { return b.score - a.score; });

  var topSetups = setups.slice(0, 20);

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
async function calcORBForTicker(ticker, today) {
  try {
    var data = await polyGetRetry('/v2/aggs/ticker/' + ticker + '/range/1/minute/' + today + '/' + today + '?adjusted=true&sort=asc&limit=500');
    var bars = data.results || [];
    if (bars.length === 0) return null;

    // Find bars in opening range (9:30-9:45 ET = first 15 minutes)
    // Polygon timestamps are in UTC ms
    var orBars = [];
    var postORBars = [];

    bars.forEach(function(b) {
      var d = new Date(b.t);
      var etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
      var parts = etStr.split(':');
      var h = parseInt(parts[0]), m = parseInt(parts[1]);
      var mins = h * 60 + m;

      if (mins >= 570 && mins < 585) { // 9:30-9:44
        orBars.push(b);
      } else if (mins >= 585) { // 9:45+
        postORBars.push(b);
      }
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

    // Current price = last bar close
    var lastBar = bars[bars.length - 1];
    var curPrice = lastBar.c;

    // Post-OR volume
    var postORVol = 0;
    postORBars.forEach(function(b) { postORVol += (b.v || 0); });

    // Breakout detection
    var breakoutType = 'none';
    var breakoutStrength = 0;

    if (curPrice > orHigh) {
      breakoutType = 'long';
      breakoutStrength = ((curPrice - orHigh) / orRange) * 100; // % of OR range above high
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
      barCount: bars.length
    };
  } catch(e) {
    return null;
  }
}

// Score a day trade setup (max 100 pts)
function scoreDayTrade(gapper, orb) {
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

  // 4. OR Tightness (0-15) — tight OR = cleaner breakout
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
        return calcORBForTicker(g.ticker, today).then(function(orb) {
          return { gapper: g, orb: orb };
        });
      });
      var orbResults = await Promise.all(orbPromises);

      orbResults.forEach(function(r) {
        if (!r.orb) return;
        var scored = scoreDayTrade(r.gapper, r.orb);
        if (scored.score < 30) return;

        // Direction based on breakout, fallback to gap direction
        var direction = r.orb.breakoutType !== 'none' ? (r.orb.breakoutType === 'long' ? 'LONG' : 'SHORT') : r.gapper.direction;

        // Trade levels
        var entry = direction === 'LONG' ? r.orb.orHigh : r.orb.orLow;
        var stop = direction === 'LONG' ? r.orb.orLow : r.orb.orHigh;
        var risk = Math.abs(entry - stop);
        var target = direction === 'LONG' ? entry + (risk * 1.5) : entry - (risk * 1.5);

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

  statusFn('Found ' + setups.length + ' day trade setups.');
  return resultData;
}

// Render a day trade card
function renderDayTradeCard(s, idx) {
  var detailId = 'dt-detail-' + idx;
  var sc = s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--blue)' : s.score >= 40 ? 'var(--amber)' : 'var(--text-muted)';
  var sbg = s.score >= 80 ? 'rgba(16,185,129,0.06)' : s.score >= 60 ? 'rgba(37,99,235,0.04)' : 'rgba(245,158,11,0.04)';
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
  html += '<div onclick="event.stopPropagation();var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid ' + sc + ';font-size:12px;font-weight:900;color:' + sc + ';font-family:var(--font-mono);cursor:pointer;" title="Click for score breakdown">' + s.score + '</div>';
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

  // Progress bar (shared, hidden during idle)
  html += '<div id="scanner-progress-wrap" style="display:none;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
  html += '<span id="scanner-status" style="font-size:14px;color:var(--text-muted);">Starting scan...</span>';
  html += '<span id="scanner-pct" style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">0%</span>';
  html += '</div>';
  html += '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">';
  html += '<div id="scanner-progress-bar" style="width:0%;height:100%;background:var(--blue);border-radius:2px;transition:width 0.3s ease;"></div>';
  html += '</div></div>';

  // ═══ TWO-COLUMN GRID ═══
  html += '<div class="scanner-dual-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">';

  // ── LEFT COLUMN: Day Trade Scanner ──
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:16px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Day Trade</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.1);color:var(--red);text-transform:uppercase;letter-spacing:.04em;">ORB</span>';
  html += '</div>';
  html += '<button onclick="runDayTradeScanUI()" class="refresh-btn" style="padding:5px 12px;font-size:12px;">Scan</button>';
  html += '</div>';
  html += '<div id="dt-phase-label" style="font-size:11px;margin-top:4px;"></div>';
  html += '<div id="dt-scanner-status" style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + (dtResults ? 'Cached' : 'Click Scan or wait for auto-scan') + '</div>';
  html += '</div>';
  // Info banner
  html += '<div onclick="toggleDTInfo()" style="padding:8px 16px;background:rgba(239,68,68,0.05);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">';
  html += '<span style="font-size:12px;color:var(--red);">&#9432;</span>';
  html += '<span style="font-size:11px;color:var(--text-muted);font-weight:600;">How does this work?</span>';
  html += '<span id="dt-info-arrow" style="margin-left:auto;font-size:10px;color:var(--text-muted);">\u25b6</span>';
  html += '</div>';
  html += '<div id="dt-info-body" style="display:none;padding:12px 16px;background:rgba(239,68,68,0.03);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.6;">';
  html += '<div style="font-weight:700;margin-bottom:6px;color:var(--text-primary);">Opening Range Breakout (ORB)</div>';
  html += '<div style="margin-bottom:8px;"><strong>What it shows:</strong> Stocks that gapped 2%+ from yesterday\'s close with unusual volume. After 9:45 AM, it tracks whether they break above or below their first 15-minute trading range.</div>';
  html += '<div style="margin-bottom:8px;"><strong>Why it works:</strong> Big gaps with high volume signal institutional interest or a major catalyst. The opening range (9:30\u20139:45) establishes the battleground \u2014 a clean break above or below it often leads to a sustained move in that direction.</div>';
  html += '<div><strong>How to use it:</strong> Look for setups with high scores (60+). Entry is at the OR break level, stop is the opposite side of the range, target is 1.5\u00d7 the range. Higher RVol (2x+) and a tight OR range (&lt;2%) are the strongest signals.</div>';
  html += '</div>';
  html += '<div id="dt-scan-results" style="padding:12px;">';
  if (dtResults && dtResults.setups && dtResults.setups.length > 0) {
    html += renderDayTradeResults(dtResults);
  } else {
    html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">15-min ORB strategy. Finds gappers with volume + news catalysts, then tracks opening range breakouts.</div>';
  }
  html += '</div>';
  html += '</div>';

  // ── RIGHT COLUMN: Swing Scanner ──
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:16px;font-weight:700;font-family:var(--font-display);color:var(--text-primary);">Swing Setups</span>';
  html += '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(37,99,235,0.1);color:var(--blue);text-transform:uppercase;letter-spacing:.04em;">Compression</span>';
  html += '</div>';
  html += '<button onclick="runFullScanUI()" id="scan-btn" class="refresh-btn" style="padding:5px 12px;font-size:12px;">Scan</button>';
  html += '</div>';
  var scanMode = isScannerMarketHours() && isMomentumCacheFresh() ? 'live' : 'eod';
  html += '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">';
  if (scanMode === 'live') {
    html += '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;"></span>Live</span>';
  }
  html += '<span style="font-size:11px;color:var(--text-muted);">' + dataFreshness + '</span>';
  html += '</div>';
  html += '</div>';

  // Info banner
  html += '<div onclick="toggleSwingInfo()" style="padding:8px 16px;background:rgba(37,99,235,0.05);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;">';
  html += '<span style="font-size:12px;color:var(--blue);">&#9432;</span>';
  html += '<span style="font-size:11px;color:var(--text-muted);font-weight:600;">How does this work?</span>';
  html += '<span id="swing-info-arrow" style="margin-left:auto;font-size:10px;color:var(--text-muted);">\u25b6</span>';
  html += '</div>';
  html += '<div id="swing-info-body" style="display:none;padding:12px 16px;background:rgba(37,99,235,0.03);border-bottom:1px solid var(--border);font-size:12px;color:var(--text-secondary);line-height:1.6;">';
  html += '<div style="font-weight:700;margin-bottom:6px;color:var(--text-primary);">SMA Compression Scanner</div>';
  html += '<div style="margin-bottom:8px;"><strong>What it shows:</strong> Stocks where the 10-day and 20-day moving averages are squeezing together (compressing). It scans the top 100 US stocks by dollar volume and scores them on compression, trend alignment, extension, relative volume, and momentum.</div>';
  html += '<div style="margin-bottom:8px;"><strong>Why it works:</strong> When moving averages compress, it means the stock is consolidating after a move. This builds energy \u2014 like a coiled spring. When the stock breaks out of compression with volume, it often leads to a strong directional move. The best setups are above all key SMAs (aligned uptrend) with low extension (not overextended).</div>';
  html += '<div><strong>How to use it:</strong> Look for scores of 50+ with tight SMA spread (&lt;2%). Stocks above their 10, 20, and 50 SMA with rising relative volume are the highest-probability swing trades. These are multi-day holds (2\u201310 days), not day trades.</div>';
  html += '</div>';
  // Screening funnel
  html += '<div id="scanner-status-idle" style="padding:6px 16px;min-height:16px;">';
  if (cache) {
    var setupCount = (scanResults && scanResults.setups) ? scanResults.setups.length : 0;
    html += '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">';
    if (cache.totalScanned) {
      html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> scanned';
      html += '<span style="font-size:10px;">\u2192</span>';
    }
    html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
    if (setupCount > 0) {
      html += '<span style="font-size:10px;">\u2192</span>';
      html += '<span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);">' + setupCount + '</span> <span style="font-weight:600;color:var(--blue);">setups</span>';
    }
    html += '</div>';
  } else {
    html += '<div style="font-size:11px;color:var(--text-muted);">Click Scan to find setups.</div>';
  }
  html += '</div>';

  // Swing results (top 5)
  html += '<div id="scan-results" style="padding:0 12px 12px;">';
  if (scanResults && scanResults.setups && scanResults.setups.length > 0) {
    html += renderSetupResults(scanResults, 5);
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // close scanner-dual-grid

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
}


// ==================== RENDER: SETUP RESULTS ====================

function renderSetupResults(data, limit) {
  var setups = data.setups || [];
  var html = '';

  if (setups.length === 0) {
    html += '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">No compression setups found right now. Check back later.</div>';
    return html;
  }

  var displaySetups = limit ? setups.slice(0, limit) : setups;
  var hasMore = limit && setups.length > limit;

  html += '<div style="display:flex;flex-direction:column;gap:8px;">';
  displaySetups.forEach(function(s, idx) {
    html += renderSetupCard(s, idx, data);
  });
  html += '</div>';

  if (hasMore) {
    html += '<div id="swing-view-all-wrap" style="text-align:center;margin-top:8px;">';
    html += '<button onclick="expandSwingResults()" class="refresh-btn" style="padding:6px 16px;font-size:12px;">View All ' + setups.length + ' Setups</button>';
    html += '</div>';
  }

  return html;
}

function expandSwingResults() {
  var scanResults = null;
  try { var sr = localStorage.getItem(SCANNER_RESULTS_KEY); if (sr) scanResults = JSON.parse(sr); } catch(e) {}
  if (!scanResults) return;
  var resultsEl = document.getElementById('scan-results');
  if (resultsEl) resultsEl.innerHTML = renderSetupResults(scanResults);
}


// ==================== RENDER: INDIVIDUAL SETUP CARD ====================
// Matches Top Ideas card style exactly — colored left border, tinted bg, compact layout

function renderSetupCard(s, idx, scanData) {
  var detailId = 'score-detail-' + idx;
  var sc = s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--blue)' : s.score >= 40 ? 'var(--amber)' : 'var(--text-muted)';
  var sbg = s.score >= 80 ? 'rgba(16,185,129,0.06)' : s.score >= 60 ? 'rgba(37,99,235,0.04)' : 'rgba(245,158,11,0.04)';

  var html = '';
  html += '<div style="background:' + sbg + ';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:12px;padding:14px 16px;border-left:3px solid ' + sc + ';">';

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
  // Score circle — clickable to expand details
  html += '<div onclick="event.stopPropagation();var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid ' + sc + ';font-size:12px;font-weight:900;color:' + sc + ';font-family:var(--font-mono);cursor:pointer;" title="Click for score breakdown">' + s.score + '</div>';
  html += '</div>';

  // Thesis
  if (s.thesis) {
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">' + s.thesis + '</div>';
  }

  // Info row: Industry, ATR, Market Cap
  var _ind = (scanData && scanData.allIndust && scanData.allIndust[s.ticker]) || '';
  var _atr = (scanData && scanData.allAtr && scanData.allAtr[s.ticker]) || null;
  var _mc = (scanData && scanData.allMcap && scanData.allMcap[s.ticker]) || null;
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;padding:4px 6px;background:var(--bg-secondary);border-radius:3px;">';
  if (_ind) html += '<span style="color:var(--text-muted);">' + _ind + '</span>';
  if (_atr) html += '<span style="color:var(--text-muted);">ATR <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">$' + _atr.toFixed(2) + '</span></span>';
  if (_mc) html += '<span style="color:var(--text-muted);">Mkt Cap <span style="font-family:var(--font-mono);font-weight:700;color:var(--text-secondary);padding:1px 5px;border:1px solid var(--border);border-radius:3px;">' + _fmtMcap(_mc) + '</span></span>';
  html += '</div>';

  // ── Expandable detail (hidden, shown on score click) ──
  var comps = s.components || {};
  html += '<div id="' + detailId + '" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">';

  // Component bars
  html += '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Score Breakdown</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:12px;margin-bottom:8px;">';
  html += renderComponentBar('Compression', comps.compression || 0, 30, 'var(--blue)');
  html += renderComponentBar('Alignment', comps.alignment || 0, 25, 'var(--blue)');
  var extLabel = (comps.extension || 0) >= 0 ? 'Near Base' : 'Extension';
  html += renderComponentBar(extLabel, Math.max(0, comps.extension || 0), 25, 'var(--blue)');
  html += renderComponentBar('Volume', comps.volume || 0, 10, 'var(--blue)');
  html += renderComponentBar('Momentum', comps.momentum || 0, 5, 'var(--blue)');
  html += '</div>';

  // Quick stats
  html += '<div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);">';
  html += '<span>Spread ' + s.spread + '%</span><span>\u00b7</span>';
  html += '<span>Ext ' + (s.ext >= 0 ? '+' : '') + s.ext + '%</span><span>\u00b7</span>';
  html += '<span>RVol ' + (s.rvol ? s.rvol + 'x' : '\u2014') + '</span><span>\u00b7</span>';
  html += '<span>5d ' + s.range5 + '%</span><span>\u00b7</span>';
  html += '<span>Risk ' + s.riskPct + '%</span>';
  html += '</div>';

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
  var btn = document.getElementById('scan-btn');
  var statusEl = document.getElementById('scanner-status');
  var pctEl = document.getElementById('scanner-pct');
  var barEl = document.getElementById('scanner-progress-bar');
  var progressWrap = document.getElementById('scanner-progress-wrap');
  var idleStatus = document.getElementById('scanner-status-idle');
  var resultsEl = document.getElementById('scan-results');

  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
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
    if (resultsEl) resultsEl.innerHTML = renderSetupResults(results, 5);

    setTimeout(function() {
      if (progressWrap) progressWrap.style.display = 'none';
      if (idleStatus) {
        var setupCount = (results.setups || []).length;
        var funnelHtml = '<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">';
        if (cache.totalScanned) {
          funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> scanned';
          funnelHtml += '<span style="font-size:10px;">\u2192</span>';
        }
        funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
        funnelHtml += '<span style="font-size:10px;">\u2192</span>';
        funnelHtml += '<span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);">' + setupCount + '</span> <span style="font-weight:600;color:var(--blue);">setups</span>';
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

  if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
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


// ==================== TOGGLES ====================

function toggleDTInfo() {
  var body = document.getElementById('dt-info-body'), arrow = document.getElementById('dt-info-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '\u25bc' : '\u25b6';
}

function toggleSwingInfo() {
  var body = document.getElementById('swing-info-body'), arrow = document.getElementById('swing-info-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '\u25bc' : '\u25b6';
}

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
