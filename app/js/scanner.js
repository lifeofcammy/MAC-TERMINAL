// ==================== scanner.js ====================
// Two-layer momentum scanner:
//   Layer 1: Daily universe builder — top 100 momentum stocks (auto-refreshes daily)
//   Layer 2: Breakout/compression scan — runs on cached top 100
// Based on Qullamaggie + Dan Zanger methodology.

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_momentum_top100';
var SCANNER_RESULTS_KEY = 'mac_scan_results';

// Local date string (YYYY-MM-DD) — avoids UTC timezone shift from toISOString()
function localDateStr(d) {
  if (!d) d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ==================== LAYER 1: DAILY MOMENTUM UNIVERSE ====================

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
  // Fresh if generated today (or last trading day if weekend)
  var today = localDateStr();
  return cache.date === today || cache.date === getLastTradingDay();
}

function getLastTradingDay() {
  var d = new Date();
  // Walk back to last weekday
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

// Retry wrapper for API calls — retries on 429 / network errors
async function polyGetRetry(path, maxRetries) {
  if (!maxRetries) maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await polyGet(path);
    } catch(e) {
      var is429 = e.message && e.message.indexOf('429') !== -1;
      var isNetwork = e.message && (e.message.indexOf('Failed to fetch') !== -1 || e.message.indexOf('NetworkError') !== -1);
      if ((is429 || isNetwork) && attempt < maxRetries - 1) {
        // Exponential backoff: 2s, 4s, 8s
        var wait = Math.pow(2, attempt + 1) * 1000;
        await new Promise(function(r) { setTimeout(r, wait); });
        continue;
      }
      throw e;
    }
  }
}

// Retry wrapper for getDailyBars
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

async function buildMomentumUniverse(statusFn) {
  if (!statusFn) statusFn = function() {};

  statusFn('Fetching all US stocks...');

  // Step 1: Get grouped daily bars (all stocks, previous trading day)
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

  // Step 2: Filter — price > $5, volume > 500K, common stocks only (no OTC, warrants, etc.)
  var filtered = allStocks.filter(function(s) {
    if (!s.T || !s.c || !s.v) return false;
    if (s.c < 5) return false;           // Min price $5
    if (s.v < 500000) return false;       // Min volume 500K
    if (s.T.length > 5) return false;     // Skip tickers > 5 chars (warrants, units)
    if (/[.-]/.test(s.T)) return false;   // Skip class shares, preferreds
    return true;
  });

  statusFn('Filtered to ' + filtered.length + ' stocks. Fetching 50-day bars...');

  // Step 3: Sort by dollar volume for deterministic ordering (highest liquidity first)
  filtered.sort(function(a, b) { return (b.v * b.c) - (a.v * a.c); });
  var candidates = filtered;

  // Step 4: Fetch 50-day bars in batches and score
  var scored = [];
  var batchSize = 25;
  var failCount = 0;

  for (var i = 0; i < candidates.length; i += batchSize) {
    var batch = candidates.slice(i, i + batchSize);
    var promises = batch.map(function(stock) {
      return getDailyBarsRetry(stock.T, 60).then(function(bars) {
        return { ticker: stock.T, bars: bars, latestClose: stock.c, latestVol: stock.v };
      }).catch(function() { failCount++; return null; });
    });
    var results = await Promise.all(promises);
    results.forEach(function(r) {
      if (!r || !r.bars || r.bars.length < 20) return;
      var score = calcMomentumScore(r.bars, r.latestClose);
      if (score.total > 0) {
        scored.push({
          ticker: r.ticker,
          price: r.latestClose,
          volume: r.latestVol,
          score: score.total,
          pct20d: score.pct20d,
          pct50d: score.pct50d,
          distFromHigh: score.distFromHigh,
          aboveSMAs: score.aboveSMAs,
          adrMultiple: score.adrMultiple,
          bars: null // Don't cache bars to save localStorage space
        });
      }
    });

    // Progress update every batch
    var progress = Math.min(i + batchSize, candidates.length);
    var pct = Math.round(progress / candidates.length * 100);
    statusFn('Scoring... ' + progress + '/' + candidates.length + ' (' + pct + '%)');

    // Small delay to be respectful to API
    if (i + batchSize < candidates.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  // Step 5: Sort by score, take top 100
  scored.sort(function(a, b) { return b.score - a.score; });
  var top100 = scored.slice(0, 100);

  // Save to cache
  var cacheData = {
    date: localDateStr(),
    ts: Date.now(),
    count: top100.length,
    tickers: top100
  };
  saveMomentumCache(cacheData);

  var failNote = failCount > 0 ? ' (' + failCount + ' tickers skipped due to errors)' : '';
  statusFn('Done! Top ' + top100.length + ' momentum stocks identified.' + failNote);
  return cacheData;
}

function calcMomentumScore(bars, currentPrice) {
  var closes = bars.map(function(b) { return b.c; });
  var highs = bars.map(function(b) { return b.h; });
  var lows = bars.map(function(b) { return b.l; });
  var len = closes.length;
  if (len < 20) return { total: 0 };

  // 20-day % change (0-30 pts)
  var close20ago = closes[Math.max(0, len - 21)];
  var pct20d = ((currentPrice - close20ago) / close20ago) * 100;
  var pts20d = 0;
  if (pct20d > 30) pts20d = 30;
  else if (pct20d > 20) pts20d = 27;
  else if (pct20d > 15) pts20d = 24;
  else if (pct20d > 10) pts20d = 20;
  else if (pct20d > 5) pts20d = 15;
  else if (pct20d > 2) pts20d = 8;
  else if (pct20d > 0) pts20d = 3;
  else pts20d = 0;

  // 50-day % change (0-25 pts)
  var pct50d = 0, pts50d = 0;
  if (len >= 50) {
    var close50ago = closes[len - 50];
    pct50d = ((currentPrice - close50ago) / close50ago) * 100;
    if (pct50d > 50) pts50d = 25;
    else if (pct50d > 30) pts50d = 22;
    else if (pct50d > 20) pts50d = 18;
    else if (pct50d > 10) pts50d = 14;
    else if (pct50d > 5) pts50d = 8;
    else if (pct50d > 0) pts50d = 3;
    else pts50d = 0;
  }

  // Distance from 52-week high (0-25 pts) — closer = better
  var highInRange = Math.max.apply(null, closes);
  var distFromHigh = ((highInRange - currentPrice) / highInRange) * 100;
  var ptsHigh = 0;
  if (distFromHigh <= 2) ptsHigh = 25;       // Within 2% of high
  else if (distFromHigh <= 5) ptsHigh = 20;
  else if (distFromHigh <= 10) ptsHigh = 14;
  else if (distFromHigh <= 15) ptsHigh = 8;
  else if (distFromHigh <= 20) ptsHigh = 3;
  else ptsHigh = 0;

  // SMA alignment (0-20 pts) — above 10, 20, 50 SMA = bullish stack
  function sma(period) {
    if (len < period) return null;
    var sum = 0;
    for (var i = len - period; i < len; i++) sum += closes[i];
    return sum / period;
  }
  var sma10 = sma(10), sma20 = sma(20), sma50 = sma(50);
  var aboveSMAs = 0;
  var ptsSMA = 0;
  if (sma10 && currentPrice > sma10) { aboveSMAs++; ptsSMA += 5; }
  if (sma20 && currentPrice > sma20) { aboveSMAs++; ptsSMA += 5; }
  if (sma50 && currentPrice > sma50) { aboveSMAs++; ptsSMA += 5; }
  // Bonus for proper stack (10 > 20 > 50)
  if (sma10 && sma20 && sma50 && sma10 > sma20 && sma20 > sma50) ptsSMA += 5;

  // ADR extension: how many ADRs above the 50 SMA
  var adrMultiple = null;
  if (sma50 && currentPrice > sma50) {
    var adrSum = 0;
    for (var ai = len - 20; ai < len; ai++) adrSum += (highs[ai] - lows[ai]);
    var adr = adrSum / 20;
    if (adr > 0) adrMultiple = Math.round(((currentPrice - sma50) / adr) * 10) / 10;
  }

  var total = Math.round(pts20d + pts50d + ptsHigh + ptsSMA);

  return {
    total: total,
    pct20d: Math.round(pct20d * 10) / 10,
    pct50d: Math.round(pct50d * 10) / 10,
    distFromHigh: Math.round(distFromHigh * 10) / 10,
    aboveSMAs: aboveSMAs + '/3',
    adrMultiple: adrMultiple
  };
}


// ==================== LAYER 2: BREAKOUT / COMPRESSION SCAN ====================

async function runBreakoutScan(statusFn) {
  if (!statusFn) statusFn = function() {};

  var cache = getMomentumCache();
  if (!cache || !cache.tickers || cache.tickers.length === 0) {
    throw new Error('No momentum universe cached. Refresh the top 100 first.');
  }

  var tickers = cache.tickers.map(function(t) { return t.ticker; });
  statusFn('Scanning ' + tickers.length + ' momentum stocks for setups...');

  var setups = [];
  var batchSize = 15;

  for (var i = 0; i < tickers.length; i += batchSize) {
    var batch = tickers.slice(i, i + batchSize);
    var promises = batch.map(function(ticker) {
      return getDailyBarsRetry(ticker, 60).then(function(bars) {
        return { ticker: ticker, bars: bars };
      }).catch(function() { return null; });
    });

    var results = await Promise.all(promises);
    results.forEach(function(r) {
      if (!r || !r.bars || r.bars.length < 20) return;
      var setup = analyzeSetup(r.ticker, r.bars);
      if (setup && setup.score >= 40) setups.push(setup);
    });

    var progress = Math.min(i + batchSize, tickers.length);
    statusFn('Scanning for setups... ' + progress + '/' + tickers.length);

    if (i + batchSize < tickers.length) {
      await new Promise(function(r) { setTimeout(r, 50); });
    }
  }

  setups.sort(function(a, b) { return b.score - a.score; });

  // Save results
  var resultData = {
    date: localDateStr(),
    ts: Date.now(),
    setups: setups
  };
  try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(resultData)); } catch(e) {}

  statusFn('Found ' + setups.length + ' setups.');
  return resultData;
}

function analyzeSetup(ticker, bars) {
  var closes = bars.map(function(b) { return b.c; });
  var highs = bars.map(function(b) { return b.h; });
  var lows = bars.map(function(b) { return b.l; });
  var volumes = bars.map(function(b) { return b.v; });
  var len = closes.length;
  if (len < 20) return null;

  var price = closes[len - 1];

  // SMA calculations
  function sma(arr, period) {
    if (arr.length < period) return null;
    var sum = 0;
    for (var i = arr.length - period; i < arr.length; i++) sum += arr[i];
    return sum / period;
  }

  var sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50);
  if (!sma10 || !sma20) return null;
  if (price < sma20) return null; // Must be above 20 SMA at minimum

  // ── BUYOUT / DEAL FILTER ──
  // Stocks pinned to an acquisition price have extremely tight ranges (<0.8% over 5 days)
  // These are untradeable for momentum — skip them
  var recent5H_pre = Math.max.apply(null, highs.slice(-5));
  var recent5L_pre = Math.min.apply(null, lows.slice(-5));
  var range5_pre = ((recent5H_pre - recent5L_pre) / price) * 100;
  if (range5_pre < 0.8) return null;

  // ── TIGHTNESS (0-30 pts) ──
  // Measure how tight the last 5-10 days have been (Qullamaggie's compression)
  var recent10H = Math.max.apply(null, highs.slice(-10));
  var recent10L = Math.min.apply(null, lows.slice(-10));
  var range10 = ((recent10H - recent10L) / price) * 100;

  var recent5H = Math.max.apply(null, highs.slice(-5));
  var recent5L = Math.min.apply(null, lows.slice(-5));
  var range5 = ((recent5H - recent5L) / price) * 100;

  var ptsTight = 0;
  if (range5 <= 3) ptsTight = 30;
  else if (range5 <= 5) ptsTight = 25;
  else if (range5 <= 7) ptsTight = 18;
  else if (range5 <= 10) ptsTight = 12;
  else if (range10 <= 8) ptsTight = 10;
  else if (range10 <= 12) ptsTight = 5;
  else ptsTight = 0;

  // ── VOLUME DRY-UP (0-25 pts) ──
  // Qullamaggie wants volume to drop during the base, then expand on breakout
  var avgVol20 = sma(volumes, 20);
  var recentAvgVol = sma(volumes.slice(-5), 5);
  var volRatio = avgVol20 > 0 ? recentAvgVol / avgVol20 : 1;

  var ptsVolDry = 0;
  if (volRatio <= 0.4) ptsVolDry = 25;      // Very dry = great
  else if (volRatio <= 0.55) ptsVolDry = 20;
  else if (volRatio <= 0.7) ptsVolDry = 15;
  else if (volRatio <= 0.85) ptsVolDry = 8;
  else ptsVolDry = 0;

  // ── BREAKOUT PROXIMITY (0-25 pts) ──
  // How close is price to the top of the range? (Zanger's clean resistance level)
  var distToBreakout = ((recent10H - price) / price) * 100;

  var ptsBreakout = 0;
  if (distToBreakout <= 0.5) ptsBreakout = 25;   // Right at resistance
  else if (distToBreakout <= 1) ptsBreakout = 22;
  else if (distToBreakout <= 2) ptsBreakout = 18;
  else if (distToBreakout <= 3) ptsBreakout = 12;
  else if (distToBreakout <= 5) ptsBreakout = 6;
  else ptsBreakout = 0;

  // ── TREND QUALITY (0-20 pts) ──
  // SMA stack + price above all
  var ptsTrend = 0;
  if (price > sma10) ptsTrend += 4;
  if (price > sma20) ptsTrend += 4;
  if (sma50 && price > sma50) ptsTrend += 4;
  if (sma10 > sma20) ptsTrend += 4;
  if (sma50 && sma20 > sma50) ptsTrend += 4;

  // ADR extension: how many ADRs above the 50 SMA
  var adrMultiple = null;
  if (sma50 && price > sma50) {
    var adrSum2 = 0;
    for (var ai2 = len - 20; ai2 < len; ai2++) adrSum2 += (highs[ai2] - lows[ai2]);
    var adr2 = adrSum2 / 20;
    if (adr2 > 0) adrMultiple = Math.round(((price - sma50) / adr2) * 10) / 10;
  }

  var totalScore = Math.round(ptsTight + ptsVolDry + ptsBreakout + ptsTrend);

  // Build description
  var desc = [];
  if (range5 <= 5) desc.push('Tight 5-day range (' + range5.toFixed(1) + '%)');
  else if (range10 <= 8) desc.push('Compressing 10-day (' + range10.toFixed(1) + '%)');
  if (volRatio <= 0.7) desc.push('Volume drying up (' + (volRatio * 100).toFixed(0) + '% of avg)');
  if (distToBreakout <= 2) desc.push('Near breakout ($' + recent10H.toFixed(2) + ')');
  if (sma10 > sma20 && sma50 && sma20 > sma50) desc.push('SMAs stacked bullish');

  // Entry / Stop / Target
  var entryPrice = recent10H;
  var stopPrice = Math.max(recent10L, sma20 ? sma20 * 0.99 : recent10L);
  var riskPct = ((entryPrice - stopPrice) / entryPrice) * 100;
  var targetPrice = entryPrice + (entryPrice - stopPrice) * 2;

  return {
    ticker: ticker,
    price: price,
    score: totalScore,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    volRatio: Math.round(volRatio * 100),
    breakoutLevel: recent10H,
    distToBreakout: Math.round(distToBreakout * 10) / 10,
    description: desc.join(' \xb7 '),
    entryPrice: entryPrice,
    stopPrice: stopPrice,
    targetPrice: targetPrice,
    riskPct: Math.round(riskPct * 10) / 10,
    sma10val: sma10 ? sma10.toFixed(2) : null,
    sma20val: sma20 ? sma20.toFixed(2) : null,
    sma50val: sma50 ? sma50.toFixed(2) : null,
    adrMultiple: adrMultiple,
    components: {
      tightness: ptsTight,
      volumeDryUp: ptsVolDry,
      breakoutProximity: ptsBreakout,
      trendQuality: ptsTrend
    }
  };
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
  var isFresh = isMomentumCacheFresh();

  var html = '';

  // ── HEADER ──
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">';
  html += '<div>';
  html += '<div class="section-title" style="margin:0;"><span class="dot" style="background:var(--blue)"></span> Momentum Scanner</div>';
  html += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Qullamaggie + Zanger methodology · ' + dataFreshness + '</div>';
  html += '</div>';
  html += '<button onclick="runFullScanUI()" id="scan-btn" class="refresh-btn" style="padding:8px 20px;font-weight:700;">Scan</button>';
  html += '</div>';

  // ── PROGRESS BAR (hidden by default) ──
  html += '<div id="scanner-progress-wrap" style="display:none;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">';
  html += '<span id="scanner-status" style="font-size:14px;color:var(--text-muted);">Starting scan...</span>';
  html += '<span id="scanner-pct" style="font-size:12px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">0%</span>';
  html += '</div>';
  html += '<div style="height:4px;background:var(--bg-secondary);border-radius:2px;overflow:hidden;">';
  html += '<div id="scanner-progress-bar" style="width:0%;height:100%;background:var(--blue);border-radius:2px;transition:width 0.3s ease;"></div>';
  html += '</div></div>';

  // ── STATUS (when no progress bar) ──
  html += '<div id="scanner-status-idle" style="font-size:14px;color:var(--text-muted);margin-bottom:12px;min-height:16px;">';
  if (cache) html += 'Last scanned ' + cacheDate + ' · ' + cache.count + ' stocks';
  else html += 'No scan data yet. Click Scan to find momentum stocks and breakout setups.';
  html += '</div>';

  // ── SCAN RESULTS (setups at top) ──
  html += '<div id="scan-results">';
  if (scanResults && scanResults.setups && scanResults.setups.length > 0) {
    html += renderScanResults(scanResults);
  }
  html += '</div>';

  // ── TOP 100 LIST (collapsible, below setups) ──
  html += '<div style="margin-top:16px;">';
  var listCollapsed = localStorage.getItem('mac_top100_collapsed') === 'true';
  html += '<div onclick="toggleTop100()" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-bottom:8px;">';
  html += '<div class="section-title" style="margin:0;"><span class="dot" style="background:var(--purple)"></span> Top 100 Momentum Stocks</div>';
  html += '<span id="top100-arrow" style="font-size:12px;color:var(--text-muted);">' + (listCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';
  html += '<div id="top100-body" style="' + (listCollapsed ? 'display:none;' : '') + '">';
  if (cache && cache.tickers && cache.tickers.length > 0) {
    html += renderTop100List(cache.tickers);
  } else {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">No data yet. Click Scan above.</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;
}

function renderScanResults(data) {
  var setups = data.setups || [];
  var time = new Date(data.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  var html = '';

  html += '<div style="font-size:14px;color:var(--text-muted);margin-bottom:8px;">Scanned ' + time + ' · ' + setups.length + ' setups found</div>';
  html += '<div class="sc-results-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-items:start;">';

  setups.forEach(function(s, idx) {
    var scoreColor = s.score >= 75 ? 'var(--green)' : 'var(--text-muted)';
    var scoreBg = s.score >= 75 ? 'rgba(16,185,129,0.06)' : 'var(--bg-card)';
    var detailId = 'setup-detail-' + idx;

    html += '<div style="background:' + scoreBg + ';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:14px;padding:16px 18px;border-left:3px solid ' + scoreColor + ';cursor:pointer;" onclick="var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\';">';

    // Header: ticker + price + score
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:18px;font-weight:900;font-family:\'JetBrains Mono\',monospace;">' + s.ticker + '</span>';
    html += '<span style="font-size:14px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + s.price.toFixed(2) + '</span>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:12px;color:var(--text-muted);">Click to expand</span>';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2.5px solid ' + scoreColor + ';font-size:14px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + s.score + '</div>';
    html += '</div></div>';

    // Description
    if (s.description) {
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px;">' + s.description + '</div>';
    }

    // Component bars
    var comps = s.components;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:14px;">';
    html += renderComponentBar('Tightness', comps.tightness, 30, scoreColor);
    html += renderComponentBar('Vol Dry-Up', comps.volumeDryUp, 25, scoreColor);
    html += renderComponentBar('Breakout', comps.breakoutProximity, 25, scoreColor);
    html += renderComponentBar('Trend', comps.trendQuality, 20, scoreColor);
    html += '</div>';

    // Key stats
    html += '<div style="display:flex;gap:8px;margin-top:8px;font-size:12px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">';
    html += '<span>5d: ' + s.range5 + '%</span>';
    html += '<span>Vol: ' + s.volRatio + '%</span>';
    html += '<span>Brkout: $' + s.breakoutLevel.toFixed(2) + ' (' + s.distToBreakout + '% away)</span>';
    html += '</div>';

    // ── EXPANDABLE DETAIL PANEL ──
    html += '<div id="' + detailId + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">';

    // Thesis
    var thesis = [];
    if (s.range5 <= 5) thesis.push('Price is consolidating in a tight ' + s.range5 + '% range over 5 days, typical of a volatility contraction pattern (VCP).');
    else if (s.range10 <= 10) thesis.push('Building a base with ' + s.range10 + '% range over 10 days.');
    if (s.volRatio <= 70) thesis.push('Volume has dried up to ' + s.volRatio + '% of the 20-day average \u2014 sellers are exhausted.');
    if (s.distToBreakout <= 2) thesis.push('Only ' + s.distToBreakout + '% from the breakout level at $' + s.breakoutLevel.toFixed(2) + '.');
    if (s.sma10val && s.sma20val && s.sma50val && parseFloat(s.sma10val) > parseFloat(s.sma20val) && parseFloat(s.sma20val) > parseFloat(s.sma50val)) {
      thesis.push('Moving averages are stacked bullish (10 > 20 > 50 SMA).');
    }
    if (thesis.length === 0) thesis.push('Moderate setup based on trend alignment and base formation.');
    if (s.adrMultiple && s.adrMultiple >= 3) thesis.push('Note: ' + s.adrMultiple + 'x ADRs above 50 SMA \u2014 extended from base.');

    html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Thesis</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">' + thesis.join(' ') + '</div>';

    // Score Breakdown
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Score Breakdown</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;font-size:14px;">';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:12px;">Tightness</div><div style="font-weight:800;color:var(--text-primary);">' + comps.tightness + '/30</div></div>';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:12px;">Vol Dry-Up</div><div style="font-weight:800;color:var(--text-primary);">' + comps.volumeDryUp + '/25</div></div>';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:12px;">Breakout Prox</div><div style="font-weight:800;color:var(--text-primary);">' + comps.breakoutProximity + '/25</div></div>';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;"><div style="color:var(--text-muted);font-size:12px;">Trend Quality</div><div style="font-weight:800;color:var(--text-primary);">' + comps.trendQuality + '/20</div></div>';
    html += '</div>';

    // Entry / Stop / Target
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Trade Levels</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Entry</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--blue);font-size:14px;">$' + (s.entryPrice ? s.entryPrice.toFixed(2) : '\u2014') + '</div></div>';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Stop</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--red);font-size:14px;">$' + (s.stopPrice ? s.stopPrice.toFixed(2) : '\u2014') + '</div></div>';
    html += '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;text-align:center;"><div style="color:var(--text-muted);font-size:12px;">Target (2:1)</div><div style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--green);font-size:14px;">$' + (s.targetPrice ? s.targetPrice.toFixed(2) : '\u2014') + '</div></div>';
    html += '</div>';

    // Risk
    html += '<div style="font-size:12px;color:var(--text-muted);">';
    html += 'Risk: ' + (s.riskPct || 0) + '% per share';
    if (s.sma10val) html += ' \xb7 10 SMA: $' + s.sma10val;
    if (s.sma20val) html += ' \xb7 20 SMA: $' + s.sma20val;
    if (s.sma50val) html += ' \xb7 50 SMA: $' + s.sma50val;
    html += '</div>';

    html += '</div>'; // close detail panel
    html += '</div>'; // close card
  });

  html += '</div>';
  return html;
}

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

function renderTop100List(tickers) {
  var html = '<div class="sc-table-wrap" style=""><div class="card" style="padding:0;overflow:hidden;">';

  // Table header
  html += '<div class="sc-table-row" style="display:grid;grid-template-columns:40px 70px 80px 65px 65px 55px 55px 44px;gap:4px;padding:8px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">';
  html += '<span>#</span><span>Ticker</span><span>Price</span><span>20d %</span><span>50d %</span><span>vs High</span><span>SMAs</span><span>Ext</span>';
  html += '</div>';

  tickers.forEach(function(t, idx) {
    var pct20Color = t.pct20d >= 0 ? 'var(--green)' : 'var(--red)';
    var pct50Color = (t.pct50d || 0) >= 0 ? 'var(--green)' : 'var(--red)';
    var bg = idx % 2 === 0 ? '' : 'background:var(--bg-secondary);';

    html += '<div class="sc-table-row" style="display:grid;grid-template-columns:40px 70px 80px 65px 65px 55px 55px 44px;gap:4px;padding:7px 14px;border-bottom:1px solid var(--border);font-size:14px;' + bg + 'align-items:center;">';
    html += '<span style="color:var(--text-muted);font-size:14px;">' + (idx + 1) + '</span>';
    html += '<span style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + t.ticker + '</span>';
    html += '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + t.price.toFixed(2) + '</span>';
    html += '<span style="font-weight:700;color:' + pct20Color + ';font-family:\'JetBrains Mono\',monospace;">' + (t.pct20d >= 0 ? '+' : '') + t.pct20d + '%</span>';
    html += '<span style="font-weight:700;color:' + pct50Color + ';font-family:\'JetBrains Mono\',monospace;">' + (t.pct50d >= 0 ? '+' : '') + (t.pct50d || 0) + '%</span>';
    html += '<span style="font-size:14px;color:var(--text-muted);">' + t.distFromHigh + '% off</span>';
    html += '<span style="font-size:14px;color:' + (t.aboveSMAs === '3/3' ? 'var(--green)' : 'var(--text-muted)') + ';">' + t.aboveSMAs + '</span>';
    html += '<span style="font-size:12px;color:var(--text-muted);">' + (t.adrMultiple != null ? t.adrMultiple + 'x' : '\u2014') + '</span>';
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

// ==================== SUPABASE SCAN CACHE ====================
// Check if today's scan results exist in Supabase (shared across all users)

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
  // Trigger the Edge Function to run the scan server-side
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

// ==================== SINGLE SCAN BUTTON ====================
// One click: builds universe (if stale) + runs breakout scan

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

  function updateProgress(msg, pct) {
    if (statusEl) statusEl.textContent = msg;
    if (pct !== undefined && pctEl) pctEl.textContent = pct + '%';
    if (pct !== undefined && barEl) barEl.style.width = pct + '%';
  }

  try {
    // ── STRATEGY: Try server cache first, then server scan, then client fallback ──
    
    // Step 1: Check if Supabase already has today's results
    updateProgress('Checking for cached results...', 5);
    var serverData = await getServerScanResults();
    
    if (serverData && serverData.momentum_universe && serverData.breakout_setups) {
      // Server has today's results — load them instantly
      updateProgress('Loading cached results...', 80);
      var momentum = serverData.momentum_universe;
      var setups = serverData.breakout_setups;
      
      // Save to localStorage for offline access
      saveMomentumCache(momentum);
      try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(setups)); } catch(e) {}
      
      updateProgress('Done! (from server cache)', 100);
      if (resultsEl) resultsEl.innerHTML = renderScanResults(setups);
      var top100Body = document.getElementById('top100-body');
      if (top100Body && momentum && momentum.tickers) {
        top100Body.innerHTML = renderTop100List(momentum.tickers);
      }
      
      setTimeout(function() {
        if (progressWrap) progressWrap.style.display = 'none';
        if (idleStatus) {
          idleStatus.textContent = 'Loaded from server · ' + (setups.setups ? setups.setups.length : 0) + ' setups · ' + (momentum.count || 0) + ' stocks';
          idleStatus.style.display = 'block';
        }
      }, 1500);
      if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
      return;
    }
    
    // Step 2: No cache — trigger server-side scan
    updateProgress('Running server-side scan (this takes a few minutes)...', 10);
    var serverResult = await triggerServerScan();
    
    if (serverResult && !serverResult.error) {
      // Server scan completed — fetch the results
      updateProgress('Server scan complete. Loading results...', 90);
      var freshData = await getServerScanResults();
      if (freshData && freshData.momentum_universe && freshData.breakout_setups) {
        var momentum2 = freshData.momentum_universe;
        var setups2 = freshData.breakout_setups;
        saveMomentumCache(momentum2);
        try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(setups2)); } catch(e) {}
        
        updateProgress('Done!', 100);
        if (resultsEl) resultsEl.innerHTML = renderScanResults(setups2);
        var top100Body2 = document.getElementById('top100-body');
        if (top100Body2 && momentum2 && momentum2.tickers) {
          top100Body2.innerHTML = renderTop100List(momentum2.tickers);
        }
        setTimeout(function() {
          if (progressWrap) progressWrap.style.display = 'none';
          if (idleStatus) {
            idleStatus.textContent = 'Server scan · ' + (setups2.setups ? setups2.setups.length : 0) + ' setups · ' + (momentum2.count || 0) + ' stocks';
            idleStatus.style.display = 'block';
          }
        }, 1500);
        if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
        return;
      }
    }
    
    // Step 3: Server unavailable — fall back to client-side scan
    updateProgress('Server unavailable. Running client-side scan...', 0);
    await buildMomentumUniverse(function(msg) {
      // Parse progress from status messages like "Scoring... 500/3024 (17%)"
      var match = msg.match(/(\d+)%/);
      var pct = match ? Math.round(parseInt(match[1]) * 0.7) : undefined; // Universe building = 0-70%
      updateProgress(msg, pct);
    });

    // Step 2: Run breakout scan
    updateProgress('Scanning for breakout setups...', 72);
    var results = await runBreakoutScan(function(msg) {
      var match = msg.match(/(\d+)\/(\d+)/);
      if (match) {
        var pct = 72 + Math.round(parseInt(match[1]) / parseInt(match[2]) * 28); // Scan = 72-100%
        updateProgress(msg, Math.min(pct, 99));
      } else {
        updateProgress(msg);
      }
    });

    updateProgress('Done!', 100);

    // Render results
    if (resultsEl) resultsEl.innerHTML = renderScanResults(results);

    // Update top 100 list
    var cache = getMomentumCache();
    var top100Body = document.getElementById('top100-body');
    if (top100Body && cache && cache.tickers) {
      top100Body.innerHTML = renderTop100List(cache.tickers);
    }

    // Update idle status for next time
    setTimeout(function() {
      if (progressWrap) progressWrap.style.display = 'none';
      if (idleStatus) {
        var cacheDate = new Date(cache.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        idleStatus.textContent = 'Last scanned ' + cacheDate + ' · ' + results.setups.length + ' setups · ' + cache.count + ' stocks';
        idleStatus.style.display = 'block';
      }
    }, 2000);

  } catch(e) {
    updateProgress('Error: ' + e.message, 0);
    if (barEl) barEl.style.background = 'var(--red)';
    if (statusEl) statusEl.style.color = 'var(--red)';
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
}

function toggleTop100() {
  var body = document.getElementById('top100-body'), arrow = document.getElementById('top100-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
  try { localStorage.setItem('mac_top100_collapsed', hidden ? 'false' : 'true'); } catch(e) {}
}


// ==================== AUTO-LOAD ON PAGE LOAD ====================
// Check server for cached results; if none, check localStorage
(function() {
  setTimeout(async function() {
    try {
      var serverData = await getServerScanResults();
      if (serverData && serverData.momentum_universe) {
        saveMomentumCache(serverData.momentum_universe);
        if (serverData.breakout_setups) {
          try { localStorage.setItem(SCANNER_RESULTS_KEY, JSON.stringify(serverData.breakout_setups)); } catch(e) {}
        }
      }
    } catch(e) {}
  }, 3000);
})();
