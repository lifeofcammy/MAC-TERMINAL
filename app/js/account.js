// ==================== account.js ====================
// Account sizing, position calculator, risk management.
// Reads account size + risk% from the header inputs.

// ==================== ACCOUNT SIZING ====================
function getAccountSize() {
  const el = document.getElementById('accountSize');
  if (!el) return 25000;
  return parseFloat(el.value.replace(/[^0-9.]/g, '')) || 25000;
}
function getRiskPct() {
  const el = document.getElementById('riskPct');
  if (!el) return 1;
  return parseFloat(el.value) || 1;
}
function saveAccountSize() {
  try {
    var acct = document.getElementById('accountSize').value;
    var risk = document.getElementById('riskPct').value;
    localStorage.setItem('mcc_account', acct);
    localStorage.setItem('mcc_risk', risk);
    // Cloud sync
    if (typeof dbSaveUserSettings === 'function' && typeof getUser === 'function' && getUser()) {
      dbSaveUserSettings({ account_size: acct, risk_pct: risk }).catch(function(e) {});
    }
  } catch(e) {}
}
function loadAccountSize() {
  try {
    const saved = localStorage.getItem('mcc_account');
    const savedRisk = localStorage.getItem('mcc_risk');
    if (saved) document.getElementById('accountSize').value = saved;
    if (savedRisk) document.getElementById('riskPct').value = savedRisk;
  } catch(e) {}
}
function calcPositionSize(entryPrice, stopPrice) {
  const acct = getAccountSize();
  const riskPct = getRiskPct() / 100;
  const riskDollars = acct * riskPct;
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (riskPerShare <= 0) return { shares: 0, positionSize: 0, riskDollars: riskDollars, riskPerShare: 0 };
  const shares = Math.floor(riskDollars / riskPerShare);
  const positionSize = shares * entryPrice;
  const pctOfAccount = (positionSize / acct) * 100;
  return { shares, positionSize, riskDollars, riskPerShare, pctOfAccount };
}
function sizingHTML(entryPrice, stopPrice) {
  const s = calcPositionSize(entryPrice, stopPrice);
  if (s.shares <= 0) return '';
  return '<div style="margin-top:5px;padding:6px 8px;background:var(--blue-bg);border:1px solid var(--blue)33;border-radius:5px;font-size:10px;font-family:\'JetBrains Mono\',monospace;line-height:1.5;">' +
    '<span style="font-weight:700;color:var(--blue);">SIZING:</span> ' +
    '<span style="color:var(--text-secondary);">' + s.shares + ' shares</span> · ' +
    '<span style="color:var(--text-secondary);">$' + s.positionSize.toLocaleString('en-US', {maximumFractionDigits:0}) + ' position</span> · ' +
    '<span style="color:var(--red);">$' + s.riskDollars.toFixed(0) + ' risk (' + getRiskPct() + '%)</span> · ' +
    '<span style="color:var(--text-muted);">' + s.pctOfAccount.toFixed(1) + '% of acct</span>' +
    '</div>';
}

function srcBadge(source, isLive, delay) {
  const mktOpen = isMarketOpen();
  let color, bg, label;
  if (source.includes('Polygon')) {
    if (mktOpen) { color = 'var(--amber)'; bg = 'var(--amber-bg)'; label = '⏱ 15-MIN DELAYED'; }
    else { color = 'var(--text-muted)'; bg = 'rgba(100,116,139,0.1)'; label = '○ MKT CLOSED'; }
  } else if (source.includes('Alpha')) {
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  } else {
    color = 'var(--green)'; bg = 'var(--green-bg)'; label = '● LIVE';
  }
  return '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + bg + ';color:' + color + ';letter-spacing:.05em;margin-left:6px;">' + label + '</span>' +
         '<span style="font-size:9px;color:var(--text-muted);margin-left:4px;">via ' + source + '</span>';
}
