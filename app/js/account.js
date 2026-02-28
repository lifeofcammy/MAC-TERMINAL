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
    localStorage.setItem('mcc_account', document.getElementById('accountSize').value);
    localStorage.setItem('mcc_risk', document.getElementById('riskPct').value);
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
