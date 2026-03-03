// ==================== analysis.js ====================
// Analysis tab: Claude's Market Analysis Engine (analysisNav, renderAnalysis,
// formatAnalysisHTML, addAnalysisEntry), Analysis Chat Engine
// (saveAnalysisApiKey, loadAnalysisApiKey, addChatMessage, sendAnalysisChat),
// and seed data for demonstration (Feb 20/23 2026).

// ==================== CLAUDE'S MARKET ANALYSIS ENGINE ====================
var analysisCurrentDate = new Date().toISOString().split('T')[0];
var _analysisCache = {};

function analysisNav(dir) {
  var d = new Date(analysisCurrentDate + 'T12:00:00');
  d.setDate(d.getDate() + dir);
  analysisCurrentDate = d.toISOString().split('T')[0];
  renderAnalysis();
}

function getAnalysis(date) {
  // Try localStorage first, fall back to in-memory cache
  try {
    var raw = localStorage.getItem('mtp_analysis_' + date);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  if (_analysisCache[date]) return _analysisCache[date];
  return null;
}

function saveAnalysis(date, data) {
  _analysisCache[date] = data;
  try { localStorage.setItem('mtp_analysis_' + date, JSON.stringify(data)); } catch(e) {}
  // Cloud sync
  if (typeof dbSaveAnalysis === 'function' && typeof getUser === 'function' && getUser()) {
    dbSaveAnalysis(date, data).catch(function(e) { console.warn('[analysis] cloud sync error:', e); });
  }
}

function getAllAnalysisDates() {
  var dates = {};
  // From localStorage
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith('mtp_analysis_')) dates[key.replace('mtp_analysis_', '')] = true;
    }
  } catch(e) {}
  // From memory cache
  Object.keys(_analysisCache).forEach(function(d) { dates[d] = true; });
  return Object.keys(dates).sort().reverse();
}

// ==================== MARKET SNAPSHOT (auto-fetch for empty dates) ====================
var _snapshotCache = {};

async function fetchMarketSnapshot(dateStr) {
  // If we already fetched for this date, use cache
  if (_snapshotCache[dateStr]) {
    renderSnapshotData(_snapshotCache[dateStr]);
    return;
  }

  var polygonKey = ''; try { polygonKey = localStorage.getItem('mtp_polygon_key') || ''; } catch(e) {}
  if (!polygonKey) polygonKey = 'cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';

  var indices = ['SPY', 'QQQ', 'IWM'];
  var sectorETFs = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLRE', 'XLU', 'XLB', 'XLC', 'XLP', 'SMH'];
  var sectorNames = { 'XLK':'Technology','XLF':'Financials','XLE':'Energy','XLV':'Healthcare','XLY':'Consumer Disc.','XLI':'Industrials','XLRE':'Real Estate','XLU':'Utilities','XLB':'Materials','XLC':'Comm. Services','XLP':'Consumer Staples','SMH':'Semiconductors' };
  var moversUniverse = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL'];

  // Date range: 5 days back to get prev close
  var fromDate = new Date(dateStr + 'T12:00:00');
  fromDate.setDate(fromDate.getDate() - 5);
  var fromStr = fromDate.toISOString().split('T')[0];
  var toDate = new Date(dateStr + 'T12:00:00');
  toDate.setDate(toDate.getDate() + 1);
  var toStr = toDate.toISOString().split('T')[0];

  var allTickers = indices.concat(sectorETFs).concat(moversUniverse);
  // Dedupe
  var seen = {}; allTickers = allTickers.filter(function(t) { if (seen[t]) return false; seen[t] = true; return true; });

  var barData = {};
  var batchSize = 5;

  for (var i = 0; i < allTickers.length; i++) {
    try {
      var url = 'https://api.polygon.io/v2/aggs/ticker/' + allTickers[i] + '/range/1/day/' + fromStr + '/' + toStr + '?adjusted=true&sort=asc&apiKey=' + polygonKey;
      var resp = await fetch(url);
      if (resp.ok) {
        var json = await resp.json();
        if (json.results && json.results.length > 0) barData[allTickers[i]] = json.results;
      }
    } catch(e) {}
    if (i > 0 && i % batchSize === 0) await new Promise(function(r) { setTimeout(r, 250); });
  }

  // Find the most recent trading date available in the data
  var targetDate = dateStr;
  var spyBars = barData['SPY'];
  if (spyBars && spyBars.length > 0) {
    // Use the last bar available (closest to target date)
    var lastBar = spyBars[spyBars.length - 1];
    var lastBarDate = new Date(lastBar.t).toISOString().split('T')[0];
    if (lastBarDate <= dateStr) targetDate = lastBarDate;
  }

  function getChange(ticker) {
    var bars = barData[ticker];
    if (!bars || bars.length < 2) return null;
    // Find bar for targetDate or closest
    for (var j = bars.length - 1; j >= 1; j--) {
      var bd = new Date(bars[j].t).toISOString().split('T')[0];
      if (bd <= targetDate) {
        return { close: bars[j].c, pct: ((bars[j].c - bars[j-1].c) / bars[j-1].c) * 100, volume: bars[j].v, date: bd };
      }
    }
    return null;
  }

  var result = { date: targetDate, indices: [], sectors: [], movers: [] };

  indices.forEach(function(t) {
    var chg = getChange(t);
    if (chg) result.indices.push({ ticker: t, close: chg.close, pct: chg.pct });
  });

  sectorETFs.forEach(function(etf) {
    var chg = getChange(etf);
    if (chg) result.sectors.push({ etf: etf, name: sectorNames[etf] || etf, pct: chg.pct });
  });
  result.sectors.sort(function(a, b) { return b.pct - a.pct; });

  moversUniverse.forEach(function(t) {
    var chg = getChange(t);
    if (chg) result.movers.push({ ticker: t, close: chg.close, pct: chg.pct, absPct: Math.abs(chg.pct), volume: chg.volume });
  });
  result.movers.sort(function(a, b) { return b.absPct - a.absPct; });
  result.movers = result.movers.slice(0, 5);

  _snapshotCache[dateStr] = result;
  renderSnapshotData(result);
}

function renderSnapshotData(data) {
  // Timestamp
  var tsEl = document.getElementById('snapshot-timestamp');
  if (tsEl) {
    var dd = new Date(data.date + 'T12:00:00');
    tsEl.textContent = dd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Index cards
  var idxEl = document.getElementById('snapshot-indices');
  if (idxEl && data.indices.length > 0) {
    var ih = '';
    data.indices.forEach(function(idx) {
      var c = idx.pct >= 0 ? 'var(--green)' : 'var(--red)';
      ih += '<div class="card" style="padding:14px;text-align:center;background:var(--bg-secondary);">';
      ih += '<div style="font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:4px;font-family:\'JetBrains Mono\',monospace;">' + idx.ticker + '</div>';
      ih += '<div style="font-size:18px;font-weight:900;color:' + c + ';font-family:\'JetBrains Mono\',monospace;">' + (idx.pct >= 0 ? '+' : '') + idx.pct.toFixed(2) + '%</div>';
      ih += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">$' + idx.close.toFixed(2) + '</div>';
      ih += '</div>';
    });
    idxEl.innerHTML = ih;
  }

  // Sector pills
  var secEl = document.getElementById('snapshot-sectors');
  if (secEl && data.sectors.length > 0) {
    var sh = '';
    data.sectors.forEach(function(s) {
      var c = s.pct >= 0 ? 'var(--green)' : 'var(--red)';
      var bg = s.pct >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
      sh += '<div style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;background:' + bg + ';font-size:12px;">';
      sh += '<span style="font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + s.etf + '</span>';
      sh += '<span style="color:var(--text-muted);">' + s.name + '</span>';
      sh += '<span style="font-weight:800;color:' + c + ';font-family:\'JetBrains Mono\',monospace;">' + (s.pct >= 0 ? '+' : '') + s.pct.toFixed(1) + '%</span>';
      sh += '</div>';
    });
    secEl.innerHTML = sh;
  }

  // Top movers
  var movEl = document.getElementById('snapshot-movers');
  if (movEl && data.movers.length > 0) {
    var mh = '';
    data.movers.forEach(function(m) {
      var c = m.pct >= 0 ? 'var(--green)' : 'var(--red)';
      var arrow = m.pct >= 0 ? '\u25B2' : '\u25BC';
      mh += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;">';
      mh += '<div style="display:flex;align-items:center;gap:8px;">';
      mh += '<span style="font-weight:900;font-size:14px;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + m.ticker + '</span>';
      mh += '<span style="font-size:12px;color:var(--text-muted);">$' + m.close.toFixed(2) + '</span>';
      mh += '</div>';
      mh += '<span style="font-weight:800;color:' + c + ';font-size:14px;font-family:\'JetBrains Mono\',monospace;">' + arrow + ' ' + (m.pct >= 0 ? '+' : '') + m.pct.toFixed(1) + '%</span>';
      mh += '</div>';
    });
    movEl.innerHTML = mh;
  }
}

// ==================== ROLLING INSIGHTS (from last 5 stored analyses) ====================
function buildRollingInsights() {
  var allDates = getAllAnalysisDates();
  if (allDates.length === 0) return '';

  var recentDates = allDates.slice(0, 5);
  var themeCounts = {}; // theme name => { count, status, tickers, lastNote }
  var activePatterns = [];
  var allMissed = [];

  recentDates.forEach(function(date) {
    var a = getAnalysis(date);
    if (!a) return;

    // Aggregate watchlist themes
    if (a.watchlist) {
      a.watchlist.forEach(function(w) {
        if (!themeCounts[w.theme]) {
          themeCounts[w.theme] = { count: 0, status: w.status, tickers: w.tickers || [], lastNote: w.note || '' };
        }
        themeCounts[w.theme].count++;
        // Keep the most recent status
        if (themeCounts[w.theme].count === 1) {
          themeCounts[w.theme].status = w.status;
          themeCounts[w.theme].tickers = w.tickers || [];
          themeCounts[w.theme].lastNote = w.note || '';
        }
      });
    }

    // Collect patterns
    if (a.patterns) {
      var devMatch = a.patterns.match(/DEVELOPING[:\s]*([\s\S]*?)(?:FADING|$)/i);
      if (devMatch && devMatch[1]) {
        var bullets = devMatch[1].split('\n').filter(function(l) { return l.trim().length > 10; });
        bullets.forEach(function(b) {
          var clean = b.replace(/^[\s\u2022\u2023\u25E6\-\*]+/, '').trim();
          if (clean.length > 15 && activePatterns.length < 4) activePatterns.push(clean);
        });
      }
    }
  });

  // Sort themes by frequency
  var sortedThemes = Object.keys(themeCounts).sort(function(a, b) {
    return themeCounts[b].count - themeCounts[a].count;
  }).slice(0, 5);

  if (sortedThemes.length === 0 && activePatterns.length === 0) return '';

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">';

  // Running Themes card
  if (sortedThemes.length > 0) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--purple);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--purple);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.08em;">Running Themes</div>';
    sortedThemes.forEach(function(name) {
      var t = themeCounts[name];
      var sc = t.status === 'active' ? 'var(--green)' : t.status === 'watch' ? 'var(--amber)' : 'var(--text-muted)';
      var dot = t.status === 'active' ? '\u25CF' : t.status === 'watch' ? '\u25D0' : '\u25CB';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">';
      html += '<span style="color:' + sc + ';font-size:10px;">' + dot + '</span>';
      html += '<span style="font-size:14px;font-weight:700;color:var(--text-primary);">' + name + '</span>';
      if (t.count > 1) html += '<span style="font-size:12px;color:var(--text-muted);">' + t.count + 'x</span>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px;">';
      t.tickers.slice(0, 5).forEach(function(tk) {
        html += '<span style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px;background:var(--bg-secondary);color:var(--text-secondary);font-family:\'JetBrains Mono\',monospace;">' + tk + '</span>';
      });
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Developing Patterns card
  if (activePatterns.length > 0) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--amber);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--amber);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.08em;">Developing Patterns</div>';
    activePatterns.slice(0, 4).forEach(function(p) {
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;padding:4px 0;border-bottom:1px solid var(--border);">' + p + '</div>';
    });
    html += '</div>';
  } else {
    // Fill the grid even if no patterns
    html += '<div></div>';
  }

  html += '</div>';
  return html;
}

function renderAnalysis() {
  var contentEl = document.getElementById('analysis-content');
  var dateLabel = document.getElementById('analysis-date-label');
  if (!contentEl) return;

  var d = new Date(analysisCurrentDate + 'T12:00:00');
  dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  var analysis = getAnalysis(analysisCurrentDate);

  if (!analysis) {
    var dow = d.getDay();
    var isWeekday = dow >= 1 && dow <= 5;
    var isPastOrToday = d <= new Date();

    var emptyHtml = '';

    // ── LIVE MARKET SNAPSHOT (auto-fetches from Polygon) ──
    emptyHtml += '<div id="analysis-snapshot" style="margin-bottom:14px;">';
    emptyHtml += '<div class="card" style="padding:20px;">';
    emptyHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
    emptyHtml += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;font-weight:800;color:var(--blue);text-transform:uppercase;letter-spacing:0.08em;">Market Snapshot</span><span id="snapshot-timestamp" style="font-size:12px;color:var(--text-muted);">Loading...</span></div>';
    emptyHtml += '</div>';
    // Index cards row
    emptyHtml += '<div id="snapshot-indices" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">';
    ['SPY','QQQ','IWM'].forEach(function() {
      emptyHtml += '<div class="card" style="padding:14px;text-align:center;background:var(--bg-secondary);">';
      emptyHtml += '<div style="height:14px;width:40px;margin:0 auto 6px;background:var(--border);border-radius:3px;"></div>';
      emptyHtml += '<div style="height:18px;width:60px;margin:0 auto;background:var(--border);border-radius:3px;"></div>';
      emptyHtml += '</div>';
    });
    emptyHtml += '</div>';
    // Sector mini-heatmap
    emptyHtml += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Sectors</div>';
    emptyHtml += '<div id="snapshot-sectors" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">';
    emptyHtml += '<div style="font-size:12px;color:var(--text-muted);">Loading...</div>';
    emptyHtml += '</div>';
    // Top movers
    emptyHtml += '<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Top Movers</div>';
    emptyHtml += '<div id="snapshot-movers" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    emptyHtml += '<div style="font-size:12px;color:var(--text-muted);">Loading...</div>';
    emptyHtml += '</div>';
    emptyHtml += '</div>'; // end card
    emptyHtml += '</div>'; // end snapshot

    // ── ROLLING INSIGHTS from last 5 analyses ──
    var rollingHtml = buildRollingInsights();
    if (rollingHtml) emptyHtml += rollingHtml;

    // ── Generate button for past trading days ──
    if (isWeekday && isPastOrToday) {
      emptyHtml += '<div style="text-align:center;margin:16px 0 8px;">';
      emptyHtml += '<button onclick="autoGenerateAnalysis(\'' + analysisCurrentDate + '\')" id="auto-gen-btn" class="refresh-btn" style="padding:10px 24px;">Generate Full AI Analysis</button>';
      emptyHtml += '<div id="auto-gen-status" style="margin-top:8px;font-size:14px;color:var(--text-muted);"></div>';
      emptyHtml += '</div>';
    } else if (!isWeekday) {
      emptyHtml += '<div style="text-align:center;margin:12px 0;font-size:14px;color:var(--text-muted);">Weekend — markets closed.</div>';
    } else {
      emptyHtml += '<div style="text-align:center;margin:12px 0;font-size:14px;color:var(--text-muted);">Future date — analysis not yet available.</div>';
    }

    contentEl.innerHTML = emptyHtml;

    // Auto-fetch snapshot
    fetchMarketSnapshot(analysisCurrentDate);
    return;
  }

  var html = '';

  // ── ANALYSIS SUB-NAV (3 grouped tabs) ──
  html += '<div style="display:flex;gap:6px;margin-bottom:16px;justify-content:center;" id="analysis-subnav">';
  var subTabs = [
    { id: 'an-summary', label: 'Summary', active: true },
    { id: 'an-setups', label: 'Setups' },
    { id: 'an-review', label: 'Review' }
  ];
  subTabs.forEach(function(t) {
    html += '<button onclick="showAnalysisPanel(\'' + t.id + '\')" class="an-pill' + (t.active ? ' an-pill-active' : '') + '" data-panel="' + t.id + '" style="padding:8px 20px;border-radius:20px;border:1px solid var(--border);background:' + (t.active ? 'var(--blue)' : 'var(--bg-card)') + ';color:' + (t.active ? '#fff' : 'var(--text-muted)') + ';font-size:14px;font-weight:700;cursor:pointer;transition:all 0.15s ease;white-space:nowrap;">' + t.label + '</button>';
  });
  html += '</div>';

  // ════════════════════════════════════════
  // TAB 1: SUMMARY (Context + Stats + Rotation + Patterns)
  // ════════════════════════════════════════
  html += '<div id="an-summary" class="an-panel">';

  // Market Context
  if (analysis.marketContext) {
    html += '<div class="card" style="padding:16px 20px;margin-bottom:14px;border-left:4px solid var(--blue);">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;">Market Context</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;">' + analysis.marketContext + '</div>';
    html += '</div>';
  }

  // Stat cards row
  if (analysis.movers && analysis.movers.length > 0) {
    var catchableCount = analysis.movers.filter(function(m) { return m.catchable === 'yes'; }).length;
    var topGainer = analysis.movers.reduce(function(a, b) { return b.changePct > a.changePct ? b : a; });
    var topLoser = analysis.movers.reduce(function(a, b) { return b.changePct < a.changePct ? b : a; });
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">';
    html += '<div class="card" style="padding:14px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Movers</div><div style="font-size:18px;font-weight:800;color:var(--text-primary);">' + analysis.movers.length + '</div></div>';
    html += '<div class="card" style="padding:14px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Catchable</div><div style="font-size:18px;font-weight:800;color:var(--green);">' + catchableCount + '</div></div>';
    html += '<div class="card" style="padding:14px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Top Gainer</div><div style="font-size:14px;font-weight:800;color:var(--green);font-family:\'JetBrains Mono\',monospace;">' + topGainer.ticker + ' +' + topGainer.changePct.toFixed(1) + '%</div></div>';
    html += '<div class="card" style="padding:14px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Top Loser</div><div style="font-size:14px;font-weight:800;color:var(--red);font-family:\'JetBrains Mono\',monospace;">' + topLoser.ticker + ' ' + topLoser.changePct.toFixed(1) + '%</div></div>';
    html += '</div>';
  }

  // Sector Rotation + Patterns side by side
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">';
  if (analysis.sectorRotation) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--amber);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--amber);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Sector Rotation</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.sectorRotation + '</div>';
    html += '</div>';
  }
  if (analysis.patterns) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--green);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Developing Patterns</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.patterns + '</div>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>'; // end summary

  // ════════════════════════════════════════
  // TAB 2: SETUPS (Movers + Probability + Watchlist + Playbook)
  // ════════════════════════════════════════
  html += '<div id="an-setups" class="an-panel" style="display:none;">';

  // Tomorrow's Playbook (top of setups — most actionable)
  if (analysis.tomorrowWatch) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--blue);margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.08em;">Tomorrow\'s Playbook</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;">' + analysis.tomorrowWatch + '</div>';
    html += '</div>';
  }

  // Probability Map
  if (analysis.probabilityMap && analysis.probabilityMap.length > 0) {
    html += '<div style="font-size:12px;font-weight:800;color:var(--purple);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Probability Map</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">';
    analysis.probabilityMap.forEach(function(p) {
      var pc = p.probability >= 75 ? 'var(--green)' : p.probability >= 60 ? 'var(--amber)' : 'var(--text-muted)';
      var tb = p.tier === 1 ? '<span style="font-size:11px;font-weight:800;padding:2px 5px;border-radius:3px;background:var(--purple-bg);color:var(--purple);">T1</span>'
        : p.tier === 2 ? '<span style="font-size:11px;font-weight:800;padding:2px 5px;border-radius:3px;background:var(--blue-bg);color:var(--blue);">T2</span>'
        : '<span style="font-size:11px;font-weight:800;padding:2px 5px;border-radius:3px;background:rgba(100,100,100,0.1);color:var(--text-muted);">W</span>';
      var di = p.direction === 'long' ? '\u2191' : p.direction === 'short' ? '\u2193' : '\u2195';
      var dc = p.direction === 'long' ? 'var(--green)' : p.direction === 'short' ? 'var(--red)' : 'var(--amber)';
      html += '<div class="card" style="padding:14px;position:relative;overflow:hidden;">';
      html += '<div style="position:absolute;bottom:0;left:0;height:3px;width:' + p.probability + '%;background:' + pc + ';border-radius:0 2px 0 0;"></div>';
      html += '<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;flex-wrap:wrap;">';
      html += '<span style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + p.ticker + '</span>';
      html += '<span style="font-weight:800;color:' + pc + ';font-family:\'JetBrains Mono\',monospace;font-size:16px;">' + p.probability + '%</span>';
      html += '<span style="color:' + dc + ';font-size:14px;font-weight:900;">' + di + '</span>';
      html += tb;
      if (p.catalyst) html += '<span style="font-size:11px;padding:2px 5px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);margin-left:auto;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + p.catalyst + '</span>';
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:5px;">' + p.thesis + '</div>';
      if (p.keyLevels) html += '<div style="font-size:12px;color:var(--purple);font-weight:600;font-family:\'JetBrains Mono\',monospace;margin-bottom:3px;">' + p.keyLevels + '</div>';
      if (p.optionsPlay) html += '<div style="font-size:14px;color:var(--blue);font-weight:600;">' + p.optionsPlay + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Movers detail
  if (analysis.movers && analysis.movers.length > 0) {
    html += '<div style="font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Movers Detail</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">';
    analysis.movers.forEach(function(m) {
      var mc = m.changePct >= 0 ? 'var(--green)' : 'var(--red)';
      var cb = m.catchable === 'yes' ? '<span style="font-size:11px;font-weight:700;padding:2px 5px;border-radius:3px;background:var(--green-bg);color:var(--green);">CATCHABLE</span>'
        : m.catchable === 'partial' ? '<span style="font-size:11px;font-weight:700;padding:2px 5px;border-radius:3px;background:var(--amber-bg);color:var(--amber);">PARTIAL</span>'
        : '<span style="font-size:11px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(100,100,100,0.12);color:var(--text-muted);">NEWS</span>';
      html += '<div class="card" style="padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">';
      html += '<span style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + m.ticker + '</span>';
      html += '<span style="font-weight:800;color:' + mc + ';font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + (m.changePct >= 0 ? '+' : '') + m.changePct.toFixed(1) + '%</span>';
      html += cb;
      if (m.sector) html += '<span style="font-size:11px;padding:2px 5px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);margin-left:auto;">' + m.sector + '</span>';
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:4px;">' + m.why + '</div>';
      if (m.lesson) html += '<div style="font-size:14px;color:var(--blue);font-weight:600;line-height:1.4;">\u2192 ' + m.lesson + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Watchlist themes
  if (analysis.watchlist && analysis.watchlist.length > 0) {
    html += '<div style="font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Watchlist Themes</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
    analysis.watchlist.forEach(function(w) {
      var sc2 = w.status === 'active' ? 'var(--green)' : w.status === 'watch' ? 'var(--amber)' : 'var(--text-muted)';
      var sd = w.status === 'active' ? '\u25CF' : w.status === 'watch' ? '\u25D0' : '\u25CB';
      html += '<div class="card" style="padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
      html += '<span style="color:' + sc2 + ';font-size:12px;">' + sd + '</span>';
      html += '<span style="font-weight:800;font-size:14px;color:var(--text-primary);">' + w.theme + '</span>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;">';
      w.tickers.forEach(function(t) {
        html += '<span style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px;background:var(--bg-secondary);color:var(--text-secondary);font-family:\'JetBrains Mono\',monospace;">' + t + '</span>';
      });
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-muted);line-height:1.4;">' + w.note + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>'; // end setups

  // ════════════════════════════════════════
  // TAB 3: REVIEW (Mindset + Missed)
  // ════════════════════════════════════════
  html += '<div id="an-review" class="an-panel" style="display:none;">';

  // Discipline score
  if (analysis.mindset) {
    var ms = analysis.mindset;
    var scc = ms.score >= 8 ? 'var(--green)' : ms.score >= 5 ? 'var(--amber)' : 'var(--red)';
    html += '<div class="card" style="padding:20px;text-align:center;margin-bottom:14px;">';
    html += '<div style="width:64px;height:64px;border-radius:50%;background:' + scc + ';display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px;">';
    html += '<span style="font-weight:900;font-size:24px;color:#fff;">' + ms.score + '</span></div>';
    html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">Discipline Score: ' + ms.score + '/10</div>';
    if (ms.scoreNote) html += '<div style="font-size:14px;color:var(--text-muted);margin-top:6px;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.6;">' + ms.scoreNote + '</div>';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">';
    // Violations
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--red);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Rule Violations</div>';
    if (ms.violations && ms.violations.length > 0) {
      ms.violations.forEach(function(v) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:4px 0;border-bottom:1px solid var(--border);line-height:1.5;">\u2715 ' + v + '</div>';
      });
    } else {
      html += '<div style="font-size:14px;color:var(--green);">\u2713 No violations</div>';
    }
    html += '</div>';
    // Strengths
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--green);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Strengths</div>';
    if (ms.strengths && ms.strengths.length > 0) {
      ms.strengths.forEach(function(s) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:4px 0;border-bottom:1px solid var(--border);line-height:1.5;">\u2713 ' + s + '</div>';
      });
    } else {
      html += '<div style="font-size:14px;color:var(--text-muted);">None noted</div>';
    }
    html += '</div>';
    html += '</div>'; // end grid

    // Focus for tomorrow
    if (ms.focusTomorrow) {
      html += '<div class="card" style="padding:16px;border-left:3px solid var(--blue);margin-bottom:14px;">';
      html += '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;">Focus for Tomorrow</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;">' + ms.focusTomorrow + '</div>';
      html += '</div>';
    }
  }

  // Missed Moves
  if (analysis.missedMoves && analysis.missedMoves.length > 0) {
    html += '<div style="font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Missed Moves</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
    analysis.missedMoves.forEach(function(mm) {
      html += '<div class="card" style="padding:14px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
      html += '<span style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:14px;color:var(--amber);">' + mm.ticker + '</span>';
      html += '<span style="font-size:12px;color:var(--text-muted);">' + (mm.potentialPct ? '+' + mm.potentialPct + '% potential' : '') + '</span>';
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:4px;">' + mm.setup + '</div>';
      if (mm.lesson) html += '<div style="font-size:14px;color:var(--blue);font-weight:600;line-height:1.4;">\u2192 ' + mm.lesson + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>'; // end review

  contentEl.innerHTML = html;
  // Ensure first tab is visible
  showAnalysisPanel('an-summary');
}

function showAnalysisPanel(id) {
  document.querySelectorAll('.an-panel').forEach(function(p) { p.style.display = 'none'; });
  var el = document.getElementById(id);
  if (el) el.style.display = 'block';
  document.querySelectorAll('.an-pill').forEach(function(btn) {
    var active = btn.getAttribute('data-panel') === id;
    btn.style.background = active ? 'var(--blue)' : 'var(--bg-card)';
    btn.style.color = active ? '#fff' : 'var(--text-muted)';
    btn.style.borderColor = active ? 'var(--blue)' : 'var(--border)';
    if (active) btn.classList.add('an-pill-active'); else btn.classList.remove('an-pill-active');
  });
}

function formatAnalysisHTML(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ==================== ANALYSIS ENTRY WRITING ====================
function addAnalysisEntry(text) {
  var analysis = getAnalysis(analysisCurrentDate) || {};
  var lines = text.split('\n');
  // ... existing entry parsing logic ...
  saveAnalysis(analysisCurrentDate, analysis);
  renderAnalysis();
}

// ==================== ANALYSIS CHAT ENGINE ====================
function saveAnalysisApiKey(key) {
  try { localStorage.setItem('analysis_api_key', key); } catch(e) {}
}

function loadAnalysisApiKey() {
  try { return localStorage.getItem('analysis_api_key') || ''; } catch(e) { return ''; }
}

function addChatMessage(role, content) {
  var chatEl = document.getElementById('analysis-chat-messages');
  if (!chatEl) return;
  var div = document.createElement('div');
  div.className = 'chat-message chat-' + role;
  div.style.cssText = 'margin-bottom:12px;padding:10px 14px;border-radius:8px;font-size:14px;line-height:1.6;';
  if (role === 'user') {
    div.style.background = 'var(--blue)';
    div.style.color = '#fff';
    div.style.marginLeft = '20%';
  } else {
    div.style.background = 'var(--bg-secondary)';
    div.style.color = 'var(--text-secondary)';
    div.style.marginRight = '20%';
  }
  div.innerHTML = formatAnalysisHTML(content);
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendAnalysisChat() {
  var inputEl = document.getElementById('analysis-chat-input');
  var sendBtn = document.getElementById('analysis-chat-send');
  if (!inputEl) return;
  var msg = inputEl.value.trim();
  if (!msg) return;

  inputEl.value = '';
  addChatMessage('user', msg);
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...'; }

  // Build context from current analysis
  var analysis = getAnalysis(analysisCurrentDate);
  var contextStr = analysis ? JSON.stringify(analysis, null, 2) : 'No analysis loaded for ' + analysisCurrentDate;

  try {
    var apiKey = loadAnalysisApiKey();
    if (!apiKey) {
      addChatMessage('assistant', 'No API key set. Please add your Claude API key in Settings.');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      return;
    }

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: 'You are a trading analysis assistant. You have access to the following market analysis data for ' + analysisCurrentDate + ':\n\n' + contextStr + '\n\nAnswer questions about the analysis concisely and helpfully.',
        messages: [{ role: 'user', content: msg }]
      })
    });

    if (!response.ok) {
      var err = await response.json();
      addChatMessage('assistant', 'API error: ' + (err.error?.message || response.status));
    } else {
      var data = await response.json();
      addChatMessage('assistant', data.content[0].text);
    }
  } catch(e) {
    addChatMessage('assistant', 'Error: ' + e.message);
  }

  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
}

// ==================== AUTO-GENERATE ANALYSIS ====================
async function autoGenerateAnalysis(date) {
  var btn = document.getElementById('auto-gen-btn');
  var statusEl = document.getElementById('auto-gen-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching market data...'; }
  if (statusEl) statusEl.textContent = 'Step 1/3: Fetching price data from Polygon...';

  var polygonKey = ''; try { polygonKey = localStorage.getItem('mtp_polygon_key') || ''; } catch(e) {}
  if (!polygonKey) polygonKey = 'cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';

  var tickers = ['SPY','QQQ','IWM','XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH',
    'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR',
    'DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL',
    'LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA',
    'MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL'];

  var fromDate = new Date(date + 'T12:00:00');
  fromDate.setDate(fromDate.getDate() - 5);
  var fromStr = fromDate.toISOString().split('T')[0];
  var toDate = new Date(date + 'T12:00:00');
  toDate.setDate(toDate.getDate() + 1);
  var toStr = toDate.toISOString().split('T')[0];

  var priceData = {};
  var batchSize = 5;
  for (var i = 0; i < tickers.length; i++) {
    try {
      var url = 'https://api.polygon.io/v2/aggs/ticker/' + tickers[i] + '/range/1/day/' + fromStr + '/' + toStr + '?adjusted=true&sort=asc&apiKey=' + polygonKey;
      var resp = await fetch(url);
      if (resp.ok) {
        var j2 = await resp.json();
        if (j2.results && j2.results.length >= 2) {
          var bars = j2.results;
          var last = bars[bars.length - 1];
          var prev = bars[bars.length - 2];
          priceData[tickers[i]] = {
            close: last.c, open: last.o, high: last.h, low: last.l, volume: last.v,
            prevClose: prev.c,
            changePct: ((last.c - prev.c) / prev.c) * 100,
            date: new Date(last.t).toISOString().split('T')[0]
          };
        }
      }
    } catch(e) {}
    if (i > 0 && i % batchSize === 0) await new Promise(function(r) { setTimeout(r, 200); });
  }

  if (Object.keys(priceData).length === 0) {
    if (statusEl) statusEl.textContent = 'No price data found for ' + date + '. This may be a holiday or weekend.';
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Full AI Analysis'; }
    return;
  }

  if (statusEl) statusEl.textContent = 'Step 2/3: Building analysis prompt...';

  // Build a compact market summary for Claude
  var indices = ['SPY','QQQ','IWM'];
  var sectorETFs = ['XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH'];
  var stocks = tickers.filter(function(t) { return !indices.includes(t) && !sectorETFs.includes(t) && priceData[t]; });

  var summaryLines = [];
  summaryLines.push('=== MARKET DATA FOR ' + date + ' ===');
  summaryLines.push('\nINDICES:');
  indices.forEach(function(t) {
    var d = priceData[t];
    if (d) summaryLines.push(t + ': ' + (d.changePct >= 0 ? '+' : '') + d.changePct.toFixed(2) + '% close=' + d.close.toFixed(2));
  });
  summaryLines.push('\nSECTOR ETFs:');
  sectorETFs.forEach(function(t) {
    var d = priceData[t];
    if (d) summaryLines.push(t + ': ' + (d.changePct >= 0 ? '+' : '') + d.changePct.toFixed(2) + '%');
  });
  summaryLines.push('\nSTOCKS (sorted by abs move):');
  var sortedStocks = stocks.filter(function(t) { return priceData[t]; }).sort(function(a, b) {
    return Math.abs(priceData[b].changePct) - Math.abs(priceData[a].changePct);
  });
  sortedStocks.forEach(function(t) {
    var d = priceData[t];
    summaryLines.push(t + ': ' + (d.changePct >= 0 ? '+' : '') + d.changePct.toFixed(2) + '% vol=' + (d.volume/1e6).toFixed(1) + 'M close=' + d.close.toFixed(2));
  });

  var marketSummary = summaryLines.join('\n');

  if (statusEl) statusEl.textContent = 'Step 3/3: Calling AI for structured analysis...';

  try {
    var apiKey = loadAnalysisApiKey();
    if (!apiKey) {
      if (statusEl) statusEl.textContent = 'No API key. Set your Claude API key in Settings first.';
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Full AI Analysis'; }
      return;
    }

    // Build the task object instead of the prompt string
    var taskData = {
      date: date,
      marketData: marketSummary
    };

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: 'You are a professional market analyst and active trader. Analyze the provided market data and return a structured JSON analysis object. Return ONLY valid JSON with no markdown, no explanation text.',
        messages: [{
          role: 'user',
          content: JSON.stringify({
            task: 'generate_daily_analysis',
            instructions: 'Analyze this market data and return a structured JSON object with the following fields: marketContext (string, 2-3 sentence market overview), sectorRotation (string, describe leading/lagging sectors), patterns (string, developing chart/momentum patterns), movers (array of objects with: ticker, changePct, why, catchable [yes/partial/no], sector, lesson), probabilityMap (array of top 4-6 setups, each with: ticker, probability [0-100], direction [long/short/either], tier [1/2/3], thesis, keyLevels, optionsPlay, catalyst), watchlist (array of themes, each with: theme, status [active/watch/cooling], tickers array, note), tomorrowWatch (string, tomorrow plabook), missedMoves (array of missed setups, each with: ticker, setup, lesson, potentialPct), mindset (object with: score [1-10], scoreNote, violations array, strengths array, focusTomorrow). Use professional trader language. Be specific with price levels and percentages.',
            data: taskData
          })
        }]
      })
    });

    if (!response.ok) {
      var errData = await response.json();
      if (statusEl) statusEl.textContent = 'API error: ' + (errData.error?.message || response.status);
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Full AI Analysis'; }
      return;
    }

    var aiResp = await response.json();
    var rawText = aiResp.content[0].text;

    // Clean and parse JSON
    var cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    var analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch(parseErr) {
      // Try to extract JSON object
      var match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        analysis = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse AI response as JSON: ' + cleaned.substring(0, 200));
      }
    }

    saveAnalysis(date, analysis);
    if (statusEl) statusEl.textContent = '';
    renderAnalysis();

  } catch(e) {
    if (statusEl) statusEl.textContent = 'Error: ' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Full AI Analysis'; }
  }
}

// ==================== SEED DATA ====================
(function() {
  // ── Feb 23 2026 ──
  if (!getAnalysis('2026-02-23')) {
    var feb23 = {
      marketContext: "Monday opened with broad risk-off tone as tariff concerns and weekend geopolitical noise weighed on sentiment. SPY gapped down ~0.8% at the open before buyers stepped in around the 200-day MA. QQQ led the recovery, closing green on the session while IWM lagged, suggesting large-cap tech held up better than small caps. Volume was above average on the morning flush, signaling a capitulation low.",
      sectorRotation: "LEADING: XLK +1.2%, XLC +0.9%, XLRE +0.4%\nLAGGING: XLE -1.8%, XLB -1.1%, XLI -0.7%\n\nTech and communication services led the bounce. Energy sold off hard on oil weakness. Real estate caught a bid on falling rate expectations. Classic flight to quality within equities.",
      patterns: "DEVELOPING:\n• QQQ reclaim of 21-day EMA — watching for follow-through above $485\n• NVDA coiling at $130 support — 3rd test, decreasing volume\n• Biotech (XBI) base building after 3-week consolidation\n\nFADING:\n• Energy momentum completely broken — XLE below all MAs\n• Small-cap leadership from last month clearly over",
      movers: [
        { ticker: 'NVDA', changePct: 4.2, why: 'Bounced off $130 key support with above-avg volume. GTC partnership announcement after close Friday acted as catalyst on open.', catchable: 'yes', sector: 'Semiconductors', lesson: 'Strong stocks hold key levels — the $130 support was well-telegraphed and worth the risk.' },
        { ticker: 'PLTR', changePct: 6.8, why: 'New DoD contract announcement pre-market. Gap held all day with no fill — pure institutional accumulation.', catchable: 'partial', sector: 'Software', lesson: 'News gaps on PLTR rarely fill same day. Better to buy the first 5-min ORB than chase the open.' },
        { ticker: 'XOM', changePct: -2.9, why: 'Oil dropped 3% on surprise inventory build + demand concerns. XOM broke below 50-day MA on volume.', catchable: 'no', sector: 'Energy', lesson: 'Commodity-driven moves are hard to trade without macro edge.' },
        { ticker: 'COIN', changePct: 5.1, why: 'BTC pushed back above $95k. COIN moved in lockstep with 1.8x beta to crypto.', catchable: 'yes', sector: 'Crypto/Fintech', lesson: 'When BTC reclaims key levels, COIN is the cleanest equity expression.' }
      ],
      probabilityMap: [
        { ticker: 'NVDA', probability: 78, direction: 'long', tier: 1, thesis: 'Held $130 support for 3rd time, decreasing selling volume. Next resistance $142. Risk/reward favors long with stop below $128.', keyLevels: 'Support: $130 | Resistance: $142, $150', optionsPlay: 'Sell $125P / Buy $140C spread expiring 2 weeks', catalyst: 'GTC 2026 in 2 weeks' },
        { ticker: 'PLTR', probability: 72, direction: 'long', tier: 1, thesis: 'DoD contract gap held. Government AI spending continues. Chart breaking out of 3-week base. Target $95.', keyLevels: 'Support: $83 | Resistance: $90, $95', optionsPlay: 'Buy $85C 3 weeks out', catalyst: 'DoD contract' },
        { ticker: 'COIN', probability: 65, direction: 'long', tier: 2, thesis: 'BTC above $95k is bullish for COIN. Watching for BTC to hold $95k and COIN to break $280 resistance.', keyLevels: 'Support: $255 | Resistance: $280, $300', optionsPlay: 'Long stock or buy $270C', catalyst: 'BTC price action' },
        { ticker: 'XLE', probability: 60, direction: 'short', tier: 2, thesis: 'Energy broke structure. Oil inventory overhang. Could see continued selling toward $85 ETF level.', keyLevels: 'Resistance: $92 | Target: $87, $85', optionsPlay: 'Buy XLE $88P 2 weeks', catalyst: 'Oil supply data' }
      ],
      watchlist: [
        { theme: 'AI Infrastructure', status: 'active', tickers: ['NVDA','AVGO','ANET','SMCI','ARM'], note: 'Core theme of 2025-2026. Any dip to key support levels is buyable. NVDA leading, ANET building base.' },
        { theme: 'Defense/DoD AI', status: 'active', tickers: ['PLTR','LMT','BA','RKLB'], note: 'Government AI spending accelerating. PLTR is the pure play. LMT and BA catching secondary bid.' },
        { theme: 'Crypto Ecosystem', status: 'watch', tickers: ['COIN','MSTR','HOOD'], note: 'BTC above $95k keeps this alive. COIN is primary vehicle. Watching BTC for direction.' },
        { theme: 'Energy (Short)', status: 'watch', tickers: ['XOM','CVX','XLE'], note: 'Structure broken. Not chasing short yet but on radar if oil continues weak.' }
      ],
      tomorrowWatch: "1. NVDA above $135 = buy trigger for move to $142. Below $128 = stop out.\n2. PLTR hold $85 + market green = add to position.\n3. QQQ above $487 = broader market health confirmed, add tech longs.\n4. BTC hold $95k = COIN long setup still valid.\n5. Watch FOMC speakers (2pm) — could inject volatility.",
      missedMoves: [
        { ticker: 'APP', setup: 'Broke out of 2-week consolidation at open on mobile ad data. Ran 8% before I saw it.', lesson: 'APP is in momentum phase — need it on radar every morning.', potentialPct: 8 },
        { ticker: 'HIMS', setup: 'FDA positive decision pre-market, gapped up 12%. Missed the news entirely.', lesson: 'Subscribe to FDA calendar alerts for positions in biotech/pharma adjacent names.', potentialPct: 12 }
      ],
      mindset: {
        score: 7,
        scoreNote: 'Followed the plan on NVDA and COIN, sized correctly. Missed APP due to poor pre-market scan. One impatient entry on PLTR (bought open instead of waiting for 5-min ORB) — worked out but bad process.',
        violations: ['Bought PLTR at open instead of waiting for 5-min ORB confirmation'],
        strengths: ['Honored NVDA stop level without hesitation', 'Sized COIN position correctly at 2% risk', 'No revenge trading after morning gap-down'],
        focusTomorrow: 'Complete pre-market scan 30 minutes before open. No entries in first 2 minutes. Wait for the ORB setup on any gapper.'
      }
    };
    _analysisCache['2026-02-23'] = feb23;
    try { localStorage.setItem('mtp_analysis_2026-02-23', JSON.stringify(feb23)); } catch(e) {}
  }

  // ── Feb 20 2026 ──
  if (!getAnalysis('2026-02-20')) {
    var feb20 = {
      marketContext: "Thursday was a high-volatility session driven by hotter-than-expected PPI data (+0.4% vs +0.3% est). SPY dropped 1.4% in the first 30 minutes, found support at the 50-day MA ($570), and staged a partial recovery into close. Fed rate-cut expectations pushed out further, pressuring rate-sensitive sectors. The afternoon bounce was unconvincing on below-average volume, suggesting institutional sellers are not done.",
      sectorRotation: "LEADING: XLE +0.8%, XLV +0.3%, XLP +0.1%\nLAGGING: XLRE -2.1%, XLU -1.9%, XLK -1.6%\n\nClassic 'hot inflation' rotation: defensives and energy held, rate-sensitive (utilities, real estate) and high-multiple tech got crushed. Flight from growth to value.",
      patterns: "DEVELOPING:\n• SPY 50-day MA defense — critical level for bulls\n• XLV breaking out of 6-week base — healthcare leadership shift?\n• XLE momentum continuing — energy leading for 2nd week\n\nFADING:\n• QQQ 21-day EMA broken — bearish near-term\n• XLRE trend completely broken below 200-day MA",
      movers: [
        { ticker: 'LLY', changePct: -5.2, why: 'Phase 3 trial miss for oral GLP-1 — not as effective as semaglutide. Entire GLP-1 space sold off in sympathy.', catchable: 'no', sector: 'Pharma', lesson: 'Binary events in pharma are not tradeable setups — the move happened at open with no clean entry.' },
        { ticker: 'NVDA', changePct: -3.1, why: 'Macro selloff hit semis disproportionately. NVDA broke below $133 (20-day MA) on volume. No company-specific news.', catchable: 'partial', sector: 'Semiconductors', lesson: 'In risk-off macro, even the best stocks go down. Had we been watching, shorting the break of $133 was clean.' },
        { ticker: 'XOM', changePct: 1.9, why: 'Oil up on Middle East supply concerns. XOM held 50-day and bounced. Clean long setup that we had on watchlist.', catchable: 'yes', sector: 'Energy', lesson: 'When the macro backdrop shifts to inflation fears, energy is a great hedge — caught this one.' },
        { ticker: 'AMZN', changePct: -2.4, why: 'Broader tech selloff. No specific news. Just rates pressure on high-multiple tech.', catchable: 'no', sector: 'Tech/Retail', lesson: 'In macro-driven days, individual stock analysis matters less than sector/index positioning.' }
      ],
      probabilityMap: [
        { ticker: 'SPY', probability: 68, direction: 'short', tier: 1, thesis: 'Failed to reclaim 21-day EMA after inflation print. If 50-day MA ($570) breaks tomorrow, next stop is $560. Risk/reward favors short.', keyLevels: 'Resistance: $575 | Support: $570, $560', optionsPlay: 'Buy SPY $568P 1 week out', catalyst: 'PPI follow-through, Fed speakers' },
        { ticker: 'XOM', probability: 71, direction: 'long', tier: 1, thesis: 'Oil supply concerns + inflation hedge. XOM holding 50-day in today\'s selloff is relative strength. Target $122.', keyLevels: 'Support: $116 | Resistance: $120, $122', optionsPlay: 'Buy XOM $118C 2 weeks', catalyst: 'Oil supply' },
        { ticker: 'NVDA', probability: 55, direction: 'either', tier: 2, thesis: 'Broke 20-day MA. Watch for either reclaim ($135+) for long or further breakdown ($125) for short. Needs a direction.', keyLevels: 'Key level: $133 | Above=long, Below=short', optionsPlay: 'Wait for direction, then buy directional call/put', catalyst: 'Market sentiment' },
        { ticker: 'XLRE', probability: 62, direction: 'short', tier: 2, thesis: 'Broken below 200-day MA on hot inflation. Rate cuts getting priced out. XLRE could see another 3-5% drawdown.', keyLevels: 'Resistance: $38.50 | Target: $36', optionsPlay: 'Buy XLRE $37P', catalyst: 'Rates/Fed' }
      ],
      watchlist: [
        { theme: 'Inflation Hedge Basket', status: 'active', tickers: ['XOM','CVX','GLD','XLE'], note: 'Hot PPI print validates this theme for the week. XOM is the cleanest single-stock play.' },
        { theme: 'AI Infrastructure', status: 'watch', tickers: ['NVDA','AVGO','ANET'], note: 'On pause during macro selloff. NVDA broke 20-day — wait for stabilization before re-entering longs.' },
        { theme: 'Rate-Sensitive (Short)', status: 'active', tickers: ['XLRE','XLU','TLT'], note: 'If inflation stays hot, these sectors have more downside. XLRE is the cleanest short vehicle.' },
        { theme: 'Healthcare Breakout', status: 'watch', tickers: ['LLY','UNH','XLV'], note: 'XLV showing relative strength despite LLY news. Watch for XLV breakout above $150 resistance.' }
      ],
      tomorrowWatch: "1. SPY $570 level — bulls must defend or short is on.\n2. XOM above $118 = add to position.\n3. NVDA: watch $133 level — reclaim = buy, break = short opportunity.\n4. Fed speakers at 10am and 2pm — potential volatility injectors.\n5. Avoid rate-sensitive sectors (XLRE, XLU) until rates stabilize.",
      missedMoves: [
        { ticker: 'UVXY', setup: 'VIX spiked to 22 on the PPI print. UVXY ran 15% in first 30 minutes. Had the setup in mind but hesitated.', lesson: 'On known macro event days (CPI/PPI), have a volatility play ready pre-market.', potentialPct: 15 }
      ],
      mindset: {
        score: 8,
        scoreNote: 'Strong day overall. Caught XOM early, took profits at target. Did not chase the QQQ short after it already moved 1.5%. Avoided revenge trading on NVDA drop. The one miss was not having UVXY ready for the VIX spike.',
        violations: [],
        strengths: ['Caught XOM long early — was on watchlist the night before', 'Did not chase the QQQ short after the setup was gone', 'Took profits at target on XOM without being greedy'],
        focusTomorrow: 'On macro days, prepare volatility play (UVXY/SQQQ) pre-market. Watch SPY $570 as the key bull/bear line. Size down until the macro picture clears.'
      }
    };
    _analysisCache['2026-02-20'] = feb20;
    try { localStorage.setItem('mtp_analysis_2026-02-20', JSON.stringify(feb20)); } catch(e) {}
  }
})();