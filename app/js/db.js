// ==================== db.js ====================
// Supabase data sync layer.
// When logged in: reads/writes Supabase (with localStorage as fast cache).
// When logged out: falls back to localStorage only.
// Drop-in replacement for direct localStorage calls.

// ==================== HELPERS ====================

function getUser() {
  // Returns current Supabase user or null
  try {
    var s = window._currentSession;
    return s && s.user ? s.user : null;
  } catch(e) { return null; }
}

function getSupabase() {
  return window.supabaseClient || null;
}

// ==================== GENERIC UPSERT / SELECT ====================

async function dbUpsert(table, data, conflictCols) {
  var sb = getSupabase();
  var user = getUser();
  if (!sb || !user) return null;
  data.user_id = user.id;
  data.updated_at = new Date().toISOString();
  try {
    var q = sb.from(table).upsert(data, { onConflict: conflictCols || 'user_id' });
    var res = await q.select();
    return res.data ? res.data[0] : null;
  } catch(e) { console.warn('dbUpsert error:', table, e); return null; }
}

async function dbSelect(table, extraFilters) {
  var sb = getSupabase();
  var user = getUser();
  if (!sb || !user) return null;
  try {
    var q = sb.from(table).select('*').eq('user_id', user.id);
    if (extraFilters) {
      for (var k in extraFilters) q = q.eq(k, extraFilters[k]);
    }
    var res = await q;
    return res.data || [];
  } catch(e) { console.warn('dbSelect error:', table, e); return null; }
}

async function dbDelete(table, extraFilters) {
  var sb = getSupabase();
  var user = getUser();
  if (!sb || !user) return null;
  try {
    var q = sb.from(table).delete().eq('user_id', user.id);
    if (extraFilters) {
      for (var k in extraFilters) q = q.eq(k, extraFilters[k]);
    }
    await q;
    return true;
  } catch(e) { console.warn('dbDelete error:', table, e); return null; }
}


// ==================== WATCHLIST ====================

async function dbSaveWatchlist(tickers) {
  // Always save to localStorage (fast cache)
  try { localStorage.setItem('mcc_watchlist', JSON.stringify(tickers)); } catch(e) {}
  // Sync to Supabase
  await dbUpsert('watchlist', { tickers: tickers });
}

async function dbLoadWatchlist() {
  // Try Supabase first
  var rows = await dbSelect('watchlist');
  if (rows && rows.length > 0) {
    var tickers = rows[0].tickers || [];
    try { localStorage.setItem('mcc_watchlist', JSON.stringify(tickers)); } catch(e) {}
    return tickers;
  }
  // Fall back to localStorage
  try { return JSON.parse(localStorage.getItem('mcc_watchlist') || '[]'); } catch(e) { return []; }
}


// ==================== JOURNAL ENTRIES ====================

async function dbSaveJournal(entries) {
  try { localStorage.setItem('mtp_journal', JSON.stringify(entries)); } catch(e) {}
  await dbUpsert('journal_entries', { entries: entries });
}

async function dbLoadJournal() {
  var rows = await dbSelect('journal_entries');
  if (rows && rows.length > 0) {
    var entries = rows[0].entries || [];
    try { localStorage.setItem('mtp_journal', JSON.stringify(entries)); } catch(e) {}
    return entries;
  }
  try { return JSON.parse(localStorage.getItem('mtp_journal') || '[]'); } catch(e) { return []; }
}


// ==================== ANALYSIS (per-date) ====================

async function dbSaveAnalysis(date, data) {
  try { localStorage.setItem('mtp_analysis_' + date, JSON.stringify(data)); } catch(e) {}
  await dbUpsert('analysis', { date: date, data: data }, 'user_id,date');
}

async function dbLoadAnalysis(date) {
  var rows = await dbSelect('analysis', { date: date });
  if (rows && rows.length > 0) {
    var data = rows[0].data;
    try { localStorage.setItem('mtp_analysis_' + date, JSON.stringify(data)); } catch(e) {}
    return data;
  }
  try {
    var raw = localStorage.getItem('mtp_analysis_' + date);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

async function dbLoadAllAnalysis() {
  var rows = await dbSelect('analysis');
  if (rows && rows.length > 0) {
    // Cache all to localStorage
    rows.forEach(function(r) {
      try { localStorage.setItem('mtp_analysis_' + r.date, JSON.stringify(r.data)); } catch(e) {}
    });
    return rows;
  }
  return null;
}


// ==================== CALENDAR SUMMARIES ====================

async function dbSaveCalSummaries(summaries) {
  try { localStorage.setItem('mtp_cal_summaries', JSON.stringify(summaries)); } catch(e) {}
  await dbUpsert('calendar_summaries', { summaries: summaries });
}

async function dbLoadCalSummaries() {
  var rows = await dbSelect('calendar_summaries');
  if (rows && rows.length > 0) {
    var s = rows[0].summaries || {};
    try { localStorage.setItem('mtp_cal_summaries', JSON.stringify(s)); } catch(e) {}
    return s;
  }
  try { return JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}'); } catch(e) { return {}; }
}


// ==================== RECAP DATA (per-date) ====================

async function dbSaveRecapData(date, csvData, htmlRecap) {
  if (csvData) try { localStorage.setItem('mtp_recap_data_' + date, csvData); } catch(e) {}
  if (htmlRecap) try { localStorage.setItem('mtp_recap_' + date, htmlRecap); } catch(e) {}
  var payload = { date: date };
  if (csvData) payload.csv_data = csvData;
  if (htmlRecap) payload.html_recap = htmlRecap;
  await dbUpsert('recap_data', payload, 'user_id,date');
}

async function dbLoadRecapData(date) {
  var rows = await dbSelect('recap_data', { date: date });
  if (rows && rows.length > 0) {
    var r = rows[0];
    if (r.csv_data) try { localStorage.setItem('mtp_recap_data_' + date, r.csv_data); } catch(e) {}
    if (r.html_recap) try { localStorage.setItem('mtp_recap_' + date, r.html_recap); } catch(e) {}
    return { csv: r.csv_data, html: r.html_recap };
  }
  return {
    csv: localStorage.getItem('mtp_recap_data_' + date),
    html: localStorage.getItem('mtp_recap_' + date)
  };
}


// ==================== USER SETTINGS ====================

async function dbSaveUserSettings(settings) {
  // settings = { account_size, risk_pct, polygon_key, alpha_key, anthropic_key, preferences }
  if (settings.account_size !== undefined) try { localStorage.setItem('mcc_account', settings.account_size); } catch(e) {}
  if (settings.risk_pct !== undefined) try { localStorage.setItem('mcc_risk', settings.risk_pct); } catch(e) {}
  if (settings.polygon_key !== undefined) try { localStorage.setItem('mac_polygon_key', settings.polygon_key); } catch(e) {}
  if (settings.alpha_key !== undefined) try { localStorage.setItem('mac_alpha_key', settings.alpha_key); } catch(e) {}
  if (settings.anthropic_key !== undefined) try { localStorage.setItem('mtp_anthropic_key', settings.anthropic_key); } catch(e) {}
  await dbUpsert('user_settings', settings);
}

async function dbLoadUserSettings() {
  var rows = await dbSelect('user_settings');
  if (rows && rows.length > 0) {
    var s = rows[0];
    // Sync to localStorage for fast reads
    if (s.account_size) try { localStorage.setItem('mcc_account', s.account_size); } catch(e) {}
    if (s.risk_pct) try { localStorage.setItem('mcc_risk', s.risk_pct); } catch(e) {}
    if (s.polygon_key) try { localStorage.setItem('mac_polygon_key', s.polygon_key); } catch(e) {}
    if (s.alpha_key) try { localStorage.setItem('mac_alpha_key', s.alpha_key); } catch(e) {}
    if (s.anthropic_key) try { localStorage.setItem('mtp_anthropic_key', s.anthropic_key); } catch(e) {}
    return s;
  }
  return {
    account_size: localStorage.getItem('mcc_account') || '',
    risk_pct: localStorage.getItem('mcc_risk') || '',
    polygon_key: localStorage.getItem('mac_polygon_key') || '',
    alpha_key: localStorage.getItem('mac_alpha_key') || '',
    anthropic_key: localStorage.getItem('mtp_anthropic_key') || ''
  };
}


// ==================== MIGRATION: localStorage → Supabase ====================
// Called once on login. Checks if Supabase has data; if empty, pushes localStorage up.

async function migrateLocalToCloud() {
  var user = getUser();
  if (!user) return;

  // Check if user already has cloud data
  var existingSettings = await dbSelect('user_settings');
  if (existingSettings && existingSettings.length > 0) {
    // User already has cloud data — pull it down to localStorage
    await dbLoadUserSettings();
    await dbLoadWatchlist();
    await dbLoadJournal();
    await dbLoadCalSummaries();
    console.log('[db] Cloud data synced to local cache.');
    return;
  }

  // No cloud data yet — push localStorage up
  console.log('[db] First login — migrating local data to cloud...');

  // Settings
  await dbSaveUserSettings({
    account_size: localStorage.getItem('mcc_account') || '',
    risk_pct: localStorage.getItem('mcc_risk') || '',
    polygon_key: localStorage.getItem('mac_polygon_key') || '',
    alpha_key: localStorage.getItem('mac_alpha_key') || '',
    anthropic_key: localStorage.getItem('mtp_anthropic_key') || ''
  });

  // Watchlist
  try {
    var wl = JSON.parse(localStorage.getItem('mcc_watchlist') || '[]');
    if (wl.length > 0) await dbSaveWatchlist(wl);
  } catch(e) {}

  // Journal
  try {
    var j = JSON.parse(localStorage.getItem('mtp_journal') || '[]');
    if (j.length > 0) await dbSaveJournal(j);
  } catch(e) {}

  // Calendar summaries
  try {
    var cs = JSON.parse(localStorage.getItem('mtp_cal_summaries') || '{}');
    if (Object.keys(cs).length > 0) await dbSaveCalSummaries(cs);
  } catch(e) {}

  // Analysis entries (scan all mtp_analysis_* keys)
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith('mtp_analysis_')) {
        var date = key.replace('mtp_analysis_', '');
        var data = JSON.parse(localStorage.getItem(key));
        if (data) await dbSaveAnalysis(date, data);
      }
    }
  } catch(e) {}

  // Recap data (scan mtp_recap_data_* and mtp_recap_* keys)
  try {
    var recapDates = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith('mtp_recap_data_')) {
        var date = key.replace('mtp_recap_data_', '');
        recapDates[date] = recapDates[date] || {};
        recapDates[date].csv = localStorage.getItem(key);
      }
      if (key && key.startsWith('mtp_recap_') && !key.startsWith('mtp_recap_data_')) {
        var date = key.replace('mtp_recap_', '');
        recapDates[date] = recapDates[date] || {};
        recapDates[date].html = localStorage.getItem(key);
      }
    }
    for (var d in recapDates) {
      await dbSaveRecapData(d, recapDates[d].csv || null, recapDates[d].html || null);
    }
  } catch(e) {}

  console.log('[db] Migration complete.');
}
