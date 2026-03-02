// ==================== scanner.js ====================
// Two-category setup scanner:
//   Category 1: EARLY BREAKOUTS — stocks compressing in a base, haven't broken out yet
//   Category 2: PULLBACK ENTRIES — stocks that ran, pulled back to support in an uptrend
//
// Layer 1: Universe builder — filters all US stocks to ~top 150 candidates
// Layer 2: Setup analysis — scores and categorizes into Early Breakouts vs Pullbacks
//
// Key change from old scanner: compression-first scoring, extension penalty,
// ETF filtering, and two distinct setup types.

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_momentum_top100';
var SCANNER_RESULTS_KEY = 'mac_scan_results';

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
  if (!cache || !cache.date) return false;
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
    if (s.c < 5) return false;
    if (s.v < 500000) return false;
    if (s.T.length > 5) return false;
    if (/[.-]/.test(s.T)) return false;
    if (etfSet[s.T]) return false;           // Exclude known ETFs
    return true;
  });

  statusFn('Filtered to ' + filtered.length + ' stocks. Scoring...');

  // Sort by dollar volume (highest liquidity first)
  filtered.sort(function(a, b) { return (b.v * b.c) - (a.v * a.c); });

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
    date: localDateStr(),
    ts: Date.now(),
    count: topN.length,
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

  // Must be above 20 SMA to be in universe (uptrend filter)
  if (!sma20 || currentPrice < sma20 * 0.97) return { total: 0 };

  // ── 1. COMPRESSION / TIGHTNESS (0-30 pts) — PRIMARY factor ──
  var recent5H = Math.max.apply(null, highs.slice(-5));
  var recent5L = Math.min.apply(null, lows.slice(-5));
  var range5 = ((recent5H - recent5L) / currentPrice) * 100;

  var recent10H = Math.max.apply(null, highs.slice(-10));
  var recent10L = Math.min.apply(null, lows.slice(-10));
  var range10 = ((recent10H - recent10L) / currentPrice) * 100;

  var ptsTight = 0;
  if (range5 <= 3) ptsTight = 30;
  else if (range5 <= 5) ptsTight = 25;
  else if (range5 <= 7) ptsTight = 20;
  else if (range5 <= 10) ptsTight = 14;
  else if (range10 <= 10) ptsTight = 10;
  else if (range10 <= 15) ptsTight = 5;
  else ptsTight = 0;

  // ── 2. EXTENSION PENALTY (0 to -20 pts) — how far above 20 SMA ──
  var extFromSma20 = sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0;
  var ptsExt = 0;
  if (extFromSma20 <= 2) ptsExt = 10;       // Sitting right on base — ideal
  else if (extFromSma20 <= 4) ptsExt = 5;
  else if (extFromSma20 <= 6) ptsExt = 0;
  else if (extFromSma20 <= 10) ptsExt = -5;
  else if (extFromSma20 <= 15) ptsExt = -10;
  else ptsExt = -20;                         // Very extended — bad

  // ── 3. VOLUME DRY-UP IN BASE (0-20 pts) ──
  var avgVol20 = sma(volumes, 20);
  var avgVol5 = sma(volumes.slice(-5), 5);
  var volRatio = avgVol20 > 0 && avgVol5 ? avgVol5 / avgVol20 : 1;

  var ptsVolDry = 0;
  if (volRatio <= 0.4) ptsVolDry = 20;
  else if (volRatio <= 0.55) ptsVolDry = 16;
  else if (volRatio <= 0.7) ptsVolDry = 12;
  else if (volRatio <= 0.85) ptsVolDry = 6;
  else ptsVolDry = 0;

  // ── 4. BREAKOUT PROXIMITY (0-20 pts) — how close to top of range ──
  var distToBreakout = recent10H > 0 ? ((recent10H - currentPrice) / currentPrice) * 100 : 99;
  var ptsBreakout = 0;
  if (distToBreakout <= 0.5) ptsBreakout = 20;
  else if (distToBreakout <= 1) ptsBreakout = 17;
  else if (distToBreakout <= 2) ptsBreakout = 13;
  else if (distToBreakout <= 3) ptsBreakout = 8;
  else if (distToBreakout <= 5) ptsBreakout = 4;
  else ptsBreakout = 0;

  // ── 5. TREND QUALITY (0-15 pts) — SMA alignment ──
  var ptsTrend = 0;
  var aboveSMAs = 0;
  if (sma10 && currentPrice > sma10) { aboveSMAs++; ptsTrend += 3; }
  if (currentPrice > sma20) { aboveSMAs++; ptsTrend += 3; }
  if (sma50 && currentPrice > sma50) { aboveSMAs++; ptsTrend += 3; }
  if (sma10 && sma10 > sma20) ptsTrend += 3;
  if (sma50 && sma20 > sma50) ptsTrend += 3;

  // ── 6. PULLBACK DETECTION (bonus for stocks pulling back to support) ──
  // If stock was higher recently but has come back to 10/20 SMA, that's interesting
  var pullbackDepth = 0;
  if (len >= 10) {
    var recentHigh = Math.max.apply(null, highs.slice(-15));
    pullbackDepth = recentHigh > 0 ? ((recentHigh - currentPrice) / recentHigh) * 100 : 0;
  }
  var ptsPullback = 0;
  // Sweet spot: pulled back 3-10% from recent high, now at/near 10 or 20 SMA
  if (pullbackDepth >= 3 && pullbackDepth <= 10) {
    var nearSma10 = sma10 && Math.abs(currentPrice - sma10) / currentPrice * 100 <= 1.5;
    var nearSma20 = Math.abs(currentPrice - sma20) / currentPrice * 100 <= 1.5;
    if (nearSma10 || nearSma20) ptsPullback = 15;
    else if (pullbackDepth <= 7) ptsPullback = 8;
    else ptsPullback = 4;
  }

  // ── BUYOUT FILTER (same as before) ──
  if (range5 < 0.8) return { total: 0 };  // Flatlined = deal stock
  if (len >= 15) {
    for (var gi = Math.max(0, len - 30); gi < len - 5; gi++) {
      var prevC = gi > 0 ? closes[gi - 1] : closes[gi];
      var gapPct = prevC > 0 ? ((closes[gi] - prevC) / prevC) * 100 : 0;
      if (gapPct > 15) {
        var postGapHighs = highs.slice(gi + 2);
        var postGapLows = lows.slice(gi + 2);
        if (postGapHighs.length >= 3) {
          var postH = Math.max.apply(null, postGapHighs);
          var postL = Math.min.apply(null, postGapLows);
          var postRange = ((postH - postL) / currentPrice) * 100;
          if (postRange < 3.5) return { total: 0 };
        }
      }
    }
  }

  var total = Math.round(Math.max(0, ptsTight + ptsExt + ptsVolDry + ptsBreakout + ptsTrend + ptsPullback));

  return {
    total: total,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    extFromSma20: Math.round(extFromSma20 * 10) / 10,
    aboveSMAs: aboveSMAs + '/3',
    volDryUp: Math.round(volRatio * 100),
    distToBreakout: Math.round(distToBreakout * 10) / 10,
    pullbackDepth: Math.round(pullbackDepth * 10) / 10
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
  var tickerMap = {};
  cache.tickers.forEach(function(t) { tickerMap[t.ticker] = t; });

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

  var marketOpen = isMarketOpenNow();
  var etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var etTimeStr = etNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  var etHours = etNow.getHours() + etNow.getMinutes() / 60;
  var mktMinutesElapsed = marketOpen ? Math.max((etHours - 9.5) * 60, 1) : 1;
  var expectedVolFraction = mktMinutesElapsed / 390;

  var earlyBreakouts = [];
  var pullbackEntries = [];

  statusFn('Categorizing setups...');

  tickers.forEach(function(ticker) {
    var snap = allSnapshots[ticker];
    var bars = allBars[ticker];
    if (!snap || !snap.prevDay || !snap.prevDay.c) return;
    if (!bars || bars.length < 20) return;

    var prevClose = snap.prevDay.c;
    var curPrice = 0, curVol = 0, curHigh = 0, curLow = 0, curVwap = 0;
    if (snap.day && snap.day.c && snap.day.c > 0) {
      curPrice = snap.day.c;
      curHigh = snap.day.h || curPrice;
      curLow = snap.day.l || curPrice;
      curVol = snap.day.v || 0;
      curVwap = snap.day.vw || 0;
    } else {
      curPrice = snap.lastTrade ? snap.lastTrade.p : prevClose;
      curHigh = curPrice; curLow = curPrice;
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

    var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    if (!sma20) return;

    // ── COMPRESSION METRICS ──
    var recent5H = Math.max.apply(null, highs.slice(-5));
    var recent5L = Math.min.apply(null, lows.slice(-5));
    var range5 = ((recent5H - recent5L) / prevClose) * 100;

    var recent10H = Math.max.apply(null, highs.slice(-10));
    var recent10L = Math.min.apply(null, lows.slice(-10));
    var range10 = ((recent10H - recent10L) / prevClose) * 100;

    // Extension from 20 SMA
    var extFromSma20 = ((curPrice - sma20) / sma20) * 100;

    // Volume
    var avgVol20 = sma(volumes, 20) || 0;
    var avgVol5 = sma(volumes.slice(-5), 5) || 0;
    var baseVolRatio = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;

    // Relative volume today (pace-adjusted)
    var relativeVol = 0;
    if (marketOpen && avgVol20 > 0 && curVol > 0) {
      relativeVol = (curVol / avgVol20) / expectedVolFraction;
    }

    // Breakout level and proximity
    var breakoutLevel = recent10H;
    var distToBreakout = breakoutLevel > 0 ? ((breakoutLevel - curPrice) / curPrice) * 100 : 0;
    var breakingOut = curPrice > breakoutLevel;

    // Pullback metrics
    var recentHigh15 = len >= 15 ? Math.max.apply(null, highs.slice(-15)) : Math.max.apply(null, highs);
    var pullbackDepth = recentHigh15 > 0 ? ((recentHigh15 - curPrice) / recentHigh15) * 100 : 0;
    var nearSma10 = sma10 && Math.abs(curPrice - sma10) / curPrice * 100 <= 2;
    var nearSma20 = Math.abs(curPrice - sma20) / curPrice * 100 <= 2;

    // SMA alignment
    var aboveSMAs = 0;
    if (sma10 && curPrice > sma10) aboveSMAs++;
    if (curPrice > sma20) aboveSMAs++;
    if (sma50 && curPrice > sma50) aboveSMAs++;
    var smaStacked = sma10 && sma50 && sma10 > sma20 && sma20 > sma50;

    // Buyout filter
    if (range5 < 0.8) return;
    if (changePct < -8) return;  // Crashing, not a setup

    // ════════════════════════════════════════════
    // CATEGORY 1: EARLY BREAKOUT
    // Tight base, hasn't broken out yet, volume drying up
    // ════════════════════════════════════════════
    var ebScore = 0;
    var ebSignals = [];

    // Must have some compression
    if (range5 <= 10 || range10 <= 12) {
      // Tightness (0-35 pts)
      var ebTight = 0;
      if (range5 <= 3) { ebTight = 35; ebSignals.push('Very tight 5d range (' + range5.toFixed(1) + '%)'); }
      else if (range5 <= 5) { ebTight = 30; ebSignals.push('Tight 5d range (' + range5.toFixed(1) + '%)'); }
      else if (range5 <= 7) { ebTight = 22; ebSignals.push('Compressing (' + range5.toFixed(1) + '% 5d)'); }
      else if (range5 <= 10) { ebTight = 14; ebSignals.push('Building base (' + range5.toFixed(1) + '% 5d)'); }
      else if (range10 <= 12) { ebTight = 8; }

      // Volume dry-up (0-20 pts)
      var ebVolDry = 0;
      if (baseVolRatio <= 0.4) { ebVolDry = 20; ebSignals.push('Vol dried up (' + Math.round(baseVolRatio * 100) + '% of avg)'); }
      else if (baseVolRatio <= 0.6) { ebVolDry = 15; ebSignals.push('Vol declining (' + Math.round(baseVolRatio * 100) + '% of avg)'); }
      else if (baseVolRatio <= 0.75) { ebVolDry = 8; }

      // Breakout proximity (0-25 pts) — closer to resistance = more imminent
      var ebBreakout = 0;
      if (breakingOut) {
        var breakPct = ((curPrice - breakoutLevel) / breakoutLevel) * 100;
        if (breakPct <= 2) { ebBreakout = 25; ebSignals.push('Breaking out above $' + breakoutLevel.toFixed(2)); }
        else if (breakPct <= 4) { ebBreakout = 15; ebSignals.push('Above range by ' + breakPct.toFixed(1) + '%'); }
        else { ebBreakout = 5; }  // Extended past breakout
      } else if (distToBreakout <= 1) { ebBreakout = 22; ebSignals.push('At resistance ($' + breakoutLevel.toFixed(2) + ')'); }
      else if (distToBreakout <= 2) { ebBreakout = 18; ebSignals.push('Near breakout ($' + breakoutLevel.toFixed(2) + ', ' + distToBreakout.toFixed(1) + '% away)'); }
      else if (distToBreakout <= 4) { ebBreakout = 10; }

      // Extension penalty (-20 to +5 pts)
      var ebExt = 0;
      if (extFromSma20 <= 2) ebExt = 5;
      else if (extFromSma20 <= 5) ebExt = 0;
      else if (extFromSma20 <= 8) ebExt = -5;
      else if (extFromSma20 <= 12) ebExt = -10;
      else ebExt = -20;

      // Live volume surge today (0-15 pts bonus)
      var ebVolSurge = 0;
      if (marketOpen && relativeVol >= 2.5) { ebVolSurge = 15; ebSignals.push('Volume surge ' + relativeVol.toFixed(1) + 'x pace'); }
      else if (marketOpen && relativeVol >= 1.5) { ebVolSurge = 10; ebSignals.push('Above-avg volume ' + relativeVol.toFixed(1) + 'x'); }
      else if (marketOpen && relativeVol >= 1.2) { ebVolSurge = 4; }

      ebScore = Math.round(Math.max(0, ebTight + ebVolDry + ebBreakout + ebExt + ebVolSurge));

      // Must score at least 35 and have real compression
      if (ebScore >= 35 && ebTight >= 14) {
        var entryPrice = breakingOut ? curPrice : breakoutLevel;
        var stopPrice = Math.max(recent5L, sma20 ? sma20 * 0.98 : recent10L);
        var riskPct = entryPrice > 0 ? ((entryPrice - stopPrice) / entryPrice) * 100 : 0;
        var targetPrice = entryPrice + (entryPrice - stopPrice) * 2;

        earlyBreakouts.push({
          ticker: ticker,
          category: 'EARLY BREAKOUT',
          price: curPrice,
          prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100,
          score: ebScore,
          signals: ebSignals,
          description: ebSignals.join(' · '),
          range5: Math.round(range5 * 10) / 10,
          range10: Math.round(range10 * 10) / 10,
          extFromSma20: Math.round(extFromSma20 * 10) / 10,
          breakoutLevel: breakoutLevel,
          breakingOut: breakingOut,
          distToBreakout: Math.round(distToBreakout * 10) / 10,
          baseVolRatio: Math.round(baseVolRatio * 100),
          relativeVol: Math.round(relativeVol * 10) / 10,
          volume: curVol,
          avgVol20: avgVol20,
          vwap: curVwap,
          entryPrice: entryPrice,
          stopPrice: stopPrice,
          targetPrice: targetPrice,
          riskPct: Math.round(riskPct * 10) / 10,
          components: {
            tightness: ebTight,
            volumeDryUp: ebVolDry,
            breakoutProximity: ebBreakout,
            extensionAdj: ebExt,
            volumeSurge: ebVolSurge
          }
        });
      }
    }

    // ════════════════════════════════════════════
    // CATEGORY 2: PULLBACK ENTRY
    // Strong stock that pulled back to support level
    // ════════════════════════════════════════════
    var pbScore = 0;
    var pbSignals = [];

    // Requirements: stock was higher recently, now pulled back 3-15%, and near a support level
    if (pullbackDepth >= 3 && pullbackDepth <= 18 && sma50 && curPrice > sma50) {
      // Pullback quality (0-30 pts) — sweet spot is 4-10% pullback
      var pbDepthPts = 0;
      if (pullbackDepth >= 4 && pullbackDepth <= 8) { pbDepthPts = 30; pbSignals.push('Healthy pullback (' + pullbackDepth.toFixed(1) + '% from high)'); }
      else if (pullbackDepth >= 3 && pullbackDepth <= 12) { pbDepthPts = 22; pbSignals.push('Pulling back (' + pullbackDepth.toFixed(1) + '% from high)'); }
      else { pbDepthPts = 10; pbSignals.push('Deep pullback (' + pullbackDepth.toFixed(1) + '%)'); }

      // Support level (0-25 pts) — at 10 SMA, 20 SMA, or VWAP
      var pbSupport = 0;
      if (nearSma10 && nearSma20) { pbSupport = 25; pbSignals.push('Holding 10 & 20 SMA'); }
      else if (nearSma20) { pbSupport = 22; pbSignals.push('Holding 20 SMA ($' + sma20.toFixed(2) + ')'); }
      else if (nearSma10) { pbSupport = 18; pbSignals.push('At 10 SMA ($' + sma10.toFixed(2) + ')'); }
      else if (curVwap > 0 && Math.abs(curPrice - curVwap) / curPrice * 100 <= 1) { pbSupport = 15; pbSignals.push('At VWAP ($' + curVwap.toFixed(2) + ')'); }
      else if (sma50 && Math.abs(curPrice - sma50) / curPrice * 100 <= 2) { pbSupport = 12; pbSignals.push('At 50 SMA ($' + sma50.toFixed(2) + ')'); }
      else { pbSupport = 0; }

      // Volume declining on pullback (0-20 pts) — healthy pullback has low volume
      var pbVolDry = 0;
      if (baseVolRatio <= 0.5) { pbVolDry = 20; pbSignals.push('Vol fading on pullback (' + Math.round(baseVolRatio * 100) + '% avg)'); }
      else if (baseVolRatio <= 0.7) { pbVolDry = 14; pbSignals.push('Light volume pullback'); }
      else if (baseVolRatio <= 0.85) { pbVolDry = 6; }

      // Trend intact (0-15 pts)
      var pbTrend = 0;
      if (smaStacked) { pbTrend = 15; pbSignals.push('SMAs stacked bullish'); }
      else if (aboveSMAs >= 2) { pbTrend = 10; }
      else if (curPrice > sma50) { pbTrend = 5; }

      // Bounce signal today (0-10 pts bonus)
      var pbBounce = 0;
      if (changePct > 1) { pbBounce = 10; pbSignals.push('Bouncing today +' + changePct.toFixed(1) + '%'); }
      else if (changePct > 0) { pbBounce = 5; }

      pbScore = Math.round(Math.max(0, pbDepthPts + pbSupport + pbVolDry + pbTrend + pbBounce));

      // Must score at least 40 and be near real support
      if (pbScore >= 40 && pbSupport >= 12) {
        var pbStop = sma50 ? sma50 * 0.98 : (sma20 * 0.95);
        var pbRisk = curPrice > 0 ? ((curPrice - pbStop) / curPrice) * 100 : 0;
        var pbTarget = curPrice + (curPrice - pbStop) * 2;

        pullbackEntries.push({
          ticker: ticker,
          category: 'PULLBACK',
          price: curPrice,
          prevClose: prevClose,
          changePct: Math.round(changePct * 100) / 100,
          score: pbScore,
          signals: pbSignals,
          description: pbSignals.join(' · '),
          pullbackDepth: Math.round(pullbackDepth * 10) / 10,
          supportLevel: nearSma20 ? '20 SMA' : nearSma10 ? '10 SMA' : sma50 && Math.abs(curPrice - sma50) / curPrice * 100 <= 2 ? '50 SMA' : 'VWAP',
          range5: Math.round(range5 * 10) / 10,
          baseVolRatio: Math.round(baseVolRatio * 100),
          relativeVol: Math.round(relativeVol * 10) / 10,
          volume: curVol,
          avgVol20: avgVol20,
          vwap: curVwap,
          aboveSMAs: aboveSMAs + '/3',
          smaStacked: smaStacked,
          entryPrice: curPrice,
          stopPrice: pbStop,
          targetPrice: pbTarget,
          riskPct: Math.round(pbRisk * 10) / 10,
          components: {
            pullbackQuality: pbDepthPts,
            supportLevel: pbSupport,
            volumeDecline: pbVolDry,
            trendIntact: pbTrend,
            bounceSignal: pbBounce
          }
        });
      }
    }
  });

  // Sort each category by score
  earlyBreakouts.sort(function(a, b) { return b.score - a.score; });
  pullbackEntries.sort(function(a, b) { return b.score - a.score; });

  // Cap results to avoid overwhelming
  earlyBreakouts = earlyBreakouts.slice(0, 15);
  pullbackEntries = pullbackEntries.slice(0, 15);

  var resultData = {
    date: localDateStr(),
    ts: Date.now(),
    mode: marketOpen ? 'live' : 'eod',
    etTime: etTimeStr,
    earlyBreakouts: earlyBreakouts,
    pullbackEntries: pullbackEntries,
    // Legacy compatibility
    setups: earlyBreakouts.concat(pullbackEntries)
  };

  try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(resultData)); } catch(e) {}

  statusFn('Found ' + earlyBreakouts.length + ' early breakouts + ' + pullbackEntries.length + ' pullback entries.');
  return resultData;
}


// ==================== UI: RENDER SCANNER TAB ====================

function renderScanner() {
  var container = document.getElementById('tab-scanner');
  if (!container) return;

  var cache = getMomentumCache();
  var scanResults = null;
  try { var sr = localStorage.getItem(SCANNER_RESULTS_KEY); if (sr) scanResults = JSON.parse(sr); } catch(e) {}

  var dataFreshness = getDataFreshnessLabel();
  var cacheDate = cache ? new Date(cache.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'Never';

  var html = '';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:center;margin-bottom:8px;">';
  html += '<div style="text-align:center;"><div class="card-header-bar">Setup Scanner</div><div style="font-size:12px;color:var(--text-muted);font-weight:500;margin-top:1px;">Find early breakouts and pullback entries before the move</div></div>';
  html += '</div>';

  // Mode indicator
  var scanMode = isScannerMarketHours() && isMomentumCacheFresh() ? 'live' : 'eod';
  var modeLabel = scanMode === 'live'
    ? '<span style="display:inline-flex;align-items:center;gap:4px;color:var(--green);font-weight:700;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;"></span> Live Mode</span>'
    : '<span style="color:var(--text-muted);">End-of-Day Mode</span>';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">';
  html += '<div style="font-size:12px;color:var(--text-muted);">' + dataFreshness + ' · ' + modeLabel + '</div>';
  html += '<button onclick="runFullScanUI()" id="scan-btn" class="refresh-btn" style="padding:8px 20px;font-weight:700;">Scan</button>';
  html += '</div>';

  // Progress bar (hidden)
  html += '<div id="scanner-progress-wrap" style="display:none;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
  html += '<span id="scanner-status" style="font-size:14px;color:var(--text-muted);">Starting scan...</span>';
  html += '<span id="scanner-pct" style="font-size:12px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">0%</span>';
  html += '</div>';
  html += '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">';
  html += '<div id="scanner-progress-bar" style="width:0%;height:100%;background:var(--blue);border-radius:2px;transition:width 0.3s ease;"></div>';
  html += '</div></div>';

  // Status idle
  html += '<div id="scanner-status-idle" style="font-size:14px;color:var(--text-muted);margin-bottom:12px;min-height:16px;">';
  if (cache) html += 'Last scanned ' + cacheDate + ' · ' + cache.count + ' candidates';
  else html += 'No scan data yet. Click Scan to find setups.';
  html += '</div>';

  // Results
  html += '<div id="scan-results">';
  if (scanResults && (scanResults.earlyBreakouts || scanResults.pullbackEntries)) {
    html += renderSetupResults(scanResults);
  } else if (scanResults && scanResults.setups && scanResults.setups.length > 0) {
    // Legacy format — still render
    if (scanResults.mode === 'live') {
      html += renderLiveScanResults(scanResults);
    } else {
      html += renderScanResults(scanResults);
    }
  }
  html += '</div>';

  // Universe list (collapsible)
  html += '<div style="margin-top:16px;">';
  var listCollapsed = localStorage.getItem('mac_top100_collapsed') === 'true';
  html += '<div onclick="toggleTop100()" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-bottom:8px;">';
  html += '<div style="flex:1;"></div>';
  html += '<div class="card-header-bar" style="flex:none;">Universe (' + (cache ? cache.count : 0) + ' Candidates)</div>';
  html += '<div style="flex:1;display:flex;justify-content:flex-end;"><span id="top100-arrow" style="font-size:12px;color:var(--text-muted);">' + (listCollapsed ? '▶' : '▼') + '</span></div>';
  html += '</div>';
  html += '<div id="top100-body" style="' + (listCollapsed ? 'display:none;' : '') + '">';
  if (cache && cache.tickers && cache.tickers.length > 0) {
    html += renderUniverseList(cache.tickers);
  } else {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No data yet. Click Scan above.</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;
}


// ==================== RENDER: NEW TWO-CATEGORY RESULTS ====================

function renderSetupResults(data) {
  var earlyBreakouts = data.earlyBreakouts || [];
  var pullbackEntries = data.pullbackEntries || [];
  var etTime = data.etTime || '';
  var isLive = data.mode === 'live';
  var html = '';

  // Summary bar
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">';
  if (isLive) html += '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;"></span> Live</span>';
  html += '<span style="font-size:12px;color:var(--text-muted);">' + etTime + ' ET · ' + earlyBreakouts.length + ' breakouts · ' + pullbackEntries.length + ' pullbacks</span>';
  html += '</div>';

  // ── EARLY BREAKOUTS SECTION ──
  html += '<div style="margin-bottom:20px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--blue);">';
  html += '<span style="font-size:14px;font-weight:800;color:var(--blue);text-transform:uppercase;letter-spacing:.06em;">Early Breakouts</span>';
  html += '<span style="font-size:12px;color:var(--text-muted);">Compression + base building · hasn\'t moved yet</span>';
  html += '</div>';

  if (earlyBreakouts.length === 0) {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No compression setups found right now. Check back as bases form.</div>';
  } else {
    html += '<div class="sc-results-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-items:start;">';
    earlyBreakouts.forEach(function(s, idx) {
      html += renderSetupCard(s, 'eb-' + idx);
    });
    html += '</div>';
  }
  html += '</div>';

  // ── PULLBACK ENTRIES SECTION ──
  html += '<div style="margin-bottom:16px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--purple);">';
  html += '<span style="font-size:14px;font-weight:800;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;">Pullback Entries</span>';
  html += '<span style="font-size:12px;color:var(--text-muted);">Strong stocks dipping to support · buy the dip in an uptrend</span>';
  html += '</div>';

  if (pullbackEntries.length === 0) {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No pullback setups found right now. Check back when strong stocks pull in.</div>';
  } else {
    html += '<div class="sc-results-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-items:start;">';
    pullbackEntries.forEach(function(s, idx) {
      html += renderSetupCard(s, 'pb-' + idx);
    });
    html += '</div>';
  }
  html += '</div>';

  return html;
}


// ==================== RENDER: INDIVIDUAL SETUP CARD ====================
// Works for both Early Breakouts and Pullback Entries

function renderSetupCard(s, detailIdPrefix) {
  var detailId = 'detail-' + detailIdPrefix;
  var isBreakout = s.category === 'EARLY BREAKOUT';
  var accentColor = isBreakout ? 'var(--blue)' : 'var(--purple)';
  var scoreColor = s.score >= 70 ? 'var(--green)' : s.score >= 50 ? accentColor : 'var(--text-muted)';
  var changePctColor = s.changePct >= 0 ? 'var(--green)' : 'var(--red)';

  var html = '';
  html += '<div style="background:var(--bg-card);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:14px;padding:16px 18px;border-left:3px solid ' + accentColor + ';cursor:pointer;" onclick="var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';">';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:18px;font-weight:900;font-family:\'JetBrains Mono\',monospace;cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;" title="Click for chart" onclick="event.stopPropagation();openTVChart(\'' + s.ticker + '\')">' + s.ticker + '</span>';
  html += '<span style="font-size:14px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + s.price.toFixed(2) + '</span>';
  html += '<span style="font-size:14px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:' + changePctColor + ';">' + (s.changePct >= 0 ? '+' : '') + s.changePct.toFixed(2) + '%</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;">';

  // Category badge
  var badgeLabel = isBreakout ? (s.breakingOut ? 'BREAKING OUT' : s.distToBreakout <= 2 ? 'NEAR BREAKOUT' : 'BASE') : s.supportLevel || 'PULLBACK';
  html += '<span style="font-size:11px;font-weight:700;color:' + accentColor + ';text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;border:1px solid ' + accentColor + ';border-radius:4px;">' + badgeLabel + '</span>';

  // Score circle
  html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2.5px solid ' + scoreColor + ';font-size:14px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + s.score + '</div>';
  html += '</div></div>';

  // Signal description
  if (s.description) {
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px;">' + s.description + '</div>';
  }

  // Component bars
  var comps = s.components || {};
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:14px;">';
  if (isBreakout) {
    html += renderComponentBar('Tightness', comps.tightness || 0, 35, accentColor);
    html += renderComponentBar('Vol Dry-Up', comps.volumeDryUp || 0, 20, accentColor);
    html += renderComponentBar('Breakout', comps.breakoutProximity || 0, 25, accentColor);
    var extLabel = (comps.extensionAdj || 0) >= 0 ? 'Near Base' : 'Extension';
    html += renderComponentBar(extLabel, Math.max(0, 20 + (comps.extensionAdj || 0)), 25, accentColor);
  } else {
    html += renderComponentBar('Pullback', comps.pullbackQuality || 0, 30, accentColor);
    html += renderComponentBar('Support', comps.supportLevel || 0, 25, accentColor);
    html += renderComponentBar('Vol Decline', comps.volumeDecline || 0, 20, accentColor);
    html += renderComponentBar('Trend', comps.trendIntact || 0, 15, accentColor);
  }
  html += '</div>';

  // Quick stats
  html += '<div style="display:flex;gap:8px;margin-top:8px;font-size:12px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);flex-wrap:wrap;">';
  if (isBreakout) {
    html += '<span>5d: ' + s.range5 + '%</span>';
    html += '<span>Ext: ' + (s.extFromSma20 >= 0 ? '+' : '') + s.extFromSma20 + '%</span>';
    if (s.relativeVol > 0) html += '<span>RVol: ' + s.relativeVol + 'x</span>';
    html += '<span>Brkout: $' + s.breakoutLevel.toFixed(2) + (s.breakingOut ? ' ✔' : '') + '</span>';
  } else {
    html += '<span>Dip: ' + s.pullbackDepth + '%</span>';
    html += '<span>Support: ' + s.supportLevel + '</span>';
    html += '<span>SMAs: ' + s.aboveSMAs + '</span>';
    if (s.relativeVol > 0) html += '<span>RVol: ' + s.relativeVol + 'x</span>';
  }
  html += '</div>';

  // Expandable detail
  html += '<div id="' + detailId + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">';

  // Trade levels
  html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Trade Levels</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">';
  html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Entry</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--blue);font-size:14px;">$' + (s.entryPrice ? s.entryPrice.toFixed(2) : '—') + '</div></div>';
  html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Stop</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--red);font-size:14px;">$' + (s.stopPrice ? s.stopPrice.toFixed(2) : '—') + '</div></div>';
  html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Target (2:1)</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--green);font-size:14px;">$' + (s.targetPrice ? s.targetPrice.toFixed(2) : '—') + '</div></div>';
  html += '</div>';

  // Extra stats
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">';
  html += '<div style="padding:6px 8px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:11px;">5d Range</div><div style="font-weight:700;font-size:14px;">' + s.range5 + '%</div></div>';
  html += '<div style="padding:6px 8px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:11px;">Base Vol</div><div style="font-weight:700;font-size:14px;">' + s.baseVolRatio + '% of avg</div></div>';
  if (s.vwap > 0) {
    var aboveVwap = s.price > s.vwap;
    html += '<div style="padding:6px 8px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:11px;">VWAP</div><div style="font-weight:700;font-size:14px;color:' + (aboveVwap ? 'var(--green)' : 'var(--red)') + ';">$' + s.vwap.toFixed(2) + '</div></div>';
  }
  html += '<div style="padding:6px 8px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:11px;">Risk</div><div style="font-weight:700;font-size:14px;">' + (s.riskPct || 0) + '%</div></div>';
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
    '<span style="color:var(--text-secondary);font-family:\'JetBrains Mono\',monospace;">' + value + '/' + max + '</span>' +
    '</div>' +
    '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">' +
    '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:2px;"></div>' +
    '</div></div>';
}


// ==================== UNIVERSE LIST ====================

function renderUniverseList(tickers) {
  var html = '<div class="sc-table-wrap" style=""><div class="card" style="padding:0;overflow:hidden;">';

  // Header
  html += '<div class="sc-table-row" style="display:grid;grid-template-columns:40px 70px 80px 60px 60px 60px 55px 55px;gap:4px;padding:8px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">';
  html += '<span>#</span><span>Ticker</span><span>Price</span><span>5d %</span><span>Ext</span><span>Vol</span><span>SMAs</span><span>Brkout</span>';
  html += '</div>';

  tickers.forEach(function(t, idx) {
    var bg = idx % 2 === 0 ? '' : 'background:var(--bg-secondary);';
    var extColor = (t.extFromSma20 || 0) <= 3 ? 'var(--green)' : (t.extFromSma20 || 0) >= 8 ? 'var(--red)' : 'var(--text-muted)';

    html += '<div class="sc-table-row" style="display:grid;grid-template-columns:40px 70px 80px 60px 60px 60px 55px 55px;gap:4px;padding:7px 14px;border-bottom:1px solid var(--border);font-size:14px;' + bg + 'align-items:center;">';
    html += '<span style="color:var(--text-muted);font-size:14px;">' + (idx + 1) + '</span>';
    html += '<span style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + t.ticker + '</span>';
    html += '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + t.price.toFixed(2) + '</span>';
    html += '<span style="font-size:14px;color:var(--text-muted);">' + (t.range5 || '—') + '%</span>';
    html += '<span style="font-size:14px;color:' + extColor + ';">' + (t.extFromSma20 != null ? (t.extFromSma20 >= 0 ? '+' : '') + t.extFromSma20 + '%' : '—') + '</span>';
    html += '<span style="font-size:14px;color:var(--text-muted);">' + (t.volDryUp != null ? t.volDryUp + '%' : '—') + '</span>';
    html += '<span style="font-size:14px;color:' + (t.aboveSMAs === '3/3' ? 'var(--green)' : 'var(--text-muted)') + ';">' + (t.aboveSMAs || '—') + '</span>';
    html += '<span style="font-size:12px;color:var(--text-muted);">' + (t.distToBreakout != null ? t.distToBreakout + '%' : '—') + '</span>';
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}


// ==================== LEGACY RENDERERS (for old cached data) ====================

function renderLiveScanResults(data) {
  var setups = data.setups || [];
  var etTime = data.etTime || '';
  var html = '';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">';
  html += '<span style="font-size:12px;color:var(--text-muted);">(Legacy format) ' + etTime + ' ET · ' + setups.length + ' setups</span>';
  html += '</div>';
  if (setups.length === 0) {
    html += '<div class="card" style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px;">No setups found. Run a new scan.</div>';
    return html;
  }
  html += '<div class="sc-results-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;">';
  setups.forEach(function(s, idx) {
    var scoreColor = s.score >= 70 ? 'var(--green)' : 'var(--text-muted)';
    html += '<div class="card" style="padding:14px;border-left:3px solid ' + scoreColor + ';">';
    html += '<div style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:16px;">' + s.ticker + ' <span style="color:var(--text-secondary);font-size:14px;">$' + s.price.toFixed(2) + '</span> <span style="font-size:14px;color:' + scoreColor + ';">' + s.score + '</span></div>';
    if (s.description) html += '<div style="font-size:14px;color:var(--text-secondary);margin-top:4px;">' + s.description + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function renderScanResults(data) {
  return renderLiveScanResults(data);
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
    var top100Body = document.getElementById('top100-body');
    if (top100Body && cache && cache.tickers) {
      top100Body.innerHTML = renderUniverseList(cache.tickers);
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
    if (resultsEl) resultsEl.innerHTML = renderSetupResults(results);

    setTimeout(function() {
      if (progressWrap) progressWrap.style.display = 'none';
      if (idleStatus) {
        var totalSetups = (results.earlyBreakouts || []).length + (results.pullbackEntries || []).length;
        idleStatus.textContent = (results.mode === 'live' ? 'Live scan' : 'Scan') + ' · ' + results.etTime + ' ET · ' + totalSetups + ' setups from ' + (cache.count || cache.tickers.length) + ' candidates';
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

function toggleTop100() {
  var body = document.getElementById('top100-body'), arrow = document.getElementById('top100-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
  try { localStorage.setItem('mac_top100_collapsed', hidden ? 'false' : 'true'); } catch(e) {}
}


// ==================== AUTO-BUILD ON PAGE LOAD ====================
var _autoBuildRunning = false;

(function() {
  setTimeout(async function() {
    if (!POLYGON_KEY) return;

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
        idleStatus.textContent = 'Universe ready · ' + (cache ? cache.count : 0) + ' candidates · Click Scan for setups';
      }
      var cache = getMomentumCache();
      var top100Body = document.getElementById('top100-body');
      if (top100Body && cache && cache.tickers) {
        top100Body.innerHTML = renderUniverseList(cache.tickers);
      }
    } catch(e) {
      console.warn('[scanner] Auto-build failed:', e);
      if (idleStatus) idleStatus.textContent = 'Auto-build failed: ' + e.message;
    }
    _autoBuildRunning = false;
  }, 2000);
})();