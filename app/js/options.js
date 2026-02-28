// ==================== options.js ====================
// Option Selling tab: IV scanner, options chain viewer, spread builder,
// ticker management, HV calculation, renderOptionsTab.

// --- Ticker list management ---
function getOptTickers() {
  try { return JSON.parse(localStorage.getItem('mcc_opt_tickers') || '[]'); } catch(e) { return []; }
}
function saveOptTickers(list) {
  try { localStorage.setItem('mcc_opt_tickers', JSON.stringify(list)); } catch(e) {}
}
function addOptTicker() {
  var input = document.getElementById('opt-ticker-input');
  if (!input) return;
  var t = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return;
  var list = getOptTickers();
  if (list.indexOf(t) === -1) list.push(t);
  saveOptTickers(list);
  input.value = '';
  renderOptTags();
}
function removeOptTicker(t) {
  var list = getOptTickers().filter(function(x) { return x !== t; });
  saveOptTickers(list);
  renderOptTags();
}
function clearOptTickers() {
  saveOptTickers([]);
  renderOptTags();
  document.getElementById('opt-results').innerHTML = '';
  document.getElementById('opt-spread-builder').innerHTML = '';
}
function loadOptPreset(preset) {
  var presets = {
    mega: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','JPM','V'],
    semis: ['NVDA','AMD','AVGO','MRVL','QCOM','MU','INTC','AMAT','LRCX','KLAC'],
    earnings: ['NVDA','MSFT','AAPL','GOOGL','AMZN','META','TSLA','CRM','SNOW','PLTR'],
    etfs: ['SPY','QQQ','IWM','XLK','XLF','XLE','XLV','SMH','GLD','TLT']
  };
  var list = presets[preset] || [];
  saveOptTickers(list);
  renderOptTags();
}
function renderOptTags() {
  var el = document.getElementById('opt-ticker-tags');
  if (!el) return;
  var list = getOptTickers();
  if (list.length === 0) { el.innerHTML = '<span style="font-size:10px;color:var(--text-muted);">No tickers added. Use presets or add manually above.</span>'; return; }
  var html = '';
  list.forEach(function(t) {
    html += '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--purple-bg);color:var(--purple);padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:\'JetBrains Mono\',monospace;">' + t +
      '<span onclick="removeOptTicker(\'' + t + '\')" style="cursor:pointer;font-size:13px;color:var(--text-muted);line-height:1;">×</span></span>';
  });
  el.innerHTML = html;
}

// --- IV Calculation Engine ---
// Calculate Historical Volatility (HV) from daily bars (annualized, close-to-close)
function calcHV(bars, period) {
  if (!bars || bars.length < period + 1) return null;
  var slice = bars.slice(-(period + 1));
  var logReturns = [];
  for (var i = 1; i < slice.length; i++) {
    if (slice[i-1].c > 0 && slice[i].c > 0) {
      logReturns.push(Math.log(slice[i].c / slice[i-1].c));
    }
  }
  if (logReturns.length < period * 0.8) return null;
  var mean = logReturns.reduce(function(a, b) { return a + b; }, 0) / logReturns.length;
  var variance = logReturns.reduce(function(a, r) { return a + Math.pow(r - mean, 2); }, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100; // annualized %
}

// Estimate IV from option data or approximate from HV + premium
// For Polygon free tier we approximate IV using HV with adjustments
function estimateIV(bars, currentPrice) {
  if (!bars || bars.length < 30) return null;

  // Current HV (20-day)
  var hv20 = calcHV(bars, 20);
  var hv50 = calcHV(bars, 50);
  var hv10 = calcHV(bars, 10);

  if (!hv20) return null;

  // IV typically trades at a premium to HV (the "variance risk premium")
  // Estimate: IV ≈ HV20 * 1.1 to 1.3 depending on recent vol dynamics
  var hvRatio = hv10 && hv50 ? hv10 / hv50 : 1;
  var vrpMultiplier = 1.15; // base variance risk premium

  // If short-term vol is spiking relative to long-term, IV is likely higher
  if (hvRatio > 1.3) vrpMultiplier = 1.35;
  else if (hvRatio > 1.1) vrpMultiplier = 1.25;
  else if (hvRatio < 0.8) vrpMultiplier = 1.08;

  var estimatedIV = hv20 * vrpMultiplier;

  return {
    iv: estimatedIV,
    hv20: hv20,
    hv50: hv50,
    hv10: hv10,
    vrp: ((estimatedIV / hv20) - 1) * 100
  };
}

// Calculate IV Rank (52-week range)
function calcIVRank(currentIV, ivHistory) {
  if (!ivHistory || ivHistory.length < 20) return null;
  var max52 = Math.max.apply(null, ivHistory);
  var min52 = Math.min.apply(null, ivHistory);
  if (max52 === min52) return 50;
  return ((currentIV - min52) / (max52 - min52)) * 100;
}

// Calculate IV Percentile (% of days below current)
function calcIVPercentile(currentIV, ivHistory) {
  if (!ivHistory || ivHistory.length < 20) return null;
  var below = ivHistory.filter(function(v) { return v < currentIV; }).length;
  return (below / ivHistory.length) * 100;
}

// Build rolling IV history from daily bars (using rolling 20-day HV as proxy)
function buildIVHistory(bars) {
  if (!bars || bars.length < 30) return [];
  var history = [];
  for (var i = 25; i < bars.length; i++) {
    var slice = bars.slice(0, i + 1);
    var hv = calcHV(slice, 20);
    if (hv !== null) {
      // Apply approximate VRP to get IV estimate
      history.push(hv * 1.15);
    }
  }
  return history;
}

// Estimate expected move from IV
function expectedMove(price, iv, dte) {
  return price * (iv / 100) * Math.sqrt(dte / 365);
}

// Signal quality for selling
function sellSignal(ivRank, ivPct) {
  if (ivRank === null || ivPct === null) return { label: 'N/A', color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.1)', score: 0 };
  var score = (ivRank * 0.5 + ivPct * 0.5);
  if (score >= 65) return { label: '● SELL', color: 'var(--green)', bg: 'var(--green-bg)', score: score };
  if (score >= 45) return { label: '● NEUTRAL', color: 'var(--amber)', bg: 'var(--amber-bg)', score: score };
  return { label: '● AVOID', color: 'var(--red)', bg: 'var(--red-bg)', score: score };
}

// --- Main Scanner ---
var _optCache = {};
async function scanOptionsAll() {
  var tickers = getOptTickers();
  if (tickers.length === 0) {
    document.getElementById('opt-results').innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Add tickers above and click Scan to analyze IV conditions.</div>';
    return;
  }

  var btn = document.getElementById('opt-scan-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Scanning ' + tickers.length + ' tickers...'; }

  var results = [];
  var snap = {};
  try { snap = await getSnapshots(tickers); } catch(e) {}

  for (var i = 0; i < tickers.length; i++) {
    var t = tickers[i];
    try {
      // Get 1 year of daily bars for IV history
      var bars = await getDailyBars(t, 260);
      var s = snap[t];
      var currentPrice = s ? (s.day?.c || s.lastTrade?.p || 0) : (bars.length > 0 ? bars[bars.length-1].c : 0);
      var prev = s ? (s.prevDay?.c || currentPrice) : (bars.length > 1 ? bars[bars.length-2].c : currentPrice);
      var dayChg = prev > 0 ? ((currentPrice - prev) / prev) * 100 : 0;

      var ivData = estimateIV(bars, currentPrice);
      var ivHistory = buildIVHistory(bars);
      var ivRank = ivData ? calcIVRank(ivData.iv, ivHistory) : null;
      var ivPct = ivData ? calcIVPercentile(ivData.iv, ivHistory) : null;
      var signal = sellSignal(ivRank, ivPct);

      // 20-day ATR for support levels
      var atr = null;
      if (bars.length >= 20) {
        var atrSlice = bars.slice(-20);
        var trSum = 0;
        for (var j = 1; j < atrSlice.length; j++) {
          var hi = atrSlice[j].h, lo = atrSlice[j].l, pc = atrSlice[j-1].c;
          trSum += Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
        }
        atr = trSum / (atrSlice.length - 1);
      }

      // Volume analysis
      var todayVol = s ? (s.day?.v || 0) : 0;
      var avg20Vol = 0;
      if (bars.length >= 20) {
        avg20Vol = bars.slice(-20).reduce(function(a, b) { return a + b.v; }, 0) / 20;
      }

      // SMA levels
      var sma10 = bars.length >= 10 ? bars.slice(-10).reduce(function(a, b) { return a + b.c; }, 0) / 10 : null;
      var sma21 = bars.length >= 21 ? bars.slice(-21).reduce(function(a, b) { return a + b.c; }, 0) / 21 : null;
      var sma50 = bars.length >= 50 ? bars.slice(-50).reduce(function(a, b) { return a + b.c; }, 0) / 50 : null;

      // Expected moves
      var em7 = ivData ? expectedMove(currentPrice, ivData.iv, 7) : null;
      var em30 = ivData ? expectedMove(currentPrice, ivData.iv, 30) : null;

      // IV sparkline data (last 60 data points)
      var ivSparkData = ivHistory.slice(-60);

      results.push({
        ticker: t, price: currentPrice, dayChg: dayChg,
        iv: ivData ? ivData.iv : null, hv20: ivData ? ivData.hv20 : null, hv50: ivData ? ivData.hv50 : null,
        hv10: ivData ? ivData.hv10 : null, vrp: ivData ? ivData.vrp : null,
        ivRank: ivRank, ivPct: ivPct, signal: signal,
        atr: atr, sma10: sma10, sma21: sma21, sma50: sma50,
        em7: em7, em30: em30, ivSparkData: ivSparkData,
        todayVol: todayVol, avg20Vol: avg20Vol
      });

      _optCache[t] = results[results.length - 1];

    } catch(e) {
      results.push({ ticker: t, price: 0, dayChg: 0, iv: null, hv20: null, ivRank: null, ivPct: null, signal: sellSignal(null, null), error: e.message });
    }
  }

  // Sort by sell signal score descending
  results.sort(function(a, b) { return b.signal.score - a.signal.score; });

  renderOptResults(results);
  renderSpreadBuilder(results.length > 0 ? results[0] : null);
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Scan All Tickers'; }
}

function renderOptResults(results) {
  var el = document.getElementById('opt-results');
  if (!el) return;
  var ts = getTimestamp();

  // Summary stats
  var sellCount = results.filter(function(r) { return r.signal.label.includes('SELL'); }).length;
  var avgIVR = 0, ivCount = 0;
  results.forEach(function(r) { if (r.ivRank !== null) { avgIVR += r.ivRank; ivCount++; } });
  avgIVR = ivCount > 0 ? avgIVR / ivCount : 0;

  var html = '';

  // Summary bar
  html += '<div class="grid-4" style="margin-bottom:16px;">';
  html += '<div class="card card-hue-purple" style="padding:14px;text-align:center;"><div class="rv-stat-label">TICKERS SCANNED</div><div class="rv-stat-value mono" style="color:var(--purple);">' + results.length + '</div></div>';
  html += '<div class="card card-hue-green" style="padding:14px;text-align:center;"><div class="rv-stat-label">SELL SIGNALS</div><div class="rv-stat-value mono" style="color:var(--green);">' + sellCount + '</div></div>';
  html += '<div class="card card-hue-blue" style="padding:14px;text-align:center;"><div class="rv-stat-label">AVG IV RANK</div><div class="rv-stat-value mono" style="color:var(--blue);">' + avgIVR.toFixed(0) + '</div></div>';
  html += '<div class="card card-hue-amber" style="padding:14px;text-align:center;"><div class="rv-stat-label">MARKET REGIME</div><div class="rv-stat-value" style="font-size:14px;color:var(--amber);">' + (avgIVR > 55 ? 'HIGH VOL' : avgIVR > 35 ? 'NORMAL' : 'LOW VOL') + '</div></div>';
  html += '</div>';

  // Results table
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">IV Scanner Results</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">' + tsLabel(ts) + ' · Sorted by sell signal strength · Source: Polygon.io (HV-derived IV estimates)</div>';
  html += '</div>';

  // Table header
  html += '<div style="display:grid;grid-template-columns:60px 70px 65px 70px 65px 65px 65px 70px 100px 1fr 80px;padding:8px 12px;background:var(--bg-secondary);border-bottom:2px solid var(--border);font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;align-items:center;">';
  html += '<div>Ticker</div><div style="text-align:right;">Price</div><div style="text-align:right;">Day %</div><div style="text-align:right;">Est. IV</div><div style="text-align:right;">HV 20</div><div style="text-align:right;">IV Rank</div><div style="text-align:right;">IV Pctl</div><div style="text-align:right;">Exp Move 7d</div><div style="text-align:center;">IV Trend (60d)</div><div>Support</div><div style="text-align:center;">Signal</div>';
  html += '</div>';

  results.forEach(function(r) {
    var ivColor = r.ivRank !== null ? (r.ivRank > 60 ? 'var(--green)' : r.ivRank > 40 ? 'var(--amber)' : 'var(--red)') : 'var(--text-muted)';

    // IV sparkline
    var sparkSvg = '';
    if (r.ivSparkData && r.ivSparkData.length > 5) {
      var w = 90, h = 22;
      var mn = Math.min.apply(null, r.ivSparkData);
      var mx = Math.max.apply(null, r.ivSparkData);
      var rng = mx - mn || 1;
      var pts = r.ivSparkData.map(function(v, idx) {
        return (idx / (r.ivSparkData.length - 1)) * w + ',' + (h - 1 - ((v - mn) / rng) * (h - 2));
      }).join(' ');
      // Current IV line
      var curY = r.iv ? (h - 1 - ((r.iv - mn) / rng) * (h - 2)) : h/2;
      sparkSvg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<line x1="0" y1="' + curY + '" x2="' + w + '" y2="' + curY + '" stroke="var(--purple)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5"/>' +
        '<polyline points="' + pts + '" fill="none" stroke="var(--purple)" stroke-width="1.5" />' +
        '<circle cx="' + w + '" cy="' + (r.ivSparkData.length > 0 ? (h - 1 - ((r.ivSparkData[r.ivSparkData.length-1] - mn) / rng) * (h - 2)) : h/2) + '" r="2" fill="var(--purple)" />' +
        '</svg>';
    }

    // Support levels string
    var supportStr = '';
    if (r.sma21) supportStr += '<span style="font-size:8px;">21EMA:$' + r.sma21.toFixed(1) + '</span> ';
    if (r.sma50) supportStr += '<span style="font-size:8px;">50SMA:$' + r.sma50.toFixed(1) + '</span>';

    // IV Rank bar
    var ivRankBar = '';
    if (r.ivRank !== null) {
      ivRankBar = '<div style="width:100%;height:4px;background:var(--bg-primary);border-radius:2px;margin-top:2px;"><div style="width:' + Math.min(100, r.ivRank).toFixed(0) + '%;height:100%;background:' + ivColor + ';border-radius:2px;"></div></div>';
    }

    html += '<div style="display:grid;grid-template-columns:60px 70px 65px 70px 65px 65px 65px 70px 100px 1fr 80px;padding:10px 12px;border-bottom:1px solid var(--border);align-items:center;transition:background 0.15s;cursor:pointer;" onmouseover="this.style.background=\'var(--bg-card-hover)\'" onmouseout="this.style.background=\'transparent\'" onclick="renderSpreadBuilder(_optCache[\'' + r.ticker + '\'])">';

    // Ticker
    html += '<div style="font-weight:800;font-size:13px;font-family:\'JetBrains Mono\',monospace;">' + r.ticker + '</div>';
    // Price
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:600;">$' + (r.price > 0 ? r.price.toFixed(2) : '—') + '</div>';
    // Day change
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;color:' + (r.dayChg >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + (r.dayChg >= 0 ? '+' : '') + r.dayChg.toFixed(2) + '%</div>';
    // Est IV
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:var(--purple);">' + (r.iv !== null ? r.iv.toFixed(1) + '%' : '—') + '</div>';
    // HV 20
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--text-secondary);">' + (r.hv20 !== null ? r.hv20.toFixed(1) + '%' : '—') + '</div>';
    // IV Rank
    html += '<div style="text-align:right;"><span style="font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:' + ivColor + ';">' + (r.ivRank !== null ? r.ivRank.toFixed(0) : '—') + '</span>' + ivRankBar + '</div>';
    // IV Percentile
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:600;color:' + (r.ivPct !== null ? (r.ivPct > 60 ? 'var(--green)' : r.ivPct > 40 ? 'var(--amber)' : 'var(--red)') : 'var(--text-muted)') + ';">' + (r.ivPct !== null ? r.ivPct.toFixed(0) + '%' : '—') + '</div>';
    // Expected Move 7d
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--text-secondary);">' + (r.em7 !== null ? '±$' + r.em7.toFixed(2) : '—') + '</div>';
    // IV Sparkline
    html += '<div style="text-align:center;">' + sparkSvg + '</div>';
    // Support
    html += '<div style="font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">' + supportStr + '</div>';
    // Signal
    html += '<div style="text-align:center;"><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;background:' + r.signal.bg + ';color:' + r.signal.color + ';">' + r.signal.label + '</span></div>';

    html += '</div>';
  });

  html += '<div style="padding:8px 12px;font-size:8px;color:var(--text-muted);border-top:1px solid var(--border);">Note: IV estimates are derived from Historical Volatility (HV) with Variance Risk Premium adjustments. For exact IV, use your broker\'s options chain. Click any row to open the Put Spread Builder.</div>';
  html += '</div>';

  el.innerHTML = html;
}

// --- Put Spread Builder ---
function renderSpreadBuilder(data) {
  var el = document.getElementById('opt-spread-builder');
  if (!el || !data || !data.ticker) return;

  var r = data;
  var acct = getAccountSize();
  var riskPctVal = getRiskPct() / 100;
  var maxRisk = acct * riskPctVal;

  // Suggest short strike at 1 ATR below price (rounded to nearest $2.50 or $5)
  var suggestedShort = r.price;
  if (r.atr) {
    suggestedShort = r.price - r.atr * 1.2;
  } else if (r.sma21) {
    suggestedShort = Math.min(r.sma21, r.price * 0.97);
  } else {
    suggestedShort = r.price * 0.97;
  }

  // Round to nearest $2.50 or $5 depending on price
  var strikeIncrement = r.price > 100 ? 5 : 2.5;
  suggestedShort = Math.floor(suggestedShort / strikeIncrement) * strikeIncrement;

  var spreadWidth = r.price > 200 ? 10 : r.price > 100 ? 5 : 2.5;
  var suggestedLong = suggestedShort - spreadWidth;

  // Estimate credit (very rough: ~30-40% of spread width for ATM-ish, less for OTM)
  var otmPct = r.price > 0 ? ((r.price - suggestedShort) / r.price) * 100 : 0;
  var creditPct = 0.35;
  if (otmPct > 5) creditPct = 0.15;
  else if (otmPct > 3) creditPct = 0.22;
  else if (otmPct > 1) creditPct = 0.30;
  var estCredit = spreadWidth * creditPct;
  var estMaxLoss = spreadWidth - estCredit;
  var contracts = Math.floor(maxRisk / (estMaxLoss * 100));
  if (contracts < 1) contracts = 1;

  var totalCredit = estCredit * contracts * 100;
  var totalMaxLoss = estMaxLoss * contracts * 100;
  var breakeven = suggestedShort - estCredit;

  // Distance from current price
  var distPct = r.price > 0 ? ((r.price - suggestedShort) / r.price * 100) : 0;

  var html = '<div class="card" style="padding:0;overflow:hidden;border-top:3px solid var(--purple);">';
  html += '<div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;">🔧 Put Spread Builder</span><span style="font-family:\'JetBrains Mono\',monospace;font-size:16px;font-weight:800;color:var(--purple);">' + r.ticker + '</span><span style="font-size:11px;color:var(--text-muted);">@ $' + r.price.toFixed(2) + '</span></div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">Click any ticker in the scanner to load it here</div>';
  html += '</div>';

  html += '<div style="padding:16px;">';

  // Strike inputs
  html += '<div class="grid-4" style="gap:12px;margin-bottom:16px;">';

  html += '<div>';
  html += '<label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:4px;">Short Strike</label>';
  html += '<input type="number" id="opt-short-strike" value="' + suggestedShort.toFixed(1) + '" step="' + strikeIncrement + '" onchange="recalcSpread()" style="width:100%;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:14px;font-weight:700;color:var(--red);" />';
  html += '<div style="font-size:8px;color:var(--text-muted);margin-top:2px;">' + distPct.toFixed(1) + '% OTM</div>';
  html += '</div>';

  html += '<div>';
  html += '<label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:4px;">Long Strike</label>';
  html += '<input type="number" id="opt-long-strike" value="' + suggestedLong.toFixed(1) + '" step="' + strikeIncrement + '" onchange="recalcSpread()" style="width:100%;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:14px;font-weight:700;color:var(--green);" />';
  html += '</div>';

  html += '<div>';
  html += '<label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:4px;">Est. Credit/Spread</label>';
  html += '<input type="number" id="opt-credit" value="' + estCredit.toFixed(2) + '" step="0.05" onchange="recalcSpread()" style="width:100%;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:14px;font-weight:700;color:var(--purple);" />';
  html += '</div>';

  html += '<div>';
  html += '<label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:4px;">Contracts</label>';
  html += '<input type="number" id="opt-contracts" value="' + contracts + '" min="1" max="100" onchange="recalcSpread()" style="width:100%;background:var(--bg-primary);border:1px solid var(--border);border-radius:5px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:14px;font-weight:700;color:var(--text-primary);" />';
  html += '</div>';

  html += '</div>';

  // Results grid
  html += '<div id="opt-spread-results">';
  html += buildSpreadResultsHTML(suggestedShort, suggestedLong, estCredit, contracts, r.price, acct);
  html += '</div>';

  html += '</div></div>';

  el.innerHTML = html;
}

function buildSpreadResultsHTML(shortStrike, longStrike, credit, contracts, currentPrice, acct) {
  var width = shortStrike - longStrike;
  var maxLoss = width - credit;
  var totalCredit = credit * contracts * 100;
  var totalMaxLoss = maxLoss * contracts * 100;
  var breakeven = shortStrike - credit;
  var ror = maxLoss > 0 ? (credit / maxLoss * 100) : 0;
  var pctAcct = acct > 0 ? (totalMaxLoss / acct * 100) : 0;
  var distPct = currentPrice > 0 ? ((currentPrice - shortStrike) / currentPrice * 100) : 0;

  var html = '<div class="grid-4" style="gap:8px;">';

  html += '<div style="background:var(--green-bg);border:1px solid var(--green)33;border-radius:8px;padding:12px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.1em;">Max Profit</div>';
  html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:800;color:var(--green);">+$' + totalCredit.toFixed(0) + '</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">$' + credit.toFixed(2) + ' × ' + contracts + ' × 100</div>';
  html += '</div>';

  html += '<div style="background:var(--red-bg);border:1px solid var(--red)33;border-radius:8px;padding:12px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.1em;">Max Loss</div>';
  html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:800;color:var(--red);">-$' + totalMaxLoss.toFixed(0) + '</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">' + pctAcct.toFixed(1) + '% of account</div>';
  html += '</div>';

  html += '<div style="background:var(--blue-bg);border:1px solid var(--blue)33;border-radius:8px;padding:12px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.1em;">Return on Risk</div>';
  html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:800;color:var(--blue);">' + ror.toFixed(0) + '%</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">Target: ≥33%</div>';
  html += '</div>';

  html += '<div style="background:var(--purple-bg);border:1px solid var(--purple)33;border-radius:8px;padding:12px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.1em;">Breakeven</div>';
  html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:800;color:var(--purple);">$' + breakeven.toFixed(2) + '</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">' + distPct.toFixed(1) + '% below price</div>';
  html += '</div>';

  html += '</div>';

  // Visual P&L diagram
  html += '<div style="margin-top:12px;padding:10px;background:var(--bg-primary);border-radius:8px;border:1px solid var(--border);">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">P&L at Expiration</div>';

  // Simple visual
  var totalWidth = 100;
  var profitZonePct = currentPrice > 0 ? Math.min(85, Math.max(15, (1 - longStrike / currentPrice) * 200)) : 50;

  html += '<div style="display:flex;height:32px;border-radius:4px;overflow:hidden;font-size:9px;font-weight:700;font-family:\'JetBrains Mono\',monospace;">';
  html += '<div style="width:15%;background:var(--red);color:#fff;display:flex;align-items:center;justify-content:center;">MAX LOSS</div>';
  html += '<div style="width:10%;background:linear-gradient(90deg,var(--red),var(--green));display:flex;align-items:center;justify-content:center;color:#fff;font-size:7px;">B/E</div>';
  html += '<div style="flex:1;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;">MAX PROFIT +$' + totalCredit.toFixed(0) + '</div>';
  html += '</div>';

  html += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;margin-top:4px;">';
  html += '<span>$' + longStrike.toFixed(0) + ' (long)</span>';
  html += '<span>$' + breakeven.toFixed(2) + ' (B/E)</span>';
  html += '<span>$' + shortStrike.toFixed(0) + ' (short)</span>';
  html += '<span style="font-weight:700;color:var(--text-primary);">$' + currentPrice.toFixed(2) + ' (now)</span>';
  html += '</div>';

  html += '</div>';

  return html;
}

function recalcSpread() {
  var shortStrike = parseFloat(document.getElementById('opt-short-strike').value) || 0;
  var longStrike = parseFloat(document.getElementById('opt-long-strike').value) || 0;
  var credit = parseFloat(document.getElementById('opt-credit').value) || 0;
  var contracts = parseInt(document.getElementById('opt-contracts').value) || 1;
  var acct = getAccountSize();

  // Find current price from the last loaded ticker
  var currentPrice = 0;
  var resultEl = document.getElementById('opt-spread-results');
  // Try to get from _optCache
  for (var t in _optCache) {
    if (_optCache[t] && _optCache[t].price > 0) { currentPrice = _optCache[t].price; break; }
  }

  var el = document.getElementById('opt-spread-results');
  if (el) {
    el.innerHTML = buildSpreadResultsHTML(shortStrike, longStrike, credit, contracts, currentPrice, acct);
  }
}

// ==================== OPTION SELLING TAB ====================
const IV_SCAN_WATCHLIST = [
  // ── Index & Sector ETFs (highest options volume in the market) ──
  { ticker: 'SPY', name: 'S&P 500 ETF', sector: 'Index' },
  { ticker: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Index' },
  { ticker: 'IWM', name: 'Russell 2000 ETF', sector: 'Index' },
  { ticker: 'DIA', name: 'Dow Jones ETF', sector: 'Index' },
  { ticker: 'XLF', name: 'Financials ETF', sector: 'Financials' },
  { ticker: 'XLE', name: 'Energy ETF', sector: 'Energy' },
  { ticker: 'XLK', name: 'Technology ETF', sector: 'Tech' },
  { ticker: 'XLV', name: 'Healthcare ETF', sector: 'Healthcare' },
  { ticker: 'XLI', name: 'Industrials ETF', sector: 'Industrials' },
  { ticker: 'SMH', name: 'Semiconductor ETF', sector: 'Semis' },
  { ticker: 'GLD', name: 'Gold ETF', sector: 'Commodities' },
  { ticker: 'SLV', name: 'Silver ETF', sector: 'Commodities' },
  { ticker: 'TLT', name: '20+ Year Treasury ETF', sector: 'Bonds' },
  { ticker: 'HYG', name: 'High Yield Bond ETF', sector: 'Bonds' },
  { ticker: 'EEM', name: 'Emerging Markets ETF', sector: 'International' },
  { ticker: 'ARKK', name: 'ARK Innovation ETF', sector: 'Growth' },
  // ── Mag 7 + Mega Caps ──
  { ticker: 'AAPL', name: 'Apple', sector: 'Tech' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Tech' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Semis' },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Tech' },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Consumer' },
  { ticker: 'TSLA', name: 'Tesla', sector: 'Auto' },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Tech' },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'Semis' },
  { ticker: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Financials' },
  // ── Semis (massive options flow) ──
  { ticker: 'AMD', name: 'AMD', sector: 'Semis' },
  { ticker: 'MU', name: 'Micron', sector: 'Semis' },
  { ticker: 'INTC', name: 'Intel', sector: 'Semis' },
  { ticker: 'QCOM', name: 'Qualcomm', sector: 'Semis' },
  { ticker: 'AMAT', name: 'Applied Materials', sector: 'Semis' },
  { ticker: 'LRCX', name: 'Lam Research', sector: 'Semis' },
  { ticker: 'MRVL', name: 'Marvell', sector: 'Semis' },
  { ticker: 'ARM', name: 'ARM Holdings', sector: 'Semis' },
  { ticker: 'TSM', name: 'TSMC', sector: 'Semis' },
  { ticker: 'ON', name: 'ON Semi', sector: 'Semis' },
  // ── High-Volume Tech / Software ──
  { ticker: 'NFLX', name: 'Netflix', sector: 'Media' },
  { ticker: 'CRM', name: 'Salesforce', sector: 'Tech' },
  { ticker: 'ORCL', name: 'Oracle', sector: 'Tech' },
  { ticker: 'ADBE', name: 'Adobe', sector: 'Tech' },
  { ticker: 'NOW', name: 'ServiceNow', sector: 'Tech' },
  { ticker: 'PLTR', name: 'Palantir', sector: 'Tech' },
  { ticker: 'SMCI', name: 'Super Micro', sector: 'Tech' },
  { ticker: 'PANW', name: 'Palo Alto', sector: 'Cyber' },
  { ticker: 'CRWD', name: 'CrowdStrike', sector: 'Cyber' },
  { ticker: 'SNOW', name: 'Snowflake', sector: 'Tech' },
  { ticker: 'NET', name: 'Cloudflare', sector: 'Tech' },
  { ticker: 'SHOP', name: 'Shopify', sector: 'Tech' },
  { ticker: 'UBER', name: 'Uber', sector: 'Tech' },
  { ticker: 'SQ', name: 'Block', sector: 'Fintech' },
  { ticker: 'APP', name: 'AppLovin', sector: 'Tech' },
  { ticker: 'RKLB', name: 'Rocket Lab', sector: 'Aerospace' },
  // ── Financials (deep options markets) ──
  { ticker: 'JPM', name: 'JP Morgan', sector: 'Financials' },
  { ticker: 'GS', name: 'Goldman Sachs', sector: 'Financials' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'Financials' },
  { ticker: 'C', name: 'Citigroup', sector: 'Financials' },
  { ticker: 'WFC', name: 'Wells Fargo', sector: 'Financials' },
  { ticker: 'MS', name: 'Morgan Stanley', sector: 'Financials' },
  { ticker: 'SCHW', name: 'Charles Schwab', sector: 'Financials' },
  { ticker: 'COF', name: 'Capital One', sector: 'Financials' },
  { ticker: 'V', name: 'Visa', sector: 'Financials' },
  { ticker: 'MA', name: 'Mastercard', sector: 'Financials' },
  { ticker: 'PYPL', name: 'PayPal', sector: 'Fintech' },
  { ticker: 'SOFI', name: 'SoFi', sector: 'Fintech' },
  // ── Consumer / Retail (your tariff plays) ──
  { ticker: 'NKE', name: 'Nike', sector: 'Consumer' },
  { ticker: 'LULU', name: 'Lululemon', sector: 'Consumer' },
  { ticker: 'DECK', name: 'Deckers', sector: 'Consumer' },
  { ticker: 'TGT', name: 'Target', sector: 'Retail' },
  { ticker: 'WMT', name: 'Walmart', sector: 'Retail' },
  { ticker: 'COST', name: 'Costco', sector: 'Retail' },
  { ticker: 'HD', name: 'Home Depot', sector: 'Retail' },
  { ticker: 'LOW', name: 'Lowes', sector: 'Retail' },
  { ticker: 'SBUX', name: 'Starbucks', sector: 'Consumer' },
  { ticker: 'MCD', name: 'McDonalds', sector: 'Consumer' },
  { ticker: 'CMG', name: 'Chipotle', sector: 'Consumer' },
  // ── Energy / Commodities (Iran hedge plays) ──
  { ticker: 'XOM', name: 'ExxonMobil', sector: 'Energy' },
  { ticker: 'CVX', name: 'Chevron', sector: 'Energy' },
  { ticker: 'OXY', name: 'Occidental', sector: 'Energy' },
  { ticker: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  { ticker: 'SLB', name: 'Schlumberger', sector: 'Energy' },
  { ticker: 'HAL', name: 'Halliburton', sector: 'Energy' },
  // ── Miners (precious metals plays) ──
  { ticker: 'FSM', name: 'Fortuna Mining', sector: 'Mining' },
  { ticker: 'AG', name: 'First Majestic', sector: 'Mining' },
  { ticker: 'PAAS', name: 'Pan American Silver', sector: 'Mining' },
  { ticker: 'WPM', name: 'Wheaton Precious', sector: 'Mining' },
  { ticker: 'NEM', name: 'Newmont', sector: 'Mining' },
  { ticker: 'FCX', name: 'Freeport-McMoRan', sector: 'Mining' },
  // ── Healthcare / Biotech (high IV names) ──
  { ticker: 'UNH', name: 'UnitedHealth', sector: 'Healthcare' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { ticker: 'PFE', name: 'Pfizer', sector: 'Healthcare' },
  { ticker: 'MRNA', name: 'Moderna', sector: 'Biotech' },
  { ticker: 'ABBV', name: 'AbbVie', sector: 'Healthcare' },
  { ticker: 'LLY', name: 'Eli Lilly', sector: 'Healthcare' },
  // ── Industrials / Defense ──
  { ticker: 'BA', name: 'Boeing', sector: 'Industrial' },
  { ticker: 'CAT', name: 'Caterpillar', sector: 'Industrial' },
  { ticker: 'DE', name: 'Deere', sector: 'Industrial' },
  { ticker: 'GE', name: 'GE Aerospace', sector: 'Industrial' },
  { ticker: 'RTX', name: 'RTX', sector: 'Defense' },
  { ticker: 'LMT', name: 'Lockheed Martin', sector: 'Defense' },
  // ── Media / Entertainment ──
  { ticker: 'DIS', name: 'Disney', sector: 'Media' },
  { ticker: 'ROKU', name: 'Roku', sector: 'Media' },
  { ticker: 'SPOT', name: 'Spotify', sector: 'Media' },
  { ticker: 'DKNG', name: 'DraftKings', sector: 'Gaming' },
  // ── Crypto-adjacent ──
  { ticker: 'COIN', name: 'Coinbase', sector: 'Crypto' },
  { ticker: 'MARA', name: 'Marathon Digital', sector: 'Crypto' },
  { ticker: 'MSTR', name: 'MicroStrategy', sector: 'Crypto' },
  { ticker: 'HOOD', name: 'Robinhood', sector: 'Crypto' },
  // ── High-IV / Meme-adjacent (premium rich) ──
  { ticker: 'GME', name: 'GameStop', sector: 'Retail' },
  { ticker: 'AMC', name: 'AMC Entertainment', sector: 'Media' },
  { ticker: 'RIVN', name: 'Rivian', sector: 'EV' },
  { ticker: 'LCID', name: 'Lucid Motors', sector: 'EV' },
  { ticker: 'NIO', name: 'NIO', sector: 'EV' },
  { ticker: 'SNAP', name: 'Snap', sector: 'Tech' },
  { ticker: 'PINS', name: 'Pinterest', sector: 'Tech' },
  // ── Travel / Leisure ──
  { ticker: 'DAL', name: 'Delta Airlines', sector: 'Travel' },
  { ticker: 'UAL', name: 'United Airlines', sector: 'Travel' },
  { ticker: 'ABNB', name: 'Airbnb', sector: 'Travel' },
  { ticker: 'BKNG', name: 'Booking Holdings', sector: 'Travel' },
  { ticker: 'RCL', name: 'Royal Caribbean', sector: 'Travel' },
  { ticker: 'WYNN', name: 'Wynn Resorts', sector: 'Gaming' },
];

// Persistent custom tickers for IV scanner
function getCustomIVTickers() {
  try { return JSON.parse(localStorage.getItem('mcc_iv_custom') || '[]'); } catch(e) { return []; }
}
function saveCustomIVTickers(list) {
  try { localStorage.setItem('mcc_iv_custom', JSON.stringify(list)); } catch(e) {}
}

// IV Rank calculation: (currentIV - 52wkLow) / (52wkHigh - 52wkLow) * 100
function calcIVRank(currentIV, low52, high52) {
  if (high52 <= low52 || !currentIV) return null;
  return Math.max(0, Math.min(100, ((currentIV - low52) / (high52 - low52)) * 100));
}

// IV Percentile: % of days in last year where IV was below current
function calcIVPercentile(currentIV, historicalIVs) {
  if (!historicalIVs || historicalIVs.length < 10) return null;
  const below = historicalIVs.filter(v => v < currentIV).length;
  return (below / historicalIVs.length) * 100;
}

function ivRankColor(rank) {
  if (rank === null || rank === undefined) return { color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.1)', label: 'N/A', cls: '' };
  if (rank >= 80) return { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', label: 'EXTREME', cls: 'iv-gauge-extreme' };
  if (rank >= 50) return { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: 'HIGH', cls: 'iv-gauge-high' };
  if (rank >= 25) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'MID', cls: 'iv-gauge-mid' };
  return { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'LOW', cls: 'iv-gauge-low' };
}

function premiumGrade(ivRank, ivPctile) {
  const avg = ((ivRank || 0) + (ivPctile || 0)) / 2;
  const score = Math.round(Math.min(100, Math.max(0, avg * 1.2))); // Scale 0-100
  let color, desc;
  if (score >= 80) { color = '#7c3aed'; desc = 'Premium rich — prime selling'; }
  else if (score >= 60) { color = '#ef4444'; desc = 'Elevated IV — good sells'; }
  else if (score >= 45) { color = '#f59e0b'; desc = 'Moderate — selective sells'; }
  else if (score >= 30) { color = '#f59e0b'; desc = 'Fair — needs catalyst'; }
  else if (score >= 15) { color = '#10b981'; desc = 'IV low — not ideal for selling'; }
  else { color = 'var(--text-muted)'; desc = 'IV crushed — avoid selling'; }
  return { grade: score, color, desc, label: score >= 80 ? 'PRIME' : score >= 60 ? 'ELEVATED' : score >= 45 ? 'MODERATE' : score >= 30 ? 'FAIR' : score >= 15 ? 'LOW' : 'DEAD' };
}

// Fetch IV data from Polygon options snapshot
async function fetchIVData(ticker) {
  try {
    // Get current stock price from snapshot
    const snap = await polyGet(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${ticker}`);
    const stockData = (snap.tickers || [])[0];
    const stockPrice = stockData ? stockData.day.c || stockData.prevDay.c : null;

    // Get options contracts — from today (0DTE) through 45 DTE
    const today = new Date();
    const target45 = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000);
    const fromDate = today.toISOString().split('T')[0];
    const toDate = target45.toISOString().split('T')[0];

    const chain = await polyGet(`/v3/snapshot/options/${ticker}?expiration_date.gte=${fromDate}&expiration_date.lte=${toDate}&limit=250`);
    const contracts = chain.results || [];

    if (!contracts.length || !stockPrice) {
      return { ticker, stockPrice, currentIV: null, ivRank: null, ivPctile: null, contracts: [], error: 'No options data' };
    }

    // Calculate average IV from near-ATM contracts
    const atmContracts = contracts.filter(c => {
      const strike = c.details?.strike_price;
      if (!strike || !stockPrice) return false;
      return Math.abs(strike - stockPrice) / stockPrice < 0.05; // within 5% of ATM
    });

    let avgIV = null;
    if (atmContracts.length > 0) {
      const ivs = atmContracts.map(c => c.implied_volatility).filter(v => v && v > 0 && v < 5);
      if (ivs.length > 0) avgIV = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    }

    // Fallback: use all contracts if no ATM found
    if (!avgIV && contracts.length > 0) {
      const ivs = contracts.map(c => c.implied_volatility).filter(v => v && v > 0 && v < 5);
      if (ivs.length > 0) avgIV = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    }

    // Estimate IV Rank using daily bars HV as proxy for historical range
    // Get daily bars for 252 days for HV calculation
    const bars = await getDailyBars(ticker, 252);
    let ivRank = null, ivPctile = null, hv20 = null, hv50 = null;
    if (bars.length > 20) {
      // Calculate historical volatilities at different windows
      const returns = [];
      for (let i = 1; i < bars.length; i++) {
        returns.push(Math.log(bars[i].c / bars[i-1].c));
      }
      // HV20
      if (returns.length >= 20) {
        const r20 = returns.slice(-20);
        const mean20 = r20.reduce((a,b) => a+b, 0) / r20.length;
        const var20 = r20.reduce((s, r) => s + (r - mean20) ** 2, 0) / (r20.length - 1);
        hv20 = Math.sqrt(var20 * 252);
      }
      // HV50
      if (returns.length >= 50) {
        const r50 = returns.slice(-50);
        const mean50 = r50.reduce((a,b) => a+b, 0) / r50.length;
        const var50 = r50.reduce((s, r) => s + (r - mean50) ** 2, 0) / (r50.length - 1);
        hv50 = Math.sqrt(var50 * 252);
      }

      // Rolling 20-day HV for each window to simulate IV history
      const hvHistory = [];
      for (let i = 20; i < returns.length; i++) {
        const window = returns.slice(i - 20, i);
        const m = window.reduce((a,b) => a+b, 0) / window.length;
        const v = window.reduce((s, r) => s + (r - m) ** 2, 0) / (window.length - 1);
        hvHistory.push(Math.sqrt(v * 252));
      }

      if (hvHistory.length > 0 && avgIV) {
        const hvMin = Math.min(...hvHistory);
        const hvMax = Math.max(...hvHistory);
        // IV Rank — but scale relative to HV range (IV is typically higher than HV)
        // Use a blended approach: compare IV to its expected range
        const ivEstLow = hvMin * 0.9;
        const ivEstHigh = hvMax * 1.5;
        ivRank = calcIVRank(avgIV, ivEstLow, ivEstHigh);
        // IV Percentile — how does current IV compare to HV history (approximation)
        ivPctile = calcIVPercentile(avgIV, hvHistory);
      }
    }

    // Get best put spreads to sell — OTM puts
    const putContracts = contracts.filter(c =>
      c.details?.contract_type === 'put' &&
      c.details?.strike_price < stockPrice &&
      c.implied_volatility > 0
    ).sort((a, b) => b.details.strike_price - a.details.strike_price);

    const callContracts = contracts.filter(c =>
      c.details?.contract_type === 'call' &&
      c.details?.strike_price > stockPrice &&
      c.implied_volatility > 0
    ).sort((a, b) => a.details.strike_price - b.details.strike_price);

    return {
      ticker, stockPrice, currentIV: avgIV, ivRank, ivPctile, hv20, hv50,
      putContracts: putContracts.slice(0, 8),
      callContracts: callContracts.slice(0, 8),
      allContracts: contracts,
      error: null
    };
  } catch (e) {
    return { ticker, stockPrice: null, currentIV: null, ivRank: null, ivPctile: null, contracts: [], error: e.message };
  }
}

// Main render
async function renderOptionsTab() {
  const container = document.getElementById('tab-options');
  const ts = getTimestamp();

  let html = '';

  // Header — matches other scanner tabs exactly
  html += '<div class="section-title"><span class="dot" style="background:var(--purple)"></span> Option Selling Command Center</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' + srcBadge('Polygon.io Options', true, 15) + '</div>';

  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:16px;padding:10px;background:linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(139,92,246,0.07) 100%);border:1px solid rgba(139,92,246,0.15);border-radius:8px;border-left:3px solid var(--purple);">';
  html += '<strong>Strategy:</strong> Scans IV Rank and IV Percentile across 119 liquid options names. Higher IV Rank = more premium to sell. Click any ticker to see live put/call chain with recommended spreads.<br>';
  html += '<details style="margin-top:6px;cursor:pointer;"><summary style="font-weight:700;color:var(--text-secondary);">How scoring works (click to expand)</summary>';
  html += '<div style="margin-top:6px;line-height:1.8;">';
  html += '<strong style="color:var(--purple);">IV Rank (40%)</strong> — (Current IV − 52w Low) / (52w High − 52w Low). Higher = options are expensive relative to history.<br>';
  html += '<strong style="color:var(--purple);">IV Percentile (40%)</strong> — % of past year where IV was lower than today. Higher = IV is elevated vs most of the year.<br>';
  html += '<strong style="color:var(--purple);">IV / HV Ratio (20%)</strong> — Implied vs realized volatility. IV > HV means options are overpriced — ideal for selling.';
  html += '</div></details></div>';

  // Scan button — same position as other scanner tabs
  html += '<div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">';
  html += '<button onclick="runIVScan();" style="padding:6px 18px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:11px;font-weight:700;font-family:\'Inter\',sans-serif;letter-spacing:0.5px;">SCAN</button>';
  html += '</div>';

  const customTickers = getCustomIVTickers();

  // Scanner results placeholder
  html += '<div id="iv-scanner-results" style="margin-bottom:20px;"></div>';

  // Detail panel placeholder (shows when you click a ticker)
  html += '<div id="iv-detail-panel" style="display:none;"></div>';

  container.innerHTML = html;

  // Don't auto-scan — wait for user to click Rescan IV
}

window._ivScanData = [];

async function runIVScan() {
  const customTickers = getCustomIVTickers();
  const allTickers = [...IV_SCAN_WATCHLIST, ...customTickers.map(t => ({ ticker: t, name: t, sector: 'Custom' }))];

  const results = [];
  const batchSize = 6;

  for (let i = 0; i < allTickers.length; i += batchSize) {
    const batch = allTickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => fetchIVData(t.ticker)));
    batchResults.forEach((r, idx) => {
      r.name = batch[idx].name;
      r.sector = batch[idx].sector;
      results.push(r);
    });
    // Update progress
    const pct = Math.min(100, Math.round(((i + batchSize) / allTickers.length) * 100));
    const el = document.getElementById('iv-scanner-results');
    if (el && i + batchSize < allTickers.length) {
      el.innerHTML = '<div class="card" style="padding:30px;text-align:center;">' +
        '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Scanning... ' + pct + '%</div>' +
        '<div style="width:100%;height:4px;background:var(--bg-primary);border-radius:2px;overflow:hidden;">' +
        '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--purple),var(--blue));border-radius:2px;transition:width 0.3s;"></div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">' + results.length + ' / ' + allTickers.length + ' tickers scanned</div>' +
        '</div>';
    }
    // Small delay between batches to avoid rate limits
    if (i + batchSize < allTickers.length) await new Promise(r => setTimeout(r, 200));
  }

  window._ivScanData = results;
  renderIVScannerResults(results);
}

function renderIVScannerResults(results) {
  const container = document.getElementById('iv-scanner-results');
  if (!container) return;

  // Summary stats
  const validResults = results.filter(r => r.currentIV !== null);
  const highIV = validResults.filter(r => (r.ivRank || 0) >= 50);
  const extremeIV = validResults.filter(r => (r.ivRank || 0) >= 80);
  const avgIVRank = validResults.length > 0 ? validResults.reduce((s, r) => s + (r.ivRank || 0), 0) / validResults.length : 0;

  // Best sell candidates (highest IV rank)
  const bestSells = [...validResults].sort((a, b) => (b.ivRank || 0) - (a.ivRank || 0)).slice(0, 3);

  let html = '';

  // Stats bar
  html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">';
  html += '<div class="options-stat-box"><div class="options-stat-label">Tickers Scanned</div><div class="options-stat-val" style="color:var(--blue);">' + validResults.length + '</div></div>';
  html += '<div class="options-stat-box"><div class="options-stat-label">Avg IV Rank</div><div class="options-stat-val" style="color:' + ivRankColor(avgIVRank).color + ';">' + avgIVRank.toFixed(0) + '</div></div>';
  html += '<div class="options-stat-box"><div class="options-stat-label">High IV (50+)</div><div class="options-stat-val" style="color:var(--red);">' + highIV.length + '</div></div>';
  html += '<div class="options-stat-box"><div class="options-stat-label">Extreme IV (80+)</div><div class="options-stat-val" style="color:var(--purple);">' + extremeIV.length + '</div></div>';
  html += '<div class="options-stat-box"><div class="options-stat-label">Errors</div><div class="options-stat-val" style="color:var(--text-muted);">' + results.filter(r => r.error).length + '</div></div>';
  html += '</div>';

  // Top Sell Candidates callout
  if (bestSells.length > 0 && bestSells[0].ivRank >= 40) {
    html += '<div class="card card-hue-purple" style="padding:14px 16px;margin-bottom:16px;border-left:3px solid var(--purple);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--purple);margin-bottom:10px;">TOP PREMIUM SELLING CANDIDATES</div>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
    bestSells.forEach(s => {
      const grade = premiumGrade(s.ivRank, s.ivPctile);
      html += '<div class="premium-card" onclick="showIVDetail(\'' + s.ticker + '\')" style="flex:1;min-width:200px;cursor:pointer;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
      html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:15px;font-weight:800;color:var(--text-primary);">' + s.ticker + '</span>';
      html += '<span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2.5px solid ' + grade.color + ';font-size:13px;font-weight:900;color:' + grade.color + ';font-family:\'JetBrains Mono\',monospace;">' + grade.grade + '</span>';
      html += '</div>';
      html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">' + (s.name || s.ticker) + ' · ' + (s.sector || '') + '</div>';
      html += '<div style="display:flex;gap:12px;font-size:11px;">';
      html += '<div><span style="color:var(--text-muted);">IV:</span> <span class="mono" style="font-weight:700;color:var(--text-primary);">' + (s.currentIV ? (s.currentIV * 100).toFixed(1) + '%' : 'N/A') + '</span></div>';
      html += '<div><span style="color:var(--text-muted);">Rank:</span> <span class="mono" style="font-weight:700;color:' + ivRankColor(s.ivRank).color + ';">' + (s.ivRank !== null ? s.ivRank.toFixed(0) : 'N/A') + '</span></div>';
      html += '</div>';
      html += '<div style="font-size:9px;color:' + grade.color + ';margin-top:6px;font-weight:600;">' + grade.desc + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // IV Scanner Grid
  html += '<div class="card" style="padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;">IV SCANNER</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">' + getTimestamp() + ' · Click row for detail</div>';
  html += '</div>';

  // Header
  html += '<div class="iv-scanner-grid header-row">';
  html += '<div>#</div><div>Ticker</div><div style="text-align:right;">Price</div><div style="text-align:right;">IV</div>';
  html += '<div style="text-align:center;">IV Rank</div><div style="text-align:center;">IV Pctile</div>';
  html += '<div style="text-align:center;">HV20 / HV50</div><div style="text-align:center;">Score</div>';
  html += '</div>';

  // Sort results
  const sorted = getSortedIVResults(validResults);
  const filtered = getFilteredIVResults(sorted);

  filtered.forEach((r, i) => {
    const ivr = ivRankColor(r.ivRank);
    const ivp = ivRankColor(r.ivPctile);
    const grade = premiumGrade(r.ivRank, r.ivPctile);

    html += '<div class="iv-scanner-grid" onclick="showIVDetail(\'' + r.ticker + '\')" style="cursor:pointer;">';
    // Rank
    html += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:800;font-size:14px;color:' + (i < 3 ? ['#ffd700','#c0c0c0','#cd7f32'][i] : 'var(--text-muted)') + ';">' + (i + 1) + '</div>';
    // Ticker + name
    html += '<div>';
    html += '<div style="font-weight:700;font-size:13px;">' + r.ticker + '</div>';
    html += '<div style="font-size:9px;color:var(--text-muted);">' + (r.name || '') + ' · ' + (r.sector || '') + '</div>';
    html += '</div>';
    // Price
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-weight:600;">' + (r.stockPrice ? '$' + price(r.stockPrice) : '—') + '</div>';
    // IV
    html += '<div style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + ivr.color + ';">' + (r.currentIV ? (r.currentIV * 100).toFixed(1) + '%' : '—') + '</div>';
    // IV Rank with gauge
    html += '<div style="text-align:center;">';
    if (r.ivRank !== null) {
      html += '<div class="iv-rank-badge" style="background:' + ivr.bg + ';color:' + ivr.color + ';">' + r.ivRank.toFixed(0) + '</div>';
      html += '<div class="iv-gauge" style="margin-top:4px;"><div class="iv-gauge-fill ' + ivr.cls + '" style="width:' + Math.min(100, r.ivRank).toFixed(0) + '%;"></div></div>';
    } else { html += '<span style="color:var(--text-muted);">—</span>'; }
    html += '</div>';
    // IV Percentile
    html += '<div style="text-align:center;">';
    if (r.ivPctile !== null) {
      html += '<div class="iv-rank-badge" style="background:' + ivp.bg + ';color:' + ivp.color + ';">' + r.ivPctile.toFixed(0) + '</div>';
    } else { html += '<span style="color:var(--text-muted);">—</span>'; }
    html += '</div>';
    // HV20 / HV50
    html += '<div style="text-align:center;font-family:\'JetBrains Mono\',monospace;font-size:10px;">';
    html += (r.hv20 ? (r.hv20 * 100).toFixed(1) + '%' : '—') + ' <span style="color:var(--text-muted);">/</span> ' + (r.hv50 ? (r.hv50 * 100).toFixed(1) + '%' : '—');
    html += '</div>';
    // Grade
    html += '<div style="text-align:center;">';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:3px solid ' + grade.color + ';font-size:14px;font-weight:900;color:' + grade.color + ';font-family:\'JetBrains Mono\',monospace;">' + grade.grade + '</div>';
    html += '<div style="font-size:8px;color:var(--text-muted);margin-top:2px;">' + grade.label + '</div>';
    html += '</div>';
    html += '</div>';
  });

  if (filtered.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">No tickers match current filter.</div>';
  }

  html += '</div>';

  // Legend
  html += '<div style="display:flex;gap:16px;margin-top:12px;font-size:9px;color:var(--text-muted);flex-wrap:wrap;">';
  html += '<span><strong>IV Rank</strong> = (Current IV − 52w Low) / (52w High − 52w Low). Higher = more premium to sell.</span>';
  html += '<span><strong>IV Percentile</strong> = % of past year where IV was lower than today.</span>';
  html += '<span><strong>HV20/HV50</strong> = 20/50-day historical (realized) volatility.</span>';
  html += '<span><strong>Score</strong> = Combined IV Rank + Percentile (0-100). Higher = more premium to harvest.</span>';
  html += '</div>';

  container.innerHTML = html;
}

function getSortedIVResults(results) {
  const sel = document.getElementById('iv-sort');
  const val = sel ? sel.value : 'ivRank-desc';
  const sorted = [...results];
  switch (val) {
    case 'ivRank-desc': sorted.sort((a, b) => (b.ivRank || -1) - (a.ivRank || -1)); break;
    case 'ivRank-asc': sorted.sort((a, b) => (a.ivRank || 999) - (b.ivRank || 999)); break;
    case 'iv-desc': sorted.sort((a, b) => (b.currentIV || 0) - (a.currentIV || 0)); break;
    case 'iv-asc': sorted.sort((a, b) => (a.currentIV || 999) - (b.currentIV || 999)); break;
    case 'ticker-asc': sorted.sort((a, b) => a.ticker.localeCompare(b.ticker)); break;
  }
  return sorted;
}

function getFilteredIVResults(results) {
  const sel = document.getElementById('iv-filter');
  const val = sel ? sel.value : 'all';
  switch (val) {
    case 'high': return results.filter(r => (r.ivRank || 0) >= 50);
    case 'extreme': return results.filter(r => (r.ivRank || 0) >= 80);
    case 'low': return results.filter(r => (r.ivRank || 0) < 25);
    default: return results;
  }
}

function sortIVResults() {
  const valid = (window._ivScanData || []).filter(r => r.currentIV !== null);
  renderIVScannerResults(window._ivScanData);
}
function filterIVResults() {
  renderIVScannerResults(window._ivScanData);
}

function addIVTicker() {
  const input = document.getElementById('iv-add-ticker');
  if (!input) return;
  const ticker = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return;
  const custom = getCustomIVTickers();
  if (custom.includes(ticker) || IV_SCAN_WATCHLIST.find(t => t.ticker === ticker)) { input.value = ''; return; }
  custom.push(ticker);
  saveCustomIVTickers(custom);
  input.value = '';
  window._optionsLoaded = false;
  renderOptionsTab();
}

function removeIVTicker(ticker) {
  const custom = getCustomIVTickers().filter(t => t !== ticker);
  saveCustomIVTickers(custom);
  window._optionsLoaded = false;
  renderOptionsTab();
}

// Detail panel — shows when you click a ticker in the scanner
async function showIVDetail(ticker) {
  const panel = document.getElementById('iv-detail-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Find data from cache
  let data = (window._ivScanData || []).find(r => r.ticker === ticker);
  if (!data) {
    panel.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);">Loading ' + ticker + ' detail...</div>';
    data = await fetchIVData(ticker);
  }

  const grade = premiumGrade(data.ivRank, data.ivPctile);
  const ivr = ivRankColor(data.ivRank);

  let html = '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;border-top:3px solid ' + grade.color + ';">';

  // Header
  html += '<div style="padding:16px 20px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="display:flex;align-items:center;gap:12px;">';
  html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:22px;font-weight:800;">' + data.ticker + '</span>';
  html += '<span style="font-size:12px;color:var(--text-muted);">' + (data.name || '') + '</span>';
  html += '<span style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;border:3px solid ' + grade.color + ';font-size:17px;font-weight:900;color:' + grade.color + ';font-family:\'JetBrains Mono\',monospace;margin-left:8px;">' + grade.grade + '</span>';
  html += '</div>';
  html += '<button onclick="document.getElementById(\'iv-detail-panel\').style.display=\'none\'" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;">✕ Close</button>';
  html += '</div>';

  // IV stats row
  html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--border);">';
  const stats = [
    { label: 'Stock Price', val: data.stockPrice ? '$' + price(data.stockPrice) : '—', color: 'var(--text-primary)' },
    { label: 'Current IV', val: data.currentIV ? (data.currentIV * 100).toFixed(1) + '%' : '—', color: ivr.color },
    { label: 'IV Rank', val: data.ivRank !== null ? data.ivRank.toFixed(0) : '—', color: ivr.color },
    { label: 'IV Percentile', val: data.ivPctile !== null ? data.ivPctile.toFixed(0) : '—', color: ivRankColor(data.ivPctile).color },
    { label: 'HV 20-Day', val: data.hv20 ? (data.hv20 * 100).toFixed(1) + '%' : '—', color: 'var(--text-primary)' },
    { label: 'HV 50-Day', val: data.hv50 ? (data.hv50 * 100).toFixed(1) + '%' : '—', color: 'var(--text-primary)' },
  ];
  stats.forEach(s => {
    html += '<div style="padding:14px 12px;text-align:center;border-right:1px solid var(--border);">';
    html += '<div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">' + s.label + '</div>';
    html += '<div style="font-family:\'JetBrains Mono\',monospace;font-size:18px;font-weight:800;color:' + s.color + ';">' + s.val + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // IV vs HV comparison
  if (data.currentIV && data.hv20) {
    const ivHvRatio = data.currentIV / data.hv20;
    const ivOverHv = data.currentIV > data.hv20;
    html += '<div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;gap:20px;align-items:center;flex-wrap:wrap;">';
    html += '<div style="font-size:11px;"><strong>IV / HV20 Ratio:</strong> <span class="mono" style="font-weight:700;color:' + (ivOverHv ? 'var(--purple)' : 'var(--green)') + ';">' + ivHvRatio.toFixed(2) + 'x</span></div>';
    html += '<div style="font-size:10px;color:var(--text-muted);">';
    if (ivHvRatio >= 1.5) html += 'IV is significantly elevated vs realized vol — premium selling is juicy here.';
    else if (ivHvRatio >= 1.2) html += 'IV above realized — favorable for premium selling.';
    else if (ivHvRatio >= 1.0) html += '➡️ IV roughly in line with realized vol — fair value.';
    else html += 'IV below realized vol — options may be cheap, not ideal for selling.';
    html += '</div></div>';
  }

  // Strategy suggestions with LIVE SPREAD RECOMMENDATIONS
  html += '<div style="padding:14px 20px;border-bottom:1px solid var(--border);">';
  html += '<div style="font-size:11px;font-weight:800;color:var(--text-secondary);margin-bottom:8px;">STRATEGY SUGGESTIONS</div>';

  if (data.ivRank !== null && data.stockPrice) {
    const acct = getAccountSize();
    const riskPct = getRiskPct() / 100;
    const riskDollars = acct * riskPct;

    if (data.ivRank >= 50) {
      html += '<div style="padding:8px 12px;background:var(--green-bg);border-radius:6px;margin-bottom:6px;font-size:11px;border-left:3px solid var(--green);">';
      html += '<strong style="color:var(--green);">SELL PUT SPREADS</strong> — IV Rank ' + data.ivRank.toFixed(0) + ' favors selling premium. ';
      html += 'Target 30-45 DTE, sell at 0.20-0.30 delta. ';
      const spreadWidth = data.stockPrice > 200 ? 5 : data.stockPrice > 50 ? 2.5 : 1;
      const maxRisk = spreadWidth * 100;
      const contracts = Math.floor(riskDollars / maxRisk);
      html += 'With your $' + acct.toLocaleString() + ' account at ' + getRiskPct() + '% risk: <strong>' + contracts + ' contracts</strong> at $' + spreadWidth.toFixed(1) + ' wide ($' + (contracts * maxRisk).toLocaleString() + ' max risk).';
      html += '</div>';

      html += '<div style="padding:8px 12px;background:var(--blue-bg);border-radius:6px;margin-bottom:6px;font-size:11px;border-left:3px solid var(--blue);">';
      html += '<strong style="color:var(--blue);">SELL IRON CONDORS</strong> — Collect premium on both sides if range-bound thesis. ';
      html += 'Sell put spread below support + call spread above resistance.';
      html += '</div>';
    }
    if (data.ivRank >= 70) {
      html += '<div style="padding:8px 12px;background:var(--purple-bg);border-radius:6px;margin-bottom:6px;font-size:11px;border-left:3px solid var(--purple);">';
      html += '<strong style="color:var(--purple);">SELL STRANGLES/STRADDLES</strong> — Extreme IV Rank ' + data.ivRank.toFixed(0) + '. If you have margin, naked strangles capture max premium. Undefined risk — size conservatively.';
      html += '</div>';
    }
    if (data.ivRank < 30) {
      html += '<div style="padding:8px 12px;background:rgba(100,116,139,0.08);border-radius:6px;margin-bottom:6px;font-size:11px;border-left:3px solid var(--text-muted);">';
      html += '<strong style="color:var(--text-muted);">AVOID SELLING</strong> — IV Rank ' + data.ivRank.toFixed(0) + ' is too low. Premium is thin. Consider buying debit spreads or waiting for IV expansion.';
      html += '</div>';
    }
  }
  html += '</div>';

  // ── RECOMMENDED SPREADS (built from live chain data) ──
  if (data.putContracts && data.putContracts.length >= 2 && data.stockPrice) {
    html += '<div style="padding:14px 20px;border-bottom:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--purple);margin-bottom:10px;">📋 RECOMMENDED PUT SPREADS — Live Chain</div>';

    // Build spread candidates from available put contracts
    var spreads = [];
    var puts = data.putContracts;
    // Also get all puts from allContracts for more pairing options
    var allPuts = (data.allContracts || []).filter(function(c) {
      return c.details && c.details.contract_type === 'put' && c.details.strike_price < data.stockPrice && c.implied_volatility > 0;
    }).sort(function(a,b) { return b.details.strike_price - a.details.strike_price; });

    // Group by expiration
    var byExpiry = {};
    allPuts.forEach(function(c) {
      var exp = c.details.expiration_date;
      if (!byExpiry[exp]) byExpiry[exp] = [];
      byExpiry[exp].push(c);
    });

    // For each expiry, find the best spread pairs
    Object.keys(byExpiry).sort().forEach(function(exp) {
      var expiryPuts = byExpiry[exp].sort(function(a,b) { return b.details.strike_price - a.details.strike_price; });
      // Calculate DTE
      var expDate = new Date(exp + 'T16:00:00');
      var now = new Date();
      var dte = Math.max(0, Math.round((expDate - now) / (1000*60*60*24)));

      for (var si = 0; si < expiryPuts.length - 1; si++) {
        var shortLeg = expiryPuts[si];
        var shortStrike = shortLeg.details.strike_price;
        // Use bid first, fallback to last trade, then day close, then midpoint estimate
        var shortBid = (shortLeg.last_quote && shortLeg.last_quote.bid > 0) ? shortLeg.last_quote.bid
          : (shortLeg.last_trade && shortLeg.last_trade.price > 0) ? shortLeg.last_trade.price
          : (shortLeg.day && shortLeg.day.close > 0) ? shortLeg.day.close
          : (shortLeg.last_quote && shortLeg.last_quote.midpoint > 0) ? shortLeg.last_quote.midpoint : 0;
        var shortDelta = shortLeg.greeks ? shortLeg.greeks.delta : null;
        var shortOI = shortLeg.open_interest || 0;
        var shortVol = (shortLeg.day && shortLeg.day.volume) || 0;
        var shortIV = shortLeg.implied_volatility || 0;
        var isEstimated = !(shortLeg.last_quote && shortLeg.last_quote.bid > 0);

        // Skip if no price at all or delta too high (too close to ATM)
        if (!shortBid || shortBid < 0.01) continue;
        if (shortDelta && Math.abs(shortDelta) > 0.40) continue;

        // Find matching long legs (lower strikes, $2.5 or $5 wide)
        var targetWidths = data.stockPrice > 200 ? [5, 10, 2.5] : data.stockPrice > 50 ? [2.5, 5, 1] : [1, 2.5, 0.5];
        for (var wi = 0; wi < targetWidths.length; wi++) {
          var width = targetWidths[wi];
          var longTarget = shortStrike - width;
          var longLeg = expiryPuts.find(function(c) {
            return Math.abs(c.details.strike_price - longTarget) < 0.01;
          });
          if (!longLeg) continue;
          // Use ask first, fallback to last trade, then day close
          var longAsk = (longLeg.last_quote && longLeg.last_quote.ask > 0) ? longLeg.last_quote.ask
            : (longLeg.last_trade && longLeg.last_trade.price > 0) ? longLeg.last_trade.price
            : (longLeg.day && longLeg.day.close > 0) ? longLeg.day.close
            : (longLeg.last_quote && longLeg.last_quote.midpoint > 0) ? longLeg.last_quote.midpoint : 0;
          var longOI = longLeg.open_interest || 0;
          var longEstimated = !(longLeg.last_quote && longLeg.last_quote.ask > 0);

          var netCredit = shortBid - longAsk;
          if (netCredit <= 0.01) continue; // Not worth it
          var estimated = isEstimated || longEstimated;

          var maxRisk = (width - netCredit) * 100;
          var ror = maxRisk > 0 ? (netCredit * 100 / maxRisk * 100) : 0;
          var contracts = maxRisk > 0 ? Math.floor((getAccountSize() * getRiskPct() / 100) / maxRisk) : 0;

          // Score the spread (0-100) — track each component for explanation
          var spreadScore = 0;
          var reasons = [];
          // Delta sweet spot: -0.15 to -0.30 = best
          if (shortDelta) {
            var absDelta = Math.abs(shortDelta);
            if (absDelta >= 0.12 && absDelta <= 0.30) { spreadScore += 25; reasons.push('Delta ' + absDelta.toFixed(2) + ' in sweet spot (0.12–0.30) +25'); }
            else if (absDelta >= 0.08 && absDelta <= 0.35) { spreadScore += 15; reasons.push('Delta ' + absDelta.toFixed(2) + ' acceptable range +15'); }
            else { spreadScore += 5; reasons.push('Delta ' + absDelta.toFixed(2) + ' outside ideal range +5'); }
          } else { reasons.push('Delta unknown +0'); }
          // RoR: higher = better, max at 50%+
          if (ror >= 40) { spreadScore += 25; reasons.push('RoR ' + ror.toFixed(0) + '% excellent +25'); }
          else if (ror >= 25) { spreadScore += 20; reasons.push('RoR ' + ror.toFixed(0) + '% strong +20'); }
          else if (ror >= 15) { spreadScore += 12; reasons.push('RoR ' + ror.toFixed(0) + '% fair +12'); }
          else { spreadScore += 5; reasons.push('RoR ' + ror.toFixed(0) + '% thin +5'); }
          // OI/Liquidity: combined OI of both legs
          var combinedOI = shortOI + longOI;
          if (combinedOI >= 1000) { spreadScore += 20; reasons.push('OI ' + combinedOI.toLocaleString() + ' deep liquidity +20'); }
          else if (combinedOI >= 500) { spreadScore += 15; reasons.push('OI ' + combinedOI.toLocaleString() + ' good liquidity +15'); }
          else if (combinedOI >= 100) { spreadScore += 10; reasons.push('OI ' + combinedOI.toLocaleString() + ' moderate +10'); }
          else { spreadScore += 3; reasons.push('OI ' + combinedOI.toLocaleString() + ' thin liquidity +3'); }
          // Volume
          if (shortVol >= 100) { spreadScore += 15; reasons.push('Volume ' + shortVol.toLocaleString() + ' heavy activity +15'); }
          else if (shortVol >= 30) { spreadScore += 10; reasons.push('Volume ' + shortVol.toLocaleString() + ' active +10'); }
          else if (shortVol >= 5) { spreadScore += 5; reasons.push('Volume ' + shortVol.toLocaleString() + ' light +5'); }
          else { reasons.push('No volume today +0'); }
          // DTE sweet spot: 0DTE gets 15, 1-7 DTE gets 12, 30-45 gets 10
          if (dte === 0) { spreadScore += 15; reasons.push('0DTE max theta decay +15'); }
          else if (dte <= 7) { spreadScore += 12; reasons.push(dte + 'DTE weekly — fast decay +12'); }
          else if (dte <= 45) { spreadScore += 10; reasons.push(dte + 'DTE standard window +10'); }
          else { spreadScore += 5; reasons.push(dte + 'DTE long-dated +5'); }

          spreadScore = Math.min(100, spreadScore);

          spreads.push({
            exp: exp, dte: dte, shortStrike: shortStrike, longStrike: longTarget, width: width,
            shortBid: shortBid, longAsk: longAsk, netCredit: netCredit, maxRisk: maxRisk, ror: ror,
            shortDelta: shortDelta, shortOI: shortOI, longOI: longOI, shortVol: shortVol,
            contracts: contracts, score: spreadScore, estimated: estimated, reasons: reasons
          });
        }
      }
    });

    // Sort by score, take top 8
    spreads.sort(function(a,b) { return b.score - a.score; });
    var topSpreads = spreads.slice(0, 8);

    if (topSpreads.length > 0) {
      // Check if any spreads use estimated pricing
      var anyEstimated = topSpreads.some(function(sp) { return sp.estimated; });
      if (anyEstimated) {
        html += '<div style="padding:8px 12px;background:var(--amber-bg);border:1px solid rgba(230,138,0,0.2);border-radius:6px;margin-bottom:8px;font-size:10px;color:var(--amber);font-weight:600;">';
        html += '⚠ Market closed — credits are <strong>estimated</strong> from last trade / prior close. Refresh when market opens for live bid/ask.';
        html += '</div>';
      }
      // Table header
      html += '<div style="display:grid;grid-template-columns:45px 70px 130px 65px 60px 55px 75px 90px 1fr;gap:0;padding:8px 10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px 8px 0 0;font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">';
      html += '<div>Score</div><div>Expiry</div><div>Spread</div><div>Credit</div><div>Risk</div><div>RoR</div><div>Delta</div><div>OI / Vol</div><div>Sizing</div>';
      html += '</div>';

      topSpreads.forEach(function(sp, idx) {
        var scoreColor = sp.score >= 75 ? 'var(--green)' : sp.score >= 55 ? 'var(--blue)' : sp.score >= 35 ? 'var(--amber)' : 'var(--text-muted)';
        var rowBg = idx === 0 ? 'rgba(12,188,135,0.06)' : idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-primary)';
        var dteLabel = sp.dte === 0 ? '0DTE' : sp.dte + 'd';
        var dteBg = sp.dte === 0 ? 'var(--red-bg)' : sp.dte <= 7 ? 'var(--amber-bg)' : 'var(--blue-bg)';
        var dteColor = sp.dte === 0 ? 'var(--red)' : sp.dte <= 7 ? 'var(--amber)' : 'var(--blue)';

        html += '<div style="display:grid;grid-template-columns:45px 70px 130px 65px 60px 55px 75px 90px 1fr;gap:0;padding:9px 10px;border:1px solid var(--border);border-top:none;align-items:center;font-size:11px;background:' + rowBg + ';' + (idx === 0 ? 'border-left:3px solid var(--green);' : '') + '">';

        // Score
        html += '<div style="text-align:center;"><div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:2.5px solid ' + scoreColor + ';font-size:12px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + sp.score + '</div></div>';

        // Expiry + DTE badge
        html += '<div><div class="mono" style="font-size:10px;">' + sp.exp + '</div>';
        html += '<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:' + dteBg + ';color:' + dteColor + ';">' + dteLabel + '</span></div>';

        // Spread strikes
        html += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:700;">';
        html += '<span style="color:var(--red);">Sell $' + sp.shortStrike + '</span>';
        html += ' <span style="color:var(--text-muted);">/</span> ';
        html += '<span style="color:var(--green);">Buy $' + sp.longStrike + '</span>';
        html += '<div style="font-size:8px;color:var(--text-muted);">$' + sp.width.toFixed(1) + ' wide</div></div>';

        // Credit
        html += '<div class="mono" style="font-weight:700;color:var(--green);">$' + sp.netCredit.toFixed(2);
        if (sp.estimated) html += '<div style="font-size:7px;color:var(--amber);font-weight:600;">EST</div>';
        html += '</div>';

        // Max risk
        html += '<div class="mono" style="font-size:10px;color:var(--red);">$' + sp.maxRisk.toFixed(0) + '</div>';

        // RoR
        html += '<div class="mono" style="font-weight:700;color:' + (sp.ror >= 25 ? 'var(--green)' : 'var(--text-secondary)') + ';">' + sp.ror.toFixed(0) + '%</div>';

        // Delta
        html += '<div class="mono" style="font-size:10px;">' + (sp.shortDelta ? sp.shortDelta.toFixed(3) : '—') + '</div>';

        // OI / Volume
        html += '<div class="mono" style="font-size:10px;">' + sp.shortOI.toLocaleString() + ' <span style="color:var(--text-muted);">/</span> ' + sp.shortVol.toLocaleString() + '</div>';

        // Sizing
        html += '<div style="font-size:10px;font-family:\'JetBrains Mono\',monospace;">';
        if (sp.contracts > 0) {
          html += '<span style="color:var(--blue);font-weight:700;">' + sp.contracts + ' ct</span>';
          html += '<span style="color:var(--text-muted);"> · $' + (sp.contracts * sp.netCredit * 100).toFixed(0) + ' cr</span>';
        } else {
          html += '<span style="color:var(--text-muted);">—</span>';
        }
        html += '</div>';
        html += '</div>';

        // Reason description row under the spread
        html += '<div style="padding:5px 10px 8px 55px;border:1px solid var(--border);border-top:none;background:' + (idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-primary)') + ';font-size:9px;color:var(--text-muted);line-height:1.6;' + (idx === 0 ? 'border-left:3px solid var(--green);' : '') + '">';
        html += '<span style="color:var(--text-secondary);">' + sp.reasons.join(' <span style="color:var(--border);">·</span> ') + '</span>';
        html += '</div>';
      });

      // Legend
      html += '<div style="margin-top:6px;font-size:8px;color:var(--text-muted);display:flex;gap:10px;flex-wrap:wrap;">';
      html += '<span><strong>Score:</strong> Delta + RoR + OI + Volume + DTE</span>';
      html += '<span><strong>Credit:</strong> short bid − long ask</span>';
      html += '<span><strong>RoR:</strong> credit / max risk</span>';
      html += '<span><strong>OI/Vol:</strong> short leg open interest / volume</span>';
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:var(--text-muted);padding:10px 0;">No viable put spreads found in the chain. This usually means:<br>• Market is closed and no last trade data exists yet (new expiration)<br>• Contracts have zero OI (no liquidity)<br>• All OTM puts have delta > 0.40 (too close to ATM)<br>Try again when market opens, or check that the ticker has active weekly options.</div>';
    }
    html += '</div>';
  }

  // Put contracts table
  if (data.putContracts && data.putContracts.length > 0) {
    html += '<div style="padding:14px 20px 4px;">';
    html += '<div style="font-size:11px;font-weight:800;color:var(--text-secondary);margin-bottom:8px;">OTM PUTS (Sell Candidates) — 30-45 DTE</div>';
    html += '</div>';
    html += '<div class="opt-chain-row header-row">';
    html += '<div>Expiry</div><div>Strike</div><div>Bid</div><div>Ask</div><div>IV</div><div>Delta</div><div>OI / Volume</div>';
    html += '</div>';
    data.putContracts.forEach(c => {
      const det = c.details || {};
      const greeks = c.greeks || {};
      const dayData = c.day || {};
      html += '<div class="opt-chain-row">';
      html += '<div class="mono" style="font-size:10px;">' + (det.expiration_date || '—') + '</div>';
      html += '<div class="mono" style="font-weight:700;">$' + (det.strike_price ? det.strike_price.toFixed(det.strike_price >= 100 ? 0 : 1) : '—') + '</div>';
      html += '<div class="mono" style="color:var(--green);">' + (c.last_quote?.bid ? c.last_quote.bid.toFixed(2) : '—') + '</div>';
      html += '<div class="mono" style="color:var(--red);">' + (c.last_quote?.ask ? c.last_quote.ask.toFixed(2) : '—') + '</div>';
      html += '<div class="mono" style="color:' + ivRankColor((c.implied_volatility || 0) * 100 / 2).color + ';">' + (c.implied_volatility ? (c.implied_volatility * 100).toFixed(1) + '%' : '—') + '</div>';
      html += '<div class="mono">' + (greeks.delta ? greeks.delta.toFixed(3) : '—') + '</div>';
      html += '<div class="mono" style="font-size:10px;">' + (c.open_interest || 0).toLocaleString() + ' / ' + (dayData.volume || 0).toLocaleString() + '</div>';
      html += '</div>';
    });
  }

  // Call contracts table
  if (data.callContracts && data.callContracts.length > 0) {
    html += '<div style="padding:14px 20px 4px;">';
    html += '<div style="font-size:11px;font-weight:800;color:var(--text-secondary);margin-bottom:8px;">OTM CALLS (Sell Candidates) — 30-45 DTE</div>';
    html += '</div>';
    html += '<div class="opt-chain-row header-row">';
    html += '<div>Expiry</div><div>Strike</div><div>Bid</div><div>Ask</div><div>IV</div><div>Delta</div><div>OI / Volume</div>';
    html += '</div>';
    data.callContracts.forEach(c => {
      const det = c.details || {};
      const greeks = c.greeks || {};
      const dayData = c.day || {};
      html += '<div class="opt-chain-row">';
      html += '<div class="mono" style="font-size:10px;">' + (det.expiration_date || '—') + '</div>';
      html += '<div class="mono" style="font-weight:700;">$' + (det.strike_price ? det.strike_price.toFixed(det.strike_price >= 100 ? 0 : 1) : '—') + '</div>';
      html += '<div class="mono" style="color:var(--green);">' + (c.last_quote?.bid ? c.last_quote.bid.toFixed(2) : '—') + '</div>';
      html += '<div class="mono" style="color:var(--red);">' + (c.last_quote?.ask ? c.last_quote.ask.toFixed(2) : '—') + '</div>';
      html += '<div class="mono" style="color:' + ivRankColor((c.implied_volatility || 0) * 100 / 2).color + ';">' + (c.implied_volatility ? (c.implied_volatility * 100).toFixed(1) + '%' : '—') + '</div>';
      html += '<div class="mono">' + (greeks.delta ? greeks.delta.toFixed(3) : '—') + '</div>';
      html += '<div class="mono" style="font-size:10px;">' + (c.open_interest || 0).toLocaleString() + ' / ' + (dayData.volume || 0).toLocaleString() + '</div>';
      html += '</div>';
    });
  }

  html += '</div>';

  // Position sizing helper
  html += '<div class="card" style="padding:14px 16px;margin-top:12px;">';
  html += '<div style="font-size:11px;font-weight:800;color:var(--text-secondary);margin-bottom:10px;">📐 QUICK POSITION SIZER (Put Spread)</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;">';
  html += '<label>Spread Width: <input type="number" id="iv-spread-width" value="' + (data.stockPrice > 200 ? 5 : 2.5) + '" step="0.5" min="0.5" style="width:55px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;" onchange="calcIVSpreadSize(\'' + data.ticker + '\')"></label>';
  html += '<label>Credit Received: <input type="number" id="iv-spread-credit" value="0.50" step="0.05" min="0.01" style="width:55px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-family:\'JetBrains Mono\',monospace;font-size:11px;" onchange="calcIVSpreadSize(\'' + data.ticker + '\')"></label>';
  html += '<div id="iv-spread-result" style="font-family:\'JetBrains Mono\',monospace;font-size:10px;"></div>';
  html += '</div></div>';

  panel.innerHTML = html;
  calcIVSpreadSize(data.ticker);
}

function calcIVSpreadSize(ticker) {
  const widthEl = document.getElementById('iv-spread-width');
  const creditEl = document.getElementById('iv-spread-credit');
  const resultEl = document.getElementById('iv-spread-result');
  if (!widthEl || !creditEl || !resultEl) return;
  const width = parseFloat(widthEl.value) || 2.5;
  const credit = parseFloat(creditEl.value) || 0.50;
  const maxRiskPerContract = (width - credit) * 100;
  const acct = getAccountSize();
  const riskPct = getRiskPct() / 100;
  const riskBudget = acct * riskPct;
  const contracts = Math.floor(riskBudget / maxRiskPerContract);
  const totalCredit = contracts * credit * 100;
  const totalRisk = contracts * maxRiskPerContract;
  const ror = (totalCredit / totalRisk * 100) || 0;

  resultEl.innerHTML =
    '<span style="color:var(--green);font-weight:700;">' + contracts + ' contracts</span> · ' +
    '<span style="color:var(--green);">$' + totalCredit.toFixed(0) + ' credit</span> · ' +
    '<span style="color:var(--red);">$' + totalRisk.toFixed(0) + ' max risk</span> · ' +
    '<span style="color:var(--blue);">' + ror.toFixed(1) + '% RoR</span>';
}

// ==================== TAB SWITCHING ====================
