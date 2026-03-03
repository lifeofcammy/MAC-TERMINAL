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
      try { renderAnalysis(); } catch(e) {}
      refreshAll();
      checkFirstRun();
    }
  }, 50);
})();
