// ==================== chart.js ====================
// Global TradingView chart popup — click any ticker to open a daily chart
// Uses TradingView's free Advanced Chart widget (15-min delayed data)

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

  // Modal container
  var modal = document.createElement('div');
  modal.style.cssText = 'position:relative;width:100%;max-width:900px;height:70vh;max-height:600px;background:var(--bg-card);border-radius:14px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.3);display:flex;flex-direction:column;';

  // Header bar
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;';
  header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
    + '<span style="font-size:16px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">' + ticker + '</span>'
    + '<span style="font-size:12px;color:var(--text-muted);">Daily Chart</span>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:12px;">'
    + '<span style="font-size:11px;color:var(--text-muted);opacity:0.7;">15-min delayed</span>'
    + '<button onclick="document.getElementById(\'tv-chart-modal\').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">&times;</button>'
    + '</div>';
  modal.appendChild(header);

  // Chart container
  var chartWrap = document.createElement('div');
  chartWrap.id = 'tv-chart-container';
  chartWrap.style.cssText = 'flex:1;min-height:0;';
  modal.appendChild(chartWrap);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Load TradingView widget
  var script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/tv.js';
  script.onload = function() {
    if (typeof TradingView === 'undefined') return;
    new TradingView.widget({
      container_id: 'tv-chart-container',
      autosize: true,
      symbol: ticker,
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
