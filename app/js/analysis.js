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
      var json = await polyGet('/v2/aggs/ticker/' + allTickers[i] + '/range/1/day/' + fromStr + '/' + toStr + '?adjusted=true&sort=asc');
      if (json.results && json.results.length > 0) barData[allTickers[i]] = json.results;
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
    html += '<div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Violations</div>';
    if (ms.violations && ms.violations.length > 0) {
      ms.violations.forEach(function(v) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border);line-height:1.5;"><strong style="color:var(--red);">' + v.rule + '</strong><br>' + v.detail + '</div>';
      });
    } else {
      html += '<div style="font-size:14px;color:var(--green);padding:8px 0;">\u2713 Clean session</div>';
    }
    html += '</div>';
    // Wins
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--green);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">What Worked</div>';
    if (ms.wins && ms.wins.length > 0) {
      ms.wins.forEach(function(w) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border);line-height:1.5;">' + w + '</div>';
      });
    }
    html += '</div>';
    html += '</div>';
  }

  // Missed Opportunities
  if (analysis.missed) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--amber);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--amber);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Missed Opportunities</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.missed + '</div>';
    html += '</div>';
  }
  html += '</div>'; // end review

  contentEl.innerHTML = html;
}


function showAnalysisPanel(panelId) {
  // Hide all panels
  document.querySelectorAll('.an-panel').forEach(function(p) { p.style.display = 'none'; });
  // Show selected
  var target = document.getElementById(panelId);
  if (target) target.style.display = 'block';
  // Update pills
  document.querySelectorAll('.an-pill').forEach(function(btn) {
    if (btn.getAttribute('data-panel') === panelId) {
      btn.style.background = 'var(--blue)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--blue)';
    } else {
      btn.style.background = 'var(--bg-card)';
      btn.style.color = 'var(--text-muted)';
      btn.style.borderColor = 'var(--border)';
    }
  });
}

function toggleAnalysisDateDropdown() {
  var dd = document.getElementById('analysis-date-dropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') {
    dd.style.display = 'none';
    return;
  }
  var allDates = getAllAnalysisDates();
  var html = '';
  if (allDates.length === 0) {
    html = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:14px;">No analysis entries yet.</div>';
  } else {
    allDates.slice(0, 20).forEach(function(date) {
      var a = getAnalysis(date);
      if (!a) return;
      var dateObj = new Date(date + 'T12:00:00');
      var dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      var isActive = date === analysisCurrentDate;
      var moverCount = (a.movers || []).length;
      var topMover = moverCount > 0 ? a.movers[0].ticker + ' ' + (a.movers[0].changePct >= 0 ? '+' : '') + a.movers[0].changePct.toFixed(1) + '%' : '';
      var topColor = moverCount > 0 && a.movers[0].changePct >= 0 ? 'var(--green)' : 'var(--red)';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:14px;gap:8px;' + (isActive ? 'background:var(--blue-bg);' : '') + '" onclick="analysisCurrentDate=\'' + date + '\';document.getElementById(\'analysis-date-dropdown\').style.display=\'none\';renderAnalysis();" onmouseover="if(!' + isActive + ')this.style.background=\'var(--bg-secondary)\'" onmouseout="if(!' + isActive + ')this.style.background=\'transparent\'">';
      html += '<span style="color:var(--text-secondary);font-weight:' + (isActive ? '700' : '500') + ';white-space:nowrap;">' + dayName + '</span>';
      html += '<span style="font-size:12px;color:var(--text-muted);">' + moverCount + ' movers</span>';
      if (topMover) html += '<span style="font-weight:700;color:' + topColor + ';font-family:\'JetBrains Mono\',monospace;font-size:11px;white-space:nowrap;">' + topMover + '</span>';
      html += '</div>';
    });
  }
  dd.innerHTML = html;
  dd.style.display = 'block';
  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function closeDD(e) {
      if (!dd.contains(e.target) && e.target.id !== 'analysis-date-label') {
        dd.style.display = 'none';
        document.removeEventListener('click', closeDD);
      }
    });
  }, 10);
}

// ==================== AUTO-GENERATE ANALYSIS FOR ANY DATE ====================
async function autoGenerateAnalysis(dateStr) {
  var btn = document.getElementById('auto-gen-btn');
  var status = document.getElementById('auto-gen-status');
  if(btn){btn.disabled=true;btn.textContent='Generating...';}

  // AI calls go through server-side proxy (no client key needed)
  if(!window._currentSession || !window._currentSession.access_token){
    if(status)status.innerHTML='<span style="color:var(--amber);">You must be logged in to generate analysis.</span>';
    if(btn){btn.disabled=false;btn.textContent='Generate Analysis';}
    return;
  }

  function setStatus(msg){if(status)status.textContent=msg;}

  try{
    // Step 1: Get daily bars for that date and the day before
    setStatus('Fetching market data...');
    var universe=['SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL','PARA','DUOL','ZS','AXP','RIVN','NIO','BABA','SPOT','RBLX','ABNB','DASH','TTD','ROKU','PINS','SNAP'];
    var sectorETFs=['XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH'];
    var allTickers=universe.concat(sectorETFs);

    // Fetch bars around the target date
    var fromDate=new Date(dateStr+'T12:00:00');
    fromDate.setDate(fromDate.getDate()-5);
    var fromStr=fromDate.toISOString().split('T')[0];
    var toDate=new Date(dateStr+'T12:00:00');
    toDate.setDate(toDate.getDate()+1);
    var toStr=toDate.toISOString().split('T')[0];

    // Fetch in batches
    var barData={};
    setStatus('Fetching price data (this may take a moment)...');
    for(var i=0;i<allTickers.length;i++){
      var ticker=allTickers[i];
      try{
        var json=await polyGet('/v2/aggs/ticker/'+ticker+'/range/1/day/'+fromStr+'/'+toStr+'?adjusted=true&sort=asc');
        if(json.results&&json.results.length>0)barData[ticker]=json.results;
      }catch(e){}
      // Rate limit: small delay every 5 tickers (free tier = 5/min)
      if(i>0&&i%5===0){
        setStatus('Fetching price data... ('+i+'/'+allTickers.length+')');
        await new Promise(function(r){setTimeout(r,1200);});
      }
    }

    // Step 2: Calculate % change for target date
    setStatus('Calculating movers...');
    var movers=[];
    universe.forEach(function(t){
      var bars=barData[t];
      if(!bars||bars.length<2)return;
      // Find the bar for target date
      var targetBar=null,prevBar=null;
      for(var j=0;j<bars.length;j++){
        var barDate=new Date(bars[j].t).toISOString().split('T')[0];
        if(barDate===dateStr){targetBar=bars[j];if(j>0)prevBar=bars[j-1];break;}
      }
      if(!targetBar||!prevBar)return;
      var pctChg=((targetBar.c-prevBar.c)/prevBar.c)*100;
      movers.push({ticker:t,close:targetBar.c,prevClose:prevBar.c,pct:pctChg,absPct:Math.abs(pctChg),volume:targetBar.v});
    });
    movers.sort(function(a,b){return b.absPct-a.absPct;});
    var topMovers=movers.slice(0,15);

    // Sector performance
    var sectorPerf=[];
    var sectorNames={'XLK':'Technology','XLF':'Financials','XLE':'Energy','XLV':'Healthcare','XLY':'Consumer Disc.','XLI':'Industrials','XLRE':'Real Estate','XLU':'Utilities','XLB':'Materials','XLC':'Comm. Services','XLP':'Consumer Staples','SMH':'Semiconductors'};
    sectorETFs.forEach(function(etf){
      var bars=barData[etf];
      if(!bars||bars.length<2)return;
      var targetBar=null,prevBar=null;
      for(var j=0;j<bars.length;j++){
        var barDate=new Date(bars[j].t).toISOString().split('T')[0];
        if(barDate===dateStr){targetBar=bars[j];if(j>0)prevBar=bars[j-1];break;}
      }
      if(!targetBar||!prevBar)return;
      var pctChg=((targetBar.c-prevBar.c)/prevBar.c)*100;
      sectorPerf.push({etf:etf,name:sectorNames[etf]||etf,pct:pctChg});
    });
    sectorPerf.sort(function(a,b){return b.pct-a.pct;});

    // SPY data for context
    var spyBar=barData['SPY'];
    var spyChg=0;
    if(spyBar){
      for(var si=0;si<spyBar.length;si++){
        var sd=new Date(spyBar[si].t).toISOString().split('T')[0];
        if(sd===dateStr&&si>0){spyChg=((spyBar[si].c-spyBar[si-1].c)/spyBar[si-1].c)*100;break;}
      }
    }

    if(topMovers.length===0){
      if(status)status.innerHTML='<span style="color:var(--amber);">No trading data found for this date. It may be a holiday.</span>';
      if(btn){btn.disabled=false;btn.textContent='Generate Analysis';}
      return;
    }

    // Step 3: Fetch news for top movers on that date
    setStatus('Fetching news...');
    var moverNews={};
    for(var ni=0;ni<Math.min(topMovers.length,10);ni++){
      try{
        var nJson=await polyGet('/v2/reference/news?ticker='+topMovers[ni].ticker+'&published_utc.gte='+dateStr+'T00:00:00Z&published_utc.lte='+dateStr+'T23:59:59Z&limit=5');
        moverNews[topMovers[ni].ticker]=(nJson.results||[]).map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});
      }catch(e){}
      if(ni>0&&ni%5===0) await new Promise(function(r){setTimeout(r,1200);});
    }

    // Step 4: Send structured data to secure server-side AI proxy
    setStatus('AI analyzing the session...');
    var moverPayload=topMovers.map(function(m){
      return {ticker:m.ticker,pct:m.pct,close:m.close,newsHeadlines:(moverNews[m.ticker]||[]).slice(0,3)};
    });
    var sectorPayload=sectorPerf.map(function(s){
      return {etf:s.etf,name:s.name,pct:s.pct};
    });

    var data=await callAIProxy({task:'generate_analysis',date:dateStr,spyChange:spyChg,movers:moverPayload,sectors:sectorPayload});
    var text=data.content&&data.content[0]?data.content[0].text:'';
    var jsonMatch=text.match(/\{[\s\S]*\}/);if(!jsonMatch)throw new Error('Could not parse AI response');
    var result=JSON.parse(jsonMatch[0]);

    // Save it
    saveAnalysis(dateStr,result);
    setStatus('');
    analysisCurrentDate=dateStr;
    renderAnalysis();

  }catch(e){
    if(status)status.innerHTML='<span style="color:var(--red);">Error: '+e.message+'</span>';
    if(btn){btn.disabled=false;btn.textContent='Generate Analysis';}
  }
}

// ==================== SILENT AUTO-GENERATE (for backfill, no DOM updates) ====================
async function autoGenerateAnalysisSilent(dateStr) {
  // AI calls go through server-side proxy
  if(!window._currentSession || !window._currentSession.access_token) throw new Error('You must be logged in');

  var universe=['SPY','QQQ','IWM','DIA','AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL','PARA','DUOL','ZS','AXP','RIVN','NIO','BABA','SPOT','RBLX','ABNB','DASH','TTD','ROKU','PINS','SNAP'];
  var sectorETFs=['XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH'];
  var allTickers=universe.concat(sectorETFs);

  var fromDate=new Date(dateStr+'T12:00:00');
  fromDate.setDate(fromDate.getDate()-5);
  var fromStr=fromDate.toISOString().split('T')[0];
  var toDate=new Date(dateStr+'T12:00:00');
  toDate.setDate(toDate.getDate()+1);
  var toStr=toDate.toISOString().split('T')[0];

  var barData={};
  for(var i=0;i<allTickers.length;i++){
    var ticker=allTickers[i];
    try{
      var json=await polyGet('/v2/aggs/ticker/'+ticker+'/range/1/day/'+fromStr+'/'+toStr+'?adjusted=true&sort=asc');
      if(json.results&&json.results.length>0)barData[ticker]=json.results;
    }catch(e){}
    if(i>0&&i%5===0) await new Promise(function(r){setTimeout(r,1200);});
  }

  var movers=[];
  universe.forEach(function(t){
    var bars=barData[t];if(!bars||bars.length<2)return;
    var targetBar=null,prevBar=null;
    for(var j=0;j<bars.length;j++){
      var barDate=new Date(bars[j].t).toISOString().split('T')[0];
      if(barDate===dateStr){targetBar=bars[j];if(j>0)prevBar=bars[j-1];break;}
    }
    if(!targetBar||!prevBar)return;
    var pctChg=((targetBar.c-prevBar.c)/prevBar.c)*100;
    movers.push({ticker:t,close:targetBar.c,prevClose:prevBar.c,pct:pctChg,absPct:Math.abs(pctChg),volume:targetBar.v});
  });
  movers.sort(function(a,b){return b.absPct-a.absPct;});
  var topMovers=movers.slice(0,15);

  var sectorPerf=[];
  var sectorNames={'XLK':'Technology','XLF':'Financials','XLE':'Energy','XLV':'Healthcare','XLY':'Consumer Disc.','XLI':'Industrials','XLRE':'Real Estate','XLU':'Utilities','XLB':'Materials','XLC':'Comm. Services','XLP':'Consumer Staples','SMH':'Semiconductors'};
  sectorETFs.forEach(function(etf){
    var bars=barData[etf];if(!bars||bars.length<2)return;
    var targetBar=null,prevBar=null;
    for(var j=0;j<bars.length;j++){
      var barDate=new Date(bars[j].t).toISOString().split('T')[0];
      if(barDate===dateStr){targetBar=bars[j];if(j>0)prevBar=bars[j-1];break;}
    }
    if(!targetBar||!prevBar)return;
    var pctChg=((targetBar.c-prevBar.c)/prevBar.c)*100;
    sectorPerf.push({etf:etf,name:sectorNames[etf]||etf,pct:pctChg});
  });
  sectorPerf.sort(function(a,b){return b.pct-a.pct;});

  var spyBar=barData['SPY'];var spyChg=0;
  if(spyBar){for(var si=0;si<spyBar.length;si++){var sd=new Date(spyBar[si].t).toISOString().split('T')[0];if(sd===dateStr&&si>0){spyChg=((spyBar[si].c-spyBar[si-1].c)/spyBar[si-1].c)*100;break;}}}

  if(topMovers.length===0) throw new Error('No trading data for '+dateStr);

  var moverNews={};
  for(var ni=0;ni<Math.min(topMovers.length,10);ni++){
    try{
      var nJson=await polyGet('/v2/reference/news?ticker='+topMovers[ni].ticker+'&published_utc.gte='+dateStr+'T00:00:00Z&published_utc.lte='+dateStr+'T23:59:59Z&limit=5');
      moverNews[topMovers[ni].ticker]=(nJson.results||[]).map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});
    }catch(e){}
    if(ni>0&&ni%5===0) await new Promise(function(r){setTimeout(r,1200);});
  }

  var moverPayload=topMovers.map(function(m){
    return {ticker:m.ticker,pct:m.pct,close:m.close,newsHeadlines:(moverNews[m.ticker]||[]).slice(0,3)};
  });
  var sectorPayload=sectorPerf.map(function(s){
    return {etf:s.etf,name:s.name,pct:s.pct};
  });

  var data=await callAIProxy({task:'generate_analysis',date:dateStr,spyChange:spyChg,movers:moverPayload,sectors:sectorPayload});
  var text=data.content&&data.content[0]?data.content[0].text:'';
  var jsonMatch=text.match(/\{[\s\S]*\}/);if(!jsonMatch) throw new Error('Could not parse AI response');
  var result=JSON.parse(jsonMatch[0]);
  saveAnalysis(dateStr, result);
}

// ==================== BACKFILL MULTIPLE DATES ====================
async function backfillAnalysis(lookbackDays) {
  lookbackDays = lookbackDays || 7;
  var statusEl = document.getElementById('backfill-status');
  var btn7 = document.getElementById('backfill-btn');
  var btn14 = document.getElementById('backfill-2wk-btn');
  function setStatus(msg) { if(statusEl) statusEl.innerHTML = msg; }

  // Find all weekdays in the lookback window that are missing
  var today = new Date();
  var missing = [];
  var d = new Date(today);
  // Go back lookbackDays calendar days (to cover enough weekdays)
  d.setDate(d.getDate() - Math.ceil(lookbackDays * 1.5));
  while(d <= today) {
    if(d.getDay() >= 1 && d.getDay() <= 5) {
      var ds = d.toISOString().split('T')[0];
      if(!getAnalysis(ds)) missing.push(ds);
    }
    d.setDate(d.getDate() + 1);
  }

  if(missing.length === 0) {
    setStatus('<span style="color:var(--green);">All trading days in the last ' + lookbackDays + ' days have analysis entries.</span>');
    return;
  }

  var ok = window.confirm('Generate analysis for ' + missing.length + ' missing day(s)?\n\n' + missing.join(', ') + '\n\nThis uses your Anthropic API key and may take a few minutes.');
  if(!ok) return;

  // Disable buttons during backfill
  if(btn7) { btn7.disabled = true; btn7.textContent = 'Working...'; }
  if(btn14) { btn14.disabled = true; btn14.textContent = 'Working...'; }

  for(var i = 0; i < missing.length; i++) {
    setStatus('Generating ' + (i+1) + '/' + missing.length + ': ' + missing[i] + '...');
    try {
      await autoGenerateAnalysisSilent(missing[i]);
    } catch(e) {
      setStatus('<span style="color:var(--red);">Error on ' + missing[i] + ': ' + e.message + '</span>');
      // Stop on credit/auth errors — no point retrying
      if(e.message.indexOf('credit') >= 0 || e.message.indexOf('401') >= 0 || e.message.indexOf('authentication') >= 0) {
        if(btn7) { btn7.disabled = false; btn7.textContent = 'Fill Missing (' + missing.length + ')'; }
        if(btn14) { btn14.disabled = false; btn14.textContent = 'Look Back 2 Weeks'; }
        return;
      }
    }
    // Wait between generations to avoid rate limits
    if(i < missing.length - 1) await new Promise(function(r) { setTimeout(r, 3000); });
  }

  setStatus('<span style="color:var(--green);">Done! Generated ' + missing.length + ' entries.</span>');
  // Refresh the analysis view to show new entries
  setTimeout(function() { renderAnalysis(); }, 500);
}

// ==================== SHAKEOUT RECLAIM SCANNER ====================

// ==================== ANALYSIS CHAT ENGINE ====================
var analysisChatHistory = [];

function addChatMessage(role, text) {
  var container = document.getElementById('analysis-chat-messages');
  if (!container) return;

  var msgDiv = document.createElement('div');
  msgDiv.style.cssText = 'margin-bottom:12px;display:flex;gap:8px;align-items:flex-start;';

  var isUser = role === 'user';
  var avatar = document.createElement('div');
  avatar.style.cssText = 'width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;' +
    (isUser ? 'background:var(--green-bg);color:var(--green);' : 'background:rgba(59,130,246,0.15);color:var(--blue);');
  avatar.textContent = isUser ? 'U' : 'AI';

  var bubble = document.createElement('div');
  bubble.style.cssText = 'flex:1;font-size:14px;line-height:1.6;color:var(--text-secondary);padding:8px 12px;border-radius:8px;white-space:pre-wrap;' +
    (isUser ? 'background:var(--bg-secondary);' : 'background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);');
  bubble.textContent = text;

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  return bubble;
}

async function sendAnalysisChat() {
  var input = document.getElementById('analysis-chat-input');
  if (!input) return;
  var msg = input.value.trim();
  if (!msg) return;

  var apiKey = true; // AI calls go through server proxy now
  if (!window._currentSession || !window._currentSession.access_token) {
    addChatMessage('assistant', '\u2192 Please log in to use the AI chat feature.');
    return;
  }

  input.value = '';
  addChatMessage('user', msg);
  var typingBubble = addChatMessage('assistant', 'Thinking...');

  // Build context
  var analysis = getAnalysis(analysisCurrentDate);
  var contextStr = 'No analysis data for this date.';
  if (analysis) {
    contextStr = 'Date: ' + analysisCurrentDate + '\n';
    if (analysis.marketContext) contextStr += 'MARKET CONTEXT: ' + analysis.marketContext + '\n\n';
    if (analysis.movers) {
      contextStr += 'BIGGEST MOVERS:\n';
      analysis.movers.forEach(function(m) {
        contextStr += '\u2022 ' + m.ticker + ' ' + (m.changePct >= 0 ? '+' : '') + m.changePct.toFixed(1) + '% (' + m.sector + ') - ' + m.why;
        if (m.lesson) contextStr += ' LESSON: ' + m.lesson;
        contextStr += ' [Catchable: ' + m.catchable + ']\n';
      });
      contextStr += '\n';
    }
    if (analysis.sectorRotation) contextStr += 'SECTOR ROTATION:\n' + analysis.sectorRotation + '\n\n';
    if (analysis.patterns) contextStr += 'DEVELOPING PATTERNS:\n' + analysis.patterns + '\n\n';
    if (analysis.missed) contextStr += 'MISSED OPPORTUNITIES:\n' + analysis.missed + '\n\n';
    if (analysis.tomorrowWatch) contextStr += 'SETUP WATCH:\n' + analysis.tomorrowWatch + '\n\n';
  }

  // Add pattern engine results if available
  var patternData = '';
  try {
    var patterns = runPatternEngine();
    if (!patterns.insufficient) {
      patternData = '\n\nTRADE JOURNAL PATTERN ENGINE RESULTS:\n';
      patternData += 'Overall: ' + patterns.overall.totalTrades + ' trades, ' + patterns.overall.winRate + ' win rate, $' + patterns.overall.totalPL + ' total P&L\n';
      patternData += 'Avg win: $' + patterns.overall.avgWin + ' | Avg loss: $' + patterns.overall.avgLoss + '\n';
      Object.keys(patterns.byStrategy).forEach(function(s) {
        var st = patterns.byStrategy[s];
        patternData += s + ': ' + st.winRate + ' win rate, ' + st.trades + ' trades, $' + st.totalPL + ' total\n';
      });
      if (patterns.edges.length > 0) {
        patternData += '\nEDGES FOUND:\n' + patterns.edges.join('\n') + '\n';
      }
    }
  } catch(e) {}

  analysisChatHistory.push({ role: 'user', content: msg });

  try {
    var response = await callAIProxy({
      task: 'analysis_chat',
      analysisContext: contextStr,
      patternData: patternData,
      chatHistory: analysisChatHistory
    });

    var reply = response.content && response.content[0] ? response.content[0].text : 'No response received.';

    analysisChatHistory.push({ role: 'assistant', content: reply });
    typingBubble.textContent = reply;

  } catch(e) {
    typingBubble.textContent = 'Error: ' + e.message;
    if (e.message.includes('401') || e.message.includes('logged in')) {
      typingBubble.textContent += '\n\nPlease log in to use AI features.';
    } else if (e.message.includes('CORS') || e.message.includes('Failed to fetch')) {
      typingBubble.textContent += '\n\nNetwork error. Check your connection and try again.';
    }
    // Remove failed message from history
    analysisChatHistory.pop();
  }
}
