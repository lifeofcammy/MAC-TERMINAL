// ==================== SEED FEB 20 TRADES + ANALYSIS ====================
(function() {
  // Seed journal with Feb 20 trades
  var journal = [];
  try { journal = JSON.parse(localStorage.getItem('mtp_journal') || '[]'); } catch(e) {}
  var hasFeb20 = journal.some(function(t) { return t.date === '2026-02-20'; });
  if (!hasFeb20) {
    var feb20trades = [
      { id: 'T20260220_001', date: '2026-02-20', ticker: 'SPY', strategy: 'Put Spread', direction: 'short',
        entry: 0.85, exit: 0.15, pl: 350, contracts: 5, entryTime: '08:35', exitTime: '09:12',
        holdMinutes: 37, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 595, longStrike: 592.5,
        notes: 'Morning put spread scalp #1. Support held. Closed for max profit. System trade.' },
      { id: 'T20260220_002', date: '2026-02-20', ticker: 'QQQ', strategy: 'Put Spread', direction: 'short',
        entry: 0.55, exit: 0.10, pl: 225, contracts: 5, entryTime: '08:40', exitTime: '09:20',
        holdMinutes: 40, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 510, longStrike: 507.5,
        notes: 'Morning put spread scalp #2. QQQ above support on SCOTUS tariff relief.' },
      { id: 'T20260220_003', date: '2026-02-20', ticker: 'GOOGL', strategy: 'Put Spread', direction: 'short',
        entry: 0.82, exit: 0.40, pl: 210, contracts: 5, entryTime: '08:46', exitTime: '09:55',
        holdMinutes: 69, isWin: true, dte: 0, strikeWidth: 2.5, shortStrike: 305, longStrike: 302.5,
        notes: 'Morning put spread scalp #3. GOOGL preferred put-sell candidate around $305-315. Clean setup.' },
      { id: 'T20260220_004', date: '2026-02-20', ticker: 'MSFT', strategy: 'Long Call', direction: 'long',
        entry: 4.25, exit: 0.75, pl: -850, contracts: 2, entryTime: '10:30', exitTime: '15:45',
        holdMinutes: 315, isWin: false, dte: 2, strikeWidth: 0, shortStrike: 0, longStrike: 0,
        notes: 'RULE #3 VIOLATION. Impulsive long call after morning session ended. MSFT in structural downtrend (-18% YTD). Broke every rule. This erased the mornings +$785.' }
    ];
    journal = journal.concat(feb20trades);
    try { localStorage.setItem('mtp_journal', JSON.stringify(journal)); } catch(e) {}
  }

  // Seed analysis with real Feb 23 data
  var key23 = 'mtp_analysis_2026-02-23';
  var exists23 = false;
  try { exists23 = !!localStorage.getItem(key23); } catch(e) {}
  if (!exists23 && !_analysisCache['2026-02-23']) {
    var feb23 = {
      marketContext: "UGLY SESSION. S&P 500 dropped 1.04% to 6,837.75 — now negative for 2026. Dow hammered -1.66% (-822 pts) to 48,804. Nasdaq -1.13% to 22,627. Two catalysts collided: (1) Trump raised global tariffs to 15% under Section 122 of the Trade Act after SCOTUS struck down IEEPA reciprocal tariffs on Friday. EU immediately paused trade deal ratification. (2) AI disruption fear trade intensified — Anthropic launched Claude Code Security tool, triggering a second day of cybersecurity carnage. Financials got destroyed on Saba Capital/Cox Capital activist plays against Blue Owl credit funds. Gold exploded to $5,177+ on safe-haven demand. 10Y yield dipped to 4.06%. VIX spiked. This was a RISK-OFF session — defensive names (WMT +2.3%, LLY +4.9%) were the only green. IV expanded significantly across software, cybersecurity, and financials — prime environment for put SELLING on the fear spike.",

      movers: [
        { ticker: 'IBM', changePct: -13.1, sector: 'Technology', catchable: 'yes',
          why: 'Anthropic launched Claude Code Security tool. Market repriced IBM as AI disruption victim — biggest Dow drag. Massive volume day.',
          lesson: 'AI disruption headlines create panic selling in incumbent tech. IBM dropped to $223 — these moves tend to overshoot on day 1. Watch for a 2-3 day bounce setup as shorts cover. Could have sold call spreads above the gap for easy premium.' },
        { ticker: 'CRWD', changePct: -9.8, sector: 'Cybersecurity', catchable: 'yes',
          why: 'Second day of selling after Anthropic Claude Code Security announcement. Entire cybersecurity sector repriced — BUG ETF -4%. Zscaler also -10%. CEO Kurtz defended moat on LinkedIn over weekend but market didnt care.',
          lesson: 'CRWD now 16.8% below 20-day SMA and 27% below 100-day SMA. RSI at 35 — approaching oversold. Earnings March 3. This is setting up as a massive mean-reversion trade. When fear-driven selling pushes quality names this far below moving averages, selling puts into elevated IV is the play. Watch $340 support — if it holds through the week, sell put spreads below it.' },
        { ticker: 'AXP', changePct: -7.2, sector: 'Financials', catchable: 'partial',
          why: 'Research report warning of massive AI-driven unemployment spooked payment/fintech names. AXP was largest Dow decliner after IBM. Also hit by broader financials selloff.',
          lesson: 'Financials sector -3% was the worst performing group. When AI fear + activist hedge fund news hit financials simultaneously, the move gets amplified. The AI unemployment thesis is a narrative trade — these tend to fade within 48-72hrs.' },
        { ticker: 'WMT', changePct: 2.3, sector: 'Consumer Staples', catchable: 'yes',
          why: 'Classic flight to defensive quality. WMT was one of few green names in a sea of red. Tariff concerns actually benefit WMT near-term as consumers trade down.',
          lesson: 'On major risk-off days, WMT and staples are the put-selling sweet spot. IV expands even on winners because of index-level VIX spike. WMT puts were likely overpriced relative to its actual risk — free money for put sellers.' },
        { ticker: 'LLY', changePct: 4.9, sector: 'Healthcare', catchable: 'partial',
          why: 'Healthcare was a defensive rotation beneficiary. LLY rallied nearly 5% (+$49) to $1,058 while everything else bled. GLP-1 momentum continues.',
          lesson: 'LLY has become a safe haven trade. On risk-off days, it attracts rotation flows. The $1,000 level is strong psychological support. If you see another fear day this week, LLY puts below $1,000 are high-probability premium collection.' },
        { ticker: 'PYPL', changePct: 5.8, sector: 'Fintech', catchable: 'no',
          why: 'Counter-trend move while AXP got destroyed. Possible rotation into cheaper fintech plays or short covering. Surprising strength given the AI disruption narrative hitting payments.',
          lesson: 'When a sector is under broad pressure but one name goes green, pay attention — it usually signals institutional accumulation or a catalyst the market hasnt fully priced. PYPL divergence from AXP is notable.' },
        { ticker: 'NVDA', changePct: 1.7, sector: 'Semiconductors', catchable: 'partial',
          why: 'Slight green into earnings Wednesday (Feb 25). Goldman raised PT to $200, Wells Fargo raised to $220. IV at 50 (52-week range 32-75). Market treating NVDA as the one must-own AI name even on a risk-off day.',
          lesson: 'NVDA holding green on a -1% SPY day ahead of earnings = massive relative strength. The options market is pricing a big move. Call/put ratio 1.6:1. Do NOT sell puts into earnings — the binary risk is too high. Wait for post-earnings IV crush to sell premium.' },
        { ticker: 'BE', changePct: 8.5, sector: 'AI Power Infrastructure', catchable: 'yes',
          why: 'Bloom Energy ripped +8.5% to $160.14 while SPY dropped 1%. AI data center power demand theme continues — $600B hyperscaler capex in 2026. Up 80% YTD, 465% over past year. $20B backlog, $5B Brookfield deal, 4 consecutive quarters of record revenue. This is THE relative strength leader on the board.',
          lesson: 'MISSED OPPORTUNITY. +8.5% on a red tape day = institutional accumulation. The signal was clear at the open: when a momentum name gaps UP on a gap-DOWN tape, you buy calls on the morning dip or sell puts below the prior close ($147.55). The $145-150 area was a layup for put spreads. We need to have BE and the AI power names (OKLO, VST, CEG, NRG, SMR) on the daily watchlist. A stock with this range and options liquidity is a prime target for our system.' },
        { ticker: 'IREN', changePct: -7.6, sector: 'AI/BTC Infrastructure', catchable: 'no',
          why: 'IREN (fka Iris Energy) sold from $43.29 to ~$40. BTC-to-AI pivot story — 4.5GW of secured power capacity, AI Cloud segment +137%, but missed earnings badly (-$0.52 vs -$0.11 est). Tariff selloff hit AI neo-cloud names. Down 48% from $76.87 high.',
          lesson: 'Not our trade right now. Missed earnings, identity crisis (BTC mining revenue -23%), and wild $5 intraday swings. The pivot thesis is interesting long-term but execution risk is too high for put selling. Revisit when it establishes a base. File under: watch but dont touch.' },
        { ticker: 'USAR', changePct: -1.7, sector: 'Critical Minerals', catchable: 'no',
          why: 'USA Rare Earth continues bleeding — closed at ~$16.96, down from $44 peak in October. Zero revenue, going concern warnings, Stillwater production delayed from 2023 to H1 2026. Rare earth sector under pressure from activist shorts. $3.1B gov deal is the bull case. EARNINGS TUESDAY FEB 25.',
          lesson: 'Binary event tomorrow — do not trade ahead of earnings on a zero-revenue company with going concern warnings. The rare earth / Project Vault thesis is compelling but this is a spec play, not a premium-selling candidate. If earnings show commercial production progress and stock stabilizes above $17, could become interesting. If it misses, knife falls further.' }
      ],

      sectorRotation: "MONEY FLOWING INTO: Consumer Staples (WMT +2.3% — defensive rotation + tariff consumer trade-down thesis), Healthcare (LLY +4.9%, defensive quality), Gold/Precious Metals (Gold hit $5,177, up 3%+ — safe haven demand exploding on tariff uncertainty), Treasuries (10Y yield down to 4.06%, 2Y to 3.48% — classic risk-off bid).\n\nMONEY FLOWING OUT OF: Financials (-3% — WORST sector. KKR -9%, Blackstone -7%, Blue Owl -5% on Saba Capital activist news. AXP -7.2%, GS -4% on AI unemployment fears), Cybersecurity (BUG ETF -4%, CRWD/ZS -10%, Fortinet/Okta -5%+ — Anthropic Claude Code Security disruption fear), Software (IBM -13%, DDOG -11%, ORCL -4%, PLTR -4% — AI replacement narrative), Small Caps (IWM outsized losses, risk-off disproportionately hits small caps).\n\nNOTABLE: The Magnificent Seven is now DOWN 5% for 2026. MSFT -18% YTD, TSLA and AMZN each -8%+. Equal-weight S&P outperforming cap-weighted by 11%+ YTD. This is a massive regime shift — the market is telling you to be in industrials, staples, and commodities, not mega-cap tech. The tariff trade is NOT over despite SCOTUS ruling.",

      patterns: "DEVELOPING:\n• AI DISRUPTION FEAR TRADE (Day 2): Anthropic Claude Code Security launched Friday, cybersecurity/software selling accelerated Monday. This pattern (new AI capability → sector panic → 2-3 day selloff → mean reversion) has repeated multiple times. CRWD earnings March 3 creates a natural catalyst for the bounce. Watch for exhaustion selling Tuesday.\n• TARIFF WHIPSAW CYCLE: SCOTUS strikes down IEEPA tariffs Friday → markets rally → Trump pivots to Section 122 (15% global) over weekend → Monday selloff. The Section 122 has a 150-day clock requiring Congressional approval to extend. Summer 2026 showdown is now on the calendar. Markets will oscillate on every tariff headline.\n• GOLD PARABOLIC RUN: $5,177 today. Was $4,652 just 3 weeks ago. Thats an 11% move in gold in under a month. Driven by: tariff uncertainty, Iran tensions (your thesis), global de-dollarization narrative. Your miners watchlist (FSM, AG, PAAS, WPM) should be catching a bid. This is a MULTI-WEEK trend, not a 1-day trade.\n• VIX EXPANSION: VIX spiked from ~19 on Friday to elevated levels Monday. This is PUT SELLER PARADISE — elevated IV means fatter premiums. Your morning put spread scalps should see better risk/reward this week.\n• MAG 7 BREAKDOWN: Down 5% YTD as a group while equal-weight SPX is +6.4%. Breadth rotation into industrials and commodities is the dominant 2026 theme. This is late-cycle behavior.\n\nFADING:\n• The Friday SCOTUS rally — completely reversed and then some. Proves that tariff uncertainty is structural, not event-driven.\n• Small cap bounce thesis — IWM continues to underperform on every risk-off day.",

      missed: "CRWD PUT SPREADS: CRWD dropped 10% on Day 2 of the AI fear selloff. But by mid-afternoon the selling was exhausting. If you had waited for the 2pm-3pm stabilization zone and sold put spreads below $340 for Wednesday expiry, you could have collected massive premium with IV at extreme levels. The stock is approaching oversold RSI territory. Lesson: On Day 2 of fear selling, dont chase the short — sell premium into the fear.\n\nWMT CALLS / PUT SELLING: WMT was clearly the safe-haven play from the open. When SPY gaps down -0.5%+ and WMT gaps UP, thats a screaming signal. Selling puts on WMT at the open would have been a layup — zero stress, defensive name, premium inflated by index VIX.\n\nIBM CALL SPREADS: IBM gapped down 13% — the largest single-day drop in years. Could have sold call spreads above $240 (the gap level) for easy premium. The gap will act as resistance for weeks. This was a textbook gap-and-trap setup.\n\nGOLD MINERS: Your watchlist (FSM, AG, PAAS, WPM) — gold hit $5,177. These miners should be catching a sympathy bid. Did you have positions? If not, the gold trend is multi-week. Tuesday dip would be an entry.\n\nAction items: (1) On fear spike days, your #1 priority should be selling premium into elevated IV — not directional bets. (2) Defensive names (WMT, LLY) become put-selling layups on risk-off days. (3) Day 2 of sector panic = start looking for mean reversion entries.",

      tomorrowWatch: "PRIORITY SETUPS — TUESDAY FEB 24:\n\n★ BE (BLOOM ENERGY) — DIGESTION PLAY:\nAfter +8.5% Monday, expect consolidation. The pattern: big move → digestion → continuation or reversal. BE closed at $160, prior close was $147.55.\n• BULL CASE: If BE holds above $155 in pre-market and dips to $155-158 range in first 30min, sell put spreads below $150. IV will still be elevated from Mondays move. The $145-150 zone is strong support (Fridays close level). This is the highest-conviction new setup.\n• BEAR CASE: If it gaps below $155, stand aside — that signals profit-taking and the pullback could extend to $145. Dont catch the knife.\n• Also watch the AI power complex: OKLO, VST, CEG, NRG, SMR for sympathy setups.\n\n★ CRWD PUT SPREADS — DAY 3 OF FEAR SELLOFF:\nCRWD at $350, down 10% Monday, 16.8% below 20-day SMA. RSI approaching oversold at 35. Anthropic enterprise briefing Tuesday could extend selling OR mark the exhaustion point.\n• If CRWD stabilizes $340-350 in first 30min, sell put spreads below $330 for Friday expiry. IV is extreme = fat premium.\n• Earnings not until March 3, so no binary event this week.\n• Watch for Kurtz or analyst defense notes — any positive headline becomes the bounce catalyst.\n\n★ WMT — DEFENSIVE PUT SELLING:\nWMT +2.3% Monday on defensive rotation. If another risk-off day, WMT gets bid again.\n• Sell puts below $126 support. Premium inflated by index VIX even though WMT itself isnt volatile. Layup setup.\n\n★ SPY/QQQ MORNING SCALPS:\nCore system trade. Before 10am. VIX elevated = fatter premiums this week.\n• SPY: sell put spreads below 6,780 support on morning dip.\n• QQQ: sell put spreads below 510 on morning weakness.\n• GOOGL: your preferred name. Sell puts below $300 if it dips on tape weakness.\n\nDO NOT TRADE:\n• NVDA — Earnings Wednesday after close. Binary event. Wait for post-earnings IV crush.\n• USAR — Earnings Tuesday. Zero revenue company with going concern warnings. Pure gamble.\n• IREN — No established base. Wild swings. Not our system.",

      probabilityMap: [
        { ticker: 'CRWD', probability: 80, tier: 1, direction: 'both', catalyst: 'Anthropic Briefing + Day 3 Fear',
          thesis: 'Day 3 of AI fear selloff. 27% below 100-day SMA, RSI 35. Anthropic enterprise briefing Tuesday is the binary catalyst — either extends panic or marks exhaustion. Entire cybersecurity complex (ZS, FTNT, OKTA, PANW) follows. Volume has been 2-3x average for two days.',
          keyLevels: 'Support: $340 | Resistance: $370 | Gap fill target: $390',
          optionsPlay: 'Sell put spreads below $330 for Friday if stabilizes. Or straddle $350 for binary move.' },
        { ticker: 'BE', probability: 75, tier: 1, direction: 'long', catalyst: 'Digestion after +8.5%',
          thesis: '+8.5% on a -1% SPY day = massive institutional buying. Digestion pattern: big move → consolidation → continuation or reversal. AI power demand narrative has no ceiling. $20B backlog, $600B hyperscaler capex. Options liquid, wide intraday ranges.',
          keyLevels: 'Support: $150-152 (Friday close) | Digestion zone: $155-160 | Continuation: $165+',
          optionsPlay: 'Sell put spreads below $150 on morning dip. If holds $155+ pre-market, high conviction.' },
        { ticker: 'HD', probability: 70, tier: 1, direction: 'both', catalyst: 'Earnings pre-market Tuesday',
          thesis: 'Confirmed earnings catalyst. Revenue expected -3.9% YoY but prediction markets 86% chance of EPS beat. Tariff whipsaw helps and hurts: SCOTUS ruling lowered import costs Friday, but 15% Section 122 tariffs raised them Monday. $377 stock, 50-day SMA at $369.',
          keyLevels: 'Support: $365 (50-day SMA) | Resistance: $390 | Gap up target: $395+',
          optionsPlay: 'Dont trade into earnings. Watch for post-report setup. If beats + guides well, sell puts on the pullback.' },
        { ticker: 'IBM', probability: 65, tier: 2, direction: 'long', catalyst: 'Dead cat bounce after -13%',
          thesis: 'Biggest single-day drop in years. Day 2 after gap-downs of this magnitude always produce oversized moves. Shorts will take profits. But Anthropic briefing Tuesday could add more AI disruption fuel and extend selling.',
          keyLevels: 'Resistance: $230-235 (old support = new resistance) | Support: $218 | Friday gap: $257',
          optionsPlay: 'Sell call spreads above $240 if it bounces. The gap at $257 is long-term resistance.' },
        { ticker: 'ZS', probability: 65, tier: 2, direction: 'both', catalyst: 'Cybersecurity sympathy + oversold',
          thesis: 'Dropped 10% Monday in sympathy with CRWD. More AI-vulnerable perception than CRWD. If Anthropic briefing is exhaustion point, ZS bounces harder on relative basis. If fear extends, ZS has most downside.',
          keyLevels: 'Watch for CRWD to lead direction. ZS follows with higher beta.',
          optionsPlay: 'Same as CRWD — sell put spreads if cybersecurity stabilizes Tuesday morning.' },
        { ticker: 'FSM', probability: 60, tier: 2, direction: 'long', catalyst: 'Gold $5,177 + Iran tensions',
          thesis: 'Gold parabolic at $5,177. Miners lagging the move — when underlying commodity breaks to new highs and miners havent caught up, snap higher comes in bursts. Iran rhetoric adds second catalyst. Entire precious metals complex (AG, PAAS, WPM) is correlated.',
          keyLevels: 'Watch gold — if holds above $5,100, miners catch a bid. If gold pulls back, miners drop fast (higher beta).',
          optionsPlay: 'Buy calls on morning dip if gold holds. Or sell puts below recent support. Small position sizing — miners are volatile.' },
        { ticker: 'USAR', probability: 55, tier: 3, direction: 'both', catalyst: 'Earnings Tuesday',
          thesis: 'Binary earnings event on zero-revenue company. Could gap 15% either direction on Stillwater production news. Not tradeable with our system. Watch for post-earnings setup only.',
          keyLevels: 'Support: $15 | Resistance: $20 | 52-week high: $44',
          optionsPlay: 'DO NOT TRADE. Watch only. Revisit after earnings if stabilizes above $17.' },
        { ticker: 'NVDA', probability: 50, tier: 3, direction: 'long', catalyst: 'Coiling before Wed earnings',
          thesis: 'Probably tight range Tuesday as everyone positions for Wednesday. The big move comes Wednesday after-hours/Thursday. Suppressing vol across all of tech Tuesday.',
          keyLevels: 'Goldman PT: $200 | Wells Fargo PT: $220 | IV at 50 (range 32-75)',
          optionsPlay: 'DO NOT TRADE pre-earnings. Wait for post-earnings IV crush Thursday. Then sell puts on the pullback if they beat.' }
      ],

      watchlist: [
        { theme: 'AI Power Infrastructure', status: 'active',
          tickers: ['BE', 'OKLO', 'VST', 'CEG', 'NRG', 'SMR'],
          note: 'THE leadership theme of 2026. BE +80% YTD, up 8.5% on a red day Monday. $600B hyperscaler capex flowing into data center power. Wide intraday ranges + options liquidity = prime for our system. Daily monitoring.' },
        { theme: 'Cybersecurity Fear Trades', status: 'active',
          tickers: ['CRWD', 'ZS', 'PANW', 'FTNT', 'OKTA', 'NET'],
          note: 'Day 2-3 of AI disruption selloffs = premium selling paradise. IV expansion on quality names pushed below key SMAs. Mean reversion within 3-5 days historically. Sell puts into the fear, dont buy direction.' },
        { theme: 'Gold & Precious Metals Miners', status: 'active',
          tickers: ['FSM', 'AG', 'PAAS', 'WPM', 'GLD', 'SLV'],
          note: 'Gold at $5,177 and parabolic. Iran tensions + tariff uncertainty + de-dollarization. Multi-week trend confirmed. Miners lagging gold = catch-up potential. Your original thesis is playing out.' },
        { theme: 'Defensive Put Selling', status: 'active',
          tickers: ['WMT', 'LLY', 'COST', 'PG', 'JNJ', 'MCD'],
          note: 'On risk-off days, these get bid while everything else bleeds. IV inflated by index VIX even on winners = free money for put sellers. WMT +2.3%, LLY +4.9% on Monday while SPY -1%.' },
        { theme: 'Tariff Beneficiary Basket', status: 'watch',
          tickers: ['NKE', 'LULU', 'DECK', 'TGT', 'WMT', 'COST'],
          note: 'SCOTUS struck IEEPA tariffs but Trump replaced with Section 122 15%. Net effect unclear. These names whipsawed Thurs-Mon. Watch for stabilization before deploying. Thesis still valid but timing is headline-dependent.' },
        { theme: 'Morning Scalp Core', status: 'active',
          tickers: ['SPY', 'QQQ', 'GOOGL'],
          note: 'Bread and butter. Morning put spread scalps before 10am = highest win rate. VIX elevated this week = fatter premiums. 3/3 on Thursday Feb 20. This is the foundation — everything else is layered on top.' }
      ],

      mindset: {
        violations: [
          { rule: 'Rule #3 — Stick to Plan', detail: 'MSFT impulsive long call on Thursday Feb 20. Entered after 10am, on a stock in structural downtrend (-18% YTD). Cost -$850 and erased entire mornings +$785. This is the most violated rule in our system.' }
        ],
        wins: [
          '3/3 morning put spread scalps on Thursday — SPY, QQQ, GOOGL. All before 10am. System worked perfectly.',
          'Did NOT trade Monday Feb 23 — if we followed the system, cash was the right position on a gap-down Monday with headline chaos. Rule #18 respected.',
          'Correctly identified tariff whipsaw pattern from Friday → Monday.'
        ],
        score: 6,
        scoreNote: 'Morning system is A+. Afternoon discipline is the problem. The MSFT trade drops this from 9/10 to 6/10. One trade destroyed the session. Fix: hard stop at 10am unless pre-planned setup triggers.'
      }
    };
    _analysisCache['2026-02-23'] = feb23;
    try { localStorage.setItem('mtp_analysis_2026-02-23', JSON.stringify(feb23)); } catch(e) {}
  }

  // Keep Feb 20 demo for history
  var key20 = 'mtp_analysis_2026-02-20';
  var exists20 = false;
  try { exists20 = !!localStorage.getItem(key20); } catch(e) {}
  if (!exists20 && !_analysisCache['2026-02-20']) {
    var feb20 = {
      marketContext: "S&P rallied +0.7% to 6,909 on SCOTUS striking down IEEPA tariffs. Nasdaq +0.9% to 22,886. Dow +0.5%. VIX crushed to 19.09 (-5.6%). Relief rally across the board — AMZN +2.6% led the Dow. Financials, comm services, and consumer discretionary all green. Energy only lagging sector (-0.7%). Clean trending day for put sellers. Your 3/3 morning put spread scalps banked +$785 before 10am. Then the MSFT impulsive long call violated Rule #3 and gave back $850. Net day: -$65.",

      movers: [
        { ticker: 'AMZN', changePct: 2.6, sector: 'Consumer Discretionary', catchable: 'yes',
          why: 'Led the Dow higher on SCOTUS tariff relief. Import-heavy businesses like AMZN were the biggest beneficiaries of the ruling.',
          lesson: 'When tariffs get reduced/eliminated, the first movers are import-heavy retailers and e-commerce. AMZN, WMT, TGT all benefited. This is the tariff beneficiary basket you identified.' },
        { ticker: 'SPY', changePct: 0.7, sector: 'Index', catchable: 'yes',
          why: 'Broad relief rally on SCOTUS ruling. 9 of 11 sectors green. Classic risk-on day.',
          lesson: '3/3 on morning put spread scalps = system works when you follow it. The MSFT long call after 10am broke every rule. Morning scalps before 10am are the edge — stop trading after.' },
        { ticker: 'MSFT', changePct: -0.5, sector: 'Technology', catchable: 'no',
          why: 'Faded after initial pop. MSFT now -18% YTD. The impulsive long call was a Rule #3 violation.',
          lesson: 'MSFT is in a structural downtrend (-18% YTD). Buying calls on a stock in a downtrend on a whim is the exact opposite of the system. This trade cost $850 and erased the mornings gains. Write this on the wall: NO IMPULSIVE LONG CALLS.' }
      ],

      sectorRotation: "MONEY FLOWING INTO: Communication Services (XLC +2.7%), Consumer Discretionary (XLY +1.3%), Financials (XLF +0.7%) — all tariff relief beneficiaries.\n\nMONEY FLOWING OUT OF: Energy (XLE -0.7% — only red sector), VIX (crushed 5.6% to 19.09).\n\nNOTABLE: The SCOTUS ruling was supposed to be the catalyst for sustained rally. Instead it lasted exactly one session before Trump pivoted to Section 122 tariffs over the weekend. The Friday rally was a trap.",

      patterns: "DEVELOPING:\n• Tariff beneficiary basket (NKE, LULU, DECK, TGT, WMT, COST) rallied on SCOTUS ruling but gave it all back Monday. The thesis is right but the timing window is narrow — these names move on headlines, not fundamentals.\n• Morning put spread scalps continue to be the highest-probability setup. 3/3 today before 10am. The data is overwhelming — your best win rate is in the first 90 minutes.\n\nFADING:\n• Any sustained rally thesis from the SCOTUS ruling — Trump replaced IEEPA tariffs with Section 122 within 48 hours. The tariff regime is structural, not going away.",

      missed: "The only missed opportunity was NOT stopping after the morning scalps. +$785 by 9:55am. Then gave back $850 on an impulsive MSFT long call. If you had closed the terminal at 10am, you finish +$785. Instead, -$65.\n\nAction item: Set a hard rule — if morning scalps hit target, CLOSE THE TERMINAL. The afternoon is where your losses come from.",

      tomorrowWatch: "WEEKEND RISK: Trump likely to respond to SCOTUS ruling with alternative tariff mechanism. Watch Truth Social for announcements.\n\nMONDAY SETUP: If tariff headlines cause a gap down, morning put spread scalps on SPY/QQQ in the first 30min. IV will likely expand over the weekend = fatter premiums.\n\nRULE #3 ENFORCEMENT: No trades after 10am unless a pre-planned setup triggers. The afternoon MSFT trade was the exact pattern that needs to stop.",

      probabilityMap: [
        { ticker: 'SPY', probability: 70, tier: 1, direction: 'short', catalyst: 'Weekend tariff headline risk',
          thesis: 'Trump will respond to SCOTUS ruling. Whatever he announces will gap SPY down Monday. Sell put spreads on the gap down in first 30min.',
          keyLevels: 'Support: 6,850 | Resistance: 6,920 | VIX trigger: 20+',
          optionsPlay: 'Morning put spread scalps below 6,830. This is your highest win-rate setup.' },
        { ticker: 'CRWD', probability: 55, tier: 2, direction: 'short', catalyst: 'Anthropic Claude Code Security launched Friday',
          thesis: 'Cybersecurity names sold Friday on Anthropic launch. If selling extends Monday, Day 2 = start watching for exhaustion. IV expanding.',
          keyLevels: 'Support: $360 | Prior support: $350 | 20-day SMA: ~$420',
          optionsPlay: 'Wait for Monday action. If Day 2 selloff, sell puts Tuesday into peak fear.' }
      ],

      watchlist: [
        { theme: 'Tariff Beneficiary Basket', status: 'active',
          tickers: ['NKE', 'LULU', 'DECK', 'TGT', 'WMT', 'COST'],
          note: 'SCOTUS ruling is the catalyst. These names rallied Friday. Watch for follow-through or reversal Monday depending on Trumps response.' },
        { theme: 'Morning Scalp Core', status: 'active',
          tickers: ['SPY', 'QQQ', 'GOOGL'],
          note: '3/3 today. System works. Dont mess with it. Stop trading after 10am.' }
      ],

      mindset: {
        violations: [
          { rule: 'Rule #3 — Stick to Plan', detail: 'MSFT long call at 10:30am. Structural downtrend stock (-18% YTD). Impulsive entry with no setup. Cost -$850 and wiped the mornings +$785. Net day: -$65.' }
        ],
        wins: [
          '3/3 morning put spread scalps: SPY +$350, QQQ +$225, GOOGL +$210. All before 10am.',
          'Correctly identified SCOTUS ruling as catalyst for tariff beneficiary names.'
        ],
        score: 5,
        scoreNote: 'Morning = 10/10 perfect. Afternoon = 0/10 catastrophic. One impulsive trade turned a +$785 day into -$65. The data is clear: your edge exists before 10am and disappears after.'
      }
    };
    _analysisCache['2026-02-20'] = feb20;
    try { localStorage.setItem('mtp_analysis_2026-02-20', JSON.stringify(feb20)); } catch(e) {}
  }
})();