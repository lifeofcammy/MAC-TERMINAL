// ==================== technicals.js ====================
// Technical analysis calculations: EMA, MACD, SMA helpers.

// ==================== TECHNICAL HELPERS ====================
function calcEMA(bars, period) {
  if (bars.length < period) return null;
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((s, b) => s + b.c, 0) / period;
  for (let i = period; i < bars.length; i++) ema = bars[i].c * k + ema * (1 - k);
  return ema;
}

function calcMACD(bars) {
  if (bars.length < 35) return null;
  const ema12 = calcEMA(bars, 12);
  const ema26 = calcEMA(bars, 26);
  if (!ema12 || !ema26) return null;
  const line = ema12 - ema26;
  return { line, dir: line > 0 ? 'Bull' : 'Bear' };
}

