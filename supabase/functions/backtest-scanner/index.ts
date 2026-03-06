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
      ]

      for (const s of allSetups) {
        if (!s.ticker || !s.entryPrice || !s.targetPrice || !s.stopPrice) continue
        setups.push({
          date: row.scan_date,
          ticker: s.ticker,
          strategy: s.strategy || s.category || 'UNKNOWN',
          score: s.score || 0,
          direction: s.breakingOut ? 'LONG' : (s.changePct < 0 ? 'SHORT' : 'LONG'),
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
    // STEP 3: Fetch daily bars for each setup (5 trading days after)
    // ══════════════════════════════════════════════════
    const results: any[] = []
    let apiCalls = 0

    for (const setup of setupsToProcess) {
      try {
        // Fetch 10 calendar days of daily bars starting day after the setup
        const startDate = new Date(setup.date + 'T12:00:00Z')
        startDate.setUTCDate(startDate.getUTCDate() + 1)
        const endDate = new Date(startDate)
        endDate.setUTCDate(endDate.getUTCDate() + 9) // 10 calendar days to get ~5 trading days

        const fromStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`
        const toStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`

        const data = await polyGet(
          `/v2/aggs/ticker/${setup.ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc`,
          polygonKey,
        )
        apiCalls++

        const bars = data.results ?? []
        if (bars.length === 0) {
          console.log(`[backtest-scanner] No bars for ${setup.ticker} after ${setup.date}`)
          continue
        }

        // Take up to 5 trading days
        const tradingBars = bars.slice(0, 5)

        // Check target/stop hits
        let hitTarget = false
        let hitStop = false
        let maxMovePct = 0
        let eodClose = tradingBars[tradingBars.length - 1]?.c ?? null

        for (const bar of tradingBars) {
          // Long direction: target = high >= targetPrice, stop = low <= stopPrice
          if (bar.h >= setup.targetPrice) hitTarget = true
          if (bar.l <= setup.stopPrice) hitStop = true

          // Max favorable move from entry
          const movePct = ((bar.h - setup.entryPrice) / setup.entryPrice) * 100
          if (movePct > maxMovePct) maxMovePct = movePct
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
