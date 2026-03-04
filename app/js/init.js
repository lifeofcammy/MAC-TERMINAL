// ==================== init.js ====================
// Initialization: runs on page load.
// Waits for auth session before triggering data loads.

// ==================== INITIAL LOAD ====================
// Auth is async — wait for _currentSession to be set before loading data.
// Polls every 50ms, times out after 5 seconds (auth.js redirects to login if no session).
(function waitForSession() {
  var waited = 0;
  var interval = setInterval(function() {
    waited += 50;
    if (window._currentSession || waited > 5000) {
      clearInterval(interval);
      // Only load Overview on startup — other tabs lazy-load on click
      refreshAll();
      checkFirstRun();
      // Pre-warm scanner cache from server in the background (non-blocking)
      _preWarmScannerCache();
    }
  }, 50);
})();

// ==================== SCANNER PRE-WARM ====================
// Silently fetch server-side scan results while user reads Overview.
// When they click Scanner tab, data is already local — instant render.
function _preWarmScannerCache() {
  try {
    var sb = window.supabaseClient;
    var session = window._currentSession;
    if (!sb || !session || !session.user) return;

    sb.from('scan_results')
      .select('scan_date, momentum_universe, breakout_setups')
      .eq('user_id', session.user.id)
      .order('scan_date', { ascending: false })
      .limit(1)
      .then(function(res) {
        if (!res.data || !res.data.length) return;
        var row = res.data[0];
        // Only use if from today or last trading day
        var today = new Date().toISOString().split('T')[0];
        var d = new Date(); var dow = d.getDay();
        var lastTD = new Date(d);
        if (dow === 0) lastTD.setDate(d.getDate() - 2);
        else if (dow === 1) lastTD.setDate(d.getDate() - 3);
        else lastTD.setDate(d.getDate() - 1);
        var lastTDStr = lastTD.toISOString().split('T')[0];

        if (row.scan_date === today || row.scan_date === lastTDStr) {
          // Write to the same localStorage keys the scanner uses
          if (row.momentum_universe) {
            try {
              localStorage.setItem('mac_scanner_universe', JSON.stringify({
                version: 2,
                date: row.scan_date,
                tickers: row.momentum_universe
              }));
            } catch(e) {}
          }
          if (row.breakout_setups) {
            try {
              localStorage.setItem('mac_scan_results', JSON.stringify(row.breakout_setups));
            } catch(e) {}
          }
          console.log('[Pre-warm] Scanner cache loaded from server (' + row.scan_date + ')');
        }
      })
      .catch(function() {});
  } catch(e) {}
}
