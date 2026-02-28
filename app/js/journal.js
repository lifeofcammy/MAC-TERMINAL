// ==================== journal.js ====================
// Trade Journal tab: calendar view, day drill-down, TOS CSV parsing,
// trade recap engine, P&L analysis, behavioral flagging, export/import.

// ==================== TRADE RECAP DATA BACKUP ====================
function recapExportAll() {
  try {
    const exportData = { version: 2, exportDate: new Date().toISOString(), summaries: {}, recapData: {}, recapHTML: {}, analysisData: {}, journal: [] };
    // Gather all localStorage keys related to recaps and analysis
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === 'mtp_cal_summaries') {
        exportData.summaries = JSON.parse(localStorage.getItem(key) || '{}');
      } else if (key === 'mtp_journal') {
        exportData.journal = JSON.parse(localStorage.getItem(key) || '[]');
      } else if (key.startsWith('mtp_recap_data_')) {
        const dateKey = key.replace('mtp_recap_data_', '');
        exportData.recapData[dateKey] = localStorage.getItem(key);
      } else if (key.startsWith('mtp_recap_')) {
        const dateKey = key.replace('mtp_recap_', '');
        exportData.recapHTML[dateKey] = localStorage.getItem(key);
      } else if (key.startsWith('mtp_analysis_')) {
        const dateKey = key.replace('mtp_analysis_', '');
        exportData.analysisData[dateKey] = localStorage.getItem(key);
      }
    }
    const dayCount = Object.keys(exportData.summaries).length;
    const analysisDays = Object.keys(exportData.analysisData).length;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trade_recap_backup_' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('Exported ' + dayCount + ' recap day(s) + ' + analysisDays + ' analysis day(s) to backup.');
  } catch (e) {
    alert('Error: Export failed: ' + e.message);
  }
}

function recapImportAll(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.summaries && !data.recapData) {
        alert('Error: Invalid backup file — no trade recap data found.');
        return;
      }
      let imported = 0;
      // Merge summaries (don't overwrite existing days unless they're in the import)
      const existingSummaries = JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}');
      if (data.summaries) {
        Object.keys(data.summaries).forEach(dateKey => {
          existingSummaries[dateKey] = data.summaries[dateKey];
          imported++;
        });
        localStorage.setItem('mtp_cal_summaries', JSON.stringify(existingSummaries));
        // Cloud sync
        if (typeof dbSaveCalSummaries === 'function' && typeof getUser === 'function' && getUser()) {
          dbSaveCalSummaries(existingSummaries).catch(function(e) {});
        }
      }
      // Restore raw CSV data per day
      if (data.recapData) {
        Object.keys(data.recapData).forEach(dateKey => {
          localStorage.setItem('mtp_recap_data_' + dateKey, data.recapData[dateKey]);
          if (typeof dbSaveRecapData === 'function' && typeof getUser === 'function' && getUser()) {
            dbSaveRecapData(dateKey, data.recapData[dateKey], null).catch(function(e) {});
          }
        });
      }
      // Restore recap HTML per day
      if (data.recapHTML) {
        Object.keys(data.recapHTML).forEach(dateKey => {
          localStorage.setItem('mtp_recap_' + dateKey, data.recapHTML[dateKey]);
          if (typeof dbSaveRecapData === 'function' && typeof getUser === 'function' && getUser()) {
            dbSaveRecapData(dateKey, null, data.recapHTML[dateKey]).catch(function(e) {});
          }
        });
      }
      // Restore journal data
      if (data.journal && data.journal.length > 0) {
        var existingJournal = [];
        try { existingJournal = JSON.parse(localStorage.getItem('mtp_journal') || '[]'); } catch(e) {}
        var existingIds = new Set(existingJournal.map(function(t) { return t.id; }));
        data.journal.forEach(function(t) {
          if (!existingIds.has(t.id)) existingJournal.push(t);
        });
        localStorage.setItem('mtp_journal', JSON.stringify(existingJournal));
        saveJournal(existingJournal);
      }

      // Restore analysis data
      let analysisImported = 0;
      if (data.analysisData) {
        Object.keys(data.analysisData).forEach(dateKey => {
          localStorage.setItem('mtp_analysis_' + dateKey, data.analysisData[dateKey]);
          // Cloud sync
          if (typeof dbSaveAnalysis === 'function' && typeof getUser === 'function' && getUser()) {
            try { dbSaveAnalysis(dateKey, JSON.parse(data.analysisData[dateKey])).catch(function(e) {}); } catch(e) {}
          }
          analysisImported++;
        });
      }
      alert('Imported ' + imported + ' recap day(s) + ' + analysisImported + ' analysis day(s). Calendar will refresh now.');
      renderRecapCalendar();
    } catch (err) {
      alert('Error: Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
  // Reset file input so same file can be re-imported
  event.target.value = '';
}

// ==================== TRADE JOURNAL DATABASE ====================
// Structured storage for every trade — the foundation for pattern engine learning
// Schema per trade: { id, date, ticker, strategy, direction, entry, exit, pl, contracts,
//   entryTime, exitTime, holdMinutes, isWin, dte, strikeWidth, shortStrike, longStrike,
//   marketCondition, scannerGrade, rvol, notes }

function getJournal() {
  try {
    return JSON.parse(localStorage.getItem('mtp_journal') || '[]');
  } catch(e) { return []; }
}

function saveJournal(journal) {
  try { localStorage.setItem('mtp_journal', JSON.stringify(journal)); } catch(e) {}
  // Cloud sync
  if (typeof dbSaveJournal === 'function' && typeof getUser === 'function' && getUser()) {
    dbSaveJournal(journal).catch(function(e) { console.warn('[journal] cloud sync error:', e); });
  }
}

function addTrade(trade) {
  var journal = getJournal();
  trade.id = 'T' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  journal.push(trade);
  saveJournal(journal);
  return trade.id;
}

function getTradesByDate(date) {
  return getJournal().filter(function(t) { return t.date === date; });
}

function getTradesByTicker(ticker) {
  return getJournal().filter(function(t) { return t.ticker === ticker; });
}

function getTradesByStrategy(strategy) {
  return getJournal().filter(function(t) { return t.strategy === strategy; });
}

// ── PATTERN ENGINE ──
// Analyzes journal to find statistical edges
function runPatternEngine() {
  var journal = getJournal();
  if (journal.length < 5) return { insufficient: true, tradeCount: journal.length };

  var patterns = {};

  // 1. Win rate by strategy
  var strategyStats = {};
  journal.forEach(function(t) {
    var s = t.strategy || 'Unknown';
    if (!strategyStats[s]) strategyStats[s] = { wins: 0, losses: 0, totalPL: 0, trades: 0, pls: [] };
    strategyStats[s].trades++;
    strategyStats[s].totalPL += (t.pl || 0);
    strategyStats[s].pls.push(t.pl || 0);
    if (t.pl > 0) strategyStats[s].wins++;
    else strategyStats[s].losses++;
  });
  patterns.byStrategy = {};
  Object.keys(strategyStats).forEach(function(s) {
    var st = strategyStats[s];
    patterns.byStrategy[s] = {
      winRate: (st.wins / st.trades * 100).toFixed(0) + '%',
      avgPL: (st.totalPL / st.trades).toFixed(0),
      totalPL: st.totalPL.toFixed(0),
      trades: st.trades,
      profitFactor: st.pls.filter(function(p){return p>0;}).reduce(function(s,v){return s+v;},0) /
        Math.abs(st.pls.filter(function(p){return p<0;}).reduce(function(s,v){return s+v;},0) || 1)
    };
  });

  // 2. Win rate by time of day
  var hourStats = {};
  journal.forEach(function(t) {
    if (!t.entryTime) return;
    var hour = parseInt(t.entryTime.split(':')[0]);
    var bucket = hour < 10 ? 'Pre-10am' : hour < 12 ? '10am-12pm' : hour < 14 ? '12pm-2pm' : '2pm-Close';
    if (!hourStats[bucket]) hourStats[bucket] = { wins: 0, losses: 0, totalPL: 0, trades: 0 };
    hourStats[bucket].trades++;
    hourStats[bucket].totalPL += (t.pl || 0);
    if (t.pl > 0) hourStats[bucket].wins++;
    else hourStats[bucket].losses++;
  });
  patterns.byTimeOfDay = {};
  Object.keys(hourStats).forEach(function(h) {
    var hs = hourStats[h];
    patterns.byTimeOfDay[h] = {
      winRate: (hs.wins / hs.trades * 100).toFixed(0) + '%',
      avgPL: (hs.totalPL / hs.trades).toFixed(0),
      trades: hs.trades
    };
  });

  // 3. Win rate by ticker
  var tickerStats = {};
  journal.forEach(function(t) {
    var tk = t.ticker || 'Unknown';
    if (!tickerStats[tk]) tickerStats[tk] = { wins: 0, losses: 0, totalPL: 0, trades: 0 };
    tickerStats[tk].trades++;
    tickerStats[tk].totalPL += (t.pl || 0);
    if (t.pl > 0) tickerStats[tk].wins++;
    else tickerStats[tk].losses++;
  });
  patterns.byTicker = {};
  Object.keys(tickerStats).sort(function(a,b) { return tickerStats[b].totalPL - tickerStats[a].totalPL; }).forEach(function(tk) {
    var ts = tickerStats[tk];
    patterns.byTicker[tk] = {
      winRate: (ts.wins / ts.trades * 100).toFixed(0) + '%',
      avgPL: (ts.totalPL / ts.trades).toFixed(0),
      totalPL: ts.totalPL.toFixed(0),
      trades: ts.trades
    };
  });

  // 4. Win rate by day of week
  var dowStats = {};
  journal.forEach(function(t) {
    if (!t.date) return;
    var dow = new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    if (!dowStats[dow]) dowStats[dow] = { wins: 0, losses: 0, totalPL: 0, trades: 0 };
    dowStats[dow].trades++;
    dowStats[dow].totalPL += (t.pl || 0);
    if (t.pl > 0) dowStats[dow].wins++;
    else dowStats[dow].losses++;
  });
  patterns.byDayOfWeek = dowStats;

  // 5. Hold time analysis
  var holdTimes = journal.filter(function(t) { return t.holdMinutes > 0; });
  if (holdTimes.length > 0) {
    var quickTrades = holdTimes.filter(function(t) { return t.holdMinutes <= 60; });
    var longTrades = holdTimes.filter(function(t) { return t.holdMinutes > 60; });
    patterns.holdTime = {
      avgMinutes: (holdTimes.reduce(function(s,t) { return s + t.holdMinutes; }, 0) / holdTimes.length).toFixed(0),
      quickWinRate: quickTrades.length > 0 ? (quickTrades.filter(function(t){return t.pl>0;}).length / quickTrades.length * 100).toFixed(0) + '%' : 'N/A',
      longWinRate: longTrades.length > 0 ? (longTrades.filter(function(t){return t.pl>0;}).length / longTrades.length * 100).toFixed(0) + '%' : 'N/A'
    };
  }

  // 6. Overall stats
  var wins = journal.filter(function(t) { return t.pl > 0; });
  var losses = journal.filter(function(t) { return t.pl <= 0; });
  patterns.overall = {
    totalTrades: journal.length,
    winRate: (wins.length / journal.length * 100).toFixed(0) + '%',
    totalPL: journal.reduce(function(s,t) { return s + (t.pl || 0); }, 0).toFixed(0),
    avgWin: wins.length > 0 ? (wins.reduce(function(s,t){return s+(t.pl||0);},0) / wins.length).toFixed(0) : '0',
    avgLoss: losses.length > 0 ? (losses.reduce(function(s,t){return s+(t.pl||0);},0) / losses.length).toFixed(0) : '0',
    bestTrade: journal.reduce(function(best, t) { return (t.pl||0) > (best.pl||0) ? t : best; }, {pl:0}),
    worstTrade: journal.reduce(function(worst, t) { return (t.pl||0) < (worst.pl||0) ? t : worst; }, {pl:0})
  };

  // 7. Edge finder — actionable insights
  patterns.edges = [];
  Object.keys(patterns.byStrategy).forEach(function(s) {
    var st = patterns.byStrategy[s];
    if (parseInt(st.winRate) >= 70 && st.trades >= 3) {
      patterns.edges.push('● ' + s + ' has ' + st.winRate + ' win rate across ' + st.trades + ' trades (avg P/L: $' + st.avgPL + ')');
    }
    if (parseInt(st.winRate) <= 35 && st.trades >= 3) {
      patterns.edges.push('● ' + s + ' only ' + st.winRate + ' win rate across ' + st.trades + ' trades — consider dropping');
    }
  });
  Object.keys(patterns.byTimeOfDay).forEach(function(h) {
    var hs = patterns.byTimeOfDay[h];
    if (parseInt(hs.winRate) >= 70 && hs.trades >= 3) {
      patterns.edges.push('● ' + h + ' entries: ' + hs.winRate + ' win rate ($' + hs.avgPL + ' avg)');
    }
    if (parseInt(hs.winRate) <= 35 && hs.trades >= 3) {
      patterns.edges.push('● ' + h + ' entries: only ' + hs.winRate + ' win rate — avoid this window');
    }
  });

  return patterns;
}

// Include journal in export/import
// (handled by existing export/import functions — we add mtp_journal key)

// ==================== TRADE RECAP ENGINE ====================

// Calendar state
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderRecapCalendar();
}

function calBackToMonth() {
  document.getElementById('recap-day-view').style.display = 'none';
  document.getElementById('recap-cal-view').style.display = 'block';
  recapClear();
  renderRecapCalendar();
}

function calOpenDay(dateKey, label) {
  document.getElementById('recap-cal-view').style.display = 'none';
  document.getElementById('recap-day-view').style.display = 'block';
  document.getElementById('day-view-title').textContent = label;
  recapClear();
  try {
    const saved = localStorage.getItem('mtp_recap_data_' + dateKey);
    if (saved) {
      document.getElementById('recap-paste').value = saved;
      setTimeout(recapAnalyze, 100);
    }
  } catch(e) {}
}

function calGetSummaries() {
  try { return JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}'); } catch (e) { return {}; }
}

function renderRecapCalendar() {
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('cal-month-label').textContent = MONTHS[calMonth] + ' ' + calYear;

  var summaries = calGetSummaries();
  var fmtD = function(n) { return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  // Build weeks of Mon-Fri only
  var weeks = [];
  var currentWeek = [null, null, null, null, null];

  for (var d = 1; d <= daysInMonth; d++) {
    var dow = new Date(calYear, calMonth, d).getDay();
    if (dow === 0 || dow === 6) continue;
    var weekdayIdx = dow - 1;
    if (weekdayIdx === 0 && currentWeek.some(function(v){return v !== null;})) {
      weeks.push(currentWeek);
      currentWeek = [null, null, null, null, null];
    }
    currentWeek[weekdayIdx] = d;
  }
  if (currentWeek.some(function(v){return v !== null;})) weeks.push(currentWeek);

  var monthPnL = 0, tradingDays = 0, greenDays = 0, redDays = 0;
  var weeklyPnLs = [];
  var gridHTML = '';

  // Header
  gridHTML += '<div style="display:grid;grid-template-columns:repeat(5,1fr) 100px;gap:6px;margin-bottom:6px;">';
  ['Mon','Tue','Wed','Thu','Fri','Week'].forEach(function(d) {
    gridHTML += '<div style="text-align:center;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;padding:4px 0;">' + d + '</div>';
  });
  gridHTML += '</div>';

  weeks.forEach(function(week) {
    var weekPnL = 0, weekHasTrades = false;
    var rowHTML = '<div style="display:grid;grid-template-columns:repeat(5,1fr) 100px;gap:6px;margin-bottom:6px;">';

    week.forEach(function(day) {
      if (!day) {
        rowHTML += '<div style="background:var(--bg-card);border-radius:10px;min-height:80px;opacity:0.15;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);"></div>';
        return;
      }
      var dateKey = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var pnl = summaries[dateKey] !== undefined ? summaries[dateKey] : null;
      var isToday = (new Date().toISOString().split('T')[0] === dateKey);
      var hasTrades = pnl !== null;

      if (hasTrades) { weekPnL += pnl; weekHasTrades = true; monthPnL += pnl; tradingDays++; if (pnl >= 0) greenDays++; else redDays++; }

      var pnlColor = !hasTrades ? 'var(--text-muted)' : pnl >= 0 ? 'var(--green)' : 'var(--red)';
      var cellBg = isToday ? 'rgba(0,102,204,0.06)' : hasTrades ? (pnl >= 0 ? 'rgba(0,135,90,0.05)' : 'rgba(217,48,37,0.05)') : 'var(--bg-card)';
      var borderColor = isToday ? 'var(--blue)' : hasTrades ? (pnl >= 0 ? 'rgba(0,135,90,0.3)' : 'rgba(217,48,37,0.3)') : 'var(--border)';
      var dayLabel = MONTHS_SHORT[calMonth] + ' ' + day + ', ' + calYear;

      rowHTML += '<div onclick="calOpenDay(\''  + dateKey + '\',\'' + dayLabel + '\')" style="background:' + cellBg + ';border:1px solid ' + borderColor + ';border-radius:10px;min-height:80px;padding:10px 12px;cursor:pointer;transition:border-color .15s;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'' + borderColor + '\'">';
      rowHTML += '<div style="display:flex;align-items:flex-start;justify-content:space-between;">';
      rowHTML += '<div style="font-weight:700;font-size:14px;color:var(--text-primary);">' + day + '</div>';
      if (isToday) rowHTML += '<div style="width:6px;height:6px;border-radius:50%;background:var(--blue);"></div>';
      rowHTML += '</div>';
      rowHTML += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:700;font-size:' + (hasTrades ? '13' : '18') + 'px;color:' + pnlColor + ';text-align:right;line-height:1;">';
      rowHTML += hasTrades ? fmtD(pnl) : '<span style="color:var(--border);font-size:18px;">+</span>';
      rowHTML += '</div></div>';
    });

    if (weekHasTrades) weeklyPnLs.push(weekPnL);
    var wc = !weekHasTrades ? 'var(--text-muted)' : weekPnL >= 0 ? 'var(--green)' : 'var(--red)';
    var wb = !weekHasTrades ? 'var(--bg-card)' : weekPnL >= 0 ? 'rgba(0,135,90,0.07)' : 'rgba(217,48,37,0.07)';
    rowHTML += '<div style="background:' + wb + ';border:1px solid var(--border);border-radius:10px;min-height:80px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);">';
    rowHTML += '<div style="font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--text-muted);text-transform:uppercase;">Week</div>';
    rowHTML += '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:700;font-size:13px;color:' + wc + ';">' + (weekHasTrades ? fmtD(weekPnL) : '—') + '</div>';
    rowHTML += '</div></div>';
    gridHTML += rowHTML;
  });

  document.getElementById('cal-grid').innerHTML = gridHTML;

  var mc = monthPnL >= 0 ? 'var(--green)' : 'var(--red)';
  if (tradingDays > 0) {
    document.getElementById('cal-month-stats').innerHTML =
      '<div style="text-align:right;"><div style="font-size:9px;color:var(--text-muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;">Month P&L</div><div style="font-family:\'JetBrains Mono\',monospace;font-weight:800;font-size:20px;color:' + mc + ';line-height:1;">' + fmtD(monthPnL) + '</div></div>' +
      '<div style="width:1px;height:30px;background:var(--border);"></div>' +
      '<div style="text-align:center;"><div style="font-size:9px;color:var(--text-muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;">Days</div><div style="font-family:\'JetBrains Mono\',monospace;font-weight:800;font-size:20px;color:var(--text-primary);line-height:1;">' + tradingDays + '</div></div>' +
      '<div style="width:1px;height:30px;background:var(--border);"></div>' +
      '<div style="text-align:center;"><div style="font-size:9px;color:var(--text-muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;">Green / Red</div><div style="font-family:\'JetBrains Mono\',monospace;font-weight:800;font-size:20px;line-height:1;"><span style="color:var(--green);">' + greenDays + '</span><span style="color:var(--text-muted);font-size:14px;"> / </span><span style="color:var(--red);">' + redDays + '</span></div></div>';
  } else {
    document.getElementById('cal-month-stats').innerHTML = '<div style="font-size:11px;color:var(--text-muted);">No trades logged — click any day and drop a TOS CSV to begin</div>';
  }

  // Performance summary below calendar
  renderRecapSummary(tradingDays, monthPnL, greenDays, redDays, weeklyPnLs);
}

function renderRecapSummary(tradingDays, monthPnL, greenDays, redDays, weeklyPnLs) {
  var el = document.getElementById('recap-performance-summary');
  if (!el) {
    var calGrid = document.getElementById('cal-grid');
    if (!calGrid) return;
    el = document.createElement('div');
    el.id = 'recap-performance-summary';
    calGrid.parentNode.insertBefore(el, calGrid.nextSibling);
  }
  if (tradingDays === 0) { el.innerHTML = ''; return; }

  var fmtD = function(n) { return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var journal = [];
  try { journal = JSON.parse(localStorage.getItem('mtp_journal') || '[]'); } catch(e) {}

  var monthKey = calYear + '-' + String(calMonth + 1).padStart(2, '0');
  var monthTrades = journal.filter(function(t) { return t.date && t.date.startsWith(monthKey); });

  var html = '<div style="margin-top:24px;">';
  html += '<div class="section-title"><span class="dot" style="background:var(--green)"></span> Performance Analysis</div>';

  if (monthTrades.length > 0) {
    var stratStats = {};
    monthTrades.forEach(function(t) {
      var s = t.strategy || 'Unknown';
      if (!stratStats[s]) stratStats[s] = { wins: 0, losses: 0, pl: 0, trades: 0 };
      stratStats[s].trades++; stratStats[s].pl += (t.pl || 0);
      if (t.pl > 0) stratStats[s].wins++; else stratStats[s].losses++;
    });

    html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px;">';
    html += '<div style="padding:10px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Monthly Strategy Breakdown — ' + monthTrades.length + ' trades</div>';
    Object.keys(stratStats).sort(function(a,b) { return stratStats[b].pl - stratStats[a].pl; }).forEach(function(s) {
      var st = stratStats[s];
      var wr = st.trades > 0 ? (st.wins / st.trades * 100).toFixed(0) : 0;
      var plColor = st.pl >= 0 ? 'var(--green)' : 'var(--red)';
      var wrColor = wr >= 60 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);">';
      html += '<div style="font-weight:700;font-size:12px;">' + s + '</div>';
      html += '<div style="display:flex;gap:20px;align-items:center;font-family:\'JetBrains Mono\',monospace;">';
      html += '<span style="font-size:10px;color:var(--text-muted);">' + st.trades + ' trades</span>';
      html += '<span style="font-size:10px;color:' + wrColor + ';font-weight:700;">' + wr + '% WR</span>';
      html += '<span style="font-size:13px;font-weight:800;color:' + plColor + ';">' + fmtD(st.pl) + '</span>';
      html += '</div></div>';
    });
    html += '</div>';

    // Time of day
    var timeStats = {};
    ['Pre-10am','10am-12pm','12pm-2pm','2pm-Close'].forEach(function(b){timeStats[b]={w:0,l:0,pl:0,t:0};});
    monthTrades.forEach(function(t) {
      if (!t.entryTime) return;
      var hour = parseInt(t.entryTime.split(':')[0]);
      var bucket = hour < 10 ? 'Pre-10am' : hour < 12 ? '10am-12pm' : hour < 14 ? '12pm-2pm' : '2pm-Close';
      timeStats[bucket].t++; timeStats[bucket].pl += (t.pl || 0);
      if (t.pl > 0) timeStats[bucket].w++; else timeStats[bucket].l++;
    });
    if (Object.values(timeStats).some(function(s){return s.t>0;})) {
      html += '<div class="card" style="padding:16px;margin-bottom:12px;">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">P&L by Entry Time</div>';
      html += '<div style="display:flex;gap:8px;">';
      ['Pre-10am','10am-12pm','12pm-2pm','2pm-Close'].forEach(function(bucket) {
        var s = timeStats[bucket];
        if (s.t === 0) {
          html += '<div style="flex:1;text-align:center;padding:8px;border-radius:6px;background:var(--bg-secondary);"><div style="font-size:10px;color:var(--text-muted);">' + bucket + '</div><div style="font-size:12px;color:var(--text-muted);">—</div></div>';
        } else {
          var c = s.pl >= 0 ? 'var(--green)' : 'var(--red)';
          var bg = s.pl >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
          html += '<div style="flex:1;text-align:center;padding:8px;border-radius:6px;background:' + bg + ';">';
          html += '<div style="font-size:10px;color:var(--text-muted);">' + bucket + '</div>';
          html += '<div style="font-size:14px;font-weight:800;color:' + c + ';font-family:\'JetBrains Mono\',monospace;">' + fmtD(s.pl) + '</div>';
          html += '<div style="font-size:9px;color:var(--text-muted);">' + s.t + ' trades · ' + (s.t > 0 ? (s.w/s.t*100).toFixed(0) : 0) + '% WR</div></div>';
        }
      });
      html += '</div></div>';
    }
  }

  // Weekly trend bars
  if (weeklyPnLs.length > 1) {
    html += '<div class="card" style="padding:16px;margin-bottom:12px;">';
    html += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Weekly P&L Trend</div>';
    html += '<div style="display:flex;gap:8px;align-items:flex-end;height:60px;">';
    var maxAbs = Math.max.apply(null, weeklyPnLs.map(function(v){return Math.abs(v);})) || 1;
    weeklyPnLs.forEach(function(wpl, idx) {
      var h = Math.max(8, Math.abs(wpl) / maxAbs * 50);
      var c = wpl >= 0 ? 'var(--green)' : 'var(--red)';
      html += '<div style="flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;">';
      html += '<div style="font-size:9px;font-weight:700;color:' + c + ';font-family:\'JetBrains Mono\',monospace;margin-bottom:2px;">' + fmtD(wpl) + '</div>';
      html += '<div style="width:100%;height:' + h + 'px;background:' + c + ';border-radius:4px 4px 0 0;opacity:0.7;"></div>';
      html += '<div style="font-size:8px;color:var(--text-muted);margin-top:2px;">Wk ' + (idx+1) + '</div></div>';
    });
    html += '</div></div>';
  }

  // Edge finder
  try {
    var patterns = runPatternEngine();
    if (!patterns.insufficient && patterns.edges && patterns.edges.length > 0) {
      html += '<div class="card" style="padding:16px;border-left:3px solid var(--blue);">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Pattern Engine — Edges Found</div>';
      patterns.edges.forEach(function(edge) {
        html += '<div style="font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:4px;">' + edge + '</div>';
      });
      html += '</div>';
    }
  } catch(e) {}

  html += '</div>';
  el.innerHTML = html;
}

// File handling
function recapHandleDrop(file) {
  if (!file) return;
  const nameEl = document.getElementById('recap-file-name');
  nameEl.textContent = 'Loading ' + file.name + '...';
  nameEl.style.display = 'block';
  nameEl.style.color = 'var(--amber)';
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('recap-paste').value = e.target.result;
    nameEl.textContent = file.name + ' (' + (e.target.result.length / 1024).toFixed(1) + ' KB)';
    nameEl.style.color = 'var(--green)';
    setTimeout(recapAnalyze, 200);
  };
  reader.onerror = () => { nameEl.textContent = 'Error: Read failed'; nameEl.style.color = 'var(--red)'; };
  reader.readAsText(file);
}

function recapClear() {
  document.getElementById('recap-paste').value = '';
  document.getElementById('recap-results').style.display = 'none';
  document.getElementById('recap-empty').style.display = 'flex';
  document.getElementById('recap-export-btn').style.display = 'none';
  const nameEl = document.getElementById('recap-file-name');
  if (nameEl) { nameEl.textContent = ''; nameEl.style.display = 'none'; }
}

// TOS CSV Parser
function parseTosCSV(raw) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const filled = [];
  const stops = {};
  let section = '';
  let filledHeader = [];
  let canceledHeader = [];

  function parseRow(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const raw2 = line.trim();

    if (/^Filled Orders/i.test(raw2)) { section = 'filled'; continue; }
    if (/^Canceled Orders/i.test(raw2)) { section = 'canceled'; continue; }
    if (/^Working Orders/i.test(raw2) || /^Rolling Strategies/i.test(raw2)) { section = 'other'; continue; }

    if (section === 'filled') {
      const row = parseRow(line);
      if (raw2.toLowerCase().includes('exec time') && raw2.toLowerCase().includes('symbol')) {
        filledHeader = row.map(c => c.toLowerCase().replace(/\s+/g, ' ').trim());
        continue;
      }
      if (!filledHeader.length) continue;
      const g = k => { const idx = filledHeader.indexOf(k); return idx >= 0 ? row[idx]?.trim() : null; };
      const sym = g('symbol');
      if (!sym || !sym.match(/^[A-Z]{1,6}$/)) continue;

      const side = (g('side') || '').toUpperCase();
      const posEffect = (g('pos effect') || '').toUpperCase();
      const isBuy = side === 'BUY';
      const isOpen = posEffect.includes('OPEN');
      const isClose = posEffect.includes('CLOSE');
      if (!isOpen && !isClose) continue;

      const execTime = g('exec time') || '';
      const qty = Math.abs(parseFloat(g('qty') || '0') || 0);
      const priceVal = parseFloat(g('net price') || g('price') || '0') || 0;
      const type = (g('type') || '').toUpperCase();
      const strike = g('strike') || '';
      const exp = g('exp') || '';
      const orderType = (row[filledHeader.length - 1] || '').toUpperCase();
      const isOption = ['CALL', 'PUT'].includes(type);
      const optType = isOption ? type : null;

      filled.push({ sym, execTime, isBuy, isOpen, isClose, qty, price: priceVal, isOption, optType, strike, exp, orderType });
    }

    if (section === 'canceled') {
      const row = parseRow(line);
      if (raw2.toLowerCase().includes('time canceled') && raw2.toLowerCase().includes('symbol')) {
        canceledHeader = row.map(c => c.toLowerCase().replace(/\s+/g, ' ').trim());
        continue;
      }
      if (!canceledHeader.length) continue;
      const g = k => { const idx = canceledHeader.indexOf(k); return idx >= 0 ? row[idx]?.trim() : null; };
      const sym = g('symbol');
      const side = (g('side') || '').toUpperCase();
      const strike = g('strike') || '';
      const type = (g('type') || '').toUpperCase();
      const isOption = ['CALL', 'PUT'].includes(type);

      if (sym && sym.match(/^[A-Z]{1,6}$/) && side === 'SELL') {
        const nextRow = parseRow(lines[i + 1] || '');
        if (nextRow[12] === 'STP' || nextRow[11] === 'STP') {
          const stopPrice = parseFloat(nextRow[11]) || parseFloat(nextRow[10]) || 0;
          if (stopPrice > 0) {
            const key = isOption ? `${sym}_${strike}_${type}` : sym;
            if (!stops[key] || stopPrice > stops[key]) stops[key] = stopPrice;
            i++;
          }
        }
      }
    }
  }
  return { filled, stops };
}

// Match round trips
function matchRoundTrips({ filled, stops }) {
  const sorted = [...filled].sort((a, b) => {
    const ta = new Date('20' + a.execTime.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'));
    const tb = new Date('20' + b.execTime.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'));
    return ta - tb;
  });

  const byKey = {};
  sorted.forEach(t => {
    const key = t.isOption ? `${t.sym}_${t.strike}_${t.optType}` : t.sym;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ ...t });
  });

  const completed = [];
  const open = [];

  Object.entries(byKey).forEach(([key, rows]) => {
    const opens = rows.filter(r => r.isOpen);
    const closes = rows.filter(r => r.isClose);
    let oi = 0, ci = 0;

    while (oi < opens.length && ci < closes.length) {
      const o = opens[oi], c = closes[ci];
      const matchQty = Math.min(o.qty, c.qty);
      const isLong = o.isBuy;
      const mult = o.isOption ? 100 : 1;
      const pnlPerUnit = isLong ? (c.price - o.price) : (o.price - c.price);
      const pnlDollar = pnlPerUnit * matchQty * mult;

      const stopPrice = stops[key] || null;
      let rr = null;
      if (stopPrice !== null) {
        const riskPerUnit = isLong ? Math.abs(o.price - stopPrice) : Math.abs(stopPrice - o.price);
        const riskDollar = riskPerUnit * matchQty * mult;
        if (riskDollar > 0) rr = parseFloat((pnlDollar / riskDollar).toFixed(2));
      }

      function parseTime(ts) {
        if (!ts) return null;
        const m = ts.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/);
        if (!m) return null;
        return new Date(2000 + parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
      }
      const entryDt = parseTime(o.execTime);
      const exitDt = parseTime(c.execTime);
      const entryHour = entryDt ? entryDt.getHours() : 9;
      const holdMins = (entryDt && exitDt) ? Math.round((exitDt - entryDt) / 60000) : null;

      completed.push({
        sym: o.sym, key, isLong, isOption: o.isOption, optType: o.optType,
        strike: o.strike, exp: o.exp,
        entryPrice: o.price, exitPrice: c.price, stopPrice,
        qty: matchQty, mult,
        entryTime: o.execTime, exitTime: c.execTime,
        entryHour, holdMins,
        pnlDollar: parseFloat(pnlDollar.toFixed(2)),
        rr, won: pnlDollar > 0,
      });

      o.qty -= matchQty; c.qty -= matchQty;
      if (o.qty <= 0) oi++;
      if (c.qty <= 0) ci++;
    }
    opens.slice(oi).filter(o => o.qty > 0).forEach(o => open.push(o));
  });

  return { completed, open };
}

// Behavioral detection
function detectBehaviors(completed) {
  const flags = [];
  if (!completed.length) return flags;
  const sorted = [...completed].sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));

  let revengeCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], curr = sorted[i];
    if (!prev.won && curr.entryTime && prev.exitTime) {
      const gap = (new Date(curr.entryTime) - new Date(prev.exitTime)) / 60000;
      if (gap < 10 && gap >= 0) revengeCount++;
    }
  }
  if (revengeCount > 0) flags.push({ label: 'Possible Revenge Trading', detail: `${revengeCount} trade${revengeCount > 1 ? 's' : ''} entered within 10 min of a loss. Force a 15-min cooldown after any loss.`, severity: revengeCount >= 2 ? 'high' : 'medium' });

  const wins = completed.filter(t => t.won);
  const losses = completed.filter(t => !t.won);
  if (wins.length > 2 && losses.length > 2) {
    const avgWin = wins.reduce((s, t) => s + t.pnlDollar, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnlDollar, 0) / losses.length);
    if (avgWin < avgLoss * 0.7) flags.push({ label: '✂️ Cutting Winners Early', detail: `Avg win ($${avgWin.toFixed(0)}) < avg loss ($${avgLoss.toFixed(0)}). Need avg win ≥ avg loss for positive expectancy.`, severity: 'high' });
  }

  if (losses.length > 1) {
    const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnlDollar, 0) / losses.length);
    const maxLoss = Math.abs(Math.min(...losses.map(t => t.pnlDollar)));
    if (maxLoss > avgLoss * 3) flags.push({ label: '🚨 Outlier Loss Detected', detail: `Max loss ($${maxLoss.toFixed(0)}) is ${(maxLoss / avgLoss).toFixed(1)}x your average loss. Hard stops are non-negotiable.`, severity: 'high' });
  }

  const withTime = completed.filter(t => t.holdMins !== null);
  if (withTime.length > 3) {
    const winHold = wins.filter(t => t.holdMins).reduce((s, t) => s + t.holdMins, 0) / (wins.filter(t => t.holdMins).length || 1);
    const lossHold = losses.filter(t => t.holdMins).reduce((s, t) => s + t.holdMins, 0) / (losses.filter(t => t.holdMins).length || 1);
    if (lossHold > winHold * 2) flags.push({ label: 'Holding Losers Too Long', detail: `Losing trades held ${Math.round(lossHold)}min avg vs ${Math.round(winHold)}min for winners.`, severity: 'medium' });
  }

  if (sorted.length > 6) flags.push({ label: 'Overtrading Detected', detail: `${sorted.length} trades. Reduce to 3-4 best setups per day.`, severity: 'medium' });

  if (flags.length === 0) flags.push({ label: 'No Major Behavioral Issues', detail: 'Good discipline this session. Keep consistent with your rules and process.', severity: 'good' });

  return flags;
}

// Main analyze function
function recapAnalyze() {
  try {
    const raw = document.getElementById('recap-paste').value.trim();
    if (!raw) { alert('Drop a TOS Trade Activity CSV file or paste data first.'); return; }

    const parsed = parseTosCSV(raw);
    const { completed, open } = matchRoundTrips(parsed);

    if (!completed.length && !open.length) {
      document.getElementById('recap-results').innerHTML = `<div style="padding:40px;text-align:center;color:var(--red);"><div style="font-size:16px;margin-bottom:12px;color:var(--red);">✕</div><div style="font-weight:800;font-size:16px;">COULD NOT PARSE DATA</div><div style="font-size:11px;color:var(--text-muted);margin-top:8px;">Make sure you've pasted a TOS "Today's Trade Activity" CSV export with a Filled Orders section.</div></div>`;
      document.getElementById('recap-results').style.display = 'block';
      document.getElementById('recap-empty').style.display = 'none';
      return;
    }

    const totalTrades = completed.length;
    const wins = completed.filter(t => t.won);
    const losses = completed.filter(t => !t.won);
    const winRate = totalTrades > 0 ? (wins.length / totalTrades * 100) : 0;
    const grossPnL = completed.reduce((s, t) => s + t.pnlDollar, 0);
    const grossWins = wins.reduce((s, t) => s + t.pnlDollar, 0);
    const grossLoss = losses.reduce((s, t) => s + t.pnlDollar, 0);
    const avgWin = wins.length ? grossWins / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss !== 0 ? Math.abs(grossWins / grossLoss) : null;
    const maxWin = wins.length ? Math.max(...wins.map(t => t.pnlDollar)) : 0;
    const maxLossVal = losses.length ? Math.min(...losses.map(t => t.pnlDollar)) : 0;

    const tradesWithRR = completed.filter(t => t.rr !== null);
    const avgRR = tradesWithRR.length ? tradesWithRR.reduce((s, t) => s + t.rr, 0) / tradesWithRR.length : null;

    const bestTrade = completed.reduce((a, b) => b.pnlDollar > a.pnlDollar ? b : a, completed[0]);
    const worstTrade = completed.reduce((a, b) => b.pnlDollar < a.pnlDollar ? b : a, completed[0]);

    const hourBuckets = {};
    completed.forEach(t => {
      const h = t.entryHour;
      if (!hourBuckets[h]) hourBuckets[h] = { pnl: 0, count: 0, wins: 0 };
      hourBuckets[h].pnl += t.pnlDollar;
      hourBuckets[h].count++;
      if (t.won) hourBuckets[h].wins++;
    });
    const hourRows = Object.entries(hourBuckets).sort((a, b) => +a[0] - +b[0]);

    const bySymbol = {};
    completed.forEach(t => {
      if (!bySymbol[t.sym]) bySymbol[t.sym] = { pnl: 0, count: 0, wins: 0 };
      bySymbol[t.sym].pnl += t.pnlDollar;
      bySymbol[t.sym].count++;
      if (t.won) bySymbol[t.sym].wins++;
    });
    const symRows = Object.entries(bySymbol).sort((a, b) => b[1].pnl - a[1].pnl);

    let maxWinStreak = 0, maxLossStreak = 0, curW = 0, curL = 0;
    const sortedByTime = [...completed].sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));
    sortedByTime.forEach(t => {
      if (t.won) { curW++; curL = 0; maxWinStreak = Math.max(maxWinStreak, curW); }
      else { curL++; curW = 0; maxLossStreak = Math.max(maxLossStreak, curL); }
    });

    const behaviors = detectBehaviors(completed);

    const grade = grossPnL > 0 && winRate >= 55 && profitFactor >= 1.5 ? 'A'
      : grossPnL > 0 && winRate >= 45 ? 'B'
      : grossPnL >= 0 ? 'C'
      : winRate >= 40 ? 'D' : 'F';
    const gradeColors = { A: 'var(--green)', B: 'var(--blue)', C: 'var(--amber)', D: '#c2410c', F: 'var(--red)' };
    const gradeColor = gradeColors[grade];
    const pnlColor = grossPnL >= 0 ? 'var(--green)' : 'var(--red)';
    const fmtDR = n => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
    const sevColor = { high: 'var(--red)', medium: 'var(--amber)', good: 'var(--green)' };

    let html = `
    <div style="background:var(--bg-card);box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 16px rgba(0,0,0,0.04);border-radius:14px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:20px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;border-bottom:1px solid var(--border);">
        <div style="width:64px;height:64px;border-radius:50%;background:${gradeColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-weight:800;font-size:32px;color:#fff;">${grade}</span>
        </div>
        <div>
          <div style="font-weight:800;font-size:18px;color:var(--text-primary);">SESSION RECAP — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${totalTrades} completed trade${totalTrades !== 1 ? 's' : ''} · ${parsed.filled.length} total executions${open.length ? ` · ${open.length} still open` : ''}</div>
        </div>
        <div style="margin-left:auto;text-align:right;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:800;color:${pnlColor};line-height:1;">${fmtDR(grossPnL)}</div>
          <div style="font-size:10px;color:var(--text-muted);">NET P&L</div>
        </div>
      </div>
      <div class="rv-stat-grid">
        ${[
          ['WIN RATE', winRate.toFixed(1) + '%', winRate >= 55 ? 'var(--green)' : winRate >= 40 ? 'var(--amber)' : 'var(--red)'],
          ['TRADES', `${wins.length}W / ${losses.length}L`, 'var(--text-primary)'],
          ['AVG WIN', fmtDR(avgWin), 'var(--green)'],
          ['AVG LOSS', fmtDR(avgLoss), 'var(--red)'],
          ['AVG R:R', avgRR !== null ? avgRR.toFixed(2) + 'R' : '—', avgRR === null ? 'var(--text-muted)' : avgRR >= 1.5 ? 'var(--green)' : 'var(--amber)'],
          ['PROFIT FACTOR', profitFactor ? profitFactor.toFixed(2) : '—', profitFactor >= 1.5 ? 'var(--green)' : profitFactor >= 1 ? 'var(--amber)' : 'var(--red)'],
          ['STREAKS', maxWinStreak + 'W / ' + maxLossStreak + 'L', 'var(--text-primary)'],
        ].map(([l, v, c]) => `<div class="rv-stat-cell">
          <div class="rv-stat-label">${l}</div>
          <div class="rv-stat-value" style="color:${c};">${v}</div>
        </div>`).join('')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div class="recap-section-card">
          <div class="recap-section-header">💰 P&L Breakdown</div>
          <div class="recap-section-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${[
              ['Gross Wins', grossWins, 'var(--green)'], ['Gross Losses', grossLoss, 'var(--red)'],
              ['Net P&L', grossPnL, pnlColor], ['Profit Factor', profitFactor ? profitFactor.toFixed(2) + 'x' : '—', 'var(--text-primary)'],
              ['Best: ' + bestTrade.sym, bestTrade.pnlDollar, 'var(--green)'], ['Worst: ' + worstTrade.sym, worstTrade.pnlDollar, 'var(--red)'],
            ].map(([l, v, c]) => `<div style="background:var(--bg-primary);border-radius:8px;padding:10px 12px;">
              <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">${l}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:${c};">${typeof v === 'number' ? fmtDR(v) : v}</div>
            </div>`).join('')}
          </div>
        </div>

        <div class="recap-section-card">
          <div class="recap-section-header">By Ticker</div>
          <div class="recap-section-body">
            ${symRows.map(([sym, d]) => {
              const wr = (d.wins / d.count * 100).toFixed(0);
              const c = d.pnl >= 0 ? 'var(--green)' : 'var(--red)';
              const barW = Math.min(100, Math.abs(d.pnl) / Math.max(...symRows.map(([, x]) => Math.abs(x.pnl))) * 100);
              return `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-weight:700;font-size:13px;color:var(--text-primary);min-width:50px;">${sym}</span>
                    <span style="font-size:10px;color:var(--text-muted);">${d.count} trades · ${wr}% WR</span>
                  </div>
                  <span style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:${c};">${fmtDR(d.pnl)}</span>
                </div>
                <div style="height:3px;background:var(--bg-primary);border-radius:2px;">
                  <div style="height:3px;width:${barW}%;background:${c};border-radius:2px;"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div>
        <div class="recap-section-card">
          <div class="recap-section-header">Behavioral Analysis</div>
          <div class="recap-section-body">
            ${behaviors.map(b => `<div class="behavior-flag ${b.severity}">
              <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${b.label}</div>
              <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;">${b.detail}</div>
            </div>`).join('')}
          </div>
        </div>

        <div class="recap-section-card">
          <div class="recap-section-header">🕐 Time of Day Performance</div>
          <div class="recap-section-body">
            ${hourRows.length ? hourRows.map(([h, d]) => {
              const label = +h < 12 ? `${h}:00 AM` : (+h === 12 ? '12:00 PM' : `${+h - 12}:00 PM`);
              const c = d.pnl >= 0 ? 'var(--green)' : 'var(--red)';
              const wr = (d.wins / d.count * 100).toFixed(0);
              const maxAbsPnl = Math.max(...hourRows.map(([, x]) => Math.abs(x.pnl))) || 1;
              const barW = Math.min(100, Math.abs(d.pnl) / maxAbsPnl * 100);
              return `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:11px;font-weight:700;color:var(--text-secondary);width:65px;">${label}</span>
                    <span style="font-size:10px;color:var(--text-muted);">${d.count} trades · ${wr}% WR</span>
                  </div>
                  <span style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${c};">${fmtDR(d.pnl)}</span>
                </div>
                <div style="height:3px;background:var(--bg-primary);border-radius:2px;">
                  <div style="height:3px;width:${barW}%;background:${c};border-radius:2px;"></div>
                </div>
              </div>`;
            }).join('') : '<div style="padding:12px;font-size:11px;color:var(--text-muted);text-align:center;">No time data available.</div>'}
          </div>
        </div>

        <div class="recap-section-card">
          <div class="recap-section-header">Trade Log (${completed.length})</div>
          <div style="max-height:280px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead><tr style="background:var(--bg-primary);">
                <th style="padding:6px 10px;text-align:left;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">TICKER</th>
                <th style="padding:6px 10px;text-align:left;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">SIDE</th>
                <th style="padding:6px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">ENTRY</th>
                <th style="padding:6px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">EXIT</th>
                <th style="padding:6px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">QTY</th>
                <th style="padding:6px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">R:R</th>
                <th style="padding:6px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:var(--text-muted);">P&L</th>
              </tr></thead>
              <tbody>
                ${sortedByTime.map(t => {
                  const c = t.won ? 'var(--green)' : 'var(--red)';
                  const rrColor = t.rr === null ? 'var(--text-muted)' : t.rr >= 2 ? 'var(--green)' : t.rr >= 1 ? 'var(--amber)' : 'var(--red)';
                  const label = t.isOption ? `${t.sym} ${t.strike}${t.optType}` : t.sym;
                  return `<tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:7px 10px;font-weight:700;color:var(--text-primary);">${label}</td>
                    <td style="padding:7px 10px;color:${t.isLong ? 'var(--green)' : 'var(--red)'};font-size:10px;font-weight:700;">${t.isLong ? 'LONG' : 'SHORT'}</td>
                    <td style="padding:7px 10px;text-align:right;color:var(--text-secondary);">$${t.entryPrice.toFixed(2)}</td>
                    <td style="padding:7px 10px;text-align:right;color:var(--text-secondary);">$${t.exitPrice.toFixed(2)}</td>
                    <td style="padding:7px 10px;text-align:right;color:var(--text-secondary);">${t.qty}</td>
                    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${rrColor};">${t.rr !== null ? t.rr.toFixed(2) + 'R' : '—'}</td>
                    <td style="padding:7px 10px;text-align:right;font-weight:700;color:${c};">${fmtDR(t.pnlDollar)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${open.length ? `<div style="padding:8px 14px;background:rgba(180,83,9,0.05);border-top:1px solid var(--border);font-size:10px;color:var(--amber);">${open.length} position${open.length !== 1 ? 's' : ''} still open: ${[...new Set(open.map(o => o.sym))].join(', ')}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- AI COACHING -->
    <div class="recap-section-card" style="border-color:rgba(124,58,237,0.3);">
      <div class="recap-section-header" style="background:rgba(124,58,237,0.05);color:var(--purple);display:flex;align-items:center;justify-content:space-between;">
        <span>🤖 AI Coaching Analysis</span>
        <span style="font-size:9px;color:var(--text-muted);letter-spacing:.1em;text-transform:uppercase;">Powered by Claude</span>
      </div>
      <div id="ai-coaching-body" style="padding:16px 20px;font-size:12px;color:var(--text-secondary);line-height:1.8;">
        <div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);">
          <div style="width:16px;height:16px;border:2px solid var(--purple);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
          <span>Analyzing your trading patterns with AI...</span>
        </div>
      </div>
    </div>`;

    document.getElementById('recap-results').innerHTML = html;
    document.getElementById('recap-results').style.display = 'block';
    document.getElementById('recap-empty').style.display = 'none';
    document.getElementById('recap-export-btn').style.display = 'inline-block';

    // Save to calendar
    try {
      // Detect trade date from the CSV data (use first trade's entry time, not today's date)
      var dateKey = new Date().toISOString().split('T')[0]; // fallback to today
      if (sortedByTime.length > 0 && sortedByTime[0].entryTime) {
        try {
          var tradeDate = new Date(sortedByTime[0].entryTime);
          if (!isNaN(tradeDate.getTime())) {
            dateKey = tradeDate.toISOString().split('T')[0];
          }
        } catch(e) {}
      }
      // Also try parsing from raw CSV exec time if entryTime didn't have a date
      if (dateKey === new Date().toISOString().split('T')[0]) {
        var rawCsvText = document.getElementById('recap-paste').value;
        var dateMatch = rawCsvText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\d{1,2}:\d{2}/);
        if (dateMatch) {
          try {
            var parsedDate = new Date(dateMatch[1]);
            if (!isNaN(parsedDate.getTime())) {
              dateKey = parsedDate.toISOString().split('T')[0];
            }
          } catch(e) {}
        }
      }
      const summaries = JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}');
      summaries[dateKey] = parseFloat(grossPnL.toFixed(2));
      localStorage.setItem('mtp_cal_summaries', JSON.stringify(summaries));
      // Cloud sync
      if (typeof dbSaveCalSummaries === 'function' && typeof getUser === 'function' && getUser()) {
        dbSaveCalSummaries(summaries).catch(function(e) {});
      }
      const rawCsv = document.getElementById('recap-paste').value;
      if (rawCsv) localStorage.setItem('mtp_recap_data_' + dateKey, rawCsv);
      // Cloud sync recap
      if (typeof dbSaveRecapData === 'function' && typeof getUser === 'function' && getUser()) {
        dbSaveRecapData(dateKey, rawCsv || null, null).catch(function(e) {});
      }
      // Refresh calendar to show the new entry
      renderRecapCalendar();
    } catch (e) {}

    // Fire AI coaching
    runAICoaching(completed, wins, losses, grossPnL, winRate, profitFactor, avgRR, behaviors, sortedByTime, bySymbol);

  } catch (err) {
    document.getElementById('recap-results').innerHTML = `<div style="padding:40px;text-align:center;color:var(--red);"><div style="font-size:16px;margin-bottom:12px;color:var(--red);">✕</div><div style="font-weight:800;font-size:16px;">ANALYSIS ERROR</div><div style="font-size:11px;color:var(--text-muted);margin-top:8px;">${err.message}</div></div>`;
    document.getElementById('recap-results').style.display = 'block';
    document.getElementById('recap-empty').style.display = 'none';
  }
}

async function runAICoaching(completed, wins, losses, grossPnL, winRate, profitFactor, avgRR, behaviors, sortedByTime, bySymbol) {
  const n = completed.length;
  const fmtDR = n => (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
  const grossWins = wins.reduce((s, t) => s + t.pnlDollar, 0);
  const grossLoss = losses.reduce((s, t) => s + t.pnlDollar, 0);
  const avgWin = wins.length ? grossWins / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  const tradeList = sortedByTime.map(t => `  ${t.sym} | ${t.isLong ? 'LONG' : 'SHORT'} | ${t.qty} | Entry $${t.entryPrice.toFixed(2)} → Exit $${t.exitPrice.toFixed(2)} | P&L: ${fmtDR(t.pnlDollar)}`).join('\n');
  const symSummary = Object.entries(bySymbol).map(([sym, d]) => `  ${sym}: ${d.count} trades, ${(d.wins / d.count * 100).toFixed(0)}% WR, net ${fmtDR(d.pnl)}`).join('\n');
  const behaviorSummary = behaviors.map(b => `  [${b.severity.toUpperCase()}] ${b.label}: ${b.detail}`).join('\n');

  const prompt = `You are an elite trading coach. A trader shared their session data. Give honest, direct, actionable coaching.

SESSION: ${n} trades, Net ${fmtDR(grossPnL)}, ${winRate.toFixed(1)}% WR, PF: ${profitFactor ? profitFactor.toFixed(2) : 'N/A'}, Avg R:R: ${avgRR !== null ? avgRR.toFixed(2) + 'R' : 'N/A'}

TRADES:\n${tradeList}\n\nPER SYMBOL:\n${symSummary}\n\nBEHAVIORS:\n${behaviorSummary}

Write coaching in these sections using HTML bold tags:
1. <strong>SESSION VERDICT</strong> — 2-3 sentences
2. <strong>WHAT YOU DID RIGHT</strong> — specific callouts
3. <strong>WHAT NEEDS TO CHANGE</strong> — reference actual trades
4. <strong>PATTERN RECOGNITION</strong> — recurring patterns
5. <strong>TOMORROW'S RULES</strong> — 3-5 concrete rules
6. <strong>BOTTOM LINE</strong> — one punchy closing line`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    if (text) {
      const formatted = text.split(/\n\n+/).filter(p => p.trim()).map(p => {
        const trimmed = p.trim();
        if (/^\d+\.\s*<strong>/.test(trimmed)) {
          return `<div style="margin-bottom:12px;padding:10px 14px;background:rgba(124,58,237,0.05);border-left:3px solid var(--purple);border-radius:0 6px 6px 0;">${trimmed}</div>`;
        }
        return `<div style="margin-bottom:8px;">${trimmed}</div>`;
      }).join('');
      document.getElementById('ai-coaching-body').innerHTML = formatted || '<div style="color:var(--text-muted);">Analysis complete.</div>';
    } else {
      document.getElementById('ai-coaching-body').innerHTML = '<div style="color:var(--text-muted);">AI analysis unavailable.</div>';
    }
  } catch (e) {
    document.getElementById('ai-coaching-body').innerHTML = `<div style="color:var(--text-muted);">AI coaching unavailable: ${e.message}</div>`;
  }
}

function recapExportPDF() {
  const dateKey = new Date().toISOString().split('T')[0];
  try {
    const html = document.getElementById('recap-results').innerHTML;
    localStorage.setItem('mtp_recap_' + dateKey, html.substring(0, 50000));
    // Cloud sync
    if (typeof dbSaveRecapData === 'function' && typeof getUser === 'function' && getUser()) {
      dbSaveRecapData(dateKey, null, html.substring(0, 50000)).catch(function(e) {});
    }
    alert('Recap saved to calendar! Use Ctrl+P / Cmd+P to print as PDF.');
  } catch (e) { alert('Use Ctrl+P / Cmd+P to save as PDF.'); }
}

// ==================== CLAUDE'S MARKET ANALYSIS ENGINE ====================
