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

function renderAnalysis() {
  var contentEl = document.getElementById('analysis-content');
  var dateLabel = document.getElementById('analysis-date-label');
  if (!contentEl) return;

  var d = new Date(analysisCurrentDate + 'T12:00:00');
  dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  var analysis = getAnalysis(analysisCurrentDate);

  if (!analysis) {
    // Check if this is a weekday (potential trading day)
    var dow = d.getDay();
    var isWeekday = dow >= 1 && dow <= 5;
    var isPastOrToday = d <= new Date();
    contentEl.innerHTML = '<div class="card" style="padding:40px;text-align:center;">' +
      '<div style="font-size:18px;margin-bottom:16px;color:var(--text-muted);">◉</div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">No market analysis for this date</div>' +
      '<div style="font-size:14px;color:var(--text-muted);max-width:450px;margin:0 auto;line-height:1.6;">Click "Generate" to auto-scan this day\'s biggest movers, sector rotations, and key themes using market data and AI.</div>' +
      (isWeekday && isPastOrToday ?
        '<button onclick="autoGenerateAnalysis(\'' + analysisCurrentDate + '\')" id="auto-gen-btn" class="refresh-btn" style="margin-top:16px;padding:10px 24px;">Generate Analysis</button>' +
        '<div id="auto-gen-status" style="margin-top:8px;font-size:14px;color:var(--text-muted);"></div>'
        : '<div style="margin-top:12px;font-size:14px;color:var(--text-muted);">' + (isWeekday ? 'Future date — analysis not yet available.' : 'Weekend — markets closed.') + '</div>') +
      '</div>';

    // Still show recent entries and running themes below
    renderRecentEntries(contentEl);
    return;
  }

  var html = '';

  // ── ANALYSIS SUB-NAV (pill tabs) ──
  html += '<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;" id="analysis-subnav">';
  var subTabs = [
    { id: 'an-overview', label: '\u{1F4CA} Overview', active: true },
    { id: 'an-movers', label: '\u{1F680} Movers' },
    { id: 'an-heatmap', label: '\u{1F3AF} Probability' },
    { id: 'an-watchlist', label: '\u{1F4E1} Watchlist' },
    { id: 'an-playbook', label: '\u{1F52E} Playbook' },
    { id: 'an-mindset', label: '\u{1F9E0} Mindset' }
  ];
  subTabs.forEach(function(t) {
    html += '<button onclick="showAnalysisPanel(\'' + t.id + '\')" class="an-pill' + (t.active ? ' an-pill-active' : '') + '" data-panel="' + t.id + '" style="padding:7px 14px;border-radius:20px;border:1px solid var(--border);background:' + (t.active ? 'var(--blue)' : 'var(--bg-card)') + ';color:' + (t.active ? '#fff' : 'var(--text-muted)') + ';font-size:14px;font-weight:700;cursor:pointer;transition:all 0.15s ease;white-space:nowrap;">' + t.label + '</button>';
  });
  html += '</div>';

  // ════════════════════════════
  // PANEL 1: OVERVIEW
  // ════════════════════════════
  html += '<div id="an-overview" class="an-panel">';

  if (analysis.marketContext) {
    html += '<div class="card" style="padding:16px 20px;margin-bottom:14px;border-left:4px solid var(--blue);">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;">MARKET CONTEXT</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;">' + analysis.marketContext + '</div>';
    html += '</div>';
  }

  if (analysis.movers && analysis.movers.length > 0) {
    var catchableCount = analysis.movers.filter(function(m) { return m.catchable === 'yes'; }).length;
    var topGainer = analysis.movers.reduce(function(a, b) { return b.changePct > a.changePct ? b : a; });
    var topLoser = analysis.movers.reduce(function(a, b) { return b.changePct < a.changePct ? b : a; });

    html += '<div class="an-stat-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">';
    html += '<div class="card" style="padding:16px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Movers</div><div style="font-size:18px;font-weight:800;color:var(--text-primary);">' + analysis.movers.length + '</div></div>';
    html += '<div class="card" style="padding:16px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Catchable</div><div style="font-size:18px;font-weight:800;color:var(--green);">' + catchableCount + '</div></div>';
    html += '<div class="card" style="padding:16px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Top Gainer</div><div style="font-size:14px;font-weight:800;color:var(--green);font-family:\'JetBrains Mono\',monospace;">' + topGainer.ticker + ' +' + topGainer.changePct.toFixed(1) + '%</div></div>';
    html += '<div class="card" style="padding:16px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Top Loser</div><div style="font-size:14px;font-weight:800;color:var(--red);font-family:\'JetBrains Mono\',monospace;">' + topLoser.ticker + ' ' + topLoser.changePct.toFixed(1) + '%</div></div>';
    html += '</div>';
  }

  html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">';
  if (analysis.sectorRotation) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--amber);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--amber);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">\u{1F504} Sector Rotation</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.sectorRotation + '</div>';
    html += '</div>';
  }
  if (analysis.patterns) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--green);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">\u{1F4C8} Developing Patterns</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.patterns + '</div>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">';
  if (analysis.missed) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--red);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">\u{274C} Missed Opportunities</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.65;white-space:pre-wrap;">' + analysis.missed + '</div>';
    html += '</div>';
  }
  if (analysis.mindset) {
    var mso = analysis.mindset;
    var sco = mso.score >= 8 ? 'var(--green)' : mso.score >= 5 ? 'var(--amber)' : 'var(--red)';
    html += '<div class="card" style="padding:16px;border-left:3px solid ' + sco + '">';
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">';
    html += '<div style="width:44px;height:44px;border-radius:50%;background:' + sco + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-weight:900;font-size:18px;color:#fff;">' + mso.score + '</span></div>';
    html += '<div><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-primary);">Discipline ' + mso.score + '/10</div>';
    if (mso.scoreNote) html += '<div style="font-size:14px;color:var(--text-muted);margin-top:2px;line-height:1.4;">' + mso.scoreNote + '</div>';
    html += '</div></div>';
    if (mso.violations && mso.violations.length > 0) {
      mso.violations.forEach(function(v) {
        html += '<div style="font-size:14px;color:var(--red);padding:3px 0;line-height:1.4;">\u26A0 <strong>' + v.rule + '</strong> \u2014 ' + v.detail.substring(0, 120) + (v.detail.length > 120 ? '...' : '') + '</div>';
      });
    }
    if (mso.wins && mso.wins.length > 0) {
      html += '<div style="margin-top:6px;">';
      mso.wins.slice(0, 2).forEach(function(w) {
        html += '<div style="font-size:12px;color:var(--green);padding:2px 0;line-height:1.4;">\u2713 ' + w.substring(0, 100) + (w.length > 100 ? '...' : '') + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '</div>'; // end overview

  // ════════════════════════════
  // PANEL 2: MOVERS
  // ════════════════════════════
  html += '<div id="an-movers" class="an-panel" style="display:none;">';
  if (analysis.movers && analysis.movers.length > 0) {
    html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    analysis.movers.forEach(function(m) {
      var mc = m.changePct >= 0 ? 'var(--green)' : 'var(--red)';
      var cb = m.catchable === 'yes' ? '<span style="font-size:12px;font-weight:700;padding:2px 5px;border-radius:3px;background:var(--green-bg);color:var(--green);">CATCHABLE</span>'
        : m.catchable === 'partial' ? '<span style="font-size:12px;font-weight:700;padding:2px 5px;border-radius:3px;background:var(--amber-bg);color:var(--amber);">PARTIALLY</span>'
        : '<span style="font-size:12px;font-weight:700;padding:2px 5px;border-radius:3px;background:rgba(100,100,100,0.12);color:var(--text-muted);">NEWS-DRIVEN</span>';
      html += '<div class="card" style="padding:16px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
      html += '<span style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + m.ticker + '</span>';
      html += '<span style="font-weight:800;color:' + mc + ';font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + (m.changePct >= 0 ? '+' : '') + m.changePct.toFixed(1) + '%</span>';
      html += cb;
      if (m.sector) html += '<span style="font-size:12px;padding:2px 5px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);margin-left:auto;">' + m.sector + '</span>';
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:6px;">' + m.why + '</div>';
      if (m.lesson) html += '<div style="font-size:14px;color:var(--blue);font-weight:600;line-height:1.5;">\u2192 ' + m.lesson + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // ════════════════════════════
  // PANEL 3: PROBABILITY HEATMAP
  // ════════════════════════════
  html += '<div id="an-heatmap" class="an-panel" style="display:none;">';
  if (analysis.probabilityMap && analysis.probabilityMap.length > 0) {
    html += '<div style="font-size:14px;color:var(--text-muted);margin-bottom:12px;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;line-height:1.5;">Ranked by probability of a 3%+ move tomorrow. Based on multi-day patterns, catalyst proximity, IV levels, technical setup, and sector correlation.</div>';
    html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    analysis.probabilityMap.forEach(function(p) {
      var pc = p.probability >= 75 ? 'var(--green)' : p.probability >= 60 ? 'var(--amber)' : 'var(--text-muted)';
      var tb = p.tier === 1 ? '<span style="font-size:12px;font-weight:800;padding:2px 5px;border-radius:3px;background:var(--purple-bg);color:var(--purple);">T1</span>'
        : p.tier === 2 ? '<span style="font-size:12px;font-weight:800;padding:2px 5px;border-radius:3px;background:var(--blue-bg);color:var(--blue);">T2</span>'
        : '<span style="font-size:12px;font-weight:800;padding:2px 5px;border-radius:3px;background:rgba(100,100,100,0.1);color:var(--text-muted);">W</span>';
      var di = p.direction === 'long' ? '\u2191' : p.direction === 'short' ? '\u2193' : '\u2195';
      var dc = p.direction === 'long' ? 'var(--green)' : p.direction === 'short' ? 'var(--red)' : 'var(--amber)';
      html += '<div class="card" style="padding:16px;position:relative;overflow:hidden;">';
      html += '<div style="position:absolute;bottom:0;left:0;height:3px;width:' + p.probability + '%;background:' + pc + ';border-radius:0 2px 0 0;"></div>';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
      html += '<span style="font-weight:900;font-family:\'JetBrains Mono\',monospace;font-size:14px;">' + p.ticker + '</span>';
      html += '<span style="font-weight:800;color:' + pc + ';font-family:\'JetBrains Mono\',monospace;font-size:18px;">' + p.probability + '%</span>';
      html += '<span style="color:' + dc + ';font-size:14px;font-weight:900;">' + di + '</span>';
      html += tb;
      if (p.catalyst) html += '<span style="font-size:12px;padding:2px 5px;border-radius:3px;background:var(--bg-secondary);color:var(--text-muted);margin-left:auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + p.catalyst + '</span>';
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.55;margin-bottom:6px;">' + p.thesis.substring(0, 180) + (p.thesis.length > 180 ? '...' : '') + '</div>';
      if (p.keyLevels) html += '<div style="font-size:12px;color:var(--purple);font-weight:600;font-family:\'JetBrains Mono\',monospace;margin-bottom:3px;">\u{1F4CD} ' + p.keyLevels + '</div>';
      if (p.optionsPlay) html += '<div style="font-size:14px;color:var(--blue);font-weight:600;">\u{1F4B0} ' + p.optionsPlay.substring(0, 120) + (p.optionsPlay.length > 120 ? '...' : '') + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // ════════════════════════════
  // PANEL 4: WATCHLIST
  // ════════════════════════════
  html += '<div id="an-watchlist" class="an-panel" style="display:none;">';
  if (analysis.watchlist && analysis.watchlist.length > 0) {
    html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    analysis.watchlist.forEach(function(w) {
      var sc2 = w.status === 'active' ? 'var(--green)' : w.status === 'watch' ? 'var(--amber)' : 'var(--text-muted)';
      var sd = w.status === 'active' ? '\u25CF' : w.status === 'watch' ? '\u25D0' : '\u25CB';
      html += '<div class="card" style="padding:16px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
      html += '<span style="color:' + sc2 + ';font-size:14px;">' + sd + '</span>';
      html += '<span style="font-weight:800;font-size:14px;color:var(--text-primary);">' + w.theme + '</span>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
      w.tickers.forEach(function(t) {
        html += '<span style="font-size:12px;font-weight:700;padding:3px 8px;border-radius:4px;background:var(--bg-secondary);color:var(--text-secondary);font-family:\'JetBrains Mono\',monospace;">' + t + '</span>';
      });
      html += '</div>';
      html += '<div style="font-size:14px;color:var(--text-muted);line-height:1.5;">' + w.note + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // ════════════════════════════
  // PANEL 5: PLAYBOOK
  // ════════════════════════════
  html += '<div id="an-playbook" class="an-panel" style="display:none;">';
  if (analysis.tomorrowWatch) {
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--blue);background:rgba(59,130,246,0.03);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.08em;">\u{1F52E} Tomorrow\'s Playbook</div>';
    html += '<div style="font-size:14px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;">' + analysis.tomorrowWatch + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // ════════════════════════════
  // PANEL 6: MINDSET
  // ════════════════════════════
  html += '<div id="an-mindset" class="an-panel" style="display:none;">';
  if (analysis.mindset) {
    var ms = analysis.mindset;
    var scc = ms.score >= 8 ? 'var(--green)' : ms.score >= 5 ? 'var(--amber)' : 'var(--red)';
    html += '<div class="card" style="padding:20px;text-align:center;margin-bottom:14px;">';
    html += '<div style="width:72px;height:72px;border-radius:50%;background:' + scc + ';display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px;">';
    html += '<span style="font-weight:900;font-size:18px;color:#fff;">' + ms.score + '</span></div>';
    html += '<div style="font-size:14px;font-weight:800;color:var(--text-primary);">DISCIPLINE SCORE: ' + ms.score + '/10</div>';
    if (ms.scoreNote) html += '<div style="font-size:14px;color:var(--text-muted);margin-top:6px;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.6;">' + ms.scoreNote + '</div>';
    html += '</div>';
    html += '<div class="an-two-col" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--red);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">\u26A0\uFE0F Violations</div>';
    if (ms.violations && ms.violations.length > 0) {
      ms.violations.forEach(function(v) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border);line-height:1.5;"><strong style="color:var(--red);">' + v.rule + '</strong><br>' + v.detail + '</div>';
      });
    } else {
      html += '<div style="font-size:14px;color:var(--green);padding:8px 0;">\u2713 Clean session</div>';
    }
    html += '</div>';
    html += '<div class="card" style="padding:16px;border-left:3px solid var(--green);">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">\u2713 What Worked</div>';
    if (ms.wins && ms.wins.length > 0) {
      ms.wins.forEach(function(w) {
        html += '<div style="font-size:14px;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--border);line-height:1.5;">' + w + '</div>';
      });
    }
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  contentEl.innerHTML = html;
  renderRecentEntries(contentEl);
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

function renderRecentEntries(parentEl) {
  var allDates = getAllAnalysisDates();

  // Determine how many weekdays are missing in the last 7 trading days
  var missingCount = 0;
  var today = new Date();
  var checkDate = new Date(today);
  var weekdaysChecked = 0;
  while(weekdaysChecked < 7) {
    checkDate.setDate(checkDate.getDate() - 1);
    if(checkDate.getDay() >= 1 && checkDate.getDay() <= 5) {
      weekdaysChecked++;
      var ds = checkDate.toISOString().split('T')[0];
      if(!getAnalysis(ds)) missingCount++;
    }
  }

  var html = '<div style="margin-top:24px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">';
  html += '<div class="section-title" style="margin:0;"><span class="dot" style="background:var(--blue)"></span> Recent Analysis Entries</div>';
  html += '<div style="display:flex;gap:6px;">';
  if(missingCount > 0) {
    html += '<button onclick="backfillAnalysis(7)" id="backfill-btn" class="refresh-btn" style="padding:4px 10px;">Scan</button>';
  }
  html += '</div></div>';
  html += '<div id="backfill-status" style="font-size:14px;color:var(--text-muted);margin-bottom:6px;"></div>';
  html += '<div class="card" style="padding:0;overflow:hidden;">';

  // Show existing entries (or placeholders for last 7 weekdays if none exist)
  var entriesToShow = allDates.slice(0, 15);
  if(entriesToShow.length === 0) {
    html += '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:14px;">No entries yet. Click a button above to auto-generate.</div>';
  } else {
    entriesToShow.forEach(function(date) {
      var a = getAnalysis(date);
      if (!a) return;
      var dateObj = new Date(date + 'T12:00:00');
      var dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      var isActive = date === analysisCurrentDate;
      var moverCount = (a.movers || []).length;
      var topMover = moverCount > 0 ? a.movers[0].ticker + ' ' + (a.movers[0].changePct >= 0 ? '+' : '') + a.movers[0].changePct.toFixed(1) + '%' : '';
      var topColor = moverCount > 0 && a.movers[0].changePct >= 0 ? 'var(--green)' : 'var(--red)';

      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;font-size:14px;' + (isActive ? 'background:rgba(59,130,246,0.08);' : '') + '" onclick="analysisCurrentDate=\'' + date + '\';renderAnalysis();">';
      html += '<span style="color:var(--text-secondary);font-weight:' + (isActive ? '700' : '400') + ';">' + dayName + '</span>';
      html += '<span style="font-size:14px;color:var(--text-muted);">' + moverCount + ' movers</span>';
      if (topMover) html += '<span style="font-weight:700;color:' + topColor + ';font-family:\'JetBrains Mono\',monospace;font-size:12px;">' + topMover + '</span>';
      html += '</div>';
    });
  }

  html += '</div></div>';
  parentEl.innerHTML += html;
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

    var polygonKey='';try{polygonKey=localStorage.getItem('mtp_polygon_key')||'';}catch(e){}
    if(!polygonKey)polygonKey='cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';

    // Fetch in batches
    var barData={};
    setStatus('Fetching price data (this may take a moment)...');
    for(var i=0;i<allTickers.length;i++){
      var ticker=allTickers[i];
      try{
        var url='https://api.polygon.io/v2/aggs/ticker/'+ticker+'/range/1/day/'+fromStr+'/'+toStr+'?adjusted=true&sort=asc&apiKey='+polygonKey;
        var resp=await fetch(url);
        if(resp.ok){
          var json=await resp.json();
          if(json.results&&json.results.length>0)barData[ticker]=json.results;
        }
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
        var newsUrl='https://api.polygon.io/v2/reference/news?ticker='+topMovers[ni].ticker+'&published_utc.gte='+dateStr+'T00:00:00Z&published_utc.lte='+dateStr+'T23:59:59Z&limit=5&apiKey='+polygonKey;
        var nResp=await fetch(newsUrl);if(nResp.ok){var nJson=await nResp.json();moverNews[topMovers[ni].ticker]=(nJson.results||[]).map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});}
      }catch(e){}
      if(ni>0&&ni%5===0) await new Promise(function(r){setTimeout(r,1200);});
    }

    // Step 4: Build AI prompt
    setStatus('AI analyzing the session...');
    var moverContext=topMovers.map(function(m){
      var dir=m.pct>0?'UP':'DOWN';
      var news=moverNews[m.ticker]||[];
      var newsStr=news.length>0?'\n  Headlines: '+news.slice(0,3).join('; '):'\n  No specific headlines.';
      return m.ticker+' '+dir+' '+m.pct.toFixed(1)+'% (Close: $'+m.close.toFixed(2)+')'+newsStr;
    }).join('\n\n');

    var sectorContext=sectorPerf.map(function(s){return s.name+' ('+s.etf+'): '+(s.pct>=0?'+':'')+s.pct.toFixed(2)+'%';}).join('\n');

    var prompt='You are a professional market analyst. Generate a full end-of-day analysis for '+dateStr+'.\n\n'+
      'SPY change: '+(spyChg>=0?'+':'')+spyChg.toFixed(2)+'%\n\n'+
      'SECTOR PERFORMANCE:\n'+sectorContext+'\n\n'+
      'BIGGEST MOVERS:\n'+moverContext+'\n\n'+
      'Generate a complete analysis in this EXACT JSON format. Return ONLY the JSON object:\n'+
      '{\n'+
      '  "marketContext": "2-3 sentence summary of the day. What drove the session. Key headlines.",\n'+
      '  "movers": [\n'+
      '    {"ticker": "DELL", "changePct": 21.8, "sector": "Technology", "catchable": "yes|partial|no", "why": "1-2 sentences on what caused the move", "lesson": "1-2 sentences — what a trader should learn from this"}\n'+
      '  ],\n'+
      '  "sectorRotation": "MONEY FLOWING INTO: ... MONEY FLOWING OUT OF: ... NOTABLE: ...",\n'+
      '  "patterns": "DEVELOPING: bullet points of multi-day patterns building. FADING: patterns losing steam.",\n'+
      '  "missed": "Opportunities that were catchable but may have been missed. Actionable lessons.",\n'+
      '  "tomorrowWatch": "Priority setups for tomorrow. Specific tickers, levels, and strategies.",\n'+
      '  "probabilityMap": [\n'+
      '    {"ticker": "CRWD", "probability": 75, "tier": 1, "direction": "long|short|both", "catalyst": "short label", "thesis": "2-3 sentences", "keyLevels": "Support: $X | Resistance: $Y", "optionsPlay": "specific options strategy"}\n'+
      '  ],\n'+
      '  "watchlist": [\n'+
      '    {"theme": "Theme Name", "status": "active|watch|fading", "tickers": ["TICK1","TICK2"], "note": "Why this theme matters"}\n'+
      '  ],\n'+
      '  "mindset": {"score": 7, "scoreNote": "Brief note on discipline", "violations": [{"rule": "Rule name", "detail": "what happened"}], "wins": ["What went right"]}\n'+
      '}\n\n'+
      'RULES:\n'+
      '- Include 6-10 movers (biggest absolute % changes with clear catalysts)\n'+
      '- "catchable" = yes if the setup was visible pre-market or early session, partial if needed fast reaction, no if purely news-driven\n'+
      '- probabilityMap: 4-6 tickers ranked by probability of 3%+ move TOMORROW\n'+
      '- watchlist: 3-5 thematic groupings\n'+
      '- For mindset: since we dont know the users trades, give a general score of 7 with note "Auto-generated — update with your actual trades"\n'+
      '- Keep everything concise and trader-focused. No fluff.\n'+
      '- Return ONLY the JSON object.';

    var data=await callAIProxy({model:'claude-sonnet-4-20250514',max_tokens:4096,messages:[{role:'user',content:prompt}]});
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

  var polygonKey='';try{polygonKey=localStorage.getItem('mtp_polygon_key')||'';}catch(e){}
  if(!polygonKey)polygonKey='cITeodtOFuLRZuppvB3hc6U4XMBQUT0u';

  var barData={};
  for(var i=0;i<allTickers.length;i++){
    var ticker=allTickers[i];
    try{
      var url='https://api.polygon.io/v2/aggs/ticker/'+ticker+'/range/1/day/'+fromStr+'/'+toStr+'?adjusted=true&sort=asc&apiKey='+polygonKey;
      var resp=await fetch(url);
      if(resp.ok){var json=await resp.json();if(json.results&&json.results.length>0)barData[ticker]=json.results;}
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
      var newsUrl='https://api.polygon.io/v2/reference/news?ticker='+topMovers[ni].ticker+'&published_utc.gte='+dateStr+'T00:00:00Z&published_utc.lte='+dateStr+'T23:59:59Z&limit=5&apiKey='+polygonKey;
      var nResp=await fetch(newsUrl);if(nResp.ok){var nJson=await nResp.json();moverNews[topMovers[ni].ticker]=(nJson.results||[]).map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});}
    }catch(e){}
    if(ni>0&&ni%5===0) await new Promise(function(r){setTimeout(r,1200);});
  }

  var moverContext=topMovers.map(function(m){
    var dir=m.pct>0?'UP':'DOWN';
    var news=moverNews[m.ticker]||[];
    var newsStr=news.length>0?'\n  Headlines: '+news.slice(0,3).join('; '):'\n  No specific headlines.';
    return m.ticker+' '+dir+' '+m.pct.toFixed(1)+'% (Close: $'+m.close.toFixed(2)+')'+newsStr;
  }).join('\n\n');

  var sectorContext=sectorPerf.map(function(s){return s.name+' ('+s.etf+'): '+(s.pct>=0?'+':'')+s.pct.toFixed(2)+'%';}).join('\n');

  var prompt='You are a professional market analyst. Generate a full end-of-day analysis for '+dateStr+'.\n\nSPY change: '+(spyChg>=0?'+':'')+spyChg.toFixed(2)+'%\n\nSECTOR PERFORMANCE:\n'+sectorContext+'\n\nBIGGEST MOVERS:\n'+moverContext+'\n\nGenerate a complete analysis in this EXACT JSON format. Return ONLY the JSON object:\n{\n  "marketContext": "2-3 sentence summary of the day. What drove the session. Key headlines.",\n  "movers": [\n    {"ticker": "DELL", "changePct": 21.8, "sector": "Technology", "catchable": "yes|partial|no", "why": "1-2 sentences on what caused the move", "lesson": "1-2 sentences — what a trader should learn from this"}\n  ],\n  "sectorRotation": "MONEY FLOWING INTO: ... MONEY FLOWING OUT OF: ... NOTABLE: ...",\n  "patterns": "DEVELOPING: bullet points of multi-day patterns building. FADING: patterns losing steam.",\n  "missed": "Opportunities that were catchable but may have been missed. Actionable lessons.",\n  "tomorrowWatch": "Priority setups for tomorrow. Specific tickers, levels, and strategies.",\n  "probabilityMap": [\n    {"ticker": "CRWD", "probability": 75, "tier": 1, "direction": "long|short|both", "catalyst": "short label", "thesis": "2-3 sentences", "keyLevels": "Support: $X | Resistance: $Y", "optionsPlay": "specific options strategy"}\n  ],\n  "watchlist": [\n    {"theme": "Theme Name", "status": "active|watch|fading", "tickers": ["TICK1","TICK2"], "note": "Why this theme matters"}\n  ],\n  "mindset": {"score": 7, "scoreNote": "Brief note on discipline", "violations": [{"rule": "Rule name", "detail": "what happened"}], "wins": ["What went right"]}\n}\n\nRULES:\n- Include 6-10 movers (biggest absolute % changes with clear catalysts)\n- "catchable" = yes if the setup was visible pre-market or early session, partial if needed fast reaction, no if purely news-driven\n- probabilityMap: 4-6 tickers ranked by probability of 3%+ move TOMORROW\n- watchlist: 3-5 thematic groupings\n- For mindset: since we dont know the users trades, give a general score of 7 with note "Auto-generated — update with your actual trades"\n- Keep everything concise and trader-focused. No fluff.\n- Return ONLY the JSON object.';

  var data=await callAIProxy({model:'claude-sonnet-4-20250514',max_tokens:4096,messages:[{role:'user',content:prompt}]});
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
    addChatMessage('assistant', '→ Please log in to use the AI chat feature.');
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
        contextStr += '• ' + m.ticker + ' ' + (m.changePct >= 0 ? '+' : '') + m.changePct.toFixed(1) + '% (' + m.sector + ') - ' + m.why;
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'You are Claude, embedded in a trader\'s MAC Terminal (Market Action Center) dashboard on the Analysis tab.\n\n' +
          'The trader uses options strategies including put spreads and covered calls. Morning setups before 10am tend to have highest win rates.\n' +
          'Key rules: Stick to your system. Avoid impulsive trades. Cash is a position.\n\n' +
          'RESPONSE RULES:\n- Keep responses concise (2-4 short paragraphs max)\n- Be specific with tickers, strikes, and levels\n- Reference the analysis data\n- Think like a trading partner\n- If asked about setups, give actionable entry/exit/risk\n\n' +
          'TODAY\'S ANALYSIS:\n' + contextStr + patternData,
      messages: analysisChatHistory
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

// ==================== SEED FEB 20 TRADES + ANALYSIS ====================
(function() {
  // Seed journal with Feb 20 trades
  var journal = [];
  try { journal = JSON.parse(localStorage.getItem('mtp_journal') || '[]'); } catch(e) {}
  var hasFeb20 = journal.some(function(t) { return t.date === '2026-02-20'; });
  if (!hasFeb20) {
    var feb20trades = [
      { id: 'T20260220_001', date: '2026-02-20', ticker: 'SPY', strategy: 'Put Spread', direction: 'short',
        entry: 0.85, exit: 0.15, pl: 350, contracts: 5, entryTime: '08:35', exitTime: '09:12',
        holdMinutes: 37, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 595, longStrike: 592.5,
        notes: 'Morning put spread scalp #1. Support held. Closed for max profit. System trade.' },
      { id: 'T20260220_002', date: '2026-02-20', ticker: 'QQQ', strategy: 'Put Spread', direction: 'short',
        entry: 0.55, exit: 0.10, pl: 225, contracts: 5, entryTime: '08:40', exitTime: '09:20',
        holdMinutes: 40, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 510, longStrike: 507.5,
        notes: 'Morning put spread scalp #2. QQQ above support on SCOTUS tariff relief.' },
      { id: 'T20260220_003', date: '2026-02-20', ticker: 'GOOGL', strategy: 'Put Spread', direction: 'short',
        entry: 0.82, exit: 0.40, pl: 210, contracts: 5, entryTime: '08:46', exitTime: '09:55',
        holdMinutes: 69, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 305, longStrike: 302.5,
        notes: 'Morning put spread scalp #3. GOOGL preferred put-sell candidate around $305-315. Clean setup.' },
      { id: 'T20260220_004', date: '2026-02-20', ticker: 'MSFT', strategy: 'Long Call', direction: 'long',
        entry: 4.25, exit: 0.75, pl: -850, contracts: 2, entryTime: '10:30', exitTime: '15:45',
        holdMinutes: 315, isWin: false, dte: 2, strikeWidth: 0, shortStrike: 0, longStrike: 0,
        notes: 'RULE #3 VIOLATION. Impulsive long call after morning session ended. MSFT in structural downtrend (-18% YTD). Broke every rule. This erased the mornings +$785.' }
    ];
    journal = journal.concat(feb20trades);
    try { localStorage.setItem('mtp_journal', JSON.stringify(journal)); } catch(e) {}
  }

  // Seed analysis with real Feb 23 data
  var key23 = 'mtp_analysis_2026-02-23';
  var exists23 = false;
  try { exists23 = !!localStorage.getItem(key23); } catch(e) {}
  if (!exists23 && !_analysisCache['2026-02-23']) {
    var feb23 = {
      marketContext: "UGLY SESSION. S&P 500 dropped 1.04% to 6,837.75 — now negative for 2026. Dow hammered -1.66% (-822 pts) to 48,804. Nasdaq -1.13% to 22,627. Two catalysts collided: (1) Trump raised global tariffs to 15% under Section 122 of the Trade Act after SCOTUS struck down IEEPA reciprocal tariffs on Friday. EU immediately paused trade deal ratification. (2) AI disruption fear trade intensified — Anthropic launched Claude Code Security tool, triggering a second day of cybersecurity carnage. Financials got destroyed on Saba Capital/Cox Capital activist plays against Blue Owl credit funds. Gold exploded to $5,177+ on safe-haven demand. 10Y yield dipped to 4.06%. VIX spiked. This was a RISK-OFF session — defensive names (WMT +2.3%, LLY +4.9%) were the only green. IV expanded significantly across software, cybersecurity, and financials — prime environment for put SELLING on the fear spike.",

      movers: [
        { ticker: 'IBM', changePct: -13.1, sector: 'Technology', catchable: 'yes',
          why: 'Anthropic launched Claude Code Security tool. Market repriced IBM as AI disruption victim — biggest Dow drag. Massive volume day.',
          lesson: 'AI disruption headlines create panic selling in incumbent tech. IBM dropped to $223 — these moves tend to overshoot on day 1. Watch for a 2-3 day bounce setup as shorts cover. Could have sold call spreads above the gap for easy premium.' },
        { ticker: 'CRWD', changePct: -9.8, sector: 'Cybersecurity', catchable: 'yes',
          why: 'Second day of selling after Anthropic Claude Code Security announcement. Entire cybersecurity sector repriced — BUG ETF -4%. Zscaler also -10%. CEO Kurtz defended moat on LinkedIn over weekend but market didnt care.',
          lesson: 'CRWD now 16.8% below 20-day SMA and 27% below 100-day SMA. RSI at 35 — approaching oversold. Earnings March 3. This is setting up as a massive mean-reversion trade. When fear-driven selling pushes quality names this far below moving averages, selling puts into elevated IV is the play. Watch $340 support — if it holds through the week, sell put spreads below it.' },
        { ticker: 'AXP', changePct: -7.2, sector: 'Financials', catchable: 'partial',
          why: 'Research report warning of massive AI-driven unemployment spooked payment/fintech names. AXP was largest Dow decliner after IBM. Also hit by broader financials selloff.',
          lesson: 'Financials sector -3% was the worst performing group. When AI fear + activist hedge fund news hit financials simultaneously, the move gets amplified. The AI unemployment thesis is a narrative trade — these tend to fade within 48-72hrs.' },
        { ticker: 'WMT', changePct: 2.3, sector: 'Consumer Staples', catchable: 'yes',
          why: 'Classic flight to defensive quality. WMT was one of few green names in a sea of red. Tariff concerns actually benefit WMT near-term as consumers trade down.',
          lesson: 'On major risk-off days, WMT and staples are the put-selling sweet spot. IV expands even on winners because of index-level VIX spike. WMT puts were likely overpriced relative to its actual risk — free money for put sellers.' },
        { ticker: 'LLY', changePct: 4.9, sector: 'Healthcare', catchable: 'partial',
          why: 'Healthcare was a defensive rotation beneficiary. LLY rallied nearly 5% (+$49) to $1,058 while everything else bled. GLP-1 momentum continues.',
          lesson: 'LLY has become a safe haven trade. On risk-off days, it attracts rotation flows. The $1,000 level is strong psychological support. If you see another fear day this week, LLY puts below $1,000 are high-probability premium collection.' },
        { ticker: 'PYPL', changePct: 5.8, sector: 'Fintech', catchable: 'no',
          why: 'Counter-trend move while AXP got destroyed. Possible rotation into cheaper fintech plays or short covering. Surprising strength given the AI disruption narrative hitting payments.',
          lesson: 'When a sector is under broad pressure but one name goes green, pay attention — it usually signals institutional accumulation or a catalyst the market hasnt fully priced. PYPL divergence from AXP is notable.' },
        { ticker: 'NVDA', changePct: 1.7, sector: 'Semiconductors', catchable: 'partial',
          why: 'Slight green into earnings Wednesday (Feb 25). Goldman raised PT to $200, Wells Fargo raised to $220. IV at 50 (52-week range 32-75). Market treating NVDA as the one must-own AI name even on a risk-off day.',
          lesson: 'NVDA holding green on a -1% SPY day ahead of earnings = massive relative strength. The options market is pricing a big move. Call/put ratio 1.6:1. Do NOT sell puts into earnings — the binary risk is too high. Wait for post-earnings IV crush to sell premium.' },
        { ticker: 'BE', changePct: 8.5, sector: 'AI Power Infrastructure', catchable: 'yes',
          why: 'Bloom Energy ripped +8.5% to $160.14 while SPY dropped 1%. AI data center power demand theme continues — $600B hyperscaler capex in 2026. Up 80% YTD, 465% over past year. $20B backlog, $5B Brookfield deal, 4 consecutive quarters of record revenue. This is THE relative strength leader on the board.',
          lesson: 'MISSED OPPORTUNITY. +8.5% on a red tape day = institutional accumulation. The signal was clear at the open: when a momentum name gaps UP on a gap-DOWN tape, you buy calls on the morning dip or sell puts below the prior close ($147.55). The $145-150 area was a layup for put spreads. We need to have BE and the AI power names (OKLO, VST, CEG, NRG, SMR) on the daily watchlist. A stock with this range and options liquidity is a prime target for our system.' },
        { ticker: 'IREN', changePct: -7.6, sector: 'AI/BTC Infrastructure', catchable: 'no',
          why: 'IREN (fka Iris Energy) sold from $43.29 to ~$40. BTC-to-AI pivot story — 4.5GW of secured power capacity, AI Cloud segment +137%, but missed earnings badly (-$0.52 vs -$0.11 est). Tariff selloff hit AI neo-cloud names. Down 48% from $76.87 high.',
          lesson: 'Not our trade right now. Missed earnings, identity crisis (BTC mining revenue -23%), and wild $5 intraday swings. The pivot thesis is interesting long-term but execution risk is too high for put selling. Revisit when it establishes a base. File under: watch but dont touch.' },
        { ticker: 'USAR', changePct: -1.7, sector: 'Critical Minerals', catchable: 'no',
          why: 'USA Rare Earth continues bleeding — closed at ~$16.96, down from $44 peak in October. Zero revenue, going concern warnings, Stillwater production delayed from 2023 to H1 2026. Rare earth sector under pressure from activist shorts. $3.1B gov deal is the bull case. EARNINGS TUESDAY FEB 25.',
          lesson: 'Binary event tomorrow — do not trade ahead of earnings on a zero-revenue company with going concern warnings. The rare earth / Project Vault thesis is compelling but this is a spec play, not a premium-selling candidate. If earnings show commercial production progress and stock stabilizes above $17, could become interesting. If it misses, knife falls further.' }
      ],

      sectorRotation: "MONEY FLOWING INTO: Consumer Staples (WMT +2.3% — defensive rotation + tariff consumer trade-down thesis), Healthcare (LLY +4.9%, defensive quality), Gold/Precious Metals (Gold hit $5,177, up 3%+ — safe haven demand exploding on tariff uncertainty), Treasuries (10Y yield down to 4.06%, 2Y to 3.48% — classic risk-off bid).\n\nMONEY FLOWING OUT OF: Financials (-3% — WORST sector. KKR -9%, Blackstone -7%, Blue Owl -5% on Saba Capital activist news. AXP -7.2%, GS -4% on AI unemployment fears), Cybersecurity (BUG ETF -4%, CRWD/ZS -10%, Fortinet/Okta -5%+ — Anthropic Claude Code Security disruption fear), Software (IBM -13%, DDOG -11%, ORCL -4%, PLTR -4% — AI replacement narrative), Small Caps (IWM outsized losses, risk-off disproportionately hits small caps).\n\nNOTABLE: The Magnificent Seven is now DOWN 5% for 2026. MSFT -18% YTD, TSLA and AMZN each -8%+. Equal-weight S&P outperforming cap-weighted by 11%+ YTD. This is a massive regime shift — the market is telling you to be in industrials, staples, and commodities, not mega-cap tech. The tariff trade is NOT over despite SCOTUS ruling.",

      patterns: "DEVELOPING:\n• AI DISRUPTION FEAR TRADE (Day 2): Anthropic Claude Code Security launched Friday, cybersecurity/software selling accelerated Monday. This pattern (new AI capability → sector panic → 2-3 day selloff → mean reversion) has repeated multiple times. CRWD earnings March 3 creates a natural catalyst for the bounce. Watch for exhaustion selling Tuesday.\n• TARIFF WHIPSAW CYCLE: SCOTUS strikes down IEEPA tariffs Friday → markets rally → Trump pivots to Section 122 (15% global) over weekend → Monday selloff. The Section 122 has a 150-day clock requiring Congressional approval to extend. Summer 2026 showdown is now on the calendar. Markets will oscillate on every tariff headline.\n• GOLD PARABOLIC RUN: $5,177 today. Was $4,652 just 3 weeks ago. Thats an 11% move in gold in under a month. Driven by: tariff uncertainty, Iran tensions (your thesis), global de-dollarization narrative. Your miners watchlist (FSM, AG, PAAS, WPM) should be catching a bid. This is a MULTI-WEEK trend, not a 1-day trade.\n• VIX EXPANSION: VIX spiked from ~19 on Friday to elevated levels Monday. This is PUT SELLER PARADISE — elevated IV means fatter premiums. Your morning put spread scalps should see better risk/reward this week.\n• MAG 7 BREAKDOWN: Down 5% YTD as a group while equal-weight SPX is +6.4%. Breadth rotation into industrials and commodities is the dominant 2026 theme. This is late-cycle behavior.\n\nFADING:\n• The Friday SCOTUS rally — completely reversed and then some. Proves that tariff uncertainty is structural, not event-driven.\n• Small cap bounce thesis — IWM continues to underperform on every risk-off day.",

      missed: "CRWD PUT SPREADS: CRWD dropped 10% on Day 2 of the AI fear selloff. But by mid-afternoon the selling was exhausting. If you had waited for the 2pm-3pm stabilization zone and sold put spreads below $340 for Wednesday expiry, you could have collected massive premium with IV at extreme levels. The stock is approaching oversold RSI territory. Lesson: On Day 2 of fear selling, dont chase the short — sell premium into the fear.\n\nWMT CALLS / PUT SELLING: WMT was clearly the safe-haven play from the open. When SPY gaps down -0.5%+ and WMT gaps UP, thats a screaming signal. Selling puts on WMT at the open would have been a layup — zero stress, defensive name, premium inflated by index VIX.\n\nIBM CALL SPREADS: IBM gapped down 13% — the largest single-day drop in years. Could have sold call spreads above $240 (the gap level) for easy premium. The gap will act as resistance for weeks. This was a textbook gap-and-trap setup.\n\nGOLD MINERS: Your watchlist (FSM, AG, PAAS, WPM) — gold hit $5,177. These miners should be catching a sympathy bid. Did you have positions? If not, the gold trend is multi-week. Tuesday dip would be an entry.\n\nAction items: (1) On fear spike days, your #1 priority should be selling premium into elevated IV — not directional bets. (2) Defensive names (WMT, LLY) become put-selling layups on risk-off days. (3) Day 2 of sector panic = start looking for mean reversion entries.",

      tomorrowWatch: "PRIORITY SETUPS — TUESDAY FEB 24:\n\n★ BE (BLOOM ENERGY) — DIGESTION PLAY:\nAfter +8.5% Monday, expect consolidation. The pattern: big move → digestion → continuation or reversal. BE closed at $160, prior close was $147.55.\n• BULL CASE: If BE holds above $155 in pre-market and dips to $155-158 range in first 30min, sell put spreads below $150. IV will still be elevated from Mondays move. The $145-150 zone is strong support (Fridays close level). This is the highest-conviction new setup.\n• BEAR CASE: If it gaps below $155, stand aside — that signals profit-taking and the pullback could extend to $145. Dont catch the knife.\n• Also watch the AI power complex: OKLO, VST, CEG, NRG, SMR for sympathy setups.\n\n★ CRWD PUT SPREADS — DAY 3 OF FEAR SELLOFF:\nCRWD at $350, down 10% Monday, 16.8% below 20-day SMA. RSI approaching oversold at 35. Anthropic enterprise briefing Tuesday could extend selling OR mark the exhaustion point.\n• If CRWD stabilizes $340-350 in first 30min, sell put spreads below $330 for Friday expiry. IV is extreme = fat premium.\n• Earnings not until March 3, so no binary event this week.\n• Watch for Kurtz or analyst defense notes — any positive headline becomes the bounce catalyst.\n\n★ WMT — DEFENSIVE PUT SELLING:\nWMT +2.3% Monday on defensive rotation. If another risk-off day, WMT gets bid again.\n• Sell puts below $126 support. Premium inflated by index VIX even though WMT itself isnt volatile. Layup setup.\n\n★ SPY/QQQ MORNING SCALPS:\nCore system trade. Before 10am. VIX elevated = fatter premiums this week.\n• SPY: sell put spreads below 6,780 support on morning dip.\n• QQQ: sell put spreads below 510 on morning weakness.\n• GOOGL: your preferred name. Sell puts below $300 if it dips on tape weakness.\n\nDO NOT TRADE:\n• NVDA — Earnings Wednesday after close. Binary event. Wait for post-earnings IV crush.\n• USAR — Earnings Tuesday. Zero revenue company with going concern warnings. Pure gamble.\n• IREN — No established base. Wild swings. Not our system.\n\nRISK EVENTS TUESDAY:\n• Home Depot (HD) earnings pre-market — consumer/housing read. Analysts expect revenue -3.9% YoY. Prediction markets 86% chance of beat. Could set tone for retail names.\n• Consumer Confidence Index — expected to dip to 102.7. If it misses big, risk-off extends.\n• Anthropic enterprise briefing — more AI disruption headlines likely. Could extend cybersecurity selling (good for CRWD put selling setup) or mark the peak of fear.\n• Fed speakers: Lorie Logan, Michael Barr, Tom Barkin — watch for rate commentary.\n• SMCI approaching deadline for delayed annual results.\n• S&P 500 futures flat to slightly negative after hours — no dramatic overnight move yet.\n\nTWO-DAY TREND SYNTHESIS:\nThursday Feb 20: SCOTUS kills IEEPA tariffs → rally → your 3/3 morning scalps banked +$785 → MSFT Rule #3 violation cost -$850.\nMonday Feb 23: Trump replaces with 15% Section 122 → selloff → AI disruption fear Day 2 → cybersecurity/software massacred → defensive rotation (WMT, LLY) + AI power (BE) were the winners.\n\nPATTERN: The market is in a headline-driven whipsaw regime. Friday gains become Monday losses. The edge is in MORNING PUT SPREADS on fear + THEMATIC MOMENTUM names showing relative strength. Your system works — you just need a wider lens on which names to apply it to.\n\nMINDSET:\n• Rule #3: Stick to the plan. Morning scalps + 1-2 thematic setups. No afternoon impulse trades.\n• Rule #18: Cash is a position. If Tuesday opens messy with HD earnings + consumer confidence, wait for 9:45-10:00 for clarity before deploying.\n• BE is now on the daily watchlist. It stays there until the trend breaks.\n• Sell premium on fear. Dont buy direction on fear. IV expansion is YOUR edge.",

      probabilityMap: [
        { ticker: 'CRWD', probability: 80, tier: 1, direction: 'both', catalyst: 'Anthropic Briefing + Day 3 Fear',
          thesis: 'Day 3 of AI fear selloff. 27% below 100-day SMA, RSI 35. Anthropic enterprise briefing Tuesday is the binary catalyst — either extends panic or marks exhaustion. Entire cybersecurity complex (ZS, FTNT, OKTA, PANW) follows. Volume has been 2-3x average for two days.',
          keyLevels: 'Support: $340 | Resistance: $370 | Gap fill target: $390',
          optionsPlay: 'Sell put spreads below $330 for Friday if stabilizes. Or straddle $350 for binary move.' },
        { ticker: 'BE', probability: 75, tier: 1, direction: 'long', catalyst: 'Digestion after +8.5%',
          thesis: '+8.5% on a -1% SPY day = massive institutional buying. Digestion pattern: big move → consolidation → continuation or reversal. AI power demand narrative has no ceiling. $20B backlog, $600B hyperscaler capex. Options liquid, wide intraday ranges.',
          keyLevels: 'Support: $150-152 (Friday close) | Digestion zone: $155-160 | Continuation: $165+',
          optionsPlay: 'Sell put spreads below $150 on morning dip. If holds $155+ pre-market, high conviction.' },
        { ticker: 'HD', probability: 70, tier: 1, direction: 'both', catalyst: 'Earnings pre-market Tuesday',
          thesis: 'Confirmed earnings catalyst. Revenue expected -3.9% YoY but prediction markets 86% chance of EPS beat. Tariff whipsaw helps and hurts: SCOTUS ruling lowered import costs Friday, but 15% Section 122 tariffs raised them Monday. $377 stock, 50-day SMA at $369.',
          keyLevels: 'Support: $365 (50-day SMA) | Resistance: $390 | Gap up target: $395+',
          optionsPlay: 'Dont trade into earnings. Watch for post-report setup. If beats + guides well, sell puts on the pullback.' },
        { ticker: 'IBM', probability: 65, tier: 2, direction: 'long', catalyst: 'Dead cat bounce after -13%',
          thesis: 'Biggest single-day drop in years. Day 2 after gap-downs of this magnitude always produce oversized moves. Shorts will take profits. But Anthropic briefing Tuesday could add more AI disruption fuel and extend selling.',
          keyLevels: 'Resistance: $230-235 (old support = new resistance) | Support: $218 | Friday gap: $257',
          optionsPlay: 'Sell call spreads above $240 if it bounces. The gap at $257 is long-term resistance.' },
        { ticker: 'ZS', probability: 65, tier: 2, direction: 'both', catalyst: 'Cybersecurity sympathy + oversold',
          thesis: 'Dropped 10% Monday in sympathy with CRWD. More AI-vulnerable perception than CRWD. If Anthropic briefing is exhaustion point, ZS bounces harder on relative basis. If fear extends, ZS has most downside.',
          keyLevels: 'Watch for CRWD to lead direction. ZS follows with higher beta.',
          optionsPlay: 'Same as CRWD — sell put spreads if cybersecurity stabilizes Tuesday morning.' },
        { ticker: 'FSM', probability: 60, tier: 2, direction: 'long', catalyst: 'Gold $5,177 + Iran tensions',
          thesis: 'Gold parabolic at $5,177. Miners lagging the move — when underlying commodity breaks to new highs and miners havent caught up, snap higher comes in bursts. Iran rhetoric adds second catalyst. Entire precious metals complex (AG, PAAS, WPM) is correlated.',
          keyLevels: 'Watch gold — if holds above $5,100, miners catch a bid. If gold pulls back, miners drop fast (higher beta).',
          optionsPlay: 'Buy calls on morning dip if gold holds. Or sell puts below recent support. Small position sizing — miners are volatile.' },
        { ticker: 'USAR', probability: 55, tier: 3, direction: 'both', catalyst: 'Earnings Tuesday',
          thesis: 'Binary earnings event on zero-revenue company. Could gap 15% either direction on Stillwater production news. Not tradeable with our system. Watch for post-earnings setup only.',
          keyLevels: 'Support: $15 | Resistance: $20 | 52-week high: $44',
          optionsPlay: 'DO NOT TRADE. Watch only. Revisit after earnings if stabilizes above $17.' },
        { ticker: 'NVDA', probability: 50, tier: 3, direction: 'long', catalyst: 'Coiling before Wed earnings',
          thesis: 'Probably tight range Tuesday as everyone positions for Wednesday. The big move comes Wednesday after-hours/Thursday. Suppressing vol across all of tech Tuesday.',
          keyLevels: 'Goldman PT: $200 | Wells Fargo PT: $220 | IV at 50 (range 32-75)',
          optionsPlay: 'DO NOT TRADE pre-earnings. Wait for post-earnings IV crush Thursday. Then sell puts on the pullback if they beat.' }
      ],

      watchlist: [
        { theme: 'AI Power Infrastructure', status: 'active',
          tickers: ['BE', 'OKLO', 'VST', 'CEG', 'NRG', 'SMR'],
          note: 'THE leadership theme of 2026. BE +80% YTD, up 8.5% on a red day Monday. $600B hyperscaler capex flowing into data center power. Wide intraday ranges + options liquidity = prime for our system. Daily monitoring.' },
        { theme: 'Cybersecurity Fear Trades', status: 'active',
          tickers: ['CRWD', 'ZS', 'PANW', 'FTNT', 'OKTA', 'NET'],
          note: 'Day 2-3 of AI disruption selloffs = premium selling paradise. IV expansion on quality names pushed below key SMAs. Mean reversion within 3-5 days historically. Sell puts into the fear, dont buy direction.' },
        { theme: 'Gold & Precious Metals Miners', status: 'active',
          tickers: ['FSM', 'AG', 'PAAS', 'WPM', 'GLD', 'SLV'],
          note: 'Gold at $5,177 and parabolic. Iran tensions + tariff uncertainty + de-dollarization. Multi-week trend confirmed. Miners lagging gold = catch-up potential. Your original thesis is playing out.' },
        { theme: 'Defensive Put Selling', status: 'active',
          tickers: ['WMT', 'LLY', 'COST', 'PG', 'JNJ', 'MCD'],
          note: 'On risk-off days, these get bid while everything else bleeds. IV inflated by index VIX even on winners = free money for put sellers. WMT +2.3%, LLY +4.9% on Monday while SPY -1%.' },
        { theme: 'Tariff Beneficiary Basket', status: 'watch',
          tickers: ['NKE', 'LULU', 'DECK', 'TGT', 'WMT', 'COST'],
          note: 'SCOTUS struck IEEPA tariffs but Trump replaced with Section 122 15%. Net effect unclear. These names whipsawed Thurs-Mon. Watch for stabilization before deploying. Thesis still valid but timing is headline-dependent.' },
        { theme: 'Morning Scalp Core', status: 'active',
          tickers: ['SPY', 'QQQ', 'GOOGL'],
          note: 'Bread and butter. Morning put spread scalps before 10am = highest win rate. VIX elevated this week = fatter premiums. 3/3 on Thursday Feb 20. This is the foundation — everything else is layered on top.' }
      ],

      mindset: {
        violations: [
          { rule: 'Rule #3 — Stick to Plan', detail: 'MSFT impulsive long call on Thursday Feb 20. Entered after 10am, on a stock in structural downtrend (-18% YTD). Cost -$850 and erased entire mornings +$785. This is the most violated rule in our system.' }
        ],
        wins: [
          '3/3 morning put spread scalps on Thursday — SPY, QQQ, GOOGL. All before 10am. System worked perfectly.',
          'Did NOT trade Monday Feb 23 — if we followed the system, cash was the right position on a gap-down Monday with headline chaos. Rule #18 respected.',
          'Correctly identified tariff whipsaw pattern from Friday → Monday.'
        ],
        score: 6,
        scoreNote: 'Morning system is A+. Afternoon discipline is the problem. The MSFT trade drops this from 9/10 to 6/10. One trade destroyed the session. Fix: hard stop at 10am unless pre-planned setup triggers.'
      }
    };
    _analysisCache['2026-02-23'] = feb23;
    try { localStorage.setItem('mtp_analysis_2026-02-23', JSON.stringify(feb23)); } catch(e) {}
  }

  // Keep Feb 20 demo for history
  var key20 = 'mtp_analysis_2026-02-20';
  var exists20 = false;
  try { exists20 = !!localStorage.getItem(key20); } catch(e) {}
  if (!exists20 && !_analysisCache['2026-02-20']) {
    var feb20 = {
      marketContext: "S&P rallied +0.7% to 6,909 on SCOTUS striking down IEEPA tariffs. Nasdaq +0.9% to 22,886. Dow +0.5%. VIX crushed to 19.09 (-5.6%). Relief rally across the board — AMZN +2.6% led the Dow. Financials, comm services, and consumer discretionary all green. Energy only lagging sector (-0.7%). Clean trending day for put sellers. Your 3/3 morning put spread scalps banked +$785 before 10am. Then the MSFT impulsive long call violated Rule #3 and gave back $850. Net day: -$65.",

      movers: [
        { ticker: 'AMZN', changePct: 2.6, sector: 'Consumer Discretionary', catchable: 'yes',
          why: 'Led the Dow higher on SCOTUS tariff relief. Import-heavy businesses like AMZN were the biggest beneficiaries of the ruling.',
          lesson: 'When tariffs get reduced/eliminated, the first movers are import-heavy retailers and e-commerce. AMZN, WMT, TGT all benefited. This is the tariff beneficiary basket you identified.' },
        { ticker: 'SPY', changePct: 0.7, sector: 'Index', catchable: 'yes',
          why: 'Broad relief rally on SCOTUS ruling. 9 of 11 sectors green. Classic risk-on day.',
          lesson: '3/3 on morning put spread scalps = system works when you follow it. The MSFT long call after 10am broke every rule. Morning scalps before 10am are the edge — stop trading after.' },
        { ticker: 'MSFT', changePct: -0.5, sector: 'Technology', catchable: 'no',
          why: 'Faded after initial pop. MSFT now -18% YTD. The impulsive long call was a Rule #3 violation.',
          lesson: 'MSFT is in a structural downtrend (-18% YTD). Buying calls on a stock in a downtrend on a whim is the exact opposite of the system. This trade cost $850 and erased the mornings gains. Write this on the wall: NO IMPULSIVE LONG CALLS.' }
      ],

      sectorRotation: "MONEY FLOWING INTO: Communication Services (XLC +2.7%), Consumer Discretionary (XLY +1.3%), Financials (XLF +0.7%) — all tariff relief beneficiaries.\n\nMONEY FLOWING OUT OF: Energy (XLE -0.7% — only red sector), VIX (crushed 5.6% to 19.09).\n\nNOTABLE: The SCOTUS ruling was supposed to be the catalyst for sustained rally. Instead it lasted exactly one session before Trump pivoted to Section 122 tariffs over the weekend. The Friday rally was a trap.",

      patterns: "DEVELOPING:\n• Tariff beneficiary basket (NKE, LULU, DECK, TGT, WMT, COST) rallied on SCOTUS ruling but gave it all back Monday. The thesis is right but the timing window is narrow — these names move on headlines, not fundamentals.\n• Morning put spread scalps continue to be the highest-probability setup. 3/3 today before 10am. The data is overwhelming — your best win rate is in the first 90 minutes.\n\nFADING:\n• Any sustained rally thesis from the SCOTUS ruling — Trump replaced IEEPA tariffs with Section 122 within 48 hours. The tariff regime is structural, not going away.",

      missed: "The only missed opportunity was NOT stopping after the morning scalps. +$785 by 9:55am. Then gave back $850 on an impulsive MSFT long call. If you had closed the terminal at 10am, you finish +$785. Instead, -$65.\n\nAction item: Set a hard rule — if morning scalps hit target, CLOSE THE TERMINAL. The afternoon is where your losses come from.",

      tomorrowWatch: "WEEKEND RISK: Trump likely to respond to SCOTUS ruling with alternative tariff mechanism. Watch Truth Social for announcements.\n\nMONDAY SETUP: If tariff headlines cause a gap down, morning put spread scalps on SPY/QQQ in the first 30min. IV will likely expand over the weekend = fatter premiums.\n\nRULE #3 ENFORCEMENT: No trades after 10am unless a pre-planned setup triggers. The afternoon MSFT trade was the exact pattern that needs to stop.",

      probabilityMap: [
        { ticker: 'SPY', probability: 70, tier: 1, direction: 'short', catalyst: 'Weekend tariff headline risk',
          thesis: 'Trump will respond to SCOTUS ruling. Whatever he announces will gap SPY down Monday. Sell put spreads on the gap down in first 30min.',
          keyLevels: 'Support: 6,850 | Resistance: 6,920 | VIX trigger: 20+',
          optionsPlay: 'Morning put spread scalps below 6,830. This is your highest win-rate setup.' },
        { ticker: 'CRWD', probability: 55, tier: 2, direction: 'short', catalyst: 'Anthropic Claude Code Security launched Friday',
          thesis: 'Cybersecurity names sold Friday on Anthropic launch. If selling extends Monday, Day 2 = start watching for exhaustion. IV expanding.',
          keyLevels: 'Support: $360 | Prior support: $350 | 20-day SMA: ~$420',
          optionsPlay: 'Wait for Monday action. If Day 2 selloff, sell puts Tuesday into peak fear.' }
      ],

      watchlist: [
        { theme: 'Tariff Beneficiary Basket', status: 'active',
          tickers: ['NKE', 'LULU', 'DECK', 'TGT', 'WMT', 'COST'],
          note: 'SCOTUS ruling is the catalyst. These names rallied Friday. Watch for follow-through or reversal Monday depending on Trumps response.' },
        { theme: 'Morning Scalp Core', status: 'active',
          tickers: ['SPY', 'QQQ', 'GOOGL'],
          note: '3/3 today. System works. Dont mess with it. Stop trading after 10am.' }
      ],

      mindset: {
        violations: [
          { rule: 'Rule #3 — Stick to Plan', detail: 'MSFT long call at 10:30am. Structural downtrend stock (-18% YTD). Impulsive entry with no setup. Cost -$850 and wiped the mornings +$785. Net day: -$65.' }
        ],
        wins: [
          '3/3 morning put spread scalps: SPY +$350, QQQ +$225, GOOGL +$210. All before 10am.',
          'Correctly identified SCOTUS ruling as catalyst for tariff beneficiary names.'
        ],
        score: 5,
        scoreNote: 'Morning = 10/10 perfect. Afternoon = 0/10 catastrophic. One impulsive trade turned a +$785 day into -$65. The data is clear: your edge exists before 10am and disappears after.'
      }
    };
    _analysisCache['2026-02-20'] = feb20;
    try { localStorage.setItem('mtp_analysis_2026-02-20', JSON.stringify(feb20)); } catch(e) {}
  }
})();