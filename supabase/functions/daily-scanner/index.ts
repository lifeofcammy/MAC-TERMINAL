// ==================== daily-scanner ====================
// Supabase Edge Function that runs the full momentum scan server-side.
// Uses the Polygon paid API key (stored as a secret) to scan ~3000 stocks,
// score them, find breakout setups, and store results in the scan_results table.
// Can be triggered manually via HTTP or on a cron schedule.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Helpers ──────────────────────────────────────────────

function localDateStr(d?: Date): string {
  const now = d || new Date()
  // Use ET (Eastern Time) since that's market time
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const y = et.getFullYear()
  const m = String(et.getMonth() + 1).padStart(2, '0')
  const day = String(et.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  while (et.getDay() === 0 || et.getDay() === 6) et.setDate(et.getDate() - 1)
  const y = et.getFullYear()
  const m = String(et.getMonth() + 1).padStart(2, '0')
  const day = String(et.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function polyGet(path: string, apiKey: string, retries = 3): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://api.polygon.io${path}${sep}apiKey=${apiKey}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(url)
      if (r.status === 429 && attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 1000))
        continue
      }
      if (!r.ok) throw new Error(`Polygon ${r.status}: ${path}`)
      return await r.json()
    } catch (e) {
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 1000))
        continue
      }
      throw e
    }
  }
}

async function getDailyBars(ticker: string, days: number, apiKey: string): Promise<any[]> {
  const now = new Date()
  const to = localDateStr(now)
  const fd = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const from = localDateStr(fd)
  const d = await polyGet(`/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=${days}`, apiKey)
  return d.results || []
}

// ── Momentum Scoring ────────────────────────────────────

function calcMomentumScore(bars: any[], currentPrice: number) {
  const closes = bars.map((b: any) => b.c)
  const highs = bars.map((b: any) => b.h)
  const lows = bars.map((b: any) => b.l)
  const len = closes.length
  if (len < 20) return { total: 0 }

  const close20ago = closes[Math.max(0, len - 21)]
  const pct20d = ((currentPrice - close20ago) / close20ago) * 100
  let pts20d = 0
  if (pct20d > 30) pts20d = 30
  else if (pct20d > 20) pts20d = 27
  else if (pct20d > 15) pts20d = 24
  else if (pct20d > 10) pts20d = 20
  else if (pct20d > 5) pts20d = 15
  else if (pct20d > 2) pts20d = 8
  else if (pct20d > 0) pts20d = 3

  let pct50d = 0, pts50d = 0
  if (len >= 50) {
    const close50ago = closes[len - 50]
    pct50d = ((currentPrice - close50ago) / close50ago) * 100
    if (pct50d > 50) pts50d = 25
    else if (pct50d > 30) pts50d = 22
    else if (pct50d > 20) pts50d = 18
    else if (pct50d > 10) pts50d = 14
    else if (pct50d > 5) pts50d = 8
    else if (pct50d > 0) pts50d = 3
  }

  const highInRange = Math.max(...closes)
  const distFromHigh = ((highInRange - currentPrice) / highInRange) * 100
  let ptsHigh = 0
  if (distFromHigh <= 2) ptsHigh = 25
  else if (distFromHigh <= 5) ptsHigh = 20
  else if (distFromHigh <= 10) ptsHigh = 14
  else if (distFromHigh <= 15) ptsHigh = 8
  else if (distFromHigh <= 20) ptsHigh = 3

  function sma(period: number): number | null {
    if (len < period) return null
    let sum = 0
    for (let i = len - period; i < len; i++) sum += closes[i]
    return sum / period
  }
  const sma10 = sma(10), sma20 = sma(20), sma50 = sma(50)
  let aboveSMAs = 0, ptsSMA = 0
  if (sma10 && currentPrice > sma10) { aboveSMAs++; ptsSMA += 5 }
  if (sma20 && currentPrice > sma20) { aboveSMAs++; ptsSMA += 5 }
  if (sma50 && currentPrice > sma50) { aboveSMAs++; ptsSMA += 5 }
  if (sma10 && sma20 && sma50 && sma10 > sma20 && sma20 > sma50) ptsSMA += 5

  let adrMultiple: number | null = null
  if (sma50 && currentPrice > sma50) {
    let adrSum = 0
    for (let ai = len - 20; ai < len; ai++) adrSum += (highs[ai] - lows[ai])
    const adr = adrSum / 20
    if (adr > 0) adrMultiple = Math.round(((currentPrice - sma50) / adr) * 10) / 10
  }

  return {
    total: Math.round(pts20d + pts50d + ptsHigh + ptsSMA),
    pct20d: Math.round(pct20d * 10) / 10,
    pct50d: Math.round(pct50d * 10) / 10,
    distFromHigh: Math.round(distFromHigh * 10) / 10,
    aboveSMAs: aboveSMAs + '/3',
    adrMultiple,
  }
}

// ── Breakout Analysis ───────────────────────────────────

function analyzeSetup(ticker: string, bars: any[]) {
  const closes = bars.map((b: any) => b.c)
  const highs = bars.map((b: any) => b.h)
  const lows = bars.map((b: any) => b.l)
  const volumes = bars.map((b: any) => b.v)
  const len = closes.length
  if (len < 20) return null

  const price = closes[len - 1]

  function sma(arr: number[], period: number): number | null {
    if (arr.length < period) return null
    let sum = 0
    for (let i = arr.length - period; i < arr.length; i++) sum += arr[i]
    return sum / period
  }

  const sma10 = sma(closes, 10), sma20 = sma(closes, 20), sma50 = sma(closes, 50)
  if (!sma10 || !sma20) return null
  if (price < sma20) return null

  // Buyout filter
  const recent5H_pre = Math.max(...highs.slice(-5))
  const recent5L_pre = Math.min(...lows.slice(-5))
  const range5_pre = ((recent5H_pre - recent5L_pre) / price) * 100
  if (range5_pre < 0.8) return null

  // Tightness (0-30 pts)
  const recent10H = Math.max(...highs.slice(-10))
  const recent10L = Math.min(...lows.slice(-10))
  const range10 = ((recent10H - recent10L) / price) * 100
  const recent5H = Math.max(...highs.slice(-5))
  const recent5L = Math.min(...lows.slice(-5))
  const range5 = ((recent5H - recent5L) / price) * 100

  let ptsTight = 0
  if (range5 <= 3) ptsTight = 30
  else if (range5 <= 5) ptsTight = 25
  else if (range5 <= 7) ptsTight = 18
  else if (range5 <= 10) ptsTight = 12
  else if (range10 <= 8) ptsTight = 10
  else if (range10 <= 12) ptsTight = 5

  // Volume dry-up (0-25 pts)
  const avgVol20 = sma(volumes, 20)
  const recentAvgVol = sma(volumes.slice(-5), 5)
  const volRatio = avgVol20 && avgVol20 > 0 ? (recentAvgVol || 0) / avgVol20 : 1
  let ptsVolDry = 0
  if (volRatio <= 0.4) ptsVolDry = 25
  else if (volRatio <= 0.55) ptsVolDry = 20
  else if (volRatio <= 0.7) ptsVolDry = 15
  else if (volRatio <= 0.85) ptsVolDry = 8

  // Breakout proximity (0-25 pts)
  const distToBreakout = ((recent10H - price) / price) * 100
  let ptsBreakout = 0
  if (distToBreakout <= 0.5) ptsBreakout = 25
  else if (distToBreakout <= 1) ptsBreakout = 22
  else if (distToBreakout <= 2) ptsBreakout = 18
  else if (distToBreakout <= 3) ptsBreakout = 12
  else if (distToBreakout <= 5) ptsBreakout = 6

  // Trend quality (0-20 pts)
  let ptsTrend = 0
  if (price > sma10) ptsTrend += 4
  if (price > sma20) ptsTrend += 4
  if (sma50 && price > sma50) ptsTrend += 4
  if (sma10 > sma20) ptsTrend += 4
  if (sma50 && sma20 > sma50) ptsTrend += 4

  let adrMultiple: number | null = null
  if (sma50 && price > sma50) {
    let adrSum2 = 0
    for (let ai2 = len - 20; ai2 < len; ai2++) adrSum2 += (highs[ai2] - lows[ai2])
    const adr2 = adrSum2 / 20
    if (adr2 > 0) adrMultiple = Math.round(((price - sma50) / adr2) * 10) / 10
  }

  const totalScore = Math.round(ptsTight + ptsVolDry + ptsBreakout + ptsTrend)
  if (totalScore < 40) return null

  // Description
  const desc: string[] = []
  if (range5 <= 5) desc.push(`Tight 5-day range (${range5.toFixed(1)}%)`)
  else if (range10 <= 8) desc.push(`Compressing 10-day (${range10.toFixed(1)}%)`)
  if (volRatio <= 0.7) desc.push(`Volume drying up (${(volRatio * 100).toFixed(0)}% of avg)`)
  if (distToBreakout <= 2) desc.push(`Near breakout ($${recent10H.toFixed(2)})`)
  if (sma10 > sma20 && sma50 && sma20 > sma50) desc.push('SMAs stacked bullish')

  const entryPrice = recent10H
  const stopPrice = Math.max(recent10L, sma20 ? sma20 * 0.99 : recent10L)
  const riskPct = ((entryPrice - stopPrice) / entryPrice) * 100
  const targetPrice = entryPrice + (entryPrice - stopPrice) * 2

  return {
    ticker,
    price,
    score: totalScore,
    range5: Math.round(range5 * 10) / 10,
    range10: Math.round(range10 * 10) / 10,
    volRatio: Math.round(volRatio * 100),
    breakoutLevel: recent10H,
    distToBreakout: Math.round(distToBreakout * 10) / 10,
    description: desc.join(' · '),
    entryPrice,
    stopPrice,
    targetPrice,
    riskPct: Math.round(riskPct * 10) / 10,
    sma10val: sma10 ? sma10.toFixed(2) : null,
    sma20val: sma20 ? sma20.toFixed(2) : null,
    sma50val: sma50 ? sma50.toFixed(2) : null,
    adrMultiple,
    components: {
      tightness: ptsTight,
      volumeDryUp: ptsVolDry,
      breakoutProximity: ptsBreakout,
      trendQuality: ptsTrend,
    },
  }
}

// ── Main Handler ────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const polygonKey = Deno.env.get('POLYGON_KEY')
    if (!polygonKey) {
      return new Response(JSON.stringify({ error: 'Polygon key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const scanDate = getLastTradingDay()

    // Check if we already have today's scan
    const { data: existing } = await supabase
      .from('scan_results')
      .select('id')
      .eq('scan_date', scanDate)
      .maybeSingle()

    // Allow force refresh via query param
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === 'true'

    if (existing && !force) {
      return new Response(JSON.stringify({ message: 'Scan already exists for ' + scanDate, cached: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 1: Get grouped daily bars
    const groupedData = await polyGet(`/v2/aggs/grouped/locale/us/market/stocks/${scanDate}?adjusted=true`, polygonKey)
    const allStocks = groupedData.results || []
    if (allStocks.length === 0) {
      return new Response(JSON.stringify({ error: 'No market data for ' + scanDate }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 2: Filter
    const filtered = allStocks.filter((s: any) => {
      if (!s.T || !s.c || !s.v) return false
      if (s.c < 5) return false
      if (s.v < 500000) return false
      if (s.T.length > 5) return false
      if (/[.-]/.test(s.T)) return false
      return true
    })

    filtered.sort((a: any, b: any) => (b.v * b.c) - (a.v * a.c))

    // Step 3: Score in batches
    const scored: any[] = []
    const batchSize = 10
    let failCount = 0

    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize)
      const promises = batch.map(async (stock: any) => {
        try {
          const bars = await getDailyBars(stock.T, 60, polygonKey)
          return { ticker: stock.T, bars, latestClose: stock.c, latestVol: stock.v }
        } catch {
          failCount++
          return null
        }
      })
      const results = await Promise.all(promises)
      for (const r of results) {
        if (!r || !r.bars || r.bars.length < 20) continue
        const score = calcMomentumScore(r.bars, r.latestClose)
        if (score.total > 0) {
          scored.push({
            ticker: r.ticker,
            price: r.latestClose,
            volume: r.latestVol,
            score: score.total,
            pct20d: score.pct20d,
            pct50d: score.pct50d,
            distFromHigh: score.distFromHigh,
            aboveSMAs: score.aboveSMAs,
            adrMultiple: score.adrMultiple,
          })
        }
      }

      // Small delay
      if (i + batchSize < filtered.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const top100 = scored.slice(0, 100)

    // Step 4: Breakout scan on top 100
    const setups: any[] = []
    for (let i = 0; i < top100.length; i += 5) {
      const batch = top100.slice(i, i + 5)
      const promises = batch.map(async (stock) => {
        try {
          const bars = await getDailyBars(stock.ticker, 60, polygonKey)
          return { ticker: stock.ticker, bars }
        } catch {
          return null
        }
      })
      const results = await Promise.all(promises)
      for (const r of results) {
        if (!r || !r.bars || r.bars.length < 20) continue
        const setup = analyzeSetup(r.ticker, r.bars)
        if (setup) setups.push(setup)
      }
      if (i + 5 < top100.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    setups.sort((a, b) => b.score - a.score)

    // Step 5: Store in Supabase
    const momentumData = {
      date: scanDate,
      ts: Date.now(),
      count: top100.length,
      tickers: top100,
    }

    const setupData = {
      date: scanDate,
      ts: Date.now(),
      setups,
    }

    await supabase
      .from('scan_results')
      .upsert({
        scan_date: scanDate,
        momentum_universe: momentumData,
        breakout_setups: setupData,
      }, { onConflict: 'scan_date' })

    return new Response(JSON.stringify({
      message: `Scan complete for ${scanDate}`,
      stocks_scanned: filtered.length,
      top100: top100.length,
      setups: setups.length,
      failed: failCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
