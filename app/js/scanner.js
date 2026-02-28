// ==================== scanner.js ====================
// Two-layer momentum scanner:
//   Layer 1: Daily universe builder — top 100 momentum stocks (auto-refreshes daily)
//   Layer 2: Breakout/compression scan — runs on cached top 100
// Based on Qullamaggie + Dan Zanger methodology.

// ==================== CONSTANTS ====================
var SCANNER_CACHE_KEY = 'mac_momentum_top100';
var SCANNER_RESULTS_KEY = 'mac_scan_results';

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
  var today = new Date().toISOString().split('T')[0];
  return cache.date === today || cache.date === getLastTradingDay();
}

function getLastTradingDay() {
  var d = new Date();
  // Walk back to last weekday
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function buildMomentumUniverse(statusFn) {
  if (!statusFn) statusFn = function() {};

  statusFn('Fetching all US stocks (grouped daily)...');

  // Step 1: Get grouped daily bars (all stocks, previous trading day)
  var lastDay = getLastTradingDay();
  var groupedData;
  try {
    groupedData = await polyGet('/v2/aggs/grouped/locale/us/market/stocks/' + lastDay + '?adjusted=true');
  } catch(e) {
    throw new Error('Failed to fetch grouped daily data: ' + e.message);
  }

  var allStocks = groupedData.results || [];
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

  statusFn('Filtered to ' + filtered.length + ' stocks. Fetching 50-day bars for top candidates...');

  // Step 3: Get 50-day bars for scoring. We can't fetch all, so first rough-sort
  // by single-day volume to take top ~400 most liquid
  filtered.sort(function(a, b) { return (b.v * b.c) - (a.v * a.c); }); // Sort by dollar volume
  var candidates = filtered.slice(0, 400);

  // Step 4: Fetch 50-day bars in batches and score
  var scored = [];
  var batchSize = 5;
  for (var i = 0; i < candidates.length; i += batchSize) {
    var batch = candidates.slice(i, i + batchSize);
    var promises = batch.map(function(stock) {
      return getDailyBars(stock.T, 60).then(function(bars) {
        return { ticker: stock.T, bars: bars, latestClose: stock.c, latestVol: stock.v };
      }).catch(function() { return null; });
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
          bars: null // Don't cache bars to save localStorage space
        });
      }
    });

    if (i % 20 === 0 && i > 0) {
      statusFn('Scoring... (' + Math.min(i + batchSize, candidates.length) + '/' + candidates.length + ')');
    }
    // Small delay to respect rate limits
    if (i + batchSize < candidates.length) {
      await new Promise(function(r) { setTimeout(r, 250); });
    }
  }

  // Step 5: Sort by score, take top 100
  scored.sort(function(a, b) { return b.score - a.score; });
  var top100 = scored.slice(0, 100);

  // Save to cache
  var cacheData = {
    date: new Date().toISOString().split('T')[0],
    ts: Date.now(),
    count: top100.length,
    tickers: top100
  };
  saveMomentumCache(cacheData);
  statusFn('Done! Top ' + top100.length + ' momentum stocks identified.');
  return cacheData;
}

function calcMomentumScore(bars, currentPrice) {
  var closes = bars.map(function(b) { return b.c; });
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

  var total = Math.round(pts20d + pts50d + ptsHigh + ptsSMA);

  return {
    total: total,
    pct20d: Math.round(pct20d * 10) / 10,
    pct50d: Math.round(pct50d * 10) / 10,
    distFromHigh: Math.round(distFromHigh * 10) / 10,
    aboveSMAs: aboveSMAs + '/3'
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
  var batchSize = 5;

  for (var i = 0; i < tickers.length; i += batchSize) {
    var batch = tickers.slice(i, i + batchSize);
    var promises = batch.map(function(ticker) {
      return getDailyBars(ticker, 60).then(function(bars) {
        return { ticker: ticker, bars: bars };
      }).catch(function() { return null; });
    });

    var results = await Promise.all(promises);
    results.forEach(function(r) {
      if (!r || !r.bars || r.bars.length < 20) return;
      var setup = analyzeSetup(r.ticker, r.bars);
      if (setup && setup.score >= 40) setups.push(setup);
    });

    if (i % 20 === 0 && i > 0) {
      statusFn('Scanning... (' + Math.min(i + batchSize, tickers.length) + '/' + tickers.length + ')');
    }
    if (i + batchSize < tickers.length) {
      await new Promise(function(r) { setTimeout(r, 250); });
    }
  }

  setups.sort(function(a, b) { return b.score - a.score; });

  // Save results
  var resultData = {
    date: new Date().toISOString().split('T')[0],
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

  var totalScore = Math.round(ptsTight + ptsVolDry + ptsBreakout + ptsTrend);

  // Build description
  var desc = [];
  if (range5 <= 5) desc.push('Tight 5-day range (' + range5.toFixed(1) + '%)');
  else if (range10 <= 8) desc.push('Compressing 10-day (' + range10.toFixed(1) + '%)');
  if (volRatio <= 0.7) desc.push('Volume drying up (' + (volRatio * 100).toFixed(0) + '% of avg)');
  if (distToBreakout <= 2) desc.push('Near breakout ($' + recent10H.toFixed(2) + ')');
  if (sma10 > sma20 && sma50 && sma20 > sma50) desc.push('SMAs stacked bullish');

  return {
    ticker: ticker,
    price: price,
    score: totalScore,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    volRatio: Math.round(volRatio * 100),
    breakoutLevel: recent10H,
    distToBreakout: Math.round(distToBreakout * 10) / 10,
    description: desc.join(' · '),
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
  html += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Qullamaggie + Zanger methodology · ' + dataFreshness + '</div>';
  html += '</div>';
  html += '<div style="display:flex;gap:6px;">';
  html += '<button onclick="refreshMomentumUI()" id="refresh-universe-btn" style="padding:6px 14px;border-radius:6px;border:1px solid ' + (isFresh ? 'var(--border)' : 'var(--amber)') + ';background:' + (isFresh ? 'var(--bg-card)' : 'rgba(245,158,11,0.08)') + ';color:' + (isFresh ? 'var(--text-secondary)' : 'var(--amber)') + ';cursor:pointer;font-size:10px;font-weight:700;font-family:\'Inter\',sans-serif;">' + (isFresh ? 'Refresh Top 100' : '⟳ Update Top 100') + '</button>';
  html += '<button onclick="runScanUI()" id="run-scan-btn" style="padding:6px 14px;border-radius:6px;border:none;background:var(--blue);color:#fff;cursor:pointer;font-size:10px;font-weight:700;font-family:\'Inter\',sans-serif;">Scan for Setups</button>';
  html += '</div></div>';

  // ── STATUS BAR ──
  html += '<div id="scanner-status" style="font-size:10px;color:var(--text-muted);margin-bottom:12px;min-height:16px;">';
  if (cache) html += 'Top 100 updated ' + cacheDate + ' · ' + cache.count + ' stocks';
  else html += 'No momentum list cached yet. Click "Update Top 100" to build it.';
  html += '</div>';

  // ── SCAN RESULTS ──
  html += '<div id="scan-results">';
  if (scanResults && scanResults.setups && scanResults.setups.length > 0) {
    html += renderScanResults(scanResults);
  } else if (cache && cache.tickers) {
    html += '<div class="card" style="padding:24px;text-align:center;color:var(--text-muted);font-size:11px;">Top 100 loaded. Click <strong>Scan for Setups</strong> to find breakout candidates.</div>';
  }
  html += '</div>';

  // ── TOP 100 LIST (collapsible) ──
  html += '<div style="margin-top:16px;">';
  var listCollapsed = localStorage.getItem('mac_top100_collapsed') === 'true';
  html += '<div onclick="toggleTop100()" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-bottom:8px;">';
  html += '<div class="section-title" style="margin:0;"><span class="dot" style="background:var(--purple)"></span> Top 100 Momentum Stocks</div>';
  html += '<span id="top100-arrow" style="font-size:11px;color:var(--text-muted);">' + (listCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';
  html += '<div id="top100-body" style="' + (listCollapsed ? 'display:none;' : '') + '">';
  if (cache && cache.tickers && cache.tickers.length > 0) {
    html += renderTop100List(cache.tickers);
  } else {
    html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px;">No data yet. Click "Update Top 100" above.</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;
}

function renderScanResults(data) {
  var setups = data.setups || [];
  var time = new Date(data.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  var html = '';

  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:8px;">Scanned ' + time + ' · ' + setups.length + ' setups found</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;">';

  setups.forEach(function(s, idx) {
    var scoreColor = s.score >= 75 ? 'var(--green)' : s.score >= 55 ? 'var(--blue)' : 'var(--amber)';
    var scoreBg = s.score >= 75 ? 'rgba(16,185,129,0.06)' : s.score >= 55 ? 'rgba(37,99,235,0.04)' : 'rgba(245,158,11,0.04)';

    html += '<div style="background:' + scoreBg + ';box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:14px;padding:16px 18px;border-left:3px solid ' + scoreColor + '">';

    // Header: ticker + price + score
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:16px;font-weight:900;font-family:\'JetBrains Mono\',monospace;">' + s.ticker + '</span>';
    html += '<span style="font-size:12px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + s.price.toFixed(2) + '</span>';
    html += '</div>';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2.5px solid ' + scoreColor + ';font-size:12px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + s.score + '</div>';
    html += '</div>';

    // Description
    if (s.description) {
      html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px;">' + s.description + '</div>';
    }

    // Component bars
    var comps = s.components;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">';
    html += renderComponentBar('Tightness', comps.tightness, 30, scoreColor);
    html += renderComponentBar('Vol Dry-Up', comps.volumeDryUp, 25, scoreColor);
    html += renderComponentBar('Breakout', comps.breakoutProximity, 25, scoreColor);
    html += renderComponentBar('Trend', comps.trendQuality, 20, scoreColor);
    html += '</div>';

    // Key stats
    html += '<div style="display:flex;gap:8px;margin-top:8px;font-size:8px;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">';
    html += '<span>5d: ' + s.range5 + '%</span>';
    html += '<span>Vol: ' + s.volRatio + '%</span>';
    html += '<span>Brkout: $' + s.breakoutLevel.toFixed(2) + ' (' + s.distToBreakout + '% away)</span>';
    html += '</div>';

    html += '</div>';
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
  var html = '<div class="card" style="padding:0;overflow:hidden;">';

  // Table header
  html += '<div style="display:grid;grid-template-columns:40px 70px 80px 65px 65px 55px 55px;gap:4px;padding:8px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:8px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">';
  html += '<span>#</span><span>Ticker</span><span>Price</span><span>20d %</span><span>50d %</span><span>vs High</span><span>SMAs</span>';
  html += '</div>';

  tickers.forEach(function(t, idx) {
    var pct20Color = t.pct20d >= 0 ? 'var(--green)' : 'var(--red)';
    var pct50Color = (t.pct50d || 0) >= 0 ? 'var(--green)' : 'var(--red)';
    var bg = idx % 2 === 0 ? '' : 'background:var(--bg-secondary);';

    html += '<div style="display:grid;grid-template-columns:40px 70px 80px 65px 65px 55px 55px;gap:4px;padding:7px 14px;border-bottom:1px solid var(--border);font-size:10px;' + bg + 'align-items:center;">';
    html += '<span style="color:var(--text-muted);font-size:9px;">' + (idx + 1) + '</span>';
    html += '<span style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + t.ticker + '</span>';
    html += '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + t.price.toFixed(2) + '</span>';
    html += '<span style="font-weight:700;color:' + pct20Color + ';font-family:\'JetBrains Mono\',monospace;">' + (t.pct20d >= 0 ? '+' : '') + t.pct20d + '%</span>';
    html += '<span style="font-weight:700;color:' + pct50Color + ';font-family:\'JetBrains Mono\',monospace;">' + (t.pct50d >= 0 ? '+' : '') + (t.pct50d || 0) + '%</span>';
    html += '<span style="font-size:9px;color:var(--text-muted);">' + t.distFromHigh + '% off</span>';
    html += '<span style="font-size:9px;color:' + (t.aboveSMAs === '3/3' ? 'var(--green)' : 'var(--text-muted)') + ';">' + t.aboveSMAs + '</span>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}


// ==================== UI ACTIONS ====================

async function refreshMomentumUI() {
  var btn = document.getElementById('refresh-universe-btn');
  var status = document.getElementById('scanner-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Building...'; }

  try {
    await buildMomentumUniverse(function(msg) {
      if (status) status.textContent = msg;
    });
    renderScanner();
  } catch(e) {
    if (status) status.innerHTML = '<span style="color:var(--red);">Error: ' + e.message + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh Top 100'; }
}

async function runScanUI() {
  var btn = document.getElementById('run-scan-btn');
  var status = document.getElementById('scanner-status');
  var resultsEl = document.getElementById('scan-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }

  // Auto-refresh universe if stale
  if (!isMomentumCacheFresh()) {
    try {
      await buildMomentumUniverse(function(msg) {
        if (status) status.textContent = 'Building universe: ' + msg;
      });
    } catch(e) {
      if (status) status.innerHTML = '<span style="color:var(--red);">Failed to build universe: ' + e.message + '</span>';
      if (btn) { btn.disabled = false; btn.textContent = 'Scan for Setups'; }
      return;
    }
  }

  try {
    var results = await runBreakoutScan(function(msg) {
      if (status) status.textContent = msg;
    });
    if (resultsEl) resultsEl.innerHTML = renderScanResults(results);
    // Also refresh the full scanner to update top 100 list
    var cache = getMomentumCache();
    if (cache) {
      var cacheDate = new Date(cache.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      if (status) status.textContent = 'Found ' + results.setups.length + ' setups · Top 100 from ' + cacheDate;
    }
  } catch(e) {
    if (status) status.innerHTML = '<span style="color:var(--red);">Scan error: ' + e.message + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Scan for Setups'; }
}

function toggleTop100() {
  var body = document.getElementById('top100-body'), arrow = document.getElementById('top100-arrow');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (arrow) arrow.textContent = hidden ? '▼' : '▶';
  try { localStorage.setItem('mac_top100_collapsed', hidden ? 'false' : 'true'); } catch(e) {}
}


// ==================== AUTO-REFRESH ON PAGE LOAD ====================
// If momentum cache is stale, auto-refresh in background
(function() {
  if (!isMomentumCacheFresh()) {
    // Delay to let the page load first
    setTimeout(function() {
      buildMomentumUniverse(function() {}).catch(function() {});
    }, 5000);
  }
})();
