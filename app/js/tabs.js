// ==================== tabs.js ====================
// Tab switching logic, lazy script loading, and refresh orchestration.

// ==================== LAZY SCRIPT LOADER ====================
var _scriptLoaded = {};
function loadScript(src) {
  if (_scriptLoaded[src]) return _scriptLoaded[src];
  _scriptLoaded[src] = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  return _scriptLoaded[src];
}

// ==================== TAB SWITCHING ====================
// Track whether overview has been loaded at least once
var _overviewLoaded = false;
var _scannerAutoBuildDone = false;

document.querySelectorAll('.tabs > .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

    // Show watchlist sidebar only on overview tab
    var wlSidebar = document.getElementById('watchlist-sidebar');
    if (wlSidebar) wlSidebar.style.display = (tab.dataset.tab === 'overview') ? '' : 'none';

    // Stop breadth auto-refresh when leaving overview; restart when returning
    if (tab.dataset.tab === 'overview') {
      // Only re-fetch if never loaded — otherwise just show cached content
      if (!_overviewLoaded) {
        renderOverview().then(function() { _overviewLoaded = true; }).catch(function() {});
      } else {
        // Restart breadth auto-refresh without re-fetching everything
        if (typeof startBreadthAutoRefresh === 'function') startBreadthAutoRefresh();
      }
    } else {
      stopBreadthAutoRefresh();
    }

    // Trigger per-tab renders (lazy-load scripts on first click)
    if (tab.dataset.tab === 'scanner') {
      loadScript('js/scanner.js?v=20260307g').then(function() {
        if (!window._scannerLoaded) { renderScanner(); window._scannerLoaded = true; }
        if (!_scannerAutoBuildDone && typeof scannerAutoBuild === 'function') {
          _scannerAutoBuildDone = true;
          scannerAutoBuild();
        }
        if (typeof startDayTradeAutoRefresh === 'function') startDayTradeAutoRefresh();
      });
    }
    if (tab.dataset.tab === 'recap') {
      loadScript('js/journal.js?v=20260305a').then(function() {
        if (typeof renderRecapCalendar === 'function') renderRecapCalendar();
      });
    }
    if (tab.dataset.tab === 'analysis') {
      Promise.all([
        loadScript('js/analysis.js?v=20260303r'),
        loadScript('js/analysis-seed.js?v=20260303r')
      ]).then(function() {
        if (typeof renderAnalysis === 'function') renderAnalysis();
      });
    }
  });
});

// ==================== REFRESH ====================
function refreshAll() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  // Clear the Polygon cache so all data is re-fetched fresh
  if (typeof clearPolyCache === 'function') clearPolyCache();

  renderOverview().then(function() { _overviewLoaded = true; }).catch(function() {});
  // Only refresh recap calendar if journal.js is loaded
  if (typeof renderRecapCalendar === 'function') renderRecapCalendar();

  setTimeout(function() {
    btn.classList.remove('spinning');
  }, 2000);
}
