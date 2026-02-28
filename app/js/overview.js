// ==================== overview.js ====================
// Overview: Morning command center
// Layout (top to bottom):
// 1. Morning Mindset (collapsible, Today's Focus always visible)
// 2. Market Regime (auto with 10/20 SMA logic, manual override)
// 3. Market Snapshot (SPY/QQQ/IWM/DIA/VIX/DXY in one tight row)
// 4. Breadth Bar (Advancers/Decliners + New Highs/Lows visual)
// 5. Today's Catalysts (Econ Calendar + top news headlines)
// 6. Watchlist (manual ticker entry, embedded)
// 7. Pre-Market Movers (top gappers)
// 8. Sector Heatmap (collapsible, color-coded)
// 9. Top Ideas (auto from scanners)

// ==================== RENDER: OVERVIEW ====================
async function renderOverview() {
  var container = document.getElementById('tab-overview');
  if (!container) return;
  var ts = getTimestamp();
  var live = isMarketOpen();

  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">Loading Overview...</div>';

  // ── TICKERS TO FETCH ──
  var indexTickers = ['SPY','QQQ','IWM','DIA'];
  var extraTickers = ['VIXY','UUP']; // VIX proxy via VIXY ETF, DXY proxy via UUP
  var sectorETFs = [
    {etf:'XLK',name:'Technology'},{etf:'SMH',name:'Semiconductors'},
    {etf:'XLF',name:'Financials'},{etf:'XLE',name:'Energy'},
    {etf:'XLV',name:'Healthcare'},{etf:'XLY',name:'Consumer Disc.'},
    {etf:'XLI',name:'Industrials'},{etf:'XLRE',name:'Real Estate'},
    {etf:'XLU',name:'Utilities'},{etf:'XLB',name:'Materials'},
    {etf:'XLC',name:'Comm. Services'},{etf:'XLP',name:'Consumer Staples'}
  ];

  var snap = {}, sectorSnap = {}, sectorBars = {}, spyBars = [], newsArticles = [];

  try {
    // Index + VIX proxy snapshots
    snap = await getSnapshots(indexTickers.concat(extraTickers));
    // SPY daily bars for 10/20 SMA
    try { spyBars = await getDailyBars('SPY', 30); } catch(e) { spyBars = []; }
    // Sector snapshots + bars
    var sectorTickers = sectorETFs.map(function(s){return s.etf;});
    sectorSnap = await getSnapshots(sectorTickers);
    for (var si=0; si<sectorTickers.length; si++) {
      try { sectorBars[sectorTickers[si]] = await getDailyBars(sectorTickers[si], 25); } catch(e) { sectorBars[sectorTickers[si]] = []; }
    }
    // News
    try { newsArticles = await getPolygonNews(null, 25); } catch(e) {}
  } catch(e) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--red);padding:30px;">Failed to load data: '+e.message+'<br><span style="font-size:11px;color:var(--text-muted);">Check your Polygon API key (gear icon).</span></div>';
    return;
  }

  // ── HELPERS ──
  function getSnap(ticker) {
    var s = snap[ticker];
    if (!s) return {price:0,change:0,pct:0,vol:0,prevClose:0,high:0,low:0,vwap:0};
    var p = s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c ? s.prevDay.c : (s.lastTrade?s.lastTrade.p:0));
    var prev = s.prevDay ? s.prevDay.c : p;
    // On weekends/holidays: day.c and prevDay.c may be the same (both = Friday close)
    // Use spyBars (daily bars) for SPY to get proper last-day change if available
    if(!live && ticker==='SPY' && spyBars.length>=2){
      p = spyBars[spyBars.length-1].c;
      prev = spyBars[spyBars.length-2].c;
    }
    var chg = p - prev;
    var pctVal = prev>0 ? (chg/prev)*100 : 0;
    return {price:p, change:chg, pct:pctVal, vol:s.day?s.day.v:0, prevClose:prev, high:s.day?s.day.h:0, low:s.day?s.day.l:0, vwap:s.day?s.day.vw:0};
  }
  // For non-SPY indexes on weekends, also fix using bars
  async function getSnapWithBars(ticker) {
    var base = getSnap(ticker);
    if(!live && base.pct===0){
      try{
        var bars = await getDailyBars(ticker, 5);
        if(bars.length>=2){
          base.price = bars[bars.length-1].c;
          base.prevClose = bars[bars.length-2].c;
          base.change = base.price - base.prevClose;
          base.pct = base.prevClose>0 ? (base.change/base.prevClose)*100 : 0;
        }
      }catch(e){}
    }
    return base;
  }

  var spyData = getSnap('SPY');
  var qqqData = await getSnapWithBars('QQQ');
  var iwmData = await getSnapWithBars('IWM');
  var diaData = await getSnapWithBars('DIA');
  var vixyData = await getSnapWithBars('VIXY');

  // ── INDEX 10 & 20 SMAs (SPY, QQQ, IWM, DIA) ──
  function calcSMA(bars, period) {
    if(!bars||bars.length<period) return null;
    var cl=bars.map(function(b){return b.c;}); var ln=cl.length;
    var sum=0; for(var i=ln-period;i<ln;i++) sum+=cl[i]; return sum/period;
  }
  var spySma10=calcSMA(spyBars,10), spySma20=calcSMA(spyBars,20);
  var spyAbove10 = spySma10!==null && spyData.price>spySma10;
  var spyAbove20 = spySma20!==null && spyData.price>spySma20;
  var spyBelow10 = spySma10!==null && spyData.price<spySma10;
  var spyBelow20 = spySma20!==null && spyData.price<spySma20;

  // Fetch bars for QQQ, IWM, DIA for their SMAs
  var qqqBars=[],iwmBars=[],diaBars=[];
  try{qqqBars=await getDailyBars('QQQ',30);}catch(e){}
  try{iwmBars=await getDailyBars('IWM',30);}catch(e){}
  try{diaBars=await getDailyBars('DIA',30);}catch(e){}

  var qqqSma10=calcSMA(qqqBars,10),qqqSma20=calcSMA(qqqBars,20);
  var iwmSma10=calcSMA(iwmBars,10),iwmSma20=calcSMA(iwmBars,20);
  var diaSma10=calcSMA(diaBars,10),diaSma20=calcSMA(diaBars,20);

  var qqqAbove10=qqqSma10!==null&&qqqData.price>qqqSma10;
  var qqqAbove20=qqqSma20!==null&&qqqData.price>qqqSma20;
  var iwmAbove10=iwmSma10!==null&&iwmData.price>iwmSma10;
  var iwmAbove20=iwmSma20!==null&&iwmData.price>iwmSma20;
  var diaAbove10=diaSma10!==null&&diaData.price>diaSma10;
  var diaAbove20=diaSma20!==null&&diaData.price>diaSma20;

  // Count how many indexes are above both SMAs vs below both
  var idxAboveBoth=0, idxBelowBoth=0, idxMixed=0;
  var idxSmaDetails=[];
  [{name:'SPY',p:spyData.price,a10:spyAbove10,a20:spyAbove20,s10:spySma10,s20:spySma20},
   {name:'QQQ',p:qqqData.price,a10:qqqAbove10,a20:qqqAbove20,s10:qqqSma10,s20:qqqSma20},
   {name:'IWM',p:iwmData.price,a10:iwmAbove10,a20:iwmAbove20,s10:iwmSma10,s20:iwmSma20},
   {name:'DIA',p:diaData.price,a10:diaAbove10,a20:diaAbove20,s10:diaSma10,s20:diaSma20}].forEach(function(idx){
    if(idx.s10===null)return;
    if(idx.a10&&idx.a20){idxAboveBoth++;idxSmaDetails.push(idx.name+' above both');}
    else if(!idx.a10&&!idx.a20){idxBelowBoth++;idxSmaDetails.push(idx.name+' below both');}
    else{idxMixed++;idxSmaDetails.push(idx.name+' mixed');}
  });

  // VIX context
  var vixPct=vixyData.pct;
  var vixNote='';
  if(Math.abs(vixPct)>5)vixNote='VIX '+(vixPct>0?'spiking +':'dropping ')+Math.abs(vixPct).toFixed(1)+'% — '+(vixPct>0?'fear elevated.':'fear fading.');
  else if(Math.abs(vixPct)>2)vixNote='VIX '+(vixPct>0?'rising +':'easing ')+Math.abs(vixPct).toFixed(1)+'%.';
  else vixNote='VIX stable.';

  // ── SECTOR DATA ──
  var sectorData = sectorETFs.map(function(sec) {
    var s=sectorSnap[sec.etf]; var bars=sectorBars[sec.etf]||[];
    var p=0,prev=0,dayChg=0,weekPerf=0;
    if(s){
      // Use day.c if available (market open), otherwise use prevDay.c (last trading day close)
      p=s.day&&s.day.c&&s.day.c>0 ? s.day.c : (s.prevDay&&s.prevDay.c ? s.prevDay.c : (s.lastTrade?s.lastTrade.p:0));
      // For prev close: if market is open, prevDay.c is yesterday. If closed, use bars for prior day.
      if(live && s.prevDay && s.prevDay.c){
        prev = s.prevDay.c;
      } else if(bars.length>=2){
        // Market closed: compare last bar close to second-to-last bar close
        prev = bars[bars.length-2].c;
        p = bars[bars.length-1].c;
      } else if(s.prevDay && s.prevDay.c){
        prev = s.prevDay.c;
      } else {
        prev = p;
      }
      dayChg = prev>0 ? ((p-prev)/prev)*100 : 0;
    }
    if(bars.length>=5){var w5=bars[bars.length-5].c;var latest=bars[bars.length-1].c;weekPerf=w5>0?((latest-w5)/w5)*100:0;}
    return {etf:sec.etf,name:sec.name,price:p,dayChg:dayChg,weekPerf:weekPerf};
  });
  sectorData.sort(function(a,b){return b.dayChg-a.dayChg;});

  // ── BREADTH ──
  var sectorsUp = sectorData.filter(function(s){return s.dayChg>0;}).length;
  var sectorsDown = sectorData.filter(function(s){return s.dayChg<0;}).length;
  var sectorsFlat = sectorData.length - sectorsUp - sectorsDown;
  var breadthPct = Math.round((sectorsUp/sectorData.length)*100);

  // ════════════════════════════════════════════════════════════
  // BUILD HTML
  // ════════════════════════════════════════════════════════════
  var html = '';

  // ════ 1. MORNING MINDSET ════
  var mindsetRules = [
    "My job is execution, not prediction. Only job is to manage risk.",
    "Capital Conservation before Capital Growth.",
    "I only trade my edge — nothing else exists.",
    "Trading is a business, losses are business expenses.",
    "One trade means nothing.",
    "I don't need to trade — I wait to be invited.",
    "I don't fight the tape, I align with it.",
    "Hope has no room in my strategy.",
    "Boredom is a signal I'm doing this right.",
    "Fall in love with the process, the outcome will figure itself out.",
    "You are defined by how you handle losses.",
    "The market is always right, respect the market.",
    "Being wrong is okay.",
    "Always have a stop loss.",
    "Better to lose on a trade and follow your rules, than make money and not follow.",
    "Discipline and process is built day in and day out.",
    "Cut losers fast, let winners run as long as trend intact.",
    "Avoid chop, cash is a position.",
    "You have a limited number of bandwidth every day, conserve it."
  ];
  var todayIdx = Math.floor(Date.now()/(24*60*60*1000)) % mindsetRules.length;
  var dailyFocus = mindsetRules[todayIdx];
  var mindsetCollapsed = localStorage.getItem('mcc_mindset_collapsed')==='true';

  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;border-left:3px solid var(--amber);">';
  html += '<div onclick="toggleMindset()" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;user-select:none;">';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:13px;font-weight:800;">Morning Mindset</span></div>';
  html += '<span id="mindset-arrow" style="font-size:11px;color:var(--text-muted);">'+(mindsetCollapsed?'▶':'▼')+'</span>';
  html += '</div>';
  // Today's Focus — ALWAYS visible
  html += '<div style="padding:0 16px 10px;"><div style="background:var(--bg-secondary);border:1px solid rgba(230,138,0,0.2);border-radius:6px;padding:10px 14px;">';
  html += '<div style="font-size:8px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">Today\'s Focus</div>';
  html += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);line-height:1.4;">'+dailyFocus+'</div>';
  html += '</div></div>';
  // Full rules — collapsible
  html += '<div id="mindset-body" style="'+(mindsetCollapsed?'display:none;':'')+'padding:0 16px 12px;">';
  html += '<div style="columns:2;column-gap:16px;">';
  mindsetRules.forEach(function(rule,i) {
    var isToday = i===todayIdx;
    html += '<div style="break-inside:avoid;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:flex-start;'+(isToday?'background:var(--amber-bg);margin:0 -4px;padding:4px;border-radius:4px;':'')+'">';
    html += '<span style="font-size:10px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;min-width:18px;">'+(i+1)+'.</span>';
    html += '<span style="font-size:11px;color:'+(isToday?'var(--amber)':'var(--text-primary)')+';line-height:1.4;font-weight:'+(isToday?'700':'500')+';">'+rule+'</span>';
    html += '</div>';
  });
  html += '</div></div></div>';

  // ════ 2. MARKET REGIME ════
  var regimeLabel='Neutral',regimeColor='var(--text-muted)',regimeBg='var(--bg-secondary)',regimeBorder='var(--border)',regimeIcon='◆',regimeDetail='';
  var spyPct=spyData.pct, qqqPct=qqqData.pct, iwmPct=iwmData.pct, diaPct=diaData.pct;
  var avgPct=(spyPct+qqqPct+iwmPct+diaPct)/4;

  // High-impact econ event check
  var hasHighImpactEvent=false, eventName='';
  try {
    var td=new Date();var dw=td.getDay();var mon=new Date(td);mon.setDate(td.getDate()-(dw===0?6:dw-1));
    var calKey='mtp_econ_cal_ff_'+mon.toISOString().split('T')[0];
    var calData=localStorage.getItem(calKey);
    if(calData){var parsed=JSON.parse(calData);var calText=(parsed.text||'').toLowerCase();
      if(/cpi|fomc|fed fund|interest rate|nonfarm|payroll|gdp|pce/.test(calText)){hasHighImpactEvent=true;
        if(/cpi/.test(calText))eventName='CPI';else if(/fomc|fed fund|interest rate/.test(calText))eventName='FOMC/Fed';
        else if(/nonfarm|payroll/.test(calText))eventName='NFP';else if(/gdp/.test(calText))eventName='GDP';
        else if(/pce/.test(calText))eventName='PCE';else eventName='major data';
      }
    }
  } catch(e){}

  // Build index status summary for notes
  function buildIndexNotes(){
    var parts=[];
    [{name:'SPY',pct:spyPct,a10:spyAbove10,a20:spyAbove20},
     {name:'QQQ',pct:qqqPct,a10:qqqAbove10,a20:qqqAbove20},
     {name:'IWM',pct:iwmPct,a10:iwmAbove10,a20:iwmAbove20},
     {name:'DIA',pct:diaPct,a10:diaAbove10,a20:diaAbove20}].forEach(function(idx){
      var smaStatus=idx.a10&&idx.a20?'above both SMAs':(!idx.a10&&!idx.a20?'below both SMAs':'between SMAs');
      parts.push(idx.name+' '+(idx.pct>=0?'+':'')+idx.pct.toFixed(1)+'% ('+smaStatus+')');
    });
    return parts.join(' · ');
  }
  var indexNotes=buildIndexNotes();
  var vixLine=vixNote;

  // Regime decision using ALL indexes + VIX
  if(hasHighImpactEvent&&!live){
    regimeLabel='Wait for '+eventName;regimeIcon='⏸';regimeColor='var(--purple)';regimeBg='rgba(124,58,237,0.06)';regimeBorder='rgba(124,58,237,0.3)';
    regimeDetail=eventName+' data expected — wait for the reaction before entering.';
  }
  else if(avgPct>0.8&&breadthPct>=65&&idxAboveBoth>=3){
    regimeLabel='Risk On';regimeIcon='▲';regimeColor='var(--green)';regimeBg='rgba(16,185,129,0.06)';regimeBorder='rgba(16,185,129,0.3)';
    regimeDetail='Broad strength. '+idxAboveBoth+'/4 indexes above 10 & 20 SMA. '+sectorsUp+'/'+sectorData.length+' sectors green. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct<-0.8&&breadthPct<=35&&idxBelowBoth>=3){
    regimeLabel='Risk Off';regimeIcon='▼';regimeColor='var(--red)';regimeBg='rgba(239,68,68,0.06)';regimeBorder='rgba(239,68,68,0.3)';
    regimeDetail='Broad weakness. '+idxBelowBoth+'/4 indexes below 10 & 20 SMA. '+sectorsDown+'/'+sectorData.length+' sectors red. '+vixLine+' Reduce size.\n'+indexNotes;
  }
  else if(Math.abs(avgPct)<0.3&&idxMixed>=2){
    regimeLabel='Choppy / Low Conviction';regimeIcon='↔';regimeColor='var(--amber)';regimeBg='rgba(245,158,11,0.06)';regimeBorder='rgba(245,158,11,0.3)';
    regimeDetail='Narrow range, mixed signals. '+idxAboveBoth+'/4 above both SMAs, '+idxBelowBoth+'/4 below both, '+idxMixed+'/4 mixed. '+vixLine+'\n'+indexNotes;
  }
  else if(avgPct>0.3||idxAboveBoth>=3){
    regimeLabel='Lean Bullish';regimeIcon='▲';regimeColor='var(--green)';regimeBg='rgba(16,185,129,0.04)';regimeBorder='rgba(16,185,129,0.2)';
    regimeDetail=idxAboveBoth+'/4 indexes above both SMAs. '+sectorsUp+'/'+sectorData.length+' sectors positive. '+vixLine+' Selective longs.\n'+indexNotes;
  }
  else if(avgPct<-0.3||idxBelowBoth>=3){
    regimeLabel='Lean Bearish';regimeIcon='▼';regimeColor='var(--red)';regimeBg='rgba(239,68,68,0.04)';regimeBorder='rgba(239,68,68,0.2)';
    regimeDetail=idxBelowBoth+'/4 indexes below both SMAs. '+sectorsDown+'/'+sectorData.length+' sectors negative. '+vixLine+' Cautious, reduce size.\n'+indexNotes;
  }
  else{
    regimeLabel='Neutral';regimeIcon='◆';regimeColor='var(--text-muted)';regimeBg='var(--bg-secondary)';regimeBorder='var(--border)';
    regimeDetail='Mixed signals across indexes. '+idxAboveBoth+' above both SMAs, '+idxBelowBoth+' below both. '+vixLine+' A+ setups only.\n'+indexNotes;
  }
  if(hasHighImpactEvent&&live) regimeDetail+=' ⚠ '+eventName+' today — volatility expected.';

  html += '<div style="background:'+regimeBg+';border:1px solid '+regimeBorder+';border-radius:10px;padding:12px 18px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">';
  html += '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">';
  html += '<span style="font-size:22px;color:'+regimeColor+';">'+regimeIcon+'</span>';
  html += '<div style="min-width:0;">';
  html += '<div style="font-size:15px;font-weight:800;color:'+regimeColor+';">'+regimeLabel+'</div>';
  html += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px;line-height:1.4;">'+regimeDetail.replace(/\n/g,'<br>')+'</div>';
  // Show all 4 indexes' SMA status
  var smaIndexes = [
    {name:'SPY',s10:spySma10,s20:spySma20,a10:spyAbove10,a20:spyAbove20},
    {name:'QQQ',s10:qqqSma10,s20:qqqSma20,a10:qqqAbove10,a20:qqqAbove20},
    {name:'IWM',s10:iwmSma10,s20:iwmSma20,a10:iwmAbove10,a20:iwmAbove20},
    {name:'DIA',s10:diaSma10,s20:diaSma20,a10:diaAbove10,a20:diaAbove20}
  ];
  var hasSmaData = smaIndexes.some(function(idx){return idx.s10!==null;});
  if(hasSmaData){
    html += '<div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">';
    smaIndexes.forEach(function(idx){
      if(idx.s10===null) return;
      var both = idx.a10 && idx.a20;
      var neither = !idx.a10 && !idx.a20;
      var smaColor = both ? 'var(--green)' : neither ? 'var(--red)' : 'var(--amber)';
      var smaLabel = both ? 'Above Both' : neither ? 'Below Both' : 'Mixed';
      html += '<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+smaColor+'15;color:'+smaColor+';font-family:\'JetBrains Mono\',monospace;">'+idx.name+' '+smaLabel+'</span>';
    });
    html += '</div>';
  }
  html += '</div></div>';
  html += '</div>';

  // ════ 3. MARKET SNAPSHOT (tight row: SPY QQQ IWM DIA VIX DXY) ════
  var dataFreshness = getDataFreshnessLabel();
  html += '<div style="display:flex;justify-content:flex-end;margin-bottom:4px;"><span style="font-size:8px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">'+dataFreshness+'</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px;">';
  var snapItems = [
    {ticker:'SPY',label:'S&P 500',data:spyData},
    {ticker:'QQQ',label:'Nasdaq',data:qqqData},
    {ticker:'IWM',label:'Russell',data:iwmData},
    {ticker:'DIA',label:'Dow',data:diaData},
    {ticker:'VIXY',label:'VIX Proxy',data:vixyData},
    {ticker:'UUP',label:'Dollar (DXY)',data:getSnap('UUP')}
  ];
  snapItems.forEach(function(idx){
    var d=idx.data; var color=d.pct>=0?'var(--green)':'var(--red)';
    var bg=d.pct>=0?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)';
    var borderC=d.pct>=0?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)';
    // VIX: invert color logic (VIX up = bad)
    if(idx.ticker==='VIXY'){color=d.pct<=0?'var(--green)':'var(--red)';bg=d.pct<=0?'rgba(16,185,129,0.04)':'rgba(239,68,68,0.04)';borderC=d.pct<=0?'rgba(16,185,129,0.15)':'rgba(239,68,68,0.15)';}
    html += '<div style="background:'+bg+';border:1px solid '+borderC+';border-radius:8px;padding:10px 12px;text-align:center;">';
    html += '<div style="font-size:8px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">'+idx.label+'</div>';
    html += '<div style="font-size:16px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">'+(d.price?'$'+price(d.price):'—')+'</div>';
    html += '<div style="font-size:11px;font-weight:700;color:'+color+';margin-top:2px;">'+pct(d.pct)+'</div>';
    html += '</div>';
  });
  html += '</div>';

  // ════ 4. BREADTH BAR (visual advancers/decliners) ════
  var breadthColor = breadthPct>=65?'var(--green)':breadthPct>=40?'var(--amber)':'var(--red)';
  html += '<div class="card" style="padding:12px 16px;margin-bottom:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  html += '<div style="font-size:11px;font-weight:800;color:var(--text-primary);">Sector Breadth</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);">'+sectorsUp+' advancing · '+sectorsDown+' declining'+(sectorsFlat>0?' · '+sectorsFlat+' flat':'')+'</div>';
  html += '</div>';
  // Visual bar
  html += '<div style="display:flex;height:20px;border-radius:6px;overflow:hidden;background:var(--bg-secondary);">';
  var greenW = (sectorsUp/sectorData.length)*100;
  var redW = (sectorsDown/sectorData.length)*100;
  var flatW = 100-greenW-redW;
  if(greenW>0) html += '<div style="width:'+greenW+'%;background:var(--green);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;">'+sectorsUp+'</div>';
  if(flatW>0) html += '<div style="width:'+flatW+'%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--text-muted);">'+sectorsFlat+'</div>';
  if(redW>0) html += '<div style="width:'+redW+'%;background:var(--red);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;">'+sectorsDown+'</div>';
  html += '</div>';
  html += '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:8px;color:var(--text-muted);">';
  html += '<span>Breadth: '+breadthPct+'%</span>';
  html += '<span>'+dataFreshness+'</span>';
  html += '</div></div>';

  // ════ 5. TODAY'S CATALYSTS (Econ Calendar + Top News) ════
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Today\'s Catalysts</div>';
  html += '<div style="font-size:9px;color:var(--text-muted);">'+tsLabel(ts)+'</div>';
  html += '</div>';
  // Econ calendar
  html += '<div style="padding:10px 16px;border-bottom:1px solid var(--border);">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Economic Calendar</div>';
  html += '<div id="econ-cal-grid" style="font-size:11px;color:var(--text-muted);">Loading...</div>';
  html += '</div>';
  // Top news headlines
  html += '<div style="padding:10px 16px;">';
  html += '<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Top Headlines</div>';
  if(newsArticles.length>0) {
    var topNews = newsArticles.slice(0,5);
    html += '<div style="display:grid;gap:4px;">';
    topNews.forEach(function(article){
      var pubTime = new Date(article.published_utc).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
      var tickers = (article.tickers||[]).slice(0,3).join(', ');
      html += '<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px solid var(--border);">';
      html += '<span style="font-size:8px;color:var(--text-muted);white-space:nowrap;padding-top:2px;">'+pubTime+'</span>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<a href="'+(article.article_url||'#')+'" target="_blank" style="font-size:11px;font-weight:600;color:var(--text-primary);text-decoration:none;line-height:1.3;">'+(article.title||'').replace(/</g,'&lt;')+'</a>';
      if(tickers) html += ' <span style="font-size:9px;color:var(--blue);font-weight:600;">'+tickers+'</span>';
      html += '</div></div>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:10px;color:var(--text-muted);">No news available.</div>';
  }
  html += '</div>';
  html += '</div>';

  // ════ 6. WATCHLIST (embedded, was its own tab) ════
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Watchlist</div>';
  var wList = getWatchlist();
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="font-size:7px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">'+dataFreshness+'</span>';
  if(wList.length>0) html += '<button onclick="clearWatchlist();renderOverview();" style="background:none;border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:8px;color:var(--text-muted);cursor:pointer;">Clear All</button>';
  html += '</div>';
  html += '</div>';
  // Add form
  html += '<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">';
  html += '<input type="text" id="wl-ticker-input" placeholder="TICKER" maxlength="5" style="width:70px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-family:\'JetBrains Mono\',monospace;font-size:12px;font-weight:700;color:var(--text-primary);text-transform:uppercase;" onkeydown="if(event.key===\'Enter\'){addToWatchlist();renderOverview();}" />';
  html += '<select id="wl-bias-select" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:5px 6px;font-size:10px;font-weight:600;color:var(--text-primary);font-family:\'Inter\',sans-serif;">';
  html += '<option value="long">▲ Long</option><option value="short">▼ Short</option><option value="watch">● Watch</option></select>';
  html += '<input type="text" id="wl-note-input" placeholder="Notes..." style="flex:1;min-width:120px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:11px;color:var(--text-primary);" onkeydown="if(event.key===\'Enter\'){addToWatchlist();renderOverview();}" />';
  html += '<button onclick="addToWatchlist();renderOverview();" style="background:var(--blue);color:white;border:none;border-radius:5px;padding:6px 14px;font-size:10px;font-weight:700;cursor:pointer;font-family:\'Inter\',sans-serif;">+ Add</button>';
  html += '</div>';
  // Watchlist items
  html += '<div id="watchlist-content" style="padding:10px 16px;">';
  if(wList.length===0) {
    html += '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:10px;">No tickers. Add symbols above to track them.</div>';
  } else {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
    // We'll load data async after render
    wList.forEach(function(item){
      var biasColor = item.bias==='long'?'var(--green)':item.bias==='short'?'var(--red)':'var(--amber)';
      var biasIcon = item.bias==='long'?'▲':item.bias==='short'?'▼':'●';
      html += '<div class="wl-card-'+item.ticker+'" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;border-left:3px solid '+biasColor+';position:relative;">';
      html += '<button onclick="removeFromWatchlist(\''+item.ticker+'\');renderOverview();" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;">×</button>';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
      html += '<span style="font-size:14px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">'+item.ticker+'</span>';
      html += '<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+biasColor+'15;color:'+biasColor+';">'+biasIcon+' '+item.bias.toUpperCase()+'</span>';
      html += '<span class="wl-price-'+item.ticker+'" style="font-size:11px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-muted);">Loading...</span>';
      html += '</div>';
      if(item.note) html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.3;font-style:italic;">'+item.note.replace(/</g,'&lt;')+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div></div>';

  // ════ 7. TODAY'S THEMES (Market-Moving News: Winners & Losers with WHY) ════
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Today\'s Themes</div>';
  html += '<button id="generate-themes-btn" onclick="generateThemes()" style="padding:4px 10px;border-radius:5px;border:1px solid var(--blue);background:rgba(37,99,235,0.08);color:var(--blue);cursor:pointer;font-size:9px;font-weight:700;font-family:\'Inter\',sans-serif;">Generate</button>';
  html += '</div>';
  html += '<div id="themes-content" style="padding:12px 16px;">';
  var cachedThemes=null;
  try{var themeKey='mac_themes_'+new Date().toISOString().split('T')[0];var themeData=localStorage.getItem(themeKey);if(themeData)cachedThemes=JSON.parse(themeData);}catch(e){}
  if(cachedThemes&&cachedThemes.movers){html+=renderThemesHTML(cachedThemes,cachedThemes.ts);}
  else if(cachedThemes&&cachedThemes.themes){html+=renderLegacyThemesHTML(cachedThemes.themes,cachedThemes.ts);}
  else{html += '<div style="font-size:10px;color:var(--text-muted);">Click "Generate" to see today\'s biggest movers and the news behind them.</div>';}
  html += '</div></div>';

  // ════ 8. SECTOR HEATMAP (collapsible) ════
  var heatmapCollapsed = localStorage.getItem('mac_heatmap_collapsed')==='true';
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div onclick="toggleHeatmap()" style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Sector Heatmap</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:7px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">'+dataFreshness+'</span><span id="heatmap-arrow" style="font-size:11px;color:var(--text-muted);">'+(heatmapCollapsed?'▶':'▼')+'</span></div>';
  html += '</div>';
  html += '<div id="heatmap-body" style="'+(heatmapCollapsed?'display:none;':'')+'">';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:12px 14px;">';
  sectorData.forEach(function(sec){
    var chgColor,chgBg;
    if(sec.dayChg>1){chgColor='#fff';chgBg='#059669';}
    else if(sec.dayChg>0.3){chgColor='#fff';chgBg='#10B981';}
    else if(sec.dayChg>0){chgColor='var(--text-primary)';chgBg='rgba(16,185,129,0.15)';}
    else if(sec.dayChg>-0.3){chgColor='var(--text-primary)';chgBg='rgba(239,68,68,0.1)';}
    else if(sec.dayChg>-1){chgColor='#fff';chgBg='#EF4444';}
    else{chgColor='#fff';chgBg='#DC2626';}
    html += '<div style="background:'+chgBg+';border-radius:6px;padding:10px;text-align:center;">';
    html += '<div style="font-size:10px;font-weight:800;color:'+chgColor+';">'+sec.etf+'</div>';
    html += '<div style="font-size:8px;color:'+chgColor+';opacity:0.8;">'+sec.name+'</div>';
    html += '<div style="font-size:14px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:'+chgColor+';margin-top:3px;">'+pct(sec.dayChg)+'</div>';
    html += '<div style="font-size:7px;color:'+chgColor+';opacity:0.7;margin-top:1px;">Wk: '+pct(sec.weekPerf)+'</div>';
    html += '</div>';
  });
  html += '</div></div></div>';

  // ════ 9. TOP IDEAS (from scanners) ════
  html += '<div class="card" style="margin-bottom:14px;padding:0;overflow:hidden;">';
  html += '<div style="padding:10px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">';
  html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);">Top Ideas</div>';
  html += '<button onclick="runQuickScan()" id="quick-scan-btn" style="padding:4px 10px;border-radius:5px;border:1px solid var(--green);background:rgba(16,185,129,0.08);color:var(--green);cursor:pointer;font-size:9px;font-weight:700;font-family:\'Inter\',sans-serif;">Quick Scan</button>';
  html += '</div>';
  html += '<div id="top-ideas-content" style="padding:12px 16px;">';
  var cachedIdeas=null;
  try{var ideaKey='mac_top_ideas_'+new Date().toISOString().split('T')[0];var ideaData=localStorage.getItem(ideaKey);if(ideaData)cachedIdeas=JSON.parse(ideaData);}catch(e){}
  if(cachedIdeas&&cachedIdeas.ideas&&cachedIdeas.ideas.length>0){html+=renderTopIdeasHTML(cachedIdeas.ideas,cachedIdeas.ts);}
  else{html += '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:10px;">Click "Quick Scan" to find today\'s top setups.</div>';}
  html += '</div></div>';

  container.innerHTML = html;
  loadEconCalendar();
  // Load watchlist live prices async
  loadWatchlistPrices();
}

// ==================== WATCHLIST PRICE LOADER ====================
async function loadWatchlistPrices() {
  var list = getWatchlist();
  if(list.length===0) return;
  var tickers = list.map(function(x){return x.ticker;});
  try {
    var snap = await getSnapshots(tickers);
    tickers.forEach(function(t){
      var el = document.querySelector('.wl-price-'+t);
      if(!el) return;
      var s = snap[t];
      if(!s){el.textContent='N/A';return;}
      var p = s.day&&s.day.c ? s.day.c : (s.lastTrade?s.lastTrade.p:0);
      var prev = s.prevDay ? s.prevDay.c : p;
      var pctVal = prev>0 ? ((p-prev)/prev)*100 : 0;
      var color = pctVal>=0 ? 'var(--green)' : 'var(--red)';
      el.innerHTML = '$'+price(p)+' <span style="color:'+color+';font-size:10px;">'+pct(pctVal)+'</span>';
      el.style.color = 'var(--text-primary)';
    });
  } catch(e){}
}

// ==================== REGIME OVERRIDE ====================
function saveRegimeOverride(val) {
  try{localStorage.setItem('mac_regime_override',val);}catch(e){}
  renderOverview();
}
function promptRegimeOverride() {
  // Quick-set to choppy as a starting override, user can then change via dropdown
  saveRegimeOverride('risk-on');
}

// ==================== TOGGLES ====================
function toggleHeatmap() {
  var body=document.getElementById('heatmap-body'),arrow=document.getElementById('heatmap-arrow');
  if(!body)return;var h=body.style.display==='none';body.style.display=h?'':'none';
  if(arrow)arrow.textContent=h?'▼':'▶';
  try{localStorage.setItem('mac_heatmap_collapsed',h?'false':'true');}catch(e){}
}
function toggleMindset() {
  var body=document.getElementById('mindset-body'),arrow=document.getElementById('mindset-arrow');
  if(!body)return;var h=body.style.display==='none';body.style.display=h?'':'none';
  if(arrow)arrow.textContent=h?'▼':'▶';
  try{localStorage.setItem('mcc_mindset_collapsed',h?'false':'true');}catch(e){}
}

// ==================== RENDER THEMES HTML (new format: movers + why) ====================
function renderThemesHTML(data, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:10px;">Updated '+time+' · <a href="#" onclick="localStorage.removeItem(\'mac_themes_\'+new Date().toISOString().split(\'T\')[0]);renderOverview();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';

  // Market narrative (if present)
  if(data.narrative){
    html += '<div style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;border-left:3px solid var(--blue);">' + data.narrative.replace(/</g,'&lt;') + '</div>';
  }

  var movers = data.movers || [];
  var winners = movers.filter(function(m){return m.direction==='up';});
  var losers = movers.filter(function(m){return m.direction==='down';});

  // Winners
  if(winners.length>0){
    html += '<div style="font-size:9px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Winners</div>';
    html += '<div style="display:grid;gap:6px;margin-bottom:12px;">';
    winners.forEach(function(m){
      html += '<div style="background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.15);border-radius:7px;padding:10px 12px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      html += '<span style="font-size:13px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + m.ticker + '</span>';
      html += '<span style="font-size:12px;font-weight:800;color:var(--green);font-family:\'JetBrains Mono\',monospace;">+' + Math.abs(m.pct).toFixed(1) + '%</span>';
      html += '</div>';
      html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.5;">' + (m.reason||'').replace(/</g,'&lt;') + '</div>';
      if(m.tags && m.tags.length>0){
        html += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;">';
        m.tags.forEach(function(tag){html += '<span style="font-size:8px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(16,185,129,0.1);color:var(--green);">' + tag + '</span>';});
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Losers
  if(losers.length>0){
    html += '<div style="font-size:9px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Losers</div>';
    html += '<div style="display:grid;gap:6px;margin-bottom:8px;">';
    losers.forEach(function(m){
      html += '<div style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.12);border-radius:7px;padding:10px 12px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      html += '<span style="font-size:13px;font-weight:800;font-family:\'JetBrains Mono\',monospace;color:var(--text-primary);">' + m.ticker + '</span>';
      html += '<span style="font-size:12px;font-weight:800;color:var(--red);font-family:\'JetBrains Mono\',monospace;">' + (m.pct<0?'':'-') + Math.abs(m.pct).toFixed(1) + '%</span>';
      html += '</div>';
      html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.5;">' + (m.reason||'').replace(/</g,'&lt;') + '</div>';
      if(m.tags && m.tags.length>0){
        html += '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;">';
        m.tags.forEach(function(tag){html += '<span style="font-size:8px;font-weight:600;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.08);color:var(--red);">' + tag + '</span>';});
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Theme groupings (if AI grouped them)
  if(data.themes && data.themes.length>0){
    html += '<div style="font-size:9px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;margin-top:4px;">Key Themes</div>';
    html += '<div style="display:grid;gap:6px;">';
    data.themes.forEach(function(theme,i){
      var colors=['var(--blue)','var(--purple)','var(--cyan)'];var bgs=['rgba(37,99,235,0.05)','rgba(124,58,237,0.05)','rgba(8,145,178,0.05)'];
      var c=colors[i%colors.length],bg=bgs[i%bgs.length];
      html += '<div style="background:'+bg+';border:1px solid '+c+'22;border-radius:6px;padding:8px 12px;border-left:3px solid '+c+';">';
      html += '<div style="font-size:11px;font-weight:800;color:var(--text-primary);">'+(theme.title||'').replace(/</g,'&lt;')+'</div>';
      html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.4;margin-top:2px;">'+(theme.description||'').replace(/</g,'&lt;')+'</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  return html;
}

// Legacy renderer (for old cached data that has themes array only)
function renderLegacyThemesHTML(themes, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:8px;">Generated '+time+' · <a href="#" onclick="localStorage.removeItem(\'mac_themes_\'+new Date().toISOString().split(\'T\')[0]);renderOverview();return false;" style="color:var(--blue);text-decoration:none;">Refresh</a></div>';
  html += '<div style="display:grid;gap:8px;">';
  themes.forEach(function(theme,i){
    var colors=['var(--blue)','var(--purple)','var(--cyan)'];var bgs=['rgba(37,99,235,0.05)','rgba(124,58,237,0.05)','rgba(8,145,178,0.05)'];
    var c=colors[i%colors.length],bg=bgs[i%bgs.length];
    html += '<div style="background:'+bg+';border:1px solid '+c+'22;border-radius:7px;padding:12px 14px;border-left:3px solid '+c+';">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--text-primary);margin-bottom:3px;">'+(theme.title||'Theme '+(i+1)).replace(/</g,'&lt;')+'</div>';
    html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.5;margin-bottom:5px;">'+(theme.description||'').replace(/</g,'&lt;')+'</div>';
    if(theme.tickers&&theme.tickers.length>0){
      html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
      theme.tickers.forEach(function(t){html += '<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+c+'15;color:'+c+';font-family:\'JetBrains Mono\',monospace;">'+t+'</span>';});
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';return html;
}

// ==================== RENDER TOP IDEAS HTML ====================
function renderTopIdeasHTML(ideas, cacheTs) {
  var html='';var time=new Date(cacheTs).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  html += '<div style="font-size:9px;color:var(--text-muted);margin-bottom:8px;">Last scan: '+time+'</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">';
  ideas.forEach(function(idea){
    var sc=idea.score>=80?'var(--green)':idea.score>=60?'var(--blue)':idea.score>=40?'var(--amber)':'var(--text-muted)';
    var sbg=idea.score>=80?'rgba(16,185,129,0.06)':idea.score>=60?'rgba(37,99,235,0.04)':'rgba(245,158,11,0.04)';
    html += '<div style="background:'+sbg+';border:1px solid var(--border);border-radius:8px;padding:12px 14px;border-left:3px solid '+sc+';">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:15px;font-weight:800;font-family:\'JetBrains Mono\',monospace;">'+idea.ticker+'</span>';
    html += '<span style="font-size:11px;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--text-secondary);">$'+(idea.price?idea.price.toFixed(2):'—')+'</span>';
    html += '</div>';
    html += '<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:2px solid '+sc+';font-size:10px;font-weight:900;color:'+sc+';font-family:\'JetBrains Mono\',monospace;">'+idea.score+'</div>';
    html += '</div>';
    if(idea.source) html += '<div style="font-size:8px;color:var(--text-muted);margin-bottom:4px;">via '+idea.source+'</div>';
    if(idea.thesis) html += '<div style="font-size:10px;color:var(--text-secondary);line-height:1.4;margin-bottom:6px;">'+idea.thesis.replace(/</g,'&lt;')+'</div>';
    if(idea.entry||idea.stop||idea.target){
      html += '<div style="display:flex;gap:8px;font-size:8px;font-family:\'JetBrains Mono\',monospace;padding:4px 6px;background:var(--bg-secondary);border-radius:3px;">';
      if(idea.entry) html += '<span style="color:var(--blue);">Entry $'+idea.entry+'</span>';
      if(idea.stop) html += '<span style="color:var(--red);">Stop $'+idea.stop+'</span>';
      if(idea.target) html += '<span style="color:var(--green);">Target $'+idea.target+'</span>';
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';return html;
}

// ==================== GENERATE THEMES (scan movers → news → AI explains WHY) ====================
async function generateThemes() {
  var btn=document.getElementById('generate-themes-btn'),el=document.getElementById('themes-content');
  if(!el)return;if(btn){btn.textContent='Scanning...';btn.disabled=true;}
  el.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:10px;"><span id="theme-progress">Finding biggest movers...</span></div>';

  var anthropicKey='';try{anthropicKey=localStorage.getItem('mtp_anthropic_key')||'';}catch(e){}
  if(!anthropicKey){el.innerHTML='<div style="padding:12px;text-align:center;color:var(--amber);font-size:11px;">Anthropic API key required. Click gear icon to add.</div>';if(btn){btn.textContent='Generate';btn.disabled=false;}return;}

  try{
    // Step 1: Scan a universe of ~80 popular tickers for biggest % movers
    var universe=['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML','WMT','COST','TGT','DIS','PYPL','INTC','DELL','PARA','DUOL','ZS','AXP','RIVN','LCID','NIO','BABA','JD','SE','GRAB','MELI','SPOT','RBLX','U','ABNB','DASH','TTD','ROKU','PINS','SNAP','LYFT','Z'];
    var allSnap={};var prog=document.getElementById('theme-progress');
    for(var bi=0;bi<universe.length;bi+=30){
      if(prog)prog.textContent='Fetching data... ('+(bi+1)+'/'+universe.length+')';
      try{Object.assign(allSnap,await getSnapshots(universe.slice(bi,bi+30)));}catch(e){}
    }

    // Step 2: Rank by absolute % change
    var ranked=[];
    universe.forEach(function(t){
      var s=allSnap[t];if(!s)return;
      var p=s.day&&s.day.c?s.day.c:(s.lastTrade?s.lastTrade.p:0);var prev=s.prevDay?s.prevDay.c:p;
      if(!p||!prev)return;
      var pctVal=((p-prev)/prev)*100;
      ranked.push({ticker:t,price:p,pct:pctVal,absPct:Math.abs(pctVal)});
    });
    ranked.sort(function(a,b){return b.absPct-a.absPct;});

    // Take top ~10 movers (mix of winners and losers)
    var topMovers=ranked.slice(0,12);
    if(topMovers.length===0){el.innerHTML='<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:10px;">No significant movers found.</div>';if(btn){btn.textContent='Generate';btn.disabled=false;}return;}

    // Step 3: Fetch news for each mover ticker
    if(prog)prog.textContent='Fetching news for movers...';
    var moverNews={};
    for(var ni=0;ni<topMovers.length;ni++){
      try{var articles=await getPolygonNews(topMovers[ni].ticker,5);moverNews[topMovers[ni].ticker]=articles.map(function(a){return a.title||'';}).filter(function(t){return t.length>0;});}catch(e){moverNews[topMovers[ni].ticker]=[];}
    }

    // Also get general market news for broader context
    var generalNews=[];
    try{var gn=await getPolygonNews(null,15);generalNews=gn.map(function(a){return (a.title||'')+' ('+((a.tickers||[]).slice(0,3).join(', '))+')';}).filter(function(t){return t.length>2;});}catch(e){}

    // Step 4: Build context for AI
    var moverContext=topMovers.map(function(m){
      var dir=m.pct>0?'UP':'DOWN';
      var tickerNews=moverNews[m.ticker]||[];
      var newsStr=tickerNews.length>0?'\n  Headlines: '+tickerNews.slice(0,3).join('; '):'\n  No specific headlines found.';
      return m.ticker+' '+dir+' '+m.pct.toFixed(1)+'% ($'+m.price.toFixed(2)+')'+newsStr;
    }).join('\n\n');

    // Get market context
    var marketCtx='';
    try{var idxSnap=await getSnapshots(['SPY','QQQ','IWM']);marketCtx=['SPY','QQQ','IWM'].map(function(t){var s=idxSnap[t];if(!s)return t+': N/A';var p=s.day&&s.day.c?s.day.c:0;var prev=s.prevDay?s.prevDay.c:p;return t+': $'+p.toFixed(2)+' ('+(prev>0?((p-prev)/prev*100>=0?'+':'')+((p-prev)/prev*100).toFixed(2)+'%':'N/A')+')';}).join(' | ');}catch(e){}

    if(prog)prog.textContent='AI analyzing movers...';

    // Step 5: Ask Claude to explain WHY each moved
    var prompt='You are a professional market analyst. Here are today\'s biggest stock movers with their associated headlines.\n\nMarket Indices: '+marketCtx+'\n\nBiggest Movers:\n'+moverContext+'\n\nGeneral Headlines:\n'+generalNews.slice(0,8).join('\n')+'\n\nYour task:\n1. For each significant mover, write a 1-2 sentence explanation of WHY it moved (the catalyst).\n2. Group the day\'s action into 2-3 overarching themes (e.g., "AI Infrastructure Boom", "Earnings Season Winners", "Macro Fears").\n3. Write a 1-sentence market narrative summary.\n\nReturn JSON ONLY in this exact format:\n{\n  "narrative": "One sentence market summary",\n  "movers": [\n    {"ticker": "DELL", "pct": 21.8, "direction": "up", "reason": "Crushed Q4 earnings...", "tags": ["Earnings", "AI"]},\n    {"ticker": "DUOL", "pct": -14.0, "direction": "down", "reason": "Weak forward guidance...", "tags": ["Earnings"]}\n  ],\n  "themes": [\n    {"title": "AI Infrastructure Spending Accelerates", "description": "DELL and... drove gains as AI capex surges."}\n  ]\n}\n\nRules:\n- Only include movers that moved >2% and have a clear catalyst.\n- "direction" must be "up" or "down".\n- "pct" should be the actual percentage change (positive number for up, negative for down).\n- "tags" are short category labels like "Earnings", "M&A", "Guidance", "Macro", "AI", etc.\n- Keep reasons concise and trader-focused. No fluff.\n- Return ONLY the JSON object, no other text.';

    var r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2048,messages:[{role:'user',content:prompt}]})});
    if(!r.ok)throw new Error('API '+r.status);
    var data=await r.json();var text=data.content&&data.content[0]?data.content[0].text:'';
    var jsonMatch=text.match(/\{[\s\S]*\}/);if(!jsonMatch)throw new Error('Parse failed');
    var result=JSON.parse(jsonMatch[0]);

    // Cache the result
    result.ts=Date.now();
    try{localStorage.setItem('mac_themes_'+new Date().toISOString().split('T')[0],JSON.stringify(result));}catch(e){}
    el.innerHTML=renderThemesHTML(result,Date.now());
  }catch(e){
    el.innerHTML='<div style="padding:10px;color:var(--red);font-size:10px;">Failed: '+e.message+'</div>';
  }
  if(btn){btn.textContent='Generate';btn.disabled=false;}
}

// ==================== QUICK SCAN ====================
async function runQuickScan() {
  var btn=document.getElementById('quick-scan-btn'),el=document.getElementById('top-ideas-content');
  if(!el)return;if(btn){btn.textContent='Scanning...';btn.disabled=true;}
  el.innerHTML='<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:11px;">Scanning top tickers... <span id="qs-progress"></span></div>';
  try{
    var qt=['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AMD','AVGO','CRM','NFLX','COIN','SNOW','PLTR','DKNG','UBER','SQ','SHOP','NET','CRWD','MU','MRVL','ANET','PANW','NOW','ADBE','ORCL','LLY','UNH','JPM','GS','V','MA','BAC','XOM','CVX','CAT','DE','LMT','BA','MSTR','SOFI','HOOD','RKLB','APP','HIMS','ARM','SMCI','TSM','ASML'];
    var allSnap={};for(var bi=0;bi<qt.length;bi+=30){try{Object.assign(allSnap,await getSnapshots(qt.slice(bi,bi+30)));}catch(e){}}
    var ideas=[];
    for(var qi=0;qi<qt.length;qi++){
      var ticker=qt[qi];var prog=document.getElementById('qs-progress');if(prog)prog.textContent=(qi+1)+'/'+qt.length;
      try{var bars=await getDailyBars(ticker,60);if(bars.length<20)continue;
        var s=allSnap[ticker];var p=0,prev=0;if(s){p=s.day&&s.day.c?s.day.c:(s.lastTrade?s.lastTrade.p:0);prev=s.prevDay?s.prevDay.c:p;}if(!p)continue;
        var closes=bars.map(function(b){return b.c;});var len=closes.length;
        function qSma(pd){if(len<pd)return null;var sm=0;for(var i=len-pd;i<len;i++)sm+=closes[i];return sm/pd;}
        var sma10=qSma(10),sma20=qSma(20),sma50=qSma(50);if(!sma10||!sma20)continue;
        var spread=Math.abs(sma10-sma20)/p*100;var aboveBoth=p>sma10&&p>sma20;var ext=((p-sma20)/sma20)*100;
        var rvol=null;if(bars.length>=21){var avgV=bars.slice(-21,-1).reduce(function(sum,b){return sum+(b.v||0);},0)/20;var tV=s&&s.day?s.day.v:0;if(avgV>0&&tV>0)rvol=tV/avgV;}
        var score=0;if(spread<=1)score+=30;else if(spread<=2)score+=22;else if(spread<=3)score+=15;else if(spread<=5)score+=8;else continue;
        if(aboveBoth)score+=15;if(sma50&&p>sma50)score+=10;
        if(ext<=2)score+=25;else if(ext<=4)score+=18;else if(ext<=6)score+=10;else if(ext<=8)score+=4;else score-=5;
        if(rvol){if(rvol>=2)score+=10;else if(rvol>=1.5)score+=7;else if(rvol>=1)score+=4;}
        var dayChg=prev>0?((p-prev)/prev)*100:0;if(dayChg>1)score+=5;else if(dayChg>0)score+=2;
        score=Math.round(Math.min(100,Math.max(0,score)));if(score<30)continue;
        var thesis='';if(spread<=2)thesis+='Tight compression ('+spread.toFixed(1)+'%). ';if(aboveBoth)thesis+='Above 10/20 SMA. ';if(ext<=3)thesis+='Near base ('+ext.toFixed(1)+'%). ';if(rvol&&rvol>=1.5)thesis+=rvol.toFixed(1)+'x volume. ';
        ideas.push({ticker:ticker,price:p,score:score,source:'Compression',thesis:thesis,entry:p.toFixed(2),stop:(sma20*0.98).toFixed(2),target:(p+(p-sma20*0.98)*2).toFixed(2)});
      }catch(e){continue;}
    }
    ideas.sort(function(a,b){return b.score-a.score;});ideas=ideas.slice(0,4);
    try{localStorage.setItem('mac_top_ideas_'+new Date().toISOString().split('T')[0],JSON.stringify({ideas:ideas,ts:Date.now()}));}catch(e){}
    el.innerHTML=ideas.length>0?renderTopIdeasHTML(ideas,Date.now()):'<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:10px;">No strong setups found. Try full scanners.</div>';
  }catch(e){el.innerHTML='<div style="color:var(--red);font-size:10px;">Scan failed: '+e.message+'</div>';}
  if(btn){btn.textContent='Quick Scan';btn.disabled=false;}
}

// ==================== ECONOMIC CALENDAR ====================
async function loadEconCalendar() {
  var el=document.getElementById('econ-cal-grid');if(!el)return;
  var today=new Date();var dow=today.getDay();var monday=new Date(today);monday.setDate(today.getDate()-(dow===0?6:dow-1));
  var cacheKey='mtp_econ_cal_ff_'+monday.toISOString().split('T')[0];
  var saved=null;try{var raw=localStorage.getItem(cacheKey);if(raw)saved=JSON.parse(raw);}catch(e){}
  if(saved&&saved.text){renderPastedCal(el,saved.text,saved.ts);}else{showCalPasteBox(el);}
}
function showCalPasteBox(el) {
  el.innerHTML='<div style="padding:4px 0;"><textarea id="econ-cal-paste" placeholder="Paste USD events (Medium + High impact) from economic calendar here..." style="width:100%;height:60px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:5px;padding:6px;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--text-primary);resize:vertical;box-sizing:border-box;line-height:1.4;"></textarea><button onclick="saveEconCal()" style="margin-top:4px;padding:4px 12px;border-radius:4px;border:1px solid var(--green);background:rgba(0,135,90,0.08);color:var(--green);cursor:pointer;font-size:9px;font-weight:700;">Save</button></div>';
}
function saveEconCal() {
  var ta=document.getElementById('econ-cal-paste');if(!ta||!ta.value.trim())return;
  var today=new Date();var dow=today.getDay();var monday=new Date(today);monday.setDate(today.getDate()-(dow===0?6:dow-1));
  var ck='mtp_econ_cal_ff_'+monday.toISOString().split('T')[0];
  try{localStorage.setItem(ck,JSON.stringify({text:ta.value.trim(),ts:Date.now()}));}catch(e){}
  renderPastedCal(document.getElementById('econ-cal-grid'),ta.value.trim(),Date.now());
}
function clearEconCal() {
  var today=new Date();var dow=today.getDay();var monday=new Date(today);monday.setDate(today.getDate()-(dow===0?6:dow-1));
  try{localStorage.removeItem('mtp_econ_cal_ff_'+monday.toISOString().split('T')[0]);}catch(e){}
  showCalPasteBox(document.getElementById('econ-cal-grid'));
}
function renderPastedCal(el,text,ts) {
  var lines=text.split('\n').map(function(l){return l.trim();}).filter(function(l){return l.length>0;});
  var events=[];var i=0;
  while(i<lines.length){var line=lines[i];
    if(line==='USD'){i++;continue;}if(/^\d{1,2}:\d{2}(am|pm)$/i.test(line)){i++;continue;}
    if(/[a-zA-Z]{3,}/.test(line)&&!/^\d/.test(line)){var ev={name:line,details:''};var dl=[];var j=i+1;
      while(j<lines.length){var nx=lines[j];if(nx==='USD')break;if(/[a-zA-Z]{3,}/.test(nx)&&!/^[\d\-]/.test(nx)&&!/^\d{1,2}:\d{2}/.test(nx)&&!/%|[KMB]$/.test(nx))break;dl.push(nx);j++;}
      if(dl.length>0)ev.details=dl.join(' · ');events.push(ev);i=j;
    }else{i++;}
  }
  var html='';
  if(events.length>0){events.forEach(function(ev){
    var name=ev.name.toLowerCase();var isHigh=/gdp|pce|cpi|nonfarm|payroll|fomc|fed fund|interest rate|unemployment rate|retail sales|ism manu/.test(name);
    var isMed=/pmi|housing|home sale|consumer confidence|jobless|claim|durable|sentiment|philly|empire|pending|trump speaks|president/.test(name);
    var dot=isHigh?'var(--red)':isMed?'var(--amber)':'var(--text-muted)';
    html += '<div style="display:flex;gap:5px;align-items:flex-start;margin-bottom:3px;font-size:9px;">';
    html += '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:'+dot+';flex-shrink:0;margin-top:3px;"></span>';
    html += '<span style="color:var(--text-primary);font-weight:600;">'+ev.name+'</span>';
    if(ev.details) html += '<span style="color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;font-size:8px;">'+ev.details+'</span>';
    html += '</div>';
  });}else{html += '<div style="white-space:pre-wrap;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--text-secondary);">'+text.replace(/</g,'&lt;')+'</div>';}
  html += '<div style="margin-top:4px;display:flex;justify-content:space-between;font-size:8px;color:var(--text-muted);">';
  html += '<span>Saved '+new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})+'</span>';
  html += '<button onclick="clearEconCal()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:1px 6px;font-size:7px;color:var(--text-muted);cursor:pointer;">Update</button>';
  html += '</div>';
  el.innerHTML=html;
}
