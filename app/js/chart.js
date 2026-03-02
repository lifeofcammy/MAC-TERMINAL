// ==================== chart.js ====================
// Global TradingView chart popup — click any ticker to open a daily chart
// Uses TradingView's free Advanced Chart widget (15-min delayed data)

// ── First-time ticker glow hint ──
(function glowHint() {
  const KEY = 'mac_ticker_clicked';
  if (localStorage.getItem(KEY)) return;
  // Wait for ticker chips to render, then pulse the first few
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const chips = document.querySelectorAll('.ticker-chip');
      const limit = Math.min(chips.length, 3);
      for (let i = 0; i < limit; i++) chips[i].classList.add('glow-hint');
      // Remove class after animation finishes (3 × 1.4 s ≈ 4.5 s)
      setTimeout(() => {
        chips.forEach(c => c.classList.remove('glow-hint'));
      }, 4800);
    }, 600);
  });
})();

// ── Modal DOM setup ──
const CHART_MODAL_HTML = `
<div id="chartModal">
  <div id="chartModalBox">
    <div id="chartModalHeader">
      <span id="chartModalTitle">Chart</span>
      <button id="chartModalClose" aria-label="Close chart">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div id="chartModalBody"></div>
  </div>
</div>
`;

document.addEventListener('DOMContentLoaded', () => {
  // Inject modal
  document.body.insertAdjacentHTML('beforeend', CHART_MODAL_HTML);

  const modal    = document.getElementById('chartModal');
  const modalBox = document.getElementById('chartModalBox');
  const title    = document.getElementById('chartModalTitle');
  const body     = document.getElementById('chartModalBody');
  const closeBtn = document.getElementById('chartModalClose');

  // ── Open chart ──
  function openChart(sym) {
    // Mark as interacted → stop glow hint
    localStorage.setItem('mac_ticker_clicked', '1');
    document.querySelectorAll('.ticker-chip.glow-hint')
            .forEach(c => c.classList.remove('glow-hint'));

    const theme = document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark' : 'light';
    title.textContent = sym + ' — Daily Chart';
    body.innerHTML = `<iframe
      src="https://s.tradingview.com/widgetembed/?frameElementId=tv_chart_${sym}&symbol=${encodeURIComponent(sym)}&interval=D&theme=${theme}&style=1&locale=en&toolbar_bg=%23f1f3f6&enable_publishing=0&hide_top_toolbar=0&hide_legend=0&saveimage=0&calendar=0&hotlist=0&news=0&studies=[]&show_popup_button=0&utm_source=terminal"
      allowtransparency="true"
      allowfullscreen
      scrolling="no"
    ></iframe>`;
    modal.classList.add('open');
  }

  // ── Close chart ──
  function closeChart() {
    modal.classList.remove('open');
    body.innerHTML = '';
  }

  closeBtn.addEventListener('click', closeChart);
  modal.addEventListener('click', e => { if (e.target === modal) closeChart(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChart(); });

  // ── Delegate clicks on ticker chips & universe chips ──
  document.addEventListener('click', e => {
    const chip = e.target.closest('.ticker-chip, .universe-chip, .watchlist-row');
    if (!chip) return;
    const sym = chip.dataset.sym || chip.querySelector('.sym, .u-sym, .wl-sym')?.textContent?.trim();
    if (sym) { e.preventDefault(); openChart(sym); }
  });

  // ── Also wire scanner rows if they have data-sym ──
  document.addEventListener('click', e => {
    const row = e.target.closest('tr[data-sym]');
    if (!row) return;
    openChart(row.dataset.sym);
  });
});
