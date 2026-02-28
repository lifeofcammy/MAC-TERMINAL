// ==================== tabs.js ====================
// Tab switching logic and refresh orchestration.
// Handles tab click events and triggers per-tab renders.

// ==================== TAB SWITCHING ====================
// Regular tabs (non-dropdown)
document.querySelectorAll('.tabs > .tab:not(.tab-dropdown)').forEach(tab => {
  tab.addEventListener('click', () => {
    // Clear all active states
    document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-dropdown-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // Activate clicked tab
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'analysis') renderAnalysis();
  });
});

// Dropdown sub-tabs (Scanners)
document.querySelectorAll('.tab-dropdown-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    // Clear all active states
    document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-dropdown-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // Activate parent Scanners tab + clicked sub-item
    document.getElementById('scanners-tab').classList.add('active');
    item.classList.add('active');
    document.getElementById('tab-' + item.dataset.tab).classList.add('active');
    // Trigger renders
    if (item.dataset.tab === 'options') { if (!window._optionsLoaded) { renderOptionsTab(); window._optionsLoaded = true; } else { renderOptTags(); } }
    if (item.dataset.tab === 'shakeout' && !window._shakeoutLoaded) { renderShakeout(); window._shakeoutLoaded = true; }
    if (item.dataset.tab === 'vcp' && !window._vcpLoaded) { renderVCP(); window._vcpLoaded = true; }
  });
});

// ==================== REFRESH ====================
function refreshAll() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  document.getElementById('lastUpdated').textContent = 'Refreshing...';

  renderOverview();
  renderRecapCalendar();

  setTimeout(function() {
    btn.classList.remove('spinning');
    document.getElementById('lastUpdated').textContent = 'Updated ' + getTimestamp();
  }, 2000);
}

// ==================== TRADE RECAP DATA BACKUP ====================
