// ==================== chart.js ====================
// Global TradingView chart popup + Qullamaggie position sizing panel
// Click any ticker to open a daily chart with trade levels, ATR, market cap, news

// ── First-time hint banner ──
(function() {
  var HINT_KEY = 'mac_chart_hint_seen';
  if (localStorage.getItem(HINT_KEY)) return;

  // Wait for app to render
  setTimeout(function() {
    var target = document.getElementById('app-content') || document.body;
    var hint = document.createElement('div');
    hint.id = 'chart-hint-banner';
    hint.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9000;background:var(--bg-card);border:1px solid var(--blue);border-radius:10px;padding:10px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,0.15);max-width:min(400px,90vw);';
    hint.innerHTML = '<span style="font-size:14px;color:var(--text-primary);line-height:1.4;">Tip: Click any <strong style="font-family:var(--font-mono);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;">ticker symbol</strong> to view its daily chart.</span>'
      + '<button onclick="this.parentElement.remove();localStorage.setItem(\'mac_chart_hint_seen\',\'1\');" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:0 2px;flex-shrink:0;">&times;</button>';
    target.appendChild(hint);

    // Auto-dismiss after 8 seconds
    setTimeout(function() {
      var el = document.getElementById('chart-hint-banner');
      if (el) { el.style.transition='opacity 0.3s'; el.style.opacity='0'; setTimeout(function(){ el.remove(); }, 300); }
      localStorage.setItem(HINT_KEY, '1');
    }, 8000);
  }, 3000);
})();

// ==================== POSITION SIZING HELPERS ====================

function getRegimeRiskMultiplier() {
  var regime = window._currentRegime || 'Neutral';
  if (regime === 'Risk On') return { mult: 1.0, label: 'Full size (Risk On)', color: 'var(--green)' };
  if (regime === 'Lean Bullish') return { mult: 0.75, label: '75% size (Lean Bullish)', color: 'var(--green)' };
  if (regime === 'Neutral') return { mult: 0.5, label: '50% size (Neutral)', color: 'var(--text-muted)' };
  if (regime === 'Choppy / Low Conviction') return { mult: 0.5, label: '50% size (Choppy)', color: 'var(--amber)' };
  if (regime === 'Lean Bearish') return { mult: 0.35, label: '35% size (Lean Bearish)', color: 'var(--red)' };
  if (regime === 'Risk Off') return { mult: 0.25, label: '25% size (Risk Off)', color: 'var(--red)' };
  return { mult: 0.5, label: '50% size (' + regime + ')', color: 'var(--amber)' };
}

function calcATR(bars, period) {
  if (!bars || bars.length < period + 1) return null;
  var trs = [];
  for (var i = 1; i < bars.length; i++) {
    var h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  var start = Math.max(0, trs.length - period);
  var sum = 0;
  for (var j = start; j < trs.length; j++) sum += trs[j];
  return sum / (trs.length - start);
}

function getScannerData(ticker) {
  try {
    var raw = localStorage.getItem('mac_scan_results');
    if (!raw) return null;
    var data = JSON.parse(raw);
    var all = (data.earlyBreakouts || []).concat(data.pullbackEntries || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].ticker === ticker) return all[i];
    }
  } catch (e) {}
  return null;
}

function calcPositionSize(accountSize, riskPct, regimeMult, entryPrice, stopPrice) {
  if (!accountSize || !entryPrice || !stopPrice || entryPrice <= stopPrice) return null;
  var adjustedRisk = (riskPct / 100) * regimeMult;
  var dollarRisk = accountSize * adjustedRisk;
  var riskPerShare = entryPrice - stopPrice;
  if (riskPerShare <= 0) return null;
  var shares = Math.floor(dollarRisk / riskPerShare);
  if (shares <= 0) return null;
  return {
    shares: shares,
    dollarCost: shares * entryPrice,
    riskPerShare: riskPerShare,
    dollarRisk: shares * riskPerShare,
    adjustedRiskPct: adjustedRisk * 100,
    target1R: entryPrice + riskPerShare,
    target2R: entryPrice + riskPerShare * 2,
    target3R: entryPrice + riskPerShare * 3
  };
}

// ==================== TRADE DATA PANEL ====================

function _statLine(label, value, color) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">'
    + '<span style="font-size:13px;color:var(--text-muted);">' + label + '</span>'
    + '<span style="font-size:14px;font-weight:700;font-family:var(--font-mono);color:' + color + ';">' + value + '</span>'
    + '</div>';
}

function _fmtPrice(v) {
  if (!v || isNaN(v)) return '---';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fmtDollars(v) {
  if (!v || isNaN(v)) return '---';
  return '$' + Math.round(v).toLocaleString('en-US');
}

function _fmtMcap(mc) {
  if (!mc || mc <= 0) return '---';
  if (mc >= 1e12) return '$' + (mc / 1e12).toFixed(1) + 'T';
  if (mc >= 1e9) return '$' + (mc / 1e9).toFixed(1) + 'B';
  if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(0) + 'M';
  return '$' + mc.toLocaleString('en-US');
}

async function loadTradePanel(ticker, panelEl) {
  var accountSize = parseFloat(localStorage.getItem('mcc_account')) || 0;
  var baseRiskPct = parseFloat(localStorage.getItem('mcc_risk')) || 1.0;
  var regimeInfo = getRegimeRiskMultiplier();
  var scanData = getScannerData(ticker);

  // Fetch data in parallel: daily bars, ticker details, news (+ snapshot if no scanner data)
  var fetchPromises = [
    getDailyBars(ticker, 30).catch(function() { return []; }),
    polyGet('/v3/reference/tickers/' + encodeURIComponent(ticker)).catch(function() { return {}; }),
    getPolygonNews([ticker], 5).catch(function() { return []; })
  ];
  if (!scanData) {
    fetchPromises.push(getSnapshots([ticker]).catch(function() { return {}; }));
  }

  try {
    var results = await Promise.all(fetchPromises);
    var bars = results[0];
    var tickerInfo = results[1].results || results[1] || {};
    var news = results[2] || [];
    var snapshot = results[3] || null;

    var atr = calcATR(bars, 14);
    var entryPrice, stopPrice, category;

    if (scanData) {
      entryPrice = scanData.entryPrice || scanData.price;
      stopPrice = scanData.stopPrice;
      category = scanData.category || 'Scanner';
    } else {
      var snapData = snapshot ? snapshot[ticker] : null;
      var curPrice = 0;
      if (snapData) {
        curPrice = (snapData.day && snapData.day.c && snapData.day.c > 0) ? snapData.day.c : (snapData.prevDay ? snapData.prevDay.c : 0);
      }
      if (!curPrice && bars && bars.length > 0) curPrice = bars[bars.length - 1].c;
      entryPrice = curPrice;
      stopPrice = atr ? curPrice - (atr * 1.5) : curPrice * 0.95;
      category = null;
    }

    var posSize = null;
    if (accountSize > 0 && entryPrice > 0 && stopPrice > 0) {
      posSize = calcPositionSize(accountSize, baseRiskPct, regimeInfo.mult, entryPrice, stopPrice);
    }

    renderTradePanel(panelEl, {
      ticker: ticker,
      entryPrice: entryPrice,
      stopPrice: stopPrice,
      category: category,
      atr: atr,
      marketCap: tickerInfo.market_cap || 0,
      regimeInfo: regimeInfo,
      posSize: posSize,
      accountSize: accountSize,
      baseRiskPct: baseRiskPct,
      news: news
    });
  } catch (e) {
    panelEl.innerHTML = '<div style="text-align:center;color:var(--red);font-size:12px;padding:8px;">Could not load trade data.</div>';
  }
}

function renderTradePanel(panelEl, d) {
  var html = '';

  // If no account size, show prompt + still show info row
  if (!d.accountSize) {
    html += '<div style="text-align:center;padding:10px 0 6px;">';
    html += '<div style="font-size:14px;color:var(--text-muted);margin-bottom:8px;">Set your account size in Settings to see position sizing.</div>';
    html += '<button onclick="toggleSettings()" style="background:var(--blue);color:white;border:none;border-radius:6px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;">Open Settings</button>';
    html += '</div>';
    html += renderInfoRow(d);
    panelEl.innerHTML = html;
    return;
  }

  // Source badge
  var sourceBadge = d.category
    ? '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(37,99,235,0.1);color:var(--blue);font-weight:700;">' + escapeHtml(d.category) + '</span>'
    : '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg-secondary);color:var(--text-muted);font-weight:600;">ATR-based levels</span>';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:16px;font-weight:800;color:var(--text-primary);">Position Sizing</span>';
  html += sourceBadge;
  html += '</div>';
  html += '<span style="font-size:13px;color:' + d.regimeInfo.color + ';font-weight:700;">' + escapeHtml(d.regimeInfo.label) + '</span>';
  html += '</div>';

  // 3-column grid
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:10px;">';

  // Column 1: Trade Levels
  html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:14px;">';
  html += '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Trade Levels</div>';
  html += _statLine('Entry', _fmtPrice(d.entryPrice), 'var(--blue)');
  html += _statLine('Stop', _fmtPrice(d.stopPrice), 'var(--red)');
  html += _statLine('Risk/Share', d.posSize ? _fmtPrice(d.posSize.riskPerShare) : '---', 'var(--text-secondary)');
  html += _statLine('ATR (14)', d.atr ? _fmtPrice(d.atr) : '---', 'var(--text-secondary)');
  html += '</div>';

  // Column 2: Position Size
  html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:14px;">';
  html += '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Position Size</div>';
  if (d.posSize) {
    html += _statLine('Shares', d.posSize.shares.toLocaleString(), 'var(--text-primary)');
    html += _statLine('Cost', _fmtDollars(d.posSize.dollarCost), 'var(--text-secondary)');
    html += _statLine('$ at Risk', _fmtDollars(d.posSize.dollarRisk), 'var(--red)');
    html += _statLine('Risk %', d.posSize.adjustedRiskPct.toFixed(2) + '%', 'var(--text-muted)');
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">Cannot calculate (check entry/stop)</div>';
  }
  html += '</div>';

  // Column 3: Targets & Trail
  html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:14px;">';
  html += '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Targets & Trail</div>';
  if (d.posSize) {
    html += _statLine('1R \u2192 sell \u2153', _fmtPrice(d.posSize.target1R), 'var(--green)');
    html += _statLine('2R \u2192 sell \u2153', _fmtPrice(d.posSize.target2R), 'var(--green)');
    html += _statLine('3R \u2192 sell \u2153', _fmtPrice(d.posSize.target3R), 'var(--green)');
    html += _statLine('Trail', '10/20 EMA', 'var(--text-muted)');
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">---</div>';
  }
  html += '</div>';

  html += '</div>'; // end grid

  // Info row
  html += renderInfoRow(d);

  panelEl.innerHTML = html;
}

function renderInfoRow(d) {
  var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px;">';

  // Market cap
  html += '<span style="color:var(--text-muted);">Mkt Cap: <strong style="color:var(--text-secondary);">' + _fmtMcap(d.marketCap) + '</strong></span>';

  // ATR (show even without account size)
  if (d.atr && !d.accountSize) {
    html += '<span style="color:var(--text-muted);">ATR (14): <strong style="color:var(--text-secondary);">' + _fmtPrice(d.atr) + '</strong></span>';
  }

  // Disclaimer
  html += '<span style="color:var(--text-muted);opacity:0.6;">Levels approximate (15-min delay)</span>';

  // News links
  if (d.news && d.news.length > 0) {
    html += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Recent News</div>';
    d.news.slice(0, 4).forEach(function(article) {
      var title = (article.title || '').substring(0, 80);
      if ((article.title || '').length > 80) title += '\u2026';
      var url = article.article_url || '#';
      var source = article.publisher ? article.publisher.name || '' : '';
      html += '<div style="margin-bottom:5px;">';
      html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" '
        + 'onclick="event.stopPropagation();" '
        + 'style="color:var(--blue);text-decoration:none;font-size:14px;line-height:1.4;display:block;" '
        + 'title="' + escapeHtml(article.title || '') + '">' + escapeHtml(title) + '</a>';
      if (source) html += '<span style="font-size:12px;color:var(--text-muted);">' + escapeHtml(source) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ==================== CHART POPUP ====================

function openTVChart(ticker) {
  if (!ticker) return;
  ticker = ticker.toUpperCase().trim();

  // Remove any existing modal
  var existing = document.getElementById('tv-chart-modal');
  if (existing) existing.remove();

  // Create modal overlay
  var overlay = document.createElement('div');
  overlay.id = 'tv-chart-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape key
  function escHandler(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  }
  document.addEventListener('keydown', escHandler);

  // Detect dark mode
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  var tvTheme = isDark ? 'dark' : 'light';

  // Modal container (wider + taller to fit data panel)
  var modal = document.createElement('div');
  modal.style.cssText = 'position:relative;width:100%;max-width:1100px;height:85vh;max-height:750px;background:var(--bg-card);border-radius:14px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.3);display:flex;flex-direction:column;margin:8px;';

  // Header bar
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;';
  header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
    + '<span style="font-size:16px;font-weight:800;font-family:var(--font-mono);">' + escapeHtml(ticker) + '</span>'
    + '<span style="font-size:12px;color:var(--text-muted);">Daily Chart</span>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:12px;">'
    + '<span style="font-size:12px;color:var(--text-muted);opacity:0.7;">15-min delayed</span>'
    + '<button onclick="document.getElementById(\'tv-chart-modal\').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">&times;</button>'
    + '</div>';
  modal.appendChild(header);

  // Chart container
  var chartWrap = document.createElement('div');
  chartWrap.id = 'tv-chart-container';
  chartWrap.style.cssText = 'flex:1;min-height:300px;';
  modal.appendChild(chartWrap);

  // Data panel (below chart)
  var dataPanel = document.createElement('div');
  dataPanel.id = 'tv-data-panel';
  dataPanel.style.cssText = 'flex-shrink:0;overflow-y:auto;border-top:1px solid var(--border);padding:16px 20px;';
  dataPanel.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:6px;">Loading trade data\u2026</div>';
  modal.appendChild(dataPanel);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Map Polygon MIC codes to TradingView exchange prefixes
  var _micToTV = {
    'XNAS': 'NASDAQ', 'XNGS': 'NASDAQ', 'XNMS': 'NASDAQ',
    'XNYS': 'NYSE', 'ARCX': 'NYSE_ARCA', 'XASE': 'AMEX',
    'BATS': 'CBOE_BZX', 'IEXG': 'IEX'
  };

  function _loadTVWidget(tvSymbol) {
    var script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.onload = function() {
      if (typeof TradingView === 'undefined') return;
      new TradingView.widget({
        container_id: 'tv-chart-container',
        autosize: true,
        symbol: tvSymbol,
        interval: 'D',
        timezone: 'America/New_York',
        theme: tvTheme,
        style: '1',
        locale: 'en',
        toolbar_bg: 'transparent',
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        studies: ['MASimple@tv-basicstudies'],
        hide_side_toolbar: true,
        allow_symbol_change: true,
        withdateranges: true,
        details: false
      });
    };
    document.head.appendChild(script);
  }

  // Look up US exchange from Polygon, then load chart with correct prefix
  if (typeof polyGet === 'function') {
    polyGet('/v3/reference/tickers/' + encodeURIComponent(ticker)).then(function(res) {
      var info = res.results || res || {};
      var mic = info.primary_exchange || '';
      var tvExchange = _micToTV[mic] || '';
      var tvSymbol = tvExchange ? (tvExchange + ':' + ticker) : ticker;
      _loadTVWidget(tvSymbol);
    }).catch(function() {
      _loadTVWidget(ticker); // fallback: bare ticker
    });
  } else {
    _loadTVWidget(ticker);
  }

  // Load trade data panel (async — doesn't block chart)
  loadTradePanel(ticker, dataPanel);
}
