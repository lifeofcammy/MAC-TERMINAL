// ==================== segments.js ====================
// Market Segments tab: renderSegments — fetches sector ETF data,
// ranks by composite score, renders candlestick chart and rotation signals.

// ==================== RENDER: MARKET SEGMENTS ====================
async function renderSegments() {
  const container = document.getElementById('tab-segments');
  const ts = getTimestamp();
  const live = isMarketOpen();

  // Sector ETFs with constituent tickers
  const sectors = [
    { etf: 'XLK', name: 'Technology', tickers: ['AAPL','MSFT','NVDA','AVGO','CRM'] },
    { etf: 'SMH', name: 'Semiconductors', tickers: ['NVDA','AMD','AVGO','MRVL','QCOM'] },
    { etf: 'XLF', name: 'Financials', tickers: ['JPM','BAC','GS','MS','BLK'] },
    { etf: 'XLE', name: 'Energy', tickers: ['XOM','CVX','COP','SLB','EOG'] },
    { etf: 'XLV', name: 'Healthcare', tickers: ['UNH','JNJ','LLY','ABBV','MRNA'] },
    { etf: 'XLY', name: 'Consumer Disc.', tickers: ['AMZN','TSLA','HD','NKE','SBUX'] },
    { etf: 'XLI', name: 'Industrials', tickers: ['LMT','RTX','CAT','DE','GE'] },
    { etf: 'XLRE', name: 'Real Estate', tickers: ['AMT','PLD','SPG','O','EQIX'] },
    { etf: 'XLU', name: 'Utilities', tickers: ['NEE','DUK','SO','AEP','D'] },
    { etf: 'XLB', name: 'Materials', tickers: ['FCX','NEM','APD','LIN','NUE'] },
    { etf: 'XLC', name: 'Comm. Services', tickers: ['META','GOOG','NFLX','DIS','CMCSA'] },
    { etf: 'XLP', name: 'Consumer Staples', tickers: ['PG','KO','PEP','COST','WMT'] },
  ];

  let html = '<div class="section-title"><span class="dot" style="background:var(--blue)"></span> Market Segments — Ranked by Composite Performance & Momentum</div>';
  html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">${srcBadge('Polygon.io', live, '')} ${tsLabel(ts)}</div>`;
  html += '<p style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">Ranking uses intraday %, 5-day trend, 20-day momentum, and volume to compute rotation signals. Mini charts show 20-day closing prices.</p>';

  try {
    const allETFs = sectors.map(s => s.etf);
    const snap = await getSnapshots(allETFs);

    // Fetch daily bars for each ETF to compute multi-timeframe data
    const barData = {};
    for (const etf of allETFs) {
      try { barData[etf] = await getDailyBars(etf, 30); } catch (e) { barData[etf] = []; }
    }

    // Also try Alpha Vantage sector performance for cross-reference
    let alphaData = null;
    try {
      const av = await alphaGet('SECTOR');
      if (av && av['Rank A: Real-Time Performance']) alphaData = av;
    } catch (e) {}

    // Build ranked data with multi-timeframe analysis
    const ranked = sectors.map(s => {
      const d = snap[s.etf];
      const bars = barData[s.etf] || [];
      if (!d) return { ...s, perf: 0, weekPerf: 0, monthPerf: 0, momentum: 0, score: 0, chartData: [], price: 0, vol: 0 };

      const p = d.day?.c || d.lastTrade?.p || 0;
      const prev = d.prevDay?.c || p;
      const dayChg = prev > 0 ? ((p - prev) / prev) * 100 : 0;
      const todayVol = d.day?.v || 0;

      // Weekly perf (last 5 bars)
      let weekPerf = 0;
      if (bars.length >= 5) {
        const w5 = bars[bars.length - 5].c;
        weekPerf = w5 > 0 ? ((p - w5) / w5) * 100 : 0;
      }

      // Monthly perf (last 20 bars)
      let monthPerf = 0;
      if (bars.length >= 20) {
        const m20 = bars[bars.length - 20].c;
        monthPerf = m20 > 0 ? ((p - m20) / m20) * 100 : 0;
      }

      // Chart data: last 20 OHLC bars for candlestick
      const chartBarsData = bars.slice(-20).map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c }));

      // Momentum: average of last 5 bars vs first 5 bars in the 20-bar window
      const chartCloses = chartBarsData.map(b => b.c);
      let momentum = 0;
      if (chartCloses.length >= 10) {
        const last5avg = chartCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const first5avg = chartCloses.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        momentum = first5avg > 0 ? ((last5avg - first5avg) / first5avg) * 100 : 0;
      }

      // Volume vs 20d avg
      let volRatio = 1;
      if (bars.length >= 20) {
        const avgVol = bars.slice(-20).reduce((a, b) => a + b.v, 0) / 20;
        volRatio = avgVol > 0 ? todayVol / avgVol : 1;
      }

      // Composite score: day × 3 + week × 2 + month × 1 + momentum × 0.5 + volume bonus
      const score = dayChg * 3 + weekPerf * 2 + monthPerf * 1 + momentum * 0.5 + (volRatio > 1.5 ? 2 : 0);

      return { ...s, perf: dayChg, weekPerf, monthPerf, momentum, score, chartBarsData, price: p, vol: todayVol, volRatio };
    }).sort((a, b) => b.score - a.score);

    if (alphaData) {
      html += `<div style="margin-bottom:12px;">${srcBadge('Alpha Vantage', true, '')} <span style="font-size:9px;color:var(--text-muted);">Sector rankings cross-referenced</span></div>`;
    }

    html += '<div class="card" style="padding:0;overflow:hidden;">';
    html += '<div class="segment-row" style="background:var(--bg-secondary);border-bottom:2px solid var(--border);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">';
    html += '<div>#</div><div>Segment</div><div style="text-align:right;">Day</div><div style="text-align:center;">20d Trend</div><div style="text-align:center;">Signal</div><div style="text-align:center;">Rotation</div>';
    html += '</div>';

    ranked.forEach((seg, i) => {
      const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
      const perfClass = seg.perf >= 0 ? 'up' : 'down';

      // Mini candlestick chart SVG
      let chartSvg = '';
      if (seg.chartBarsData && seg.chartBarsData.length > 3) {
        const cBars = seg.chartBarsData;
        const allHighs = cBars.map(b => b.h);
        const allLows = cBars.map(b => b.l);
        const cMin = Math.min(...allLows);
        const cMax = Math.max(...allHighs);
        const cRange = cMax - cMin || 1;
        const svgW = 120, svgH = 36;
        const candleW = Math.max(2, Math.floor((svgW - 4) / cBars.length) - 1);
        const gap = 1;

        let svgContent = '';
        cBars.forEach((b, ci) => {
          const x = 2 + ci * (candleW + gap);
          const yH = svgH - 2 - ((b.h - cMin) / cRange) * (svgH - 4);
          const yL = svgH - 2 - ((b.l - cMin) / cRange) * (svgH - 4);
          const yO = svgH - 2 - ((b.o - cMin) / cRange) * (svgH - 4);
          const yC = svgH - 2 - ((b.c - cMin) / cRange) * (svgH - 4);
          const bull = b.c >= b.o;
          const color = bull ? '#00c853' : '#ff1744';
          const bodyTop = Math.min(yO, yC);
          const bodyH = Math.max(1, Math.abs(yC - yO));
          const wickX = x + candleW / 2;

          // Wick
          svgContent += '<line x1="' + wickX + '" y1="' + yH + '" x2="' + wickX + '" y2="' + yL + '" stroke="' + color + '" stroke-width="0.7" opacity="0.6"/>';
          // Body
          svgContent += '<rect x="' + x + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + (bull ? color : color) + '" opacity="0.85" rx="0.3"/>';
        });

        chartSvg = '<svg width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="display:block;">' + svgContent + '</svg>';
      } else {
        chartSvg = '<span style="font-size:9px;color:var(--text-muted);">No data</span>';
      }

      // Signal strength: based on composite score
      const signalStrength = Math.abs(seg.score);
      let signalColor, signalText;
      if (seg.score > 8) { signalColor = 'var(--green)'; signalText = 'Strong'; }
      else if (seg.score > 3) { signalColor = 'var(--green)'; signalText = 'Moderate'; }
      else if (seg.score > -3) { signalColor = 'var(--amber)'; signalText = 'Mixed'; }
      else if (seg.score > -8) { signalColor = 'var(--red)'; signalText = 'Weak'; }
      else { signalColor = 'var(--red)'; signalText = 'Very Weak'; }

      // Rotation status: multi-factor
      // ROTATING IN: positive day + positive week + positive momentum + above-average volume
      // ROTATING OUT: negative on multiple timeframes
      // HOLD: mixed signals
      let rotation, rotClass;
      const bullFactors = (seg.perf > 0 ? 1 : 0) + (seg.weekPerf > 0 ? 1 : 0) + (seg.monthPerf > 0 ? 1 : 0) + (seg.momentum > 0 ? 1 : 0);
      const bearFactors = (seg.perf < 0 ? 1 : 0) + (seg.weekPerf < 0 ? 1 : 0) + (seg.monthPerf < 0 ? 1 : 0) + (seg.momentum < 0 ? 1 : 0);

      if (bullFactors >= 3 && seg.score > 3) { rotation = '↑ ROTATING IN'; rotClass = 'rotation-in'; }
      else if (bearFactors >= 3 && seg.score < -3) { rotation = '↓ ROTATING OUT'; rotClass = 'rotation-out'; }
      else { rotation = '— HOLD'; rotClass = 'rotation-neutral'; }

      // Trend detail tooltip text
      const trendDetail = `Wk: ${seg.weekPerf >= 0 ? '+' : ''}${seg.weekPerf.toFixed(1)}% · Mo: ${seg.monthPerf >= 0 ? '+' : ''}${seg.monthPerf.toFixed(1)}% · Mom: ${seg.momentum >= 0 ? '+' : ''}${seg.momentum.toFixed(1)}%`;

      html += `<div class="segment-row">
        <div class="segment-rank ${rankClass}">${i + 1}</div>
        <div>
          <div class="segment-name">${seg.name}</div>
          <div class="segment-sub">${seg.etf} · $${seg.price ? price(seg.price) : '—'} · ${seg.tickers.join(', ')}</div>
        </div>
        <div class="segment-perf ${perfClass}" style="line-height:1.3;">
          ${pct(seg.perf)}
          <div style="font-size:9px;color:var(--text-muted);font-weight:500;">${trendDetail}</div>
        </div>
        <div class="segment-chart">${chartSvg}</div>
        <div class="segment-signal">
          <span class="signal-dot" style="background:${signalColor}"></span>
          <span class="signal-dot" style="background:${signalColor};opacity:${signalStrength > 5 ? '1' : '0.3'}"></span>
          <span class="signal-dot" style="background:${signalColor};opacity:${signalStrength > 10 ? '1' : '0.3'}"></span>
          <span style="font-size:10px;color:${signalColor};font-weight:600;margin-left:4px;">${signalText}</span>
        </div>
        <div><span class="segment-rotation ${rotClass}">${rotation}</span></div>
      </div>`;
    });
    html += '</div>';

  } catch (e) {
    html += `<div class="card" style="text-align:center;color:var(--red);padding:30px;font-size:12px;">Segment data unavailable: ${e.message}</div>`;
  }


  container.innerHTML = html;
}


// ==================== FINNHUB ECONOMIC CALENDAR ====================
