// ==================== scanner.js ====================
// Unified setup scanner (Top Ideas style):
//   Scans entire US market, filters to ~150 candidates, scores on
//   SMA compression + alignment + extension + volume + momentum.
//
// Layer 1: Universe builder — filters all US stocks to ~top 150 candidates
// Layer 2: Unified scoring — Top Ideas style (compression, alignment, extension, RVol, day change)

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_scanner_universe';
var SCANNER_CACHE_VERSION = 2;
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
    if (s.c < 10) return false;
    if (s.v < 500000) return false;
    if (s.T.length > 5) return false;
    if (/[.-]/.test(s.T)) return false;
    if (etfSet[s.T]) return false;           // Exclude known ETFs
    return true;
  });

  statusFn('Filtered to ' + filtered.length + ' stocks. Scoring...');

  // Sort by dollar volume (highest liquidity first)
  filtered.sort(function(a, b) { return (b.v * b.c) - (a.v * a.c); });

  // Fetch SPY bars for Relative Strength comparison
  var spyBars = [];
  try { spyBars = await getDailyBarsRetry('SPY', 60); } catch(e) {}
  var spyReturn20 = 0;
  if (spyBars.length >= 20) {
    var spyOld = spyBars[spyBars.length - 20].c;
    var spyNow = spyBars[spyBars.length - 1].c;
    spyReturn20 = spyOld > 0 ? ((spyNow - spyOld) / spyOld) * 100 : 0;
  }

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
      var score = calcUniverseScore(r.bars, r.latestClose, spyReturn20);
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

function calcUniverseScore(bars, currentPrice, spyReturn20) {
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
  // ATR-relative: normalize range by the stock's own ATR so high-ATR names
  // that compress recently still score well
  var recent5H = Math.max.apply(null, highs.slice(-5));
  var recent5L = Math.min.apply(null, lows.slice(-5));
  var range5 = ((recent5H - recent5L) / currentPrice) * 100;

  var recent10H = Math.max.apply(null, highs.slice(-10));
  var recent10L = Math.min.apply(null, lows.slice(-10));
  var range10 = ((recent10H - recent10L) / currentPrice) * 100;

  // Compute ATR14 for normalization
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

  // Minimum ATR% filter — only keep stocks with ATR ≥ 4.5% of price (Qullamaggie-style)
  var atrPct = currentPrice > 0 && _atr14 > 0 ? (_atr14 / currentPrice) * 100 : 0;
  if (atrPct < 4.5) return { total: 0 };

  // ATR-relative range: how many ATRs does the 5d/10d range span?
  var atrRatio5 = (_atr14 > 0) ? (recent5H - recent5L) / _atr14 : range5;
  var atrRatio10 = (_atr14 > 0) ? (recent10H - recent10L) / _atr14 : range10;

  var ptsTight = 0;
  // Score on ATR-relative compression (5d range as multiple of ATR)
  if (atrRatio5 <= 2) ptsTight = 30;       // 5d range ≤ 2x ATR — very tight
  else if (atrRatio5 <= 3) ptsTight = 25;
  else if (atrRatio5 <= 4) ptsTight = 20;
  else if (atrRatio5 <= 5.5) ptsTight = 14;
  else if (atrRatio10 <= 6) ptsTight = 10;
  else if (atrRatio10 <= 8) ptsTight = 5;
  else ptsTight = 0;

  // ── 2. EXTENSION PENALTY (0 to -20 pts) — how far above 20 SMA ──
  var extFromSma20 = sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0;
  var ptsExt = 0;
  if (extFromSma20 <= 4) ptsExt = 10;       // Near base — ideal
  else if (extFromSma20 <= 6) ptsExt = 5;
  else if (extFromSma20 <= 8) ptsExt = 0;
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

  // ── BUYOUT FILTER ──
  if (range5 < 0.8) return { total: 0 };  // Flatlined = deal stock
  // 10d range < 1.5% AND 5d range < 2% = dead stock (buyout/deal)
  if (range10 < 1.5 && range5 < 2) return { total: 0 };
  if (len >= 15) {
    for (var gi = Math.max(0, len - 30); gi < len - 5; gi++) {
      var prevC = gi > 0 ? closes[gi - 1] : closes[gi];
      var gapPct = prevC > 0 ? ((closes[gi] - prevC) / prevC) * 100 : 0;
      if (gapPct > 10) {
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

  // ── 7. RELATIVE STRENGTH vs SPY (0-15 pts) ──
  var ptsRS = 0;
  if (len >= 20 && spyReturn20 !== undefined) {
    var stockOld = closes[len - 20];
    var stockReturn20 = stockOld > 0 ? ((currentPrice - stockOld) / stockOld) * 100 : 0;
    var rsRatio = spyReturn20 !== 0 ? stockReturn20 / Math.abs(spyReturn20) : (stockReturn20 > 0 ? 2 : 0);
    if (rsRatio >= 3) ptsRS = 15;        // 3x+ SPY's move — very strong
    else if (rsRatio >= 2) ptsRS = 12;
    else if (rsRatio >= 1.5) ptsRS = 8;
    else if (rsRatio >= 1) ptsRS = 4;    // Matching SPY
    else ptsRS = 0;                       // Underperforming
  }

  // ── 8. EPISODIC PIVOT BONUS (0-15 pts) — gap up on catalyst then consolidation ──
  var ptsEpisodic = 0;
  if (len >= 10) {
    for (var ei = Math.max(1, len - 40); ei < len - 3; ei++) {
      var epGap = closes[ei - 1] > 0 ? ((closes[ei] - closes[ei - 1]) / closes[ei - 1]) * 100 : 0;
      if (epGap >= 8) {
        // Found a big gap up — check if price is consolidating above that level
        var gapClose = closes[ei];
        var daysAfter = len - ei - 1;
        if (daysAfter >= 3 && currentPrice >= gapClose * 0.92) {
          // Price held above 92% of gap close level — consolidating, not fading
          var postHigh = Math.max.apply(null, highs.slice(ei + 1));
          var postLow = Math.min.apply(null, lows.slice(ei + 1));
          var postRangeRatio = _atr14 > 0 ? (postHigh - postLow) / (_atr14 * daysAfter) : 1;
          if (postRangeRatio <= 0.6) ptsEpisodic = 15;      // Very tight consolidation after gap
          else if (postRangeRatio <= 0.8) ptsEpisodic = 10;
          else ptsEpisodic = 5;                               // Held level but loose
          break;
        }
      }
    }
  }

  var total = Math.round(Math.max(0, ptsTight + ptsExt + ptsVolDry + ptsBreakout + ptsTrend + ptsPullback + ptsRS + ptsEpisodic));

  // ATR already computed above as _atr14
  var atr14 = _atr14 > 0 ? _atr14 : null;

  return {
    total: total,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    extFromSma20: Math.round(extFromSma20 * 10) / 10,
    aboveSMAs: aboveSMAs + '/3',
    volDryUp: Math.round(volRatio * 100),
    distToBreakout: Math.round(distToBreakout * 10) / 10,
    pullbackDepth: Math.round(pullbackDepth * 10) / 10,
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

  // Fetch SPY bars for Relative Strength comparison
  var spyBars2 = [];
  try { spyBars2 = await getDailyBarsRetry('SPY', 60); } catch(e) {}
  var spyRet20 = 0;
  if (spyBars2.length >= 20) {
    var _so = spyBars2[spyBars2.length - 20].c;
    var _sn = spyBars2[spyBars2.length - 1].c;
    spyRet20 = _so > 0 ? ((_sn - _so) / _so) * 100 : 0;
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

  // Helper: compute setup score for any ticker (same formula for cards + universe list)
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
    var highs = bars.map(function(b) { return b.h; });
    var lows = bars.map(function(b) { return b.l; });
    var volumes = bars.map(function(b) { return b.v; });

    function sma(arr, period) {
      if (arr.length < period) return null;
      var s = 0; for (var i = arr.length - period; i < arr.length; i++) s += arr[i]; return s / period;
    }

    var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
    if (!sma20 || !sma10) return null;

    var spread = Math.abs(sma10 - sma20) / curPrice * 100;
    var ext = ((curPrice - sma20) / sma20) * 100;
    var rvol = null;
    var avgVol20 = sma(volumes, 20);
    if (avgVol20 > 0 && curVol > 0) rvol = curVol / avgVol20;

    // ATR14 for normalization
    var _len2 = bars.length;
    var _atr2 = 0;
    if (_len2 >= 15) {
      var _ts2 = 0;
      for (var _j = _len2 - 14; _j < _len2; _j++) {
        var _t2 = highs[_j] - lows[_j];
        if (_j > 0) _t2 = Math.max(_t2, Math.abs(highs[_j] - closes[_j - 1]), Math.abs(lows[_j] - closes[_j - 1]));
        _ts2 += _t2;
      }
      _atr2 = _ts2 / 14;
    }
    // ATR-relative SMA spread: how many ATRs apart are the 10/20 SMAs?
    var spreadATR = (_atr2 > 0) ? Math.abs(sma10 - sma20) / _atr2 : spread;

    // Score: use ATR-relative spread so high-ATR names with converging SMAs score well
    var ptsCompress = spreadATR <= 0.5 ? 30 : spreadATR <= 1 ? 22 : spreadATR <= 1.5 ? 15 : spreadATR <= 2.5 ? 8 : 0;
    var ptsAlign = 0;
    if (curPrice > sma10 && curPrice > sma20) ptsAlign += 15;
    if (sma50 && curPrice > sma50) ptsAlign += 10;
    var ptsExt = ext <= 4 ? 25 : ext <= 6 ? 18 : ext <= 8 ? 10 : ext <= 10 ? 4 : -5;
    var ptsVol = (rvol && rvol >= 2) ? 10 : (rvol && rvol >= 1.5) ? 7 : (rvol && rvol >= 1) ? 4 : 0;
    var changePct = ((curPrice - prevClose) / prevClose) * 100;
    var ptsMom = changePct > 1 ? 5 : changePct > 0 ? 2 : 0;
    var recent10H = Math.max.apply(null, highs.slice(-10));
    var distToBreakout = recent10H > 0 ? ((recent10H - curPrice) / curPrice) * 100 : 99;
    var ptsBrkout = distToBreakout <= 1 ? 5 : 0;

    // RS vs SPY (0-15 pts)
    var _ptsRS2 = 0;
    var _len3 = closes.length;
    if (_len3 >= 20) {
      var _sOld = closes[_len3 - 20];
      var _sRet = _sOld > 0 ? ((curPrice - _sOld) / _sOld) * 100 : 0;
      var _rsR = spyRet20 !== 0 ? _sRet / Math.abs(spyRet20) : (_sRet > 0 ? 2 : 0);
      if (_rsR >= 3) _ptsRS2 = 15;
      else if (_rsR >= 2) _ptsRS2 = 12;
      else if (_rsR >= 1.5) _ptsRS2 = 8;
      else if (_rsR >= 1) _ptsRS2 = 4;
    }

    // Episodic Pivot bonus (0-15 pts)
    var _ptsEP2 = 0;
    if (_len3 >= 10) {
      for (var _ei = Math.max(1, _len3 - 40); _ei < _len3 - 3; _ei++) {
        var _epG = closes[_ei - 1] > 0 ? ((closes[_ei] - closes[_ei - 1]) / closes[_ei - 1]) * 100 : 0;
        if (_epG >= 8) {
          var _gC = closes[_ei];
          var _dA = _len3 - _ei - 1;
          if (_dA >= 3 && curPrice >= _gC * 0.92) {
            var _pH = Math.max.apply(null, highs.slice(_ei + 1));
            var _pL = Math.min.apply(null, lows.slice(_ei + 1));
            var _prR = _atr2 > 0 ? (_pH - _pL) / (_atr2 * _dA) : 1;
            if (_prR <= 0.6) _ptsEP2 = 15;
            else if (_prR <= 0.8) _ptsEP2 = 10;
            else _ptsEP2 = 5;
            break;
          }
        }
      }
    }

    return Math.round(Math.min(130, Math.max(0, ptsCompress + ptsAlign + ptsExt + ptsVol + ptsMom + ptsBrkout + _ptsRS2 + _ptsEP2)));
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

    var recent10H = Math.max.apply(null, highs.slice(-10));
    var distToBreakout = recent10H > 0 ? ((recent10H - curPrice) / curPrice) * 100 : 99;

    var recent5H = Math.max.apply(null, highs.slice(-5));
    var recent5L = Math.min.apply(null, lows.slice(-5));
    var range5 = ((recent5H - recent5L) / curPrice) * 100;
    if (range5 < 0.8) return; // flatlined deal stock
    // Buyout filter: 10d range < 1.5% AND 5d range < 2% = dead stock
    if (highs.length >= 10) {
      var r10H = Math.max.apply(null, highs.slice(-10));
      var r10L = Math.min.apply(null, lows.slice(-10));
      var range10 = ((r10H - r10L) / curPrice) * 100;
      if (range10 < 1.5 && range5 < 2) return;
    }
    // Post-gap flatline: gap >10% then barely moves = acquisition/deal stock
    if (closes.length >= 15) {
      for (var bi = Math.max(0, closes.length - 30); bi < closes.length - 5; bi++) {
        var bPrev = bi > 0 ? closes[bi - 1] : closes[bi];
        var bGap = bPrev > 0 ? ((closes[bi] - bPrev) / bPrev) * 100 : 0;
        if (bGap > 10) {
          var pgH = highs.slice(bi + 2);
          var pgL = lows.slice(bi + 2);
          if (pgH.length >= 3) {
            var pgRange = ((Math.max.apply(null, pgH) - Math.min.apply(null, pgL)) / curPrice) * 100;
            if (pgRange < 3.5) return;
          }
        }
      }
    }
    if (changePct < -8) return;

    // Market cap filter — minimum $500M (avoid micro caps)
    var mcap = allMarketCap[ticker] || 0;
    if (mcap > 0 && mcap < 500000000) return;

    var score = allScores[ticker] || 0;
    if (score < 30) return;

    // SMA Alignment (for thesis + card data)
    var aboveBoth = curPrice > sma10 && curPrice > sma20;

    // Component scores (for card display)
    var ptsCompress = spread <= 1 ? 30 : spread <= 2 ? 22 : spread <= 3 ? 15 : spread <= 5 ? 8 : 0;
    var ptsAlign = 0;
    if (aboveBoth) ptsAlign += 15;
    if (sma50 && curPrice > sma50) ptsAlign += 10;
    var ptsExt = ext <= 4 ? 25 : ext <= 6 ? 18 : ext <= 8 ? 10 : ext <= 10 ? 4 : -5;
    var ptsVol = (rvol && rvol >= 2) ? 10 : (rvol && rvol >= 1.5) ? 7 : (rvol && rvol >= 1) ? 4 : 0;
    var ptsMom = changePct > 1 ? 5 : changePct > 0 ? 2 : 0;
    var ptsBrkout = distToBreakout <= 1 ? 5 : 0;

    // ── THESIS ──
    var thesis = '';
    if (spread <= 2) thesis += 'Tight compression (' + spread.toFixed(1) + '%). ';
    if (aboveBoth) thesis += 'Above 10/20 SMA. ';
    if (ext <= 4) thesis += 'Near base (' + ext.toFixed(1) + '%). ';
    else if (ext > 8) thesis += 'Extended (' + ext.toFixed(1) + '%). ';
    if (rvol && rvol >= 1.5) thesis += rvol.toFixed(1) + 'x volume. ';
    if (changePct > 1) thesis += 'Up ' + changePct.toFixed(1) + '% today. ';
    if (distToBreakout <= 1) thesis += 'Near breakout. ';

    // RS vs SPY check for thesis
    var _cLen = closes.length;
    var _stockRet = _cLen >= 20 && closes[_cLen - 20] > 0 ? ((curPrice - closes[_cLen - 20]) / closes[_cLen - 20]) * 100 : 0;
    var _rsR2 = spyRet20 !== 0 ? _stockRet / Math.abs(spyRet20) : (_stockRet > 0 ? 2 : 0);
    if (_rsR2 >= 2) thesis += 'Strong RS (' + _rsR2.toFixed(1) + 'x SPY). ';

    // Episodic Pivot check for thesis
    var _hasEP = false;
    for (var _epi = Math.max(1, _cLen - 40); _epi < _cLen - 3; _epi++) {
      var _epGap2 = closes[_epi - 1] > 0 ? ((closes[_epi] - closes[_epi - 1]) / closes[_epi - 1]) * 100 : 0;
      if (_epGap2 >= 8 && curPrice >= closes[_epi] * 0.92) { _hasEP = true; break; }
    }
    if (_hasEP) thesis += 'Episodic pivot (gap + consolidation). ';

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
      distToBreakout: Math.round(distToBreakout * 10) / 10,
      entryPrice: curPrice,
      stopPrice: stopPrice,
      targetPrice: targetPrice,
      riskPct: Math.round(riskPct * 10) / 10,
      components: {
        compression: ptsCompress,
        alignment: ptsAlign,
        extension: ptsExt,
        volume: ptsVol,
        momentum: ptsMom,
        breakout: ptsBrkout
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
  html += '<div style="text-align:center;"><div class="card-header-bar">Setup Scanner</div><div style="font-size:12px;color:var(--text-muted);font-weight:500;margin-top:1px;">Find compression setups with momentum across the market</div></div>';
  html += '</div>';

  // Scan button + progress bar
  var scanMode = isScannerMarketHours() && isMomentumCacheFresh() ? 'live' : 'eod';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  if (scanMode === 'live') {
    html += '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;"></span> Live</span>';
  }
  html += '<span style="font-size:12px;color:var(--text-muted);">' + dataFreshness + '</span>';
  html += '</div>';
  html += '<button onclick="runFullScanUI()" id="scan-btn" class="refresh-btn" style="padding:8px 20px;font-weight:700;">Scan</button>';
  html += '</div>';

  // Progress bar (hidden during idle)
  html += '<div id="scanner-progress-wrap" style="display:none;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
  html += '<span id="scanner-status" style="font-size:14px;color:var(--text-muted);">Starting scan...</span>';
  html += '<span id="scanner-pct" style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);">0%</span>';
  html += '</div>';
  html += '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">';
  html += '<div id="scanner-progress-bar" style="width:0%;height:100%;background:var(--blue);border-radius:2px;transition:width 0.3s ease;"></div>';
  html += '</div></div>';

  // Screening funnel (idle status)
  html += '<div id="scanner-status-idle" style="margin-bottom:14px;min-height:16px;">';
  if (cache) {
    var setupCount = (scanResults && scanResults.setups) ? scanResults.setups.length : 0;
    html += '<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);flex-wrap:wrap;">';
    if (cache.totalScanned) {
      html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> stocks scanned';
      html += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
    }
    if (cache.filteredCount) {
      html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.filteredCount.toLocaleString() + '</span> passed filters';
      html += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
    }
    html += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
    if (setupCount > 0) {
      html += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
      html += '<span style="font-family:var(--font-mono);font-weight:700;color:var(--blue);">' + setupCount + '</span> <span style="font-weight:600;color:var(--blue);">setups</span>';
    }
    html += '</div>';
  } else {
    html += '<div style="font-size:13px;color:var(--text-muted);">No scan data yet. Click Scan to find setups.</div>';
  }
  html += '</div>';

  // Results
  html += '<div id="scan-results">';
  if (scanResults && scanResults.setups && scanResults.setups.length > 0) {
    html += renderSetupResults(scanResults);
  }
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
}


// ==================== RENDER: SETUP RESULTS ====================

function renderSetupResults(data) {
  var setups = data.setups || [];
  var html = '';

  if (setups.length === 0) {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No compression setups found right now. Check back later.</div>';
    return html;
  }

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
  setups.forEach(function(s, idx) {
    html += renderSetupCard(s, idx, data);
  });
  html += '</div>';

  return html;
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
    if (resultsEl) resultsEl.innerHTML = renderSetupResults(results);

    setTimeout(function() {
      if (progressWrap) progressWrap.style.display = 'none';
      if (idleStatus) {
        // Rebuild the funnel display with fresh data
        var setupCount = (results.setups || []).length;
        var funnelHtml = '<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);flex-wrap:wrap;">';
        if (cache.totalScanned) {
          funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> stocks scanned';
          funnelHtml += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
        }
        if (cache.filteredCount) {
          funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.filteredCount.toLocaleString() + '</span> passed filters';
          funnelHtml += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
        }
        funnelHtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.count + '</span> candidates';
        funnelHtml += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
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
          var _fhtml = '<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);flex-wrap:wrap;">';
          if (cache.totalScanned) {
            _fhtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.totalScanned.toLocaleString() + '</span> stocks scanned';
            _fhtml += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
          }
          if (cache.filteredCount) {
            _fhtml += '<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);">' + cache.filteredCount.toLocaleString() + '</span> passed filters';
            _fhtml += '<span style="color:var(--text-muted);font-size:11px;">\u2192</span>';
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
