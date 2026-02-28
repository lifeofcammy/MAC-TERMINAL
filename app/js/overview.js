// ==================== overview.js ====================
// Overview tab: 5-section command center
// 1. Market Regime (risk-on/off/choppy/wait banner)
// 2. Market Pulse (SPY/QQQ/IWM/VIX/breadth/volume)
// 3. Today's Themes (AI + Polygon news)
// 4. Top Ideas (auto from scanner results)
// 5. Sector Heatmap (collapsible, from segments data)

// ==================== RENDER: OVERVIEW ====================
async function renderOverview() {
  var container = document.getElementById('tab-overview');
  if (!container) return;
  var ts = getTimestamp();
  var live = isMarketOpen();

  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">Loading Overview...</div>';

  // ── FETCH CORE DATA ──
  var indexTickers = ['SPY','QQQ','IWM','DIA'];
  var vixTicker = 'VIX';  // We'll use VIXY as proxy or direct VIX
  var sectorETFs = [
    { etf: 'XLK', name: 'Technology' }, { etf: 'SMH', name: 'Semiconductors' },
    { etf: 'XLF', name: 'Financials' }, { etf: 'XLE', name: 'Energy' },
    { etf: 'XLV', name: 'Healthcare' }, { etf: 'XLY', name: 'Consumer Disc.' },
    { etf: 'XLI', name: 'Industrials' }, { etf: 'XLRE', name: 'Real Estate' },
    { etf: 'XLU', name: 'Utilities' }, { etf: 'XLB', name: 'Materials' },
    { etf: 'XLC', name: 'Comm. Services' }, { etf: 'XLP', name: 'Consumer Staples' }
  ];

  var snap = {}, sectorSnap = {}, sectorBars = {};
  var newsArticles = [];

  try {
    // Fetch index snapshots
    snap = await getSnapshots(indexTickers);
    // Fetch sector snapshots
    var sectorTickers = sectorETFs.map(function(s) { return s.etf; });
    sectorSnap = await getSnapshots(sectorTickers);
    // Fetch daily bars for sectors (20 days for heatmap + momentum)
    for (var si = 0; si < sectorTickers.length; si++) {
      try { sectorBars[sectorTickers[si]] = await getDailyBars(sectorTickers[si], 25); } catch(e) { sectorBars[sectorTickers[si]] = []; }
    }
    // Fetch news
    try { newsArticles = await getPolygonNews(null, 25); } catch(e) {}
  } catch(e) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--red);padding:30px;">Failed to load data: ' + e.message + '<br><span style="font-size:11px;color:var(--text-muted);">Make sure your Polygon API key is set (click the gear icon).</span></div>';
    return;
  }

  // ── HELPER: Get snapshot data for a ticker ──
  function getSnap(ticker) {
    var s = snap[ticker];
    if (!s) return { price: 0, change: 0, pct: 0, vol: 0, prevClose: 0, high: 0, low: 0, vwap: 0 };
    var p = s.day && s.day.c ? s.day.c : (s.lastTrade ? s.lastTrade.p : 0);
    var prev = s.prevDay ? s.prevDay.c : p;
    var chg = p - prev;
    var pctVal = prev > 0 ? (chg / prev) * 100 : 0;
    return {
      price: p, change: chg, pct: pctVal,
      vol: s.day ? s.day.v : 0, prevClose: prev,
      high: s.day ? s.day.h : 0, low: s.day ? s.day.l : 0,
      vwap: s.day ? s.day.vw : 0
    };
  }

  var spyData = getSnap('SPY');
  var qqqData = getSnap('QQQ');
  var iwmData = getSnap('IWM');
  var diaData = getSnap('DIA');

  // ── SECTOR DATA ──
  var sectorData = sectorETFs.map(function(sec) {
    var s = sectorSnap[sec.etf];
    var bars = sectorBars[sec.etf] || [];
    var p = 0, prev = 0, dayChg = 0, weekPerf = 0;
    if (s) {
      p = s.day && s.day.c ? s.day.c : (s.lastTrade ? s.lastTrade.p : 0);
      prev = s.prevDay ? s.prevDay.c : p;
      dayChg = prev > 0 ? ((p - prev) / prev) * 100 : 0;
    }
    if (bars.length >= 5) {
      var w5 = bars[bars.length - 5].c;
      weekPerf = w5 > 0 ? ((p - w5) / w5) * 100 : 0;
    }
    return { etf: sec.etf, name: sec.name, price: p, dayChg: dayChg, weekPerf: weekPerf };
  });
  sectorData.sort(function(a, b) { return b.dayChg - a.dayChg; });

  // ── BREADTH ESTIMATE ──
  // Count sectors up vs down as a breadth proxy
  var sectorsUp = sectorData.filter(function(s) { return s.dayChg > 0; }).length;
  var sectorsDown = sectorData.filter(function(s) { return s.dayChg < 0; }).length;
  var breadthPct = Math.round((sectorsUp / sectorData.length) * 100);

  // ════════════════════════════════════════════════════════════════
  // SECTION 1: MARKET REGIME BANNER
  // ════════════════════════════════════════════════════════════════
  var regimeLabel = 'Neutral';
  var regimeColor = 'var(--text-muted)';
  var regimeBg = 'var(--bg-secondary)';
  var regimeBorder = 'var(--border)';
  var regimeIcon = '◆';
  var regimeDetail = '';

  // Calculate regime from data
  var spyPct = spyData.pct;
  var qqqPct = qqqData.pct;
  var avgPct = (spyPct + qqqPct) / 2;

  // Check for saved economic calendar events (high-impact today)
  var hasHighImpactEvent = false;
  var eventName = '';
  try {
    var today = new Date();
    var dow = today.getDay();
    var monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    var calKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];
    var calData = localStorage.getItem(calKey);
    if (calData) {
      var parsed = JSON.parse(calData);
      var calText = (parsed.text || '').toLowerCase();
      if (/cpi|fomc|fed fund|interest rate|nonfarm|payroll|gdp|pce/.test(calText)) {
        hasHighImpactEvent = true;
        if (/cpi/.test(calText)) eventName = 'CPI';
        else if (/fomc|fed fund|interest rate/.test(calText)) eventName = 'FOMC/Fed';
        else if (/nonfarm|payroll/.test(calText)) eventName = 'NFP';
        else if (/gdp/.test(calText)) eventName = 'GDP';
        else if (/pce/.test(calText)) eventName = 'PCE';
        else eventName = 'major data';
      }
    }
  } catch(e) {}

  // Also check manual override
  var manualRegime = null;
  try { manualRegime = localStorage.getItem('mac_regime_override'); } catch(e) {}

  if (manualRegime && manualRegime !== 'auto') {
    // Manual override active
    var overrides = {
      'risk-on': { label: 'Risk On', icon: '▲', color: 'var(--green)', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.3)' },
      'risk-off': { label: 'Risk Off', icon: '▼', color: 'var(--red)', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.3)' },
      'choppy': { label: 'Choppy / Rangebound', icon: '↔', color: 'var(--amber)', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.3)' },
      'wait': { label: 'Wait for News', icon: '⏸', color: 'var(--purple)', bg: 'rgba(124,58,237,0.06)', border: 'rgba(124,58,237,0.3)' }
    };
    var ov = overrides[manualRegime] || overrides['choppy'];
    regimeLabel = ov.label;
    regimeIcon = ov.icon;
    regimeColor = ov.color;
    regimeBg = ov.bg;
    regimeBorder = ov.border;
    regimeDetail = 'Manual override active';
  } else {
    // Auto-detect regime
    if (hasHighImpactEvent && !live) {
      regimeLabel = 'Wait for ' + eventName;
      regimeIcon = '⏸';
      regimeColor = 'var(--purple)';
      regimeBg = 'rgba(124,58,237,0.06)';
      regimeBorder = 'rgba(124,58,237,0.3)';
      regimeDetail = eventName + ' data expected — consider waiting for the reaction before entering positions.';
    } else if (avgPct > 0.8 && breadthPct >= 65) {
      regimeLabel = 'Risk On';
      regimeIcon = '▲';
      regimeColor = 'var(--green)';
      regimeBg = 'rgba(16,185,129,0.06)';
      regimeBorder = 'rgba(16,185,129,0.3)';
      regimeDetail = 'Broad-based strength. ' + sectorsUp + '/' + sectorData.length + ' sectors green. Favorable for long setups.';
    } else if (avgPct < -0.8 && breadthPct <= 35) {
      regimeLabel = 'Risk Off';
      regimeIcon = '▼';
      regimeColor = 'var(--red)';
      regimeBg = 'rgba(239,68,68,0.06)';
      regimeBorder = 'rgba(239,68,68,0.3)';
      regimeDetail = 'Broad weakness. ' + sectorsDown + '/' + sectorData.length + ' sectors red. Reduce size, consider hedges.';
    } else if (Math.abs(avgPct) < 0.3 && Math.abs(spyPct - qqqPct) < 0.5) {
      regimeLabel = 'Choppy / Low Conviction';
      regimeIcon = '↔';
      regimeColor = 'var(--amber)';
      regimeBg = 'rgba(245,158,11,0.06)';
      regimeBorder = 'rgba(245,158,11,0.3)';
      regimeDetail = 'Narrow range, mixed signals. Wait for a clear direction or reduce position sizes.';
    } else if (avgPct > 0.3) {
      regimeLabel = 'Lean Bullish';
      regimeIcon = '▲';
      regimeColor = 'var(--green)';
      regimeBg = 'rgba(16,185,129,0.04)';
      regimeBorder = 'rgba(16,185,129,0.2)';
      regimeDetail = sectorsUp + '/' + sectorData.length + ' sectors positive. Slight bullish tilt — selective longs.';
    } else if (avgPct < -0.3) {
      regimeLabel = 'Lean Bearish';
      regimeIcon = '▼';
      regimeColor = 'var(--red)';
      regimeBg = 'rgba(239,68,68,0.04)';
      regimeBorder = 'rgba(239,68,68,0.2)';
      regimeDetail = sectorsDown + '/' + sectorData.length + ' sectors negative. Slight bearish tilt — be cautious with new longs.';
    } else {
      regimeLabel = 'Neutral';
      regimeIcon = '◆';
      regimeColor = 'var(--text-muted)';
      regimeBg = 'var(--bg-secondary)';
      regimeBorder = 'var(--border)';
      regimeDetail = 'Mixed signals. No clear edge — stick to A+ setups only.';
    }

    // Append high-impact event warning if present even in auto mode
    if (hasHighImpactEvent && live) {
      regimeDetail += ' ⚠ ' + eventName + ' data today — volatility expected.';
    }
  }

  var html = '';

  // REGIME BANNER
  html += '<div style="background:' + regimeBg + ';border:1px solid ' + regimeBorder + ';border-radius:10px;padding:14px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;">';
  html += '<div style="display:flex;align-items:center;gap:12px;">';
  html += '<span style="font-size:24px;color:' + regimeColor + ';">' + regimeIcon + '</span>';
  html += '<div>';
  html += '<div style="font-size:16px;font-weight:800;color:' + regimeColor + ';">' + regimeLabel + '</div>';
  html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">' + regimeDetail + '</div>';
  html += '</div>';
  html += '</div>';
  // Override dropdown
  html += '<div style="display:flex;align-items:center;gap:6px;">';
  html += '<select id="regime-override" onchange="saveRegimeOverride(this.value)" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:10px;font-weight:600;color:var(--text-secondary);font-family:\'Inter\',sans-serif;cursor:pointer;">';
  html += '<option value="auto"' + (manualRegime === null || manualRegime === 'auto' ? ' selected' : '') + '>Auto</option>';
  html += '<option value="risk-on"' + (manualRegime === 'risk-on' ? ' selected' : '') + '>Risk On</option>';
  html += '<option value="risk-off"' + (manualRegime === 'risk-off' ? ' selected' : '') + '>Risk Off</option>';
  html += '<option value="choppy"' + (manualRegime === 'choppy' ? ' selected' : '') + '>Choppy</option>';
  html += '<option value="wait"' + (manualRegime === 'wait' ? ' selected' : '') + '>Wait</option>';
  html += '</select>';
  html += '</div>';
  html += '</div>';

  // ════════════════════════════════════════════════════════════════
  // SECTION 2: MARKET PULSE
  // ════════════════════════════════════════════════════════════════
  html += '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:16px;">';

  var indices = [
    { ticker: 'SPY', label: 'S&P 500', data: spyData },
    { ticker: 'QQQ', label: 'Nasdaq 100', data: qqqData },
    { ticker: 'IWM', label: 'Russell 2000', data: iwmData },
    { ticker: 'DIA', label: 'Dow Jones', data: diaData }
  ];

  indices.forEach(function(idx) {
    var d = idx.data;
    var color = d.pct >= 0 ? 'var(--green)' : 'var(--red)';
    var bg = d.pct >= 0 ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)';
    var borderCol = d.pct >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';

    html += '<div style="background:' + bg + ';border:1px solid ' + borderCol + ';border-radius:10px;padding:14px 16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">' + idx.label + '</span>';
    html += '<span style="font-size:10px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">' + idx.ticker + '</span>';
    html += '</div>';
    html += '<div style="font-size:22px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">$' + (d.price ? price(d.price) : '—') + '</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">';
    html += '<span style="font-size:13px;font-weight:700;color:' + color + ';">' + pct(d.pct) + '</span>';
    html += '<span style="font-size:10px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">' + (d.change >= 0 ? '+' : '') + d.change.toFixed(2) + '</span>';
    html += '</div>';
    // Day range bar
    if (d.high > 0 && d.low > 0) {
      var range = d.high - d.low;
      var pos = range > 0 ? ((d.price - d.low) / range) * 100 : 50;
      html += '<div style="margin-top:8px;">';
      html += '<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;margin-bottom:3px;"><span>L: $' + d.low.toFixed(2) + '</span><span>H: $' + d.high.toFixed(2) + '</span></div>';
      html += '<div style="height:4px;background:var(--border);border-radius:2px;position:relative;">';
      html += '<div style="position:absolute;left:' + pos + '%;top:-2px;width:8px;height:8px;background:' + color + ';border-radius:50%;transform:translateX(-50%);"></div>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</div>';

  // Breadth + Volume summary row
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">';

  // Breadth gauge
  var breadthColor = breadthPct >= 65 ? 'var(--green)' : breadthPct >= 40 ? 'var(--amber)' : 'var(--red)';
  html += '<div class="card" style="padding:14px 16px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Sector Breadth</div>';
  html += '<div style="font-size:28px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:' + breadthColor + ';">' + breadthPct + '%</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + sectorsUp + ' up / ' + sectorsDown + ' down</div>';
  html += '</div>';

  // Market status
  html += '<div class="card" style="padding:14px 16px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Market Status</div>';
  if (live) {
    html += '<div style="font-size:16px;font-weight:800;color:var(--green);">● OPEN</div>';
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Regular hours</div>';
  } else {
    html += '<div style="font-size:16px;font-weight:800;color:var(--text-muted);">○ CLOSED</div>';
    html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Data from last close</div>';
  }
  html += '</div>';

  // Data source
  html += '<div class="card" style="padding:14px 16px;text-align:center;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Data Source</div>';
  html += '<div style="font-size:14px;font-weight:700;color:var(--text-primary);">Polygon.io</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + (live ? '15-min delayed' : 'End of day') + ' · ' + ts + '</div>';
  html += '</div>';

  html += '</div>';

  // ════════════════════════════════════════════════════════════════
  // SECTION 3: TODAY'S THEMES (News + AI)
  // ════════════════════════════════════════════════════════════════
  html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;color:var(--text-primary);">Today\'s Themes</span><span class="card-badge badge-blue" style="font-size:8px;">AI + NEWS</span></div>';
  html += '<div style="display:flex;gap:6px;">';
  html += '<button id="generate-themes-btn" onclick="generateThemes()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--blue);background:rgba(37,99,235,0.08);color:var(--blue);cursor:pointer;font-size:10px;font-weight:700;font-family:\'Inter\',sans-serif;">Generate Themes</button>';
  html += '<button onclick="copyBriefingPrompt()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-size:10px;font-weight:600;font-family:\'Inter\',sans-serif;">Copy for Claude</button>';
  html += '</div></div>';

  // Themes content area
  html += '<div id="themes-content" style="padding:16px;">';

  // Check for cached themes
  var cachedThemes = null;
  try {
    var themeKey = 'mac_themes_' + new Date().toISOString().split('T')[0];
    var themeData = localStorage.getItem(themeKey);
    if (themeData) cachedThemes = JSON.parse(themeData);
  } catch(e) {}

  if (cachedThemes && cachedThemes.themes) {
    html += renderThemesHTML(cachedThemes.themes, cachedThemes.ts);
  } else {
    // Show latest news as fallback
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Click "Generate Themes" to get AI-powered market themes, or review the latest headlines below.</div>';
    if (newsArticles.length > 0) {
      html += '<div style="display:grid;gap:8px;">';
      var shownNews = newsArticles.slice(0, 8);
      shownNews.forEach(function(article) {
        var pubTime = new Date(article.published_utc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        var tickers = (article.tickers || []).slice(0, 4).join(', ');
        html += '<div style="display:flex;gap:10px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'var(--border)\'">';
        html += '<div style="flex:1;">';
        html += '<a href="' + (article.article_url || '#') + '" target="_blank" style="font-size:12px;font-weight:600;color:var(--text-primary);text-decoration:none;line-height:1.4;">' + (article.title || 'Untitled').replace(/</g, '&lt;') + '</a>';
        html += '<div style="display:flex;gap:8px;margin-top:3px;font-size:9px;color:var(--text-muted);">';
        html += '<span>' + pubTime + '</span>';
        if (article.publisher && article.publisher.name) html += '<span>' + article.publisher.name + '</span>';
        if (tickers) html += '<span style="color:var(--blue);font-weight:600;">' + tickers + '</span>';
        html += '</div></div></div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px;">No news available. Make sure your Polygon API key is set.</div>';
    }
  }

  html += '</div></div>';

  // ════════════════════════════════════════════════════════════════
  // SECTION 4: TOP IDEAS (from scanner results)
  // ════════════════════════════════════════════════════════════════
  html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">';
  html += '<div style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;color:var(--text-primary);">Top Ideas</span><span class="card-badge badge-green" style="font-size:8px;">FROM SCANNERS</span></div>';
  html += '<button onclick="runQuickScan()" id="quick-scan-btn" style="padding:5px 12px;border-radius:6px;border:1px solid var(--green);background:rgba(16,185,129,0.08);color:var(--green);cursor:pointer;font-size:10px;font-weight:700;font-family:\'Inter\',sans-serif;">Quick Scan</button>';
  html += '</div>';

  html += '<div id="top-ideas-content" style="padding:16px;">';

  // Check for cached scan results
  var cachedIdeas = null;
  try {
    var ideaKey = 'mac_top_ideas_' + new Date().toISOString().split('T')[0];
    var ideaData = localStorage.getItem(ideaKey);
    if (ideaData) cachedIdeas = JSON.parse(ideaData);
  } catch(e) {}

  if (cachedIdeas && cachedIdeas.ideas && cachedIdeas.ideas.length > 0) {
    html += renderTopIdeasHTML(cachedIdeas.ideas, cachedIdeas.ts);
  } else {
    html += '<div style="text-align:center;padding:24px;color:var(--text-muted);">';
    html += '<div style="font-size:16px;margin-bottom:8px;">—</div>';
    html += '<div style="font-size:12px;font-weight:600;">No scan results yet</div>';
    html += '<div style="font-size:11px;margin-top:4px;">Click "Quick Scan" above to find today\'s top setups, or run the full scanners in the Scanners tab.</div>';
    html += '</div>';
  }

  html += '</div></div>';

  // ════════════════════════════════════════════════════════════════
  // SECTION 5: SECTOR HEATMAP (collapsible)
  // ════════════════════════════════════════════════════════════════
  var heatmapCollapsed = localStorage.getItem('mac_heatmap_collapsed') === 'true';

  html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleHeatmap()" style="padding:12px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;color:var(--text-primary);">Sector Heatmap</span><span class="card-badge badge-blue" style="font-size:8px;">ROTATION</span></div>';
  html += '<span id="heatmap-arrow" style="font-size:12px;color:var(--text-muted);">' + (heatmapCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';

  html += '<div id="heatmap-body" style="' + (heatmapCollapsed ? 'display:none;' : '') + '">';

  // Heatmap grid
  html += '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;padding:14px 16px;">';
  sectorData.forEach(function(sec) {
    var chgColor, chgBg;
    if (sec.dayChg > 1) { chgColor = '#fff'; chgBg = '#059669'; }
    else if (sec.dayChg > 0.3) { chgColor = '#fff'; chgBg = '#10B981'; }
    else if (sec.dayChg > 0) { chgColor = 'var(--text-primary)'; chgBg = 'rgba(16,185,129,0.15)'; }
    else if (sec.dayChg > -0.3) { chgColor = 'var(--text-primary)'; chgBg = 'rgba(239,68,68,0.1)'; }
    else if (sec.dayChg > -1) { chgColor = '#fff'; chgBg = '#EF4444'; }
    else { chgColor = '#fff'; chgBg = '#DC2626'; }

    html += '<div style="background:' + chgBg + ';border-radius:8px;padding:12px;text-align:center;transition:transform 0.15s;" onmouseover="this.style.transform=\'scale(1.03)\'" onmouseout="this.style.transform=\'scale(1)\'">';
    html += '<div style="font-size:11px;font-weight:800;color:' + chgColor + ';">' + sec.etf + '</div>';
    html += '<div style="font-size:9px;color:' + chgColor + ';opacity:0.8;margin-top:1px;">' + sec.name + '</div>';
    html += '<div style="font-size:16px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:' + chgColor + ';margin-top:4px;">' + pct(sec.dayChg) + '</div>';
    html += '<div style="font-size:8px;color:' + chgColor + ';opacity:0.7;margin-top:2px;">Wk: ' + pct(sec.weekPerf) + '</div>';
    html += '</div>';
  });
  html += '</div>';

  html += '<div style="padding:8px 16px;border-top:1px solid var(--border);font-size:8px;color:var(--text-muted);display:flex;justify-content:space-between;">';
  html += '<span>Source: Polygon.io Snapshots + Daily Bars</span>';
  html += '<span>' + ts + '</span>';
  html += '</div>';

  html += '</div></div>';

  // ════════════════════════════════════════════════════════════════
  // SECTION 6: MORNING MINDSET (collapsible, kept from original)
  // ════════════════════════════════════════════════════════════════
  var mindsetRules = [
    "My job is execution, not prediction. Only job is to manage risk.",
    "Capital Conservation before Capital Growth.",
    "I only trade my edge — nothing else exists.",
    "Trading is a business, losses are business expenses.",
    "One trade means nothing.",
    "I don't need to trade — I wait to be invited.",
    "I don't fight the tape, I align with it.",
    "Hope has no room in my strategy.",
    "Boredom is a signal I'm doing this right.",
    "Fall in love with the process, the outcome will figure itself out.",
    "You are defined by how you handle losses.",
    "The market is always right, respect the market.",
    "Being wrong is okay.",
    "Always have a stop loss.",
    "Better to lose on a trade and follow your rules, than make money and not follow.",
    "Discipline and process is built day in and day out.",
    "Cut losers fast, let winners run as long as trend intact.",
    "Avoid chop, cash is a position.",
    "You have a limited number of bandwidth every day, conserve it."
  ];
  var todayIdx = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % mindsetRules.length;
  var dailyFocus = mindsetRules[todayIdx];
  var mindsetCollapsed = localStorage.getItem('mcc_mindset_collapsed') === 'true';

  html += '<div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;border-left:3px solid var(--amber);">';
  html += '<div onclick="toggleMindset()" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;font-weight:800;">Morning Mindset</span><span class="card-badge badge-amber" style="font-size:8px;">DAILY RULES</span></div>';
  html += '<span id="mindset-arrow" style="font-size:12px;color:var(--text-muted);">' + (mindsetCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';
  // Daily focus
  html += '<div style="padding:0 16px 10px;"><div style="background:var(--bg-secondary);border:1px solid rgba(230,138,0,0.2);border-radius:6px;padding:10px 14px;">';
  html += '<div style="font-size:8px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">Today\'s Focus</div>';
  html += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.4;">' + dailyFocus + '</div>';
  html += '</div></div>';
  // Full rules
  html += '<div id="mindset-body" style="' + (mindsetCollapsed ? 'display:none;' : '') + 'padding:0 16px 14px;">';
  html += '<div style="columns:2;column-gap:16px;">';
  mindsetRules.forEach(function(rule, i) {
    var isToday = i === todayIdx;
    html += '<div style="break-inside:avoid;padding:5px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:flex-start;' + (isToday ? 'background:var(--amber-bg);margin:0 -4px;padding:5px 4px;border-radius:4px;' : '') + '">';
    html += '<span style="font-size:10px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;min-width:18px;padding-top:1px;">' + (i+1) + '.</span>';
    html += '<span style="font-size:12px;color:' + (isToday ? 'var(--amber)' : 'var(--text-primary)') + ';line-height:1.4;font-weight:' + (isToday ? '700' : '500') + ';">' + rule + '</span>';
    html += '</div>';
  });
  html += '</div></div></div>';

  // ════════════════════════════════════════════════════════════════
  // ECONOMIC CALENDAR (paste-in, kept from original)
  // ════════════════════════════════════════════════════════════════
  html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Economic Calendar</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">' + tsLabel(ts) + ' · <a href="https://www.forexfactory.com/calendar" target="_blank" style="color:var(--blue);text-decoration:none;">ForexFactory.com</a></div></div>';
  html += '<div id="econ-cal-grid" style="padding:16px;font-size:11px;color:var(--text-muted);text-align:center;">Loading...</div>';
  html += '<div style="padding:6px 16px;border-top:1px solid var(--border);display:flex;gap:12px;font-size:8px;color:var(--text-muted);">';
  html += '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:3px;vertical-align:middle;"></span>High impact</span>';
  html += '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--amber);margin-right:3px;vertical-align:middle;"></span>Medium</span>';
  html += '<span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--text-muted);margin-right:3px;vertical-align:middle;"></span>Low</span>';
  html += '</div></div>';

  container.innerHTML = html;
  loadEconCalendar();
}

// ==================== REGIME OVERRIDE ====================
function saveRegimeOverride(val) {
  try { localStorage.setItem('mac_regime_override', val); } catch(e) {}
  renderOverview();
}

// ==================== HEATMAP TOGGLE ====================
function toggleHeatmap() {
  var body = document.getElementById('heatmap-body');
  var arrow = document.getElementById('heatmap-arrow');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
  try { localStorage.setItem('mac_heatmap_collapsed', isHidden ? 'false' : 'true'); } catch(e) {}
}

// ==================== MORNING MINDSET TOGGLE ====================
function toggleMindset() {
  var body = document.getElementById('mindset-body');
  var arrow = document.getElementById('mindset-arrow');
  if (!body) return;
  var isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
  try { localStorage.setItem('mcc_mindset_collapsed', isHidden ? 'false' : 'true'); } catch(e) {}
}

// ==================== RENDER THEMES HTML ====================
function renderThemesHTML(themes, cacheTs) {
  var html = '';
  var time = new Date(cacheTs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:10px;">Generated at ' + time + ' · <a href="#" onclick="localStorage.removeItem(\'mac_themes_\' + new Date().toISOString().split(\'T\')[0]);renderOverview();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';
  html += '<div style="display:grid;gap:10px;">';
  themes.forEach(function(theme, i) {
    var colors = ['var(--blue)', 'var(--purple)', 'var(--cyan)'];
    var bgs = ['rgba(37,99,235,0.05)', 'rgba(124,58,237,0.05)', 'rgba(8,145,178,0.05)'];
    var c = colors[i % colors.length];
    var bg = bgs[i % bgs.length];
    html += '<div style="background:' + bg + ';border:1px solid ' + c + '22;border-radius:8px;padding:14px 16px;border-left:3px solid ' + c + ';">';
    html += '<div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">' + (theme.title || 'Theme ' + (i+1)).replace(/</g, '&lt;') + '</div>';
    html += '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:6px;">' + (theme.description || '').replace(/</g, '&lt;') + '</div>';
    if (theme.tickers && theme.tickers.length > 0) {
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
      theme.tickers.forEach(function(t) {
        html += '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + c + '15;color:' + c + ';font-family:\'JetBrains Mono\',monospace;">' + t + '</span>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ==================== RENDER TOP IDEAS HTML ====================
function renderTopIdeasHTML(ideas, cacheTs) {
  var html = '';
  var time = new Date(cacheTs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:10px;">Last scan: ' + time + '</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px;">';

  ideas.forEach(function(idea, i) {
    var scoreColor = idea.score >= 80 ? 'var(--green)' : idea.score >= 60 ? 'var(--blue)' : idea.score >= 40 ? 'var(--amber)' : 'var(--text-muted)';
    var scoreBg = idea.score >= 80 ? 'rgba(16,185,129,0.06)' : idea.score >= 60 ? 'rgba(37,99,235,0.04)' : 'rgba(245,158,11,0.04)';

    html += '<div style="background:' + scoreBg + ';border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:3px solid ' + scoreColor + ';">';
    // Header row
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:16px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">' + idea.ticker + '</span>';
    html += '<span style="font-size:12px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$' + (idea.price ? idea.price.toFixed(2) : '—') + '</span>';
    html += '</div>';
    // Score badge
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:2px solid ' + scoreColor + ';font-size:12px;font-weight:900;color:' + scoreColor + ';font-family:\'JetBrains Mono\',monospace;">' + idea.score + '</div>';
    html += '</div>';
    // Scanner source
    if (idea.source) {
      html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:6px;">via ' + idea.source + '</div>';
    }
    // Thesis / why
    if (idea.thesis) {
      html += '<div style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px;">' + idea.thesis.replace(/</g, '&lt;') + '</div>';
    }
    // Key levels
    if (idea.entry || idea.stop || idea.target) {
      html += '<div style="display:flex;gap:10px;font-size:9px;font-family:\'JetBrains Mono\',monospace;padding:6px 8px;background:var(--bg-secondary);border-radius:4px;">';
      if (idea.entry) html += '<span style="color:var(--blue);">Entry: $' + idea.entry + '</span>';
      if (idea.stop) html += '<span style="color:var(--red);">Stop: $' + idea.stop + '</span>';
      if (idea.target) html += '<span style="color:var(--green);">Target: $' + idea.target + '</span>';
      html += '</div>';
    }
    // Position sizing
    if (idea.price && idea.stop) {
      html += sizingHTML(parseFloat(idea.entry || idea.price), parseFloat(idea.stop));
    }
    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ==================== GENERATE THEMES (AI + NEWS) ====================
async function generateThemes() {
  var btn = document.getElementById('generate-themes-btn');
  var el = document.getElementById('themes-content');
  if (!el) return;
  if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }

  // Get Anthropic key
  var anthropicKey = '';
  try { anthropicKey = localStorage.getItem('mtp_anthropic_key') || ''; } catch(e) {}

  if (!anthropicKey) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--amber);font-size:12px;">Anthropic API key required for AI themes. Click the gear icon to add your key.<br><span style="font-size:10px;color:var(--text-muted);">You can still use "Copy for Claude" to manually generate themes.</span></div>';
    if (btn) { btn.textContent = 'Generate Themes'; btn.disabled = false; }
    return;
  }

  // Fetch latest news for context
  var newsContext = '';
  try {
    var articles = await getPolygonNews(null, 15);
    if (articles.length > 0) {
      newsContext = articles.map(function(a) {
        return '- ' + (a.title || '') + ' (' + (a.tickers || []).slice(0, 3).join(', ') + ')';
      }).join('\n');
    }
  } catch(e) {}

  // Get market data context
  var marketContext = '';
  try {
    var idxSnap = await getSnapshots(['SPY','QQQ','IWM']);
    var mkts = ['SPY','QQQ','IWM'].map(function(t) {
      var s = idxSnap[t];
      if (!s) return t + ': N/A';
      var p = s.day && s.day.c ? s.day.c : 0;
      var prev = s.prevDay ? s.prevDay.c : p;
      var pctVal = prev > 0 ? ((p - prev) / prev * 100) : 0;
      return t + ': $' + p.toFixed(2) + ' (' + (pctVal >= 0 ? '+' : '') + pctVal.toFixed(2) + '%)';
    });
    marketContext = mkts.join(' | ');
  } catch(e) {}

  var prompt = 'You are a professional market analyst. Based on today\'s market data and news, identify the 2-3 most important market themes driving price action today.\n\nMarket Data: ' + marketContext + '\n\nLatest Headlines:\n' + newsContext + '\n\nFor each theme, provide:\n1. A short title (5-8 words)\n2. A brief explanation (2-3 sentences) of WHY this matters and how it affects the market\n3. 3-5 specific ticker symbols most affected by this theme\n\nRespond in this exact JSON format:\n[{"title":"Theme Title","description":"Why this matters...","tickers":["AAPL","MSFT"]}]\n\nIMPORTANT: Respond with ONLY the JSON array. No other text.';

  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error('API ' + response.status + ': ' + errText.substring(0, 200));
    }

    var data = await response.json();
    var text = data.content && data.content[0] ? data.content[0].text : '';

    // Parse JSON from response
    var jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Could not parse themes from AI response');

    var themes = JSON.parse(jsonMatch[0]);

    // Cache for today
    var themeKey = 'mac_themes_' + new Date().toISOString().split('T')[0];
    try { localStorage.setItem(themeKey, JSON.stringify({ themes: themes, ts: Date.now() })); } catch(e) {}

    el.innerHTML = renderThemesHTML(themes, Date.now());
  } catch(e) {
    el.innerHTML = '<div style="padding:12px;color:var(--red);font-size:11px;">Theme generation failed: ' + e.message + '<br><span style="color:var(--text-muted);">Try "Copy for Claude" instead.</span></div>';
  }

  if (btn) { btn.textContent = 'Generate Themes'; btn.disabled = false; }
}

// ==================== QUICK SCAN (for Top Ideas) ====================
async function runQuickScan() {
  var btn = document.getElementById('quick-scan-btn');
  var el = document.getElementById('top-ideas-content');
  if (!el) return;
  if (btn) { btn.textContent = 'Scanning...'; btn.disabled = true; }

  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Running quick scan on top tickers... <span id="qs-progress"></span></div>';

  try {
    // Quick scan: check a subset of popular tickers for compression
    var quickTickers = [
      'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM',
      'NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD',
      'MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM',
      'GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA',
      'MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML'
    ];

    // Get snapshots
    var allSnap = {};
    for (var bi = 0; bi < quickTickers.length; bi += 30) {
      var batch = quickTickers.slice(bi, bi + 30);
      try {
        var batchSnap = await getSnapshots(batch);
        Object.assign(allSnap, batchSnap);
      } catch(e) {}
    }

    var ideas = [];

    for (var qi = 0; qi < quickTickers.length; qi++) {
      var ticker = quickTickers[qi];
      var prog = document.getElementById('qs-progress');
      if (prog) prog.textContent = (qi + 1) + '/' + quickTickers.length;

      try {
        var bars = await getDailyBars(ticker, 60);
        if (bars.length < 20) continue;

        var s = allSnap[ticker];
        var p = 0, prev = 0, dayChg = 0;
        if (s) {
          p = s.day && s.day.c ? s.day.c : (s.lastTrade ? s.lastTrade.p : 0);
          prev = s.prevDay ? s.prevDay.c : p;
          dayChg = prev > 0 ? ((p - prev) / prev) * 100 : 0;
        }
        if (!p) continue;

        // Calculate SMAs
        var closes = bars.map(function(b) { return b.c; });
        var len = closes.length;
        function qSma(period) { if (len < period) return null; var sum = 0; for (var i = len - period; i < len; i++) sum += closes[i]; return sum / period; }
        var sma10 = qSma(10), sma20 = qSma(20), sma50 = qSma(50);

        if (!sma10 || !sma20) continue;

        // Compression: 10/20 SMA spread
        var spread1020 = Math.abs(sma10 - sma20) / p * 100;
        var aboveBoth = p > sma10 && p > sma20;

        // Extension from 20 SMA
        var ext = ((p - sma20) / sma20) * 100;

        // RVOL
        var rvol = null;
        if (bars.length >= 21) {
          var avgVol = bars.slice(-21, -1).reduce(function(sum, b) { return sum + (b.v || 0); }, 0) / 20;
          var todayVol = s && s.day ? s.day.v : 0;
          if (avgVol > 0 && todayVol > 0) rvol = todayVol / avgVol;
        }

        // Score: compression + bullish + proximity + volume
        var score = 0;
        if (spread1020 <= 1) score += 30;
        else if (spread1020 <= 2) score += 22;
        else if (spread1020 <= 3) score += 15;
        else if (spread1020 <= 5) score += 8;
        else continue; // not compressed enough

        if (aboveBoth) score += 15;
        if (sma50 && p > sma50) score += 10;

        // Base proximity
        if (ext <= 2) score += 25;
        else if (ext <= 4) score += 18;
        else if (ext <= 6) score += 10;
        else if (ext <= 8) score += 4;
        else score -= 5;

        // Volume
        if (rvol) {
          if (rvol >= 2.0) score += 10;
          else if (rvol >= 1.5) score += 7;
          else if (rvol >= 1.0) score += 4;
        }

        // Day change bonus
        if (dayChg > 1) score += 5;
        else if (dayChg > 0) score += 2;

        score = Math.round(Math.min(100, Math.max(0, score)));
        if (score < 30) continue;

        // Build thesis
        var thesis = '';
        if (spread1020 <= 2) thesis += 'Tight SMA compression (' + spread1020.toFixed(1) + '%). ';
        if (aboveBoth) thesis += 'Price above 10/20 SMA. ';
        if (ext <= 3) thesis += 'Near base (' + ext.toFixed(1) + '% from 20 SMA). ';
        if (rvol && rvol >= 1.5) thesis += 'Elevated volume (' + rvol.toFixed(1) + 'x avg). ';

        // Estimate entry/stop/target
        var entry = p.toFixed(2);
        var stop = (sma20 * 0.98).toFixed(2);
        var rr = p + (p - sma20 * 0.98) * 2;
        var target = rr.toFixed(2);

        ideas.push({
          ticker: ticker, price: p, score: score,
          source: 'Compression Scanner',
          thesis: thesis,
          entry: entry, stop: stop, target: target
        });
      } catch(e) { continue; }
    }

    // Sort and take top 4
    ideas.sort(function(a, b) { return b.score - a.score; });
    ideas = ideas.slice(0, 4);

    // Cache
    var ideaKey = 'mac_top_ideas_' + new Date().toISOString().split('T')[0];
    try { localStorage.setItem(ideaKey, JSON.stringify({ ideas: ideas, ts: Date.now() })); } catch(e) {}

    if (ideas.length > 0) {
      el.innerHTML = renderTopIdeasHTML(ideas, Date.now());
    } else {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px;">No strong setups found in the quick scan. Try the full scanners for a deeper look.</div>';
    }
  } catch(e) {
    el.innerHTML = '<div style="color:var(--red);font-size:11px;">Quick scan failed: ' + e.message + '</div>';
  }

  if (btn) { btn.textContent = 'Quick Scan'; btn.disabled = false; }
}

// ==================== ECONOMIC CALENDAR (paste-in) ====================
async function loadEconCalendar() {
  var el = document.getElementById('econ-cal-grid');
  if (!el) return;
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];
  var saved = null;
  try { var raw = localStorage.getItem(cacheKey); if (raw) saved = JSON.parse(raw); } catch(e) {}
  if (saved && saved.text) { renderPastedCal(el, saved.text, saved.ts); }
  else { showCalPasteBox(el); }
}

function showCalPasteBox(el) {
  var html = '<div style="padding:12px 14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  html += '<span style="font-size:9px;color:var(--text-muted);">Paste USD events from FF (Medium + High impact)</span>';
  html += '<a href="https://www.forexfactory.com/calendar" target="_blank" style="padding:4px 10px;border-radius:4px;border:1px solid var(--blue);background:rgba(59,130,246,0.08);color:var(--blue);font-size:9px;font-weight:700;text-decoration:none;">Forex Factory</a>';
  html += '</div>';
  html += '<textarea id="econ-cal-paste" placeholder="Select USD rows on Forex Factory → Copy → Paste here" style="width:100%;height:80px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--text-primary);resize:vertical;box-sizing:border-box;line-height:1.5;"></textarea>';
  html += '<button onclick="saveEconCal()" style="margin-top:6px;padding:5px 14px;border-radius:4px;border:1px solid var(--green);background:rgba(0,135,90,0.08);color:var(--green);cursor:pointer;font-size:9px;font-weight:700;">Save</button>';
  html += '</div>';
  el.innerHTML = html;
}

function saveEconCal() {
  var textarea = document.getElementById('econ-cal-paste');
  if (!textarea || !textarea.value.trim()) return;
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];
  try { localStorage.setItem(cacheKey, JSON.stringify({ text: textarea.value.trim(), ts: Date.now() })); } catch(e) {}
  var el = document.getElementById('econ-cal-grid');
  renderPastedCal(el, textarea.value.trim(), Date.now());
}

function clearEconCal() {
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  var cacheKey = 'mtp_econ_cal_ff_' + monday.toISOString().split('T')[0];
  try { localStorage.removeItem(cacheKey); } catch(e) {}
  var el = document.getElementById('econ-cal-grid');
  showCalPasteBox(el);
}

function renderPastedCal(el, text, ts) {
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
  var events = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (line === 'USD') { i++; continue; }
    if (/^\d{1,2}:\d{2}(am|pm)$/i.test(line)) { i++; continue; }
    if (/[a-zA-Z]{3,}/.test(line) && !/^\d/.test(line)) {
      var ev = { name: line, details: '' };
      var dataLines = [];
      var j = i + 1;
      while (j < lines.length) {
        var next = lines[j];
        if (next === 'USD') break;
        if (/[a-zA-Z]{3,}/.test(next) && !/^[\d\-]/.test(next) && !/^\d{1,2}:\d{2}/.test(next) && !/%|[KMB]$/.test(next)) break;
        dataLines.push(next);
        j++;
      }
      if (dataLines.length > 0) ev.details = dataLines.join(' · ');
      events.push(ev);
      i = j;
    } else { i++; }
  }

  var html = '<div style="padding:10px 14px;max-height:200px;overflow-y:auto;">';
  if (events.length > 0) {
    events.forEach(function(ev) {
      var name = ev.name.toLowerCase();
      var isHigh = /gdp|pce|cpi|nonfarm|payroll|fomc|fed fund|interest rate|unemployment rate|retail sales|ism manu/.test(name);
      var isMed = /pmi|housing|home sale|consumer confidence|jobless|claim|durable|sentiment|philly|empire|pending|trump speaks|president/.test(name);
      var dotColor = isHigh ? 'var(--red)' : isMed ? 'var(--amber)' : 'var(--text-muted)';
      html += '<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;font-size:9px;">';
      html += '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:3px;"></span>';
      html += '<span style="color:var(--text-primary);font-weight:600;">' + ev.name + '</span>';
      if (ev.details) html += '<span style="color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;font-size:8px;margin-left:2px;">' + ev.details + '</span>';
      html += '</div>';
    });
  } else {
    html += '<div style="white-space:pre-wrap;font-family:\'JetBrains Mono\',monospace;font-size:9px;line-height:1.5;color:var(--text-secondary);">' + text.replace(/</g, '&lt;') + '</div>';
  }
  html += '</div>';

  var fetchTime = new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  html += '<div style="padding:6px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:8px;color:var(--text-muted);">';
  html += '<span>Source: <a href="https://www.forexfactory.com/calendar" target="_blank" style="color:var(--blue);text-decoration:none;font-weight:600;">ForexFactory.com</a> · ' + fetchTime + '</span>';
  html += '<button onclick="clearEconCal()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:2px 8px;font-size:8px;color:var(--text-muted);cursor:pointer;">Update</button>';
  html += '</div>';
  el.innerHTML = html;
}

// ==================== COPY BRIEFING PROMPT ====================
async function copyBriefingPrompt() {
  var prompt = 'Generate my morning trading briefing for today. 1. MACRO THEMES — 2-3 sentences on what\'s driving markets 2. SECTOR OUTLOOK — what\'s hot, what\'s cold, rotation signals 3. TOP 5 TRADE IDEAS — specific tickers with key levels and direction 4. RISK EVENTS — earnings, fed speakers, geopolitical catalysts 5. KEY LEVELS — SPY and QQQ support/resistance for the session';
  navigator.clipboard.writeText(prompt).then(function() {
    window.open('https://claude.ai', '_blank');
  }).catch(function() {});
}
