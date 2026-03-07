// ==================== backtest-scanner/index.ts ====================
// Nightly backtester: checks if scanner setups hit target or stop within 5 trading days.
//
// Runs at 5 PM ET via pg_cron (two jobs: 21:00 + 22:00 UTC for DST coverage).
// Reads scan_results for each of the last 5 trading days, fetches daily bars
// for 5 days after each setup date, and upserts results to scanner_history.
//
// Re-runs nightly so the 5-day lookback window fills in over time.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS ─────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// ── Date helpers ─────────────────────────────────────────

function etDateStr(d: Date): string {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const y = et.getFullYear()
  const m = String(et.getMonth() + 1).padStart(2, '0')
  const day = String(et.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Get last N trading days (weekdays) ending today or yesterday */
function getRecentTradingDays(count: number): string[] {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const days: string[] = []

  for (let offset = 1; offset < 30 && days.length < count; offset++) {
    const d = new Date(et)
    d.setDate(d.getDate() - offset)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    days.push(`${y}-${mo}-${day}`)
  }
  return days
}

// ── Polygon helpers ──────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function polyGet(path: string, apiKey: string, maxRetries = 4): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://api.polygon.io${path}${sep}apiKey=${apiKey}`

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const r = await fetch(url)
      if (r.status === 429) {
        if (attempt < maxRetries - 1) {
          await sleep(Math.pow(2, attempt + 1) * 1000)
          continue
        }
        throw new Error(`Polygon 429: rate limited on ${path}`)
      }
      if (!r.ok) throw new Error(`Polygon ${r.status}: ${path}`)
      return await r.json()
    } catch (e: any) {
      const isNetwork = e.message && (
        e.message.includes('Failed to fetch') ||
        e.message.includes('NetworkError') ||
        e.message.includes('fetch')
      )
      if (isNetwork && attempt < maxRetries - 1) {
        await sleep(Math.pow(2, attempt + 1) * 1000)
        continue
      }
      throw e
    }
  }
}

// ── Regime computation ───────────────────────────────────

/** Fetch SMA for a ticker on a given date using Polygon daily bars */
async function getSmaOnDate(ticker: string, dateStr: string, period: number, apiKey: string): Promise<number | null> {
  // Fetch enough bars to compute SMA (period + buffer for weekends/holidays)
  const endDate = new Date(dateStr + 'T12:00:00Z')
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - (period * 2 + 10))

  const fromStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`
  const toStr = dateStr

  const data = await polyGet(
    `/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=${period + 5}`,
    apiKey,
  )
  const bars = data?.results ?? []
  if (bars.length < period) return null

  let sum = 0
  for (let i = 0; i < period; i++) sum += bars[i].c
  return sum / period
}

/** Compute simplified market regime for a given date: Bullish / Bearish / Chop */
async function computeRegimeForDate(dateStr: string, apiKey: string): Promise<string> {
  const indexes = ['SPY', 'QQQ', 'IWM', 'DIA']

  // Fetch close price + SMAs for each index on this date
  let aboveBoth = 0
  let belowBoth = 0
  let totalPct = 0
  let validCount = 0

  for (const ticker of indexes) {
    try {
      // Get bars around this date (just need close + prev close)
      const data = await polyGet(
        `/v2/aggs/ticker/${ticker}/range/1/day/${dateStr}/${dateStr}?adjusted=true&sort=asc&limit=1`,
        apiKey,
      )
      const bars = data?.results ?? []
      if (bars.length === 0) continue

      const close = bars[0].c
      const open = bars[0].o
      const pct = ((close - open) / open) * 100

      // Get 10 and 20 SMAs
      const sma10 = await getSmaOnDate(ticker, dateStr, 10, apiKey)
      const sma20 = await getSmaOnDate(ticker, dateStr, 20, apiKey)

      if (sma10 !== null && sma20 !== null) {
        if (close > sma10 && close > sma20) aboveBoth++
        else if (close < sma10 && close < sma20) belowBoth++
      }

      totalPct += pct
      validCount++
    } catch (e: any) {
      console.warn(`[regime] Failed to get data for ${ticker} on ${dateStr}: ${e.message}`)
    }
  }

  if (validCount === 0) return 'Chop'

  const avgPct = totalPct / validCount

  // Simplified 3-bucket regime (matches overview.js logic, consolidated)
  if (avgPct > 0.3 || aboveBoth >= 3) return 'Bullish'
  if (avgPct < -0.3 || belowBoth >= 3) return 'Bearish'
  return 'Chop'
}

// ── Main Handler ─────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── ET time guard ──────────────────────────────────
    const urlCheck = new URL(req.url)
    const forceRun = urlCheck.searchParams.get('force') === 'true'
    const cronTriggered = urlCheck.searchParams.get('source') === 'cron'

    if (cronTriggered && !forceRun) {
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const etH = etNow.getHours()
      const etM = etNow.getMinutes()
      const etDay = etNow.getDay()

      // Skip weekends
      if (etDay === 0 || etDay === 6) {
        return new Response(JSON.stringify({ message: 'Weekend — skipping backtest', skipped: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Only run between 5:00-5:15 PM ET
      const etMinutes = etH * 60 + etM
      if (etMinutes < 1020 || etMinutes > 1035) { // 1020 = 17:00, 1035 = 17:15
        return new Response(JSON.stringify({ message: `Not in 5:00-5:15 PM ET window (current: ${etH}:${String(etM).padStart(2, '0')} ET)`, skipped: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      console.log(`[backtest-scanner] Cron trigger accepted: ${etH}:${String(etM).padStart(2, '0')} ET`)
    }

    // ── Environment setup ──────────────────────────────
    const polygonKey = Deno.env.get('POLYGON_API_KEY')
    if (!polygonKey) {
      return new Response(JSON.stringify({ error: 'POLYGON_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // ══════════════════════════════════════════════════
    // BACKFILL MODE: Compute regime for all existing scanner_history rows
    // Trigger with ?backfill=true
    // ══════════════════════════════════════════════════
    const backfillMode = urlCheck.searchParams.get('backfill') === 'true'
    if (backfillMode) {
      console.log('[backtest-scanner] BACKFILL MODE: Computing regime for all historical rows')

      // Get all unique dates that have no regime set
      const { data: histRows, error: histErr } = await supabase
        .from('scanner_history')
        .select('date')
        .is('market_regime', null)
        .order('date', { ascending: false })

      if (histErr) throw new Error(`Failed to fetch history: ${histErr.message}`)

      // Deduplicate dates
      const uniqueDates = [...new Set((histRows || []).map((r: any) => r.date))]
      console.log(`[backtest-scanner] Found ${uniqueDates.length} dates needing regime backfill`)

      let updated = 0
      for (const dateStr of uniqueDates) {
        try {
          const regime = await computeRegimeForDate(dateStr, polygonKey)
          const { error: upErr } = await supabase
            .from('scanner_history')
            .update({ market_regime: regime })
            .eq('date', dateStr)

          if (!upErr) {
            updated++
            console.log(`[backtest-scanner] ${dateStr} → ${regime}`)
          }
          // Rate limit: 5 API calls per date (4 indexes × close + SMAs), wait between dates
          await sleep(2000)
        } catch (e: any) {
          console.warn(`[backtest-scanner] Failed to compute regime for ${dateStr}: ${e.message}`)
        }
      }

      return new Response(
        JSON.stringify({ message: 'Backfill complete', dates_processed: uniqueDates.length, dates_updated: updated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ══════════════════════════════════════════════════
    // STEP 1: Get scan_results for the last 5 trading days
    // ══════════════════════════════════════════════════
    const recentDays = getRecentTradingDays(5)
    console.log(`[backtest-scanner] Checking scan results for dates: ${recentDays.join(', ')}`)

    const { data: scanRows, error: scanErr } = await supabase
      .from('scan_results')
      .select('scan_date, breakout_setups')
      .in('scan_date', recentDays)

    if (scanErr) throw new Error(`Failed to fetch scan_results: ${scanErr.message}`)
    if (!scanRows || scanRows.length === 0) {
      return new Response(JSON.stringify({ message: 'No scan results found for recent days', dates_checked: recentDays }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[backtest-scanner] Found ${scanRows.length} scan result days`)

    // ══════════════════════════════════════════════════
    // STEP 2: Extract setups to backtest
    // ══════════════════════════════════════════════════
    interface SetupToBacktest {
      date: string
      ticker: string
      strategy: string
      score: number
      direction: string
      entryPrice: number
      targetPrice: number
      stopPrice: number
    }

    const setups: SetupToBacktest[] = []

    for (const row of scanRows) {
      const bs = row.breakout_setups
      if (!bs) continue

      const allSetups = [
        ...(bs.earlyBreakouts || []).map((s: any) => ({ ...s, strategy: 'EARLY BREAKOUT' })),
        ...(bs.pullbackEntries || []).map((s: any) => ({ ...s, strategy: 'PULLBACK' })),
        ...(bs.meanReversions || []).map((s: any) => ({ ...s, strategy: 'MEAN REVERSION' })),
        ...(bs.momentumBreakouts || []).map((s: any) => ({ ...s, strategy: 'MOMENTUM BREAKOUT' })),
        ...(bs.daytrade_setups || []).map((s: any) => ({ ...s, strategy: 'ORB_BREAKOUT' })),
      ]

      for (const s of allSetups) {
        if (!s.ticker || !s.entryPrice || !s.targetPrice || !s.stopPrice) continue
        // Determine direction: use explicit direction if set, then infer from category
        let direction = 'LONG'
        if (s.direction === 'SHORT') direction = 'SHORT'
        else if (s.direction === 'LONG') direction = 'LONG'
        else if (s.breakingOut === false && s.changePct < 0) direction = 'SHORT'

        setups.push({
          date: row.scan_date,
          ticker: s.ticker,
          strategy: s.strategy || s.category || 'UNKNOWN',
          score: s.score || 0,
          direction,
          entryPrice: s.entryPrice,
          targetPrice: s.targetPrice,
          stopPrice: s.stopPrice,
        })
      }
    }

    if (setups.length === 0) {
      return new Response(JSON.stringify({ message: 'No setups to backtest', scan_days: scanRows.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Cap at 30 setups to stay within API/time limits
    const setupsToProcess = setups.slice(0, 30)
    console.log(`[backtest-scanner] Processing ${setupsToProcess.length} setups (of ${setups.length} total)`)

    // ══════════════════════════════════════════════════
    // STEP 2.5: Compute market regime for each unique setup date
    // ══════════════════════════════════════════════════
    const uniqueSetupDates = [...new Set(setupsToProcess.map(s => s.date))]
    const regimeByDate: Record<string, string> = {}

    for (const dateStr of uniqueSetupDates) {
      try {
        regimeByDate[dateStr] = await computeRegimeForDate(dateStr, polygonKey)
        console.log(`[backtest-scanner] Regime for ${dateStr}: ${regimeByDate[dateStr]}`)
        await sleep(1000) // Rate limit between dates
      } catch (e: any) {
        console.warn(`[backtest-scanner] Could not compute regime for ${dateStr}: ${e.message}`)
        regimeByDate[dateStr] = 'Chop' // Default fallback
      }
    }

    // ══════════════════════════════════════════════════
    // STEP 3: Fetch daily bars for each setup (5 trading days after)
    // ══════════════════════════════════════════════════
    const results: any[] = []
    let apiCalls = 0

    for (const setup of setupsToProcess) {
      try {
        const isIntraday = setup.strategy === 'ORB_BREAKOUT'
        const isShort = setup.direction === 'SHORT'

        let bars: any[] = []

        if (isIntraday) {
          // ORB: fetch 15-min bars for same day (9:45 AM - 4:00 PM ET)
          const data = await polyGet(
            `/v2/aggs/ticker/${setup.ticker}/range/15/minute/${setup.date}/${setup.date}?adjusted=true&sort=asc&limit=100`,
            polygonKey,
          )
          apiCalls++
          const allBars = data.results ?? []
          // Filter to post-ORB bars (after 9:45 AM ET = 585 min)
          bars = allBars.filter((b: any) => {
            const d = new Date(b.t)
            const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false })
            const parts = etStr.split(':')
            const mins = parseInt(parts[0]) * 60 + parseInt(parts[1])
            return mins >= 585 && mins <= 960  // 9:45 AM to 4:00 PM
          })
        } else {
          // Swing: fetch daily bars for 5 trading days after setup
          const startDate = new Date(setup.date + 'T12:00:00Z')
          startDate.setUTCDate(startDate.getUTCDate() + 1)
          const endDate = new Date(startDate)
          endDate.setUTCDate(endDate.getUTCDate() + 9)

          const fromStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`
          const toStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`

          const data = await polyGet(
            `/v2/aggs/ticker/${setup.ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc`,
            polygonKey,
          )
          apiCalls++
          bars = (data.results ?? []).slice(0, 5)
        }

        if (bars.length === 0) {
          console.log(`[backtest-scanner] No bars for ${setup.ticker} after ${setup.date}`)
          continue
        }

        // Check target/stop hits with direction awareness
        let hitTarget = false
        let hitStop = false
        let maxMovePct = 0
        let eodClose = bars[bars.length - 1]?.c ?? null

        for (const bar of bars) {
          if (isShort) {
            // SHORT: target hit when low <= targetPrice, stop hit when high >= stopPrice
            if (bar.l <= setup.targetPrice) hitTarget = true
            if (bar.h >= setup.stopPrice) hitStop = true
            // Max favorable move = how far price dropped from entry
            const movePct = ((setup.entryPrice - bar.l) / setup.entryPrice) * 100
            if (movePct > maxMovePct) maxMovePct = movePct
          } else {
            // LONG: target hit when high >= targetPrice, stop hit when low <= stopPrice
            if (bar.h >= setup.targetPrice) hitTarget = true
            if (bar.l <= setup.stopPrice) hitStop = true
            const movePct = ((bar.h - setup.entryPrice) / setup.entryPrice) * 100
            if (movePct > maxMovePct) maxMovePct = movePct
          }
        }

        results.push({
          date: setup.date,
          ticker: setup.ticker,
          strategy: setup.strategy,
          score: setup.score,
          direction: setup.direction,
          entry_price: setup.entryPrice,
          target_price: setup.targetPrice,
          stop_price: setup.stopPrice,
          eod_close: eodClose,
          hit_target: hitTarget,
          hit_stop: hitStop,
          max_move_pct: Math.round(maxMovePct * 1000) / 1000,
          market_regime: regimeByDate[setup.date] || null,
        })

        // Gentle rate limiting
        if (apiCalls % 5 === 0) await sleep(500)

      } catch (e: any) {
        console.warn(`[backtest-scanner] Failed to backtest ${setup.ticker} (${setup.date}): ${e.message}`)
      }
    }

    console.log(`[backtest-scanner] Backtested ${results.length} setups using ${apiCalls} API calls`)

    // ══════════════════════════════════════════════════
    // STEP 4: Upsert results to scanner_history
    // ══════════════════════════════════════════════════
    if (results.length > 0) {
      const { error: upsertErr } = await supabase
        .from('scanner_history')
        .upsert(results, { onConflict: 'date,ticker,strategy' })

      if (upsertErr) {
        throw new Error(`Failed to upsert scanner_history: ${upsertErr.message}`)
      }
      console.log(`[backtest-scanner] Upserted ${results.length} rows to scanner_history`)
    }

    return new Response(
      JSON.stringify({
        message: 'Backtest complete',
        scan_days_checked: scanRows.length,
        setups_found: setups.length,
        setups_processed: setupsToProcess.length,
        results_saved: results.length,
        api_calls: apiCalls,
        summary: {
          hit_target: results.filter(r => r.hit_target).length,
          hit_stop: results.filter(r => r.hit_stop).length,
          neither: results.filter(r => !r.hit_target && !r.hit_stop).length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    console.error('[backtest-scanner] Fatal error:', e)
    return new Response(
      JSON.stringify({ error: e?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
