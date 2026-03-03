// ==================== daily-scanner/index.ts ====================
// ARCHITECTURE (v3): Grouped-daily + Live Snapshot overlay
//
// Approach: Fetch 30 days of GROUPED daily data (~10 API batches),
//   assemble per-ticker bar arrays in memory, build the 150-stock universe,
//   then overlay LIVE prices from Polygon v3 Snapshot before scoring setups.
//   → ~31 API calls per run → completes well within Edge Function limits.
//
// Algorithm:
//   1. Calculate last 30 trading days (weekdays, skip Sat/Sun)
//   2. Fetch grouped daily data for each trading day in batches of 3
//   3. Build ticker → [{o,h,l,c,v,t}, ...] map in memory
//   4. Filter tickers: price >= $5, vol >= 500K, len <= 5 chars, no dots/dashes, min 20 days
//   5. Score each ticker with calcUniverseScore (ported from scanner.js)
//   6. Take top 150 universe candidates
//   7. Fetch Polygon v3 Snapshot for the 150 tickers (1 API call)
//   8. Re-score universe with live prices, re-sort, re-slice top 150
//   9. Run setup analysis (early breakouts + pullback entries) using live prices
//  10. Upsert results to scan_results table
//
// Designed to run at 9:35 AM ET via cron — uses live market prices
// instead of stale yesterday's closes.
//
// Output format: matches what the frontend (scanner.js / db.js) expects.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS ─────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// ── Known ETFs to exclude ────────────────────────────────
const KNOWN_ETFS = new Set([
  'SPY','QQQ','IWM','DIA','VOO','VTI','VIXY','UUP','GLD','SLV','TLT','HYG','LQD',
  'XLK','XLF','XLE','XLV','XLY','XLI','XLRE','XLU','XLB','XLC','XLP','SMH',
  'EWJ','EWZ','EWY','EWG','EWH','EWA','EWT','EWC','EWU','EWS','EWW','EWQ',
  'FXI','MCHI','KWEB','INDA','VWO','EEM','EFA','IEMG','VEA','VGK',
  'ARKK','ARKW','ARKF','ARKG','ARKQ','ARKX',
  'SOXX','IGV','IBB','XBI','XOP','OIH','KRE','KBE','XRT','JETS','PAVE',
  'ITA','XAR','HACK','SKYY','BOTZ','ICLN','TAN','URNM','LIT','REMX',
  'SOXL','SOXS','TQQQ','SQQQ','UPRO','SPXU','LABU','LABD','UVXY','SVXY',
  'SPXL','SPXS','TNA','TZA','FAS','FAZ','NUGT','DUST','JNUG','JDST',
  'BND','AGG','IEF','SHY','VCSH','VCIT','BNDX','EMB','JNK','MUB',
  'VNQ','MORT','HOMZ','IYR',
  'USO','UNG','DBA','DBC','PDBC','GSG','WEAT','CORN','CPER',
  'RSP','SPLG','SCHD','VIG','DVY','SDY','NOBL','VYM','HDV',
  'QLD','PSQ','SH','SDS','DOG','DXD','RWM','TWM',
  'IBIT','BITO','GBTC','ETHE','FBTC',
  'GDX','GDXJ','SIL','SILJ','PPLT','PALL','GLTR',
  'COWZ','DIVO','JEPI','JEPQ','XYLD','QYLD','RYLD',
  'AMLP','MLPA','SRVR','NERD','SOCL','SUBZ','BETZ','PEJ',
  'PBJ','MJ','YOLO','MSOS','BUZZ','VPN','CLOU','WCLD','BUG',
  'FTEC','FHLC','FNCL','FENY','FDIS','FIDU','FREL','FUTY','FMAT','FCOM','FSTA',
  'IVV','IJR','IJH','MDY','IWB','IWF','IWD','IWN','IWO','IWP','IWS',
  'VBK','VBR','VTV','VUG','VOE','VOT','VTWO','VXUS','VMBS',
])

// ── Date / Trading Day Helpers ───────────────────────────

/**
 * Format a Date as YYYY-MM-DD using Eastern Time.
 */
function etDateStr(d: Date): string {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const y = et.getFullYear()
  const m = String(et.getMonth() + 1).padStart(2, '0')
  const day = String(et.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Return the most recent completed trading day in Eastern Time.
 * If it's a weekday and before 5 PM ET, use the previous trading day
 * (market data for today may not be finalized yet).
 * On weekends, use Friday.
 */
function getLastTradingDay(): string {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = et.getDay()   // 0=Sun, 6=Sat
  const hour = et.getHours()

  // If weekday before 5 PM ET, step back one day so we use the previous completed session
  if (dow >= 1 && dow <= 5 && hour < 17) {
    et.setDate(et.getDate() - 1)
  }

  // Roll back past weekends
  while (et.getDay() === 0 || et.getDay() === 6) {
    et.setDate(et.getDate() - 1)
  }

  const y = et.getFullYear()
  const mo = String(et.getMonth() + 1).padStart(2, '0')
  const d = String(et.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * Return an array of trading day date strings (YYYY-MM-DD) for the last ~30 trading days,
 * ending on lastTradingDay.  We look back ~45 calendar days to guarantee >= 30 trading days.
 * Only weekdays are included; holidays will return empty groups and be skipped later.
 *
 * 30 days supports 10 SMA and 20 SMA fully. 50 SMA degrades gracefully (returns null).
 * This keeps CPU usage well within Supabase Edge Function limits.
 */
function getTradingDays(lastTradingDay: string): string[] {
  const end = new Date(lastTradingDay + 'T12:00:00Z')  // noon UTC avoids DST edge cases
  const days: string[] = []

  // Walk backwards ~45 calendar days and collect weekdays
  for (let offset = 0; offset < 45; offset++) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - offset)
    const dow = d.getUTCDay()  // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue  // skip weekends
    const y = d.getUTCFullYear()
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    days.push(`${y}-${mo}-${day}`)
    if (days.length === 30) break
  }

  // days[0] = most recent, days[29] = oldest — reverse so oldest first
  return days.reverse()
}

// ── Polygon API Helpers ──────────────────────────────────

interface Bar {
  o: number
  h: number
  l: number
  c: number
  v: number
  vw?: number
  t: number
}

/**
 * Fetch a single URL from Polygon with exponential backoff on 429 / network errors.
 * Retries up to `maxRetries` times.
 */
async function polyGet(path: string, apiKey: string, maxRetries = 4): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://api.polygon.io${path}${sep}apiKey=${apiKey}`

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const r = await fetch(url)

      // 429 rate-limit: wait and retry
      if (r.status === 429) {
        if (attempt < maxRetries - 1) {
          const wait = Math.pow(2, attempt + 1) * 1000  // 2s, 4s, 8s ...
          await sleep(wait)
          continue
        }
        throw new Error(`Polygon 429: rate limited on ${path}`)
      }

      if (!r.ok) {
        throw new Error(`Polygon ${r.status}: ${path}`)
      }

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Live Snapshot Fetcher ────────────────────────────────
//
// Fetches Polygon v3 Snapshot for up to 250 tickers in a single call.
// Returns a Map of ticker → { price, prevClose, changePercent, volume, open }
// Uses session data which reflects the current trading session.

interface SnapshotData {
  price: number
  prevClose: number
  changePercent: number
  volume: number
  open: number
}

async function fetchLiveSnapshot(
  tickers: string[],
  apiKey: string,
): Promise<Map<string, SnapshotData>> {
  const result = new Map<string, SnapshotData>()
  if (tickers.length === 0) return result

  // v3 snapshot supports ticker.any_of with up to 250 tickers per call
  const tickerParam = tickers.join(',')
  const url = `/v3/snapshot?ticker.any_of=${tickerParam}&limit=250`

  try {
    const data = await polyGet(url, apiKey)
    const results = data.results ?? []

    for (const item of results) {
      const ticker = item.ticker
      const session = item.session ?? {}

      // session.price = last trade price (live during market hours)
      // session.previous_close = previous session's close
      // session.change_percent = percent change from prev close
      // session.volume = current session volume
      // session.open = today's open price
      const price        = session.price ?? 0
      const prevClose    = session.previous_close ?? 0
      const changePercent = session.change_percent ?? 0
      const volume       = session.volume ?? 0
      const open         = session.open ?? 0

      // Only include if we got a valid price
      if (price > 0) {
        result.set(ticker, { price, prevClose, changePercent, volume, open })
      }
    }

    console.log(`[daily-scanner] Snapshot: got live prices for ${result.size}/${tickers.length} tickers`)
  } catch (e: any) {
    console.error(`[daily-scanner] Snapshot fetch failed: ${e.message} — falling back to bar closes`)
  }

  return result
}

// ── SMA helper (shared by all scoring functions) ─────────

function sma(arr: number[], period: number): number | null {
  if (arr.length < period) return null
  let sum = 0
  for (let i = arr.length - period; i < arr.length; i++) sum += arr[i]
  return sum / period
}

// ── Fast min/max helpers (avoid spread operator overhead) ──

function arrMax(arr: number[], fromIdx = 0, toIdx = arr.length): number {
  let max = -Infinity
  for (let i = fromIdx; i < toIdx; i++) {
    if (arr[i] > max) max = arr[i]
  }
  return max
}

function arrMin(arr: number[], fromIdx = 0, toIdx = arr.length): number {
  let min = Infinity
  for (let i = fromIdx; i < toIdx; i++) {
    if (arr[i] < min) min = arr[i]
  }
  return min
}

// ── Universe Scoring (ported exactly from scanner.js) ───
//
// Rewards: compression, trend alignment, volume dry-up, proximity to breakout
// Penalizes: extension from 20 SMA

interface UniverseScoreResult {
  total: number
  range5: number
  range10: number
  extFromSma20: number
  aboveSMAs: string
  volDryUp: number
  distToBreakout: number
  pullbackDepth: number
}

function calcUniverseScore(bars: Bar[], currentPrice: number): UniverseScoreResult {
  const closes  = bars.map(b => b.c)
  const highs   = bars.map(b => b.h)
  const lows    = bars.map(b => b.l)
  const volumes = bars.map(b => b.v)
  const len = closes.length

  if (len < 20) return { total: 0, range5: 0, range10: 0, extFromSma20: 0, aboveSMAs: '0/3', volDryUp: 100, distToBreakout: 99, pullbackDepth: 0 }

  const sma10 = sma(closes, 10)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)

  // Must be above 20 SMA * 0.97 to be considered (uptrend filter)
  if (!sma20 || currentPrice < sma20 * 0.97) {
    return { total: 0, range5: 0, range10: 0, extFromSma20: 0, aboveSMAs: '0/3', volDryUp: 100, distToBreakout: 99, pullbackDepth: 0 }
  }

  // ── 1. COMPRESSION / TIGHTNESS (0-30 pts) ──
  const recent5H  = arrMax(highs, Math.max(0, len - 5))
  const recent5L  = arrMin(lows, Math.max(0, len - 5))
  const range5    = ((recent5H - recent5L) / currentPrice) * 100

  const recent10H = arrMax(highs, Math.max(0, len - 10))
  const recent10L = arrMin(lows, Math.max(0, len - 10))
  const range10   = ((recent10H - recent10L) / currentPrice) * 100

  let ptsTight = 0
  if      (range5  <= 3)  ptsTight = 30
  else if (range5  <= 5)  ptsTight = 25
  else if (range5  <= 7)  ptsTight = 20
  else if (range5  <= 10) ptsTight = 14
  else if (range10 <= 10) ptsTight = 10
  else if (range10 <= 15) ptsTight = 5

  // ── 2. EXTENSION PENALTY (−20 to +10 pts) ──
  const extFromSma20 = sma20 > 0 ? ((currentPrice - sma20) / sma20) * 100 : 0
  let ptsExt = 0
  if      (extFromSma20 <= 2)  ptsExt = 10
  else if (extFromSma20 <= 4)  ptsExt = 5
  else if (extFromSma20 <= 6)  ptsExt = 0
  else if (extFromSma20 <= 10) ptsExt = -5
  else if (extFromSma20 <= 15) ptsExt = -10
  else                          ptsExt = -20

  // ── 3. VOLUME DRY-UP IN BASE (0-20 pts) ──
  const avgVol20  = sma(volumes, 20) ?? 1
  const avgVol5   = sma(volumes.slice(-5), 5) ?? 0
  const volRatio  = avgVol20 > 0 ? avgVol5 / avgVol20 : 1

  let ptsVolDry = 0
  if      (volRatio <= 0.40) ptsVolDry = 20
  else if (volRatio <= 0.55) ptsVolDry = 16
  else if (volRatio <= 0.70) ptsVolDry = 12
  else if (volRatio <= 0.85) ptsVolDry = 6

  // ── 4. BREAKOUT PROXIMITY (0-20 pts) ──
  const distToBreakout = recent10H > 0 ? ((recent10H - currentPrice) / currentPrice) * 100 : 99
  let ptsBreakout = 0
  if      (distToBreakout <= 0.5) ptsBreakout = 20
  else if (distToBreakout <= 1)   ptsBreakout = 17
  else if (distToBreakout <= 2)   ptsBreakout = 13
  else if (distToBreakout <= 3)   ptsBreakout = 8
  else if (distToBreakout <= 5)   ptsBreakout = 4

  // ── 5. TREND QUALITY (0-15 pts) ──
  let ptsTrend = 0
  let aboveSMAsCount = 0
  if (sma10 && currentPrice > sma10)        { aboveSMAsCount++; ptsTrend += 3 }
  if (currentPrice > sma20)                  { aboveSMAsCount++; ptsTrend += 3 }
  if (sma50 && currentPrice > sma50)         { aboveSMAsCount++; ptsTrend += 3 }
  if (sma10 && sma10 > sma20)                ptsTrend += 3
  if (sma50 && sma20 > sma50)                ptsTrend += 3

  // ── 6. PULLBACK BONUS (0-15 pts) ──
  let pullbackDepth = 0
  if (len >= 10) {
    const recentHigh = arrMax(highs, Math.max(0, len - 15))
    pullbackDepth = recentHigh > 0 ? ((recentHigh - currentPrice) / recentHigh) * 100 : 0
  }
  let ptsPullback = 0
  if (pullbackDepth >= 3 && pullbackDepth <= 10) {
    const nearSma10 = sma10 !== null && Math.abs(currentPrice - sma10) / currentPrice * 100 <= 1.5
    const nearSma20 = Math.abs(currentPrice - sma20) / currentPrice * 100 <= 1.5
    if (nearSma10 || nearSma20) ptsPullback = 15
    else if (pullbackDepth <= 7) ptsPullback = 8
    else ptsPullback = 4
  }

  // ── BUYOUT FILTER ──
  // Flatlined stocks (range5 < 0.8) are likely acquisition targets — skip
  if (range5 < 0.8) {
    return { total: 0, range5: Math.round(range5 * 10) / 10, range10: Math.round(range10 * 10) / 10, extFromSma20: 0, aboveSMAs: aboveSMAsCount + '/3', volDryUp: Math.round(volRatio * 100), distToBreakout: Math.round(distToBreakout * 10) / 10, pullbackDepth: Math.round(pullbackDepth * 10) / 10 }
  }
  // Gap-up + compression pattern — likely buyout pending
  if (len >= 15) {
    for (let gi = Math.max(0, len - 30); gi < len - 5; gi++) {
      const prevC = gi > 0 ? closes[gi - 1] : closes[gi]
      const gapPct = prevC > 0 ? ((closes[gi] - prevC) / prevC) * 100 : 0
      if (gapPct > 15) {
        const postGapHighs = highs.slice(gi + 2)
        const postGapLows  = lows.slice(gi + 2)
        if (postGapHighs.length >= 3) {
          const postH     = arrMax(postGapHighs, 0)
          const postL     = arrMin(postGapLows, 0)
          const postRange = ((postH - postL) / currentPrice) * 100
          if (postRange < 3.5) {
            return { total: 0, range5: Math.round(range5 * 10) / 10, range10: Math.round(range10 * 10) / 10, extFromSma20: 0, aboveSMAs: aboveSMAsCount + '/3', volDryUp: Math.round(volRatio * 100), distToBreakout: Math.round(distToBreakout * 10) / 10, pullbackDepth: Math.round(pullbackDepth * 10) / 10 }
          }
        }
      }
    }
  }

  const total = Math.round(Math.max(0, ptsTight + ptsExt + ptsVolDry + ptsBreakout + ptsTrend + ptsPullback))

  return {
    total,
    range5:        Math.round(range5        * 10) / 10,
    range10:       Math.round(range10       * 10) / 10,
    extFromSma20:  Math.round(extFromSma20  * 10) / 10,
    aboveSMAs:     aboveSMAsCount + '/3',
    volDryUp:      Math.round(volRatio      * 100),
    distToBreakout:Math.round(distToBreakout* 10) / 10,
    pullbackDepth: Math.round(pullbackDepth * 10) / 10,
  }
}

// ── Setup Analysis (ported from scanner.js runSetupScan) ─
//
// Server-side runs after hours: relativeVol = 0, volumeSurge = 0, bounce = 0.
// Price = last close (most recent bar).
// prevClose = second-to-last bar close.

interface EarlyBreakout {
  ticker: string
  category: 'EARLY BREAKOUT'
  price: number
  prevClose: number
  changePct: number
  score: number
  signals: string[]
  description: string
  range5: number
  range10: number
  extFromSma20: number
  breakoutLevel: number
  breakingOut: boolean
  distToBreakout: number
  baseVolRatio: number
  relativeVol: number
  volume: number
  avgVol20: number
  vwap: number
  entryPrice: number
  stopPrice: number
  targetPrice: number
  riskPct: number
  components: {
    tightness: number
    volumeDryUp: number
    breakoutProximity: number
    extensionAdj: number
    volumeSurge: number
  }
}

interface PullbackEntry {
  ticker: string
  category: 'PULLBACK'
  price: number
  prevClose: number
  changePct: number
  score: number
  signals: string[]
  description: string
  pullbackDepth: number
  supportLevel: string
  range5: number
  baseVolRatio: number
  relativeVol: number
  volume: number
  avgVol20: number
  vwap: number
  aboveSMAs: string
  smaStacked: boolean
  entryPrice: number
  stopPrice: number
  targetPrice: number
  riskPct: number
  components: {
    pullbackQuality: number
    supportLevel: number
    volumeDecline: number
    trendIntact: number
    bounceSignal: number
  }
}

function analyzeSetups(
  ticker: string,
  bars: Bar[],
  livePrice?: number,
  livePrevClose?: number,
): { eb: EarlyBreakout | null; pb: PullbackEntry | null } {

  const closes  = bars.map(b => b.c)
  const highs   = bars.map(b => b.h)
  const lows    = bars.map(b => b.l)
  const volumes = bars.map(b => b.v)
  const len = closes.length

  if (len < 20) return { eb: null, pb: null }

  // Use live snapshot prices if available, otherwise fall back to bar closes
  const curPrice  = livePrice ?? closes[len - 1]
  const prevClose = livePrevClose ?? closes[len - 2] ?? curPrice
  const curVol    = volumes[len - 1]
  const changePct = ((curPrice - prevClose) / prevClose) * 100

  // Crash filter
  if (changePct < -8) return { eb: null, pb: null }

  const sma10 = sma(closes, 10)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)

  if (!sma20) return { eb: null, pb: null }

  // ── Compression metrics ──
  const recent5H  = arrMax(highs, Math.max(0, len - 5))
  const recent5L  = arrMin(lows, Math.max(0, len - 5))
  const range5    = ((recent5H - recent5L) / prevClose) * 100

  const recent10H = arrMax(highs, Math.max(0, len - 10))
  const recent10L = arrMin(lows, Math.max(0, len - 10))
  const range10   = ((recent10H - recent10L) / prevClose) * 100

  // Buyout filter
  if (range5 < 0.8) return { eb: null, pb: null }

  const extFromSma20 = ((curPrice - sma20) / sma20) * 100

  const avgVol20_val = sma(volumes, 20) ?? 1
  const avgVol5_val  = sma(volumes.slice(-5), 5) ?? 0
  const baseVolRatio = avgVol20_val > 0 ? avgVol5_val / avgVol20_val : 1

  const breakoutLevel  = recent10H
  const distToBreakout = breakoutLevel > 0 ? ((breakoutLevel - curPrice) / curPrice) * 100 : 0
  const breakingOut    = curPrice > breakoutLevel

  const recentHigh15 = len >= 15 ? arrMax(highs, len - 15) : arrMax(highs, 0)
  const pullbackDepth = recentHigh15 > 0 ? ((recentHigh15 - curPrice) / recentHigh15) * 100 : 0

  const nearSma10 = sma10 !== null && Math.abs(curPrice - sma10) / curPrice * 100 <= 2
  const nearSma20 = Math.abs(curPrice - sma20) / curPrice * 100 <= 2

  let aboveSMAsCount = 0
  if (sma10 && curPrice > sma10) aboveSMAsCount++
  if (curPrice > sma20)           aboveSMAsCount++
  if (sma50 && curPrice > sma50) aboveSMAsCount++
  const smaStacked = !!(sma10 && sma50 && sma10 > sma20 && sma20 > sma50)

  // After-hours: no live volume surge, no live bounce signal
  const relativeVol = 0
  const curVwap     = 0

  // ════════════════════════════════════════════
  // CATEGORY 1: EARLY BREAKOUT
  // ════════════════════════════════════════════
  let eb: EarlyBreakout | null = null

  if (range5 <= 10 || range10 <= 12) {
    // Tightness (0-35 pts)
    let ebTight = 0
    const ebSignals: string[] = []

    if      (range5 <= 3)  { ebTight = 35; ebSignals.push(`Very tight 5d range (${range5.toFixed(1)}%)`) }
    else if (range5 <= 5)  { ebTight = 30; ebSignals.push(`Tight 5d range (${range5.toFixed(1)}%)`) }
    else if (range5 <= 7)  { ebTight = 22; ebSignals.push(`Compressing (${range5.toFixed(1)}% 5d)`) }
    else if (range5 <= 10) { ebTight = 14; ebSignals.push(`Building base (${range5.toFixed(1)}% 5d)`) }
    else if (range10 <= 12){ ebTight = 8 }

    // Volume dry-up (0-20 pts)
    let ebVolDry = 0
    if      (baseVolRatio <= 0.4)  { ebVolDry = 20; ebSignals.push(`Vol dried up (${Math.round(baseVolRatio * 100)}% of avg)`) }
    else if (baseVolRatio <= 0.6)  { ebVolDry = 15; ebSignals.push(`Vol declining (${Math.round(baseVolRatio * 100)}% of avg)`) }
    else if (baseVolRatio <= 0.75) { ebVolDry = 8 }

    // Breakout proximity (0-25 pts)
    let ebBreakout = 0
    if (breakingOut) {
      const breakPct = ((curPrice - breakoutLevel) / breakoutLevel) * 100
      if      (breakPct <= 2) { ebBreakout = 25; ebSignals.push(`Breaking out above $${breakoutLevel.toFixed(2)}`) }
      else if (breakPct <= 4) { ebBreakout = 15; ebSignals.push(`Above range by ${breakPct.toFixed(1)}%`) }
      else                    { ebBreakout = 5 }
    } else if (distToBreakout <= 1) { ebBreakout = 22; ebSignals.push(`At resistance ($${breakoutLevel.toFixed(2)})`) }
    else if   (distToBreakout <= 2) { ebBreakout = 18; ebSignals.push(`Near breakout ($${breakoutLevel.toFixed(2)}, ${distToBreakout.toFixed(1)}% away)`) }
    else if   (distToBreakout <= 4) { ebBreakout = 10 }

    // Extension penalty (-20 to +5 pts)
    let ebExt = 0
    if      (extFromSma20 <= 2)  ebExt = 5
    else if (extFromSma20 <= 5)  ebExt = 0
    else if (extFromSma20 <= 8)  ebExt = -5
    else if (extFromSma20 <= 12) ebExt = -10
    else                          ebExt = -20

    // No live volume surge server-side (after hours)
    const ebVolSurge = 0

    const ebScore = Math.round(Math.max(0, ebTight + ebVolDry + ebBreakout + ebExt + ebVolSurge))

    if (ebScore >= 35 && ebTight >= 14) {
      const entryPrice = breakingOut ? curPrice : breakoutLevel
      const stopPrice  = Math.max(recent5L, sma20 ? sma20 * 0.98 : recent10L)
      const riskPct    = entryPrice > 0 ? ((entryPrice - stopPrice) / entryPrice) * 100 : 0
      const targetPrice = entryPrice + (entryPrice - stopPrice) * 2

      eb = {
        ticker,
        category: 'EARLY BREAKOUT',
        price: curPrice,
        prevClose,
        changePct: Math.round(changePct * 100) / 100,
        score: ebScore,
        signals: ebSignals,
        description: ebSignals.join(' · '),
        range5: Math.round(range5 * 10) / 10,
        range10: Math.round(range10 * 10) / 10,
        extFromSma20: Math.round(extFromSma20 * 10) / 10,
        breakoutLevel,
        breakingOut,
        distToBreakout: Math.round(distToBreakout * 10) / 10,
        baseVolRatio: Math.round(baseVolRatio * 100),
        relativeVol: 0,
        volume: curVol,
        avgVol20: avgVol20_val,
        vwap: 0,
        entryPrice,
        stopPrice,
        targetPrice,
        riskPct: Math.round(riskPct * 10) / 10,
        components: {
          tightness: ebTight,
          volumeDryUp: ebVolDry,
          breakoutProximity: ebBreakout,
          extensionAdj: ebExt,
          volumeSurge: 0,
        },
      }
    }
  }

  // ════════════════════════════════════════════
  // CATEGORY 2: PULLBACK ENTRY
  // ════════════════════════════════════════════
  let pb: PullbackEntry | null = null

  if (pullbackDepth >= 3 && pullbackDepth <= 18 && sma50 && curPrice > sma50) {
    const pbSignals: string[] = []

    // Pullback quality (0-30 pts)
    let pbDepthPts = 0
    if      (pullbackDepth >= 4 && pullbackDepth <= 8)  { pbDepthPts = 30; pbSignals.push(`Healthy pullback (${pullbackDepth.toFixed(1)}% from high)`) }
    else if (pullbackDepth >= 3 && pullbackDepth <= 12) { pbDepthPts = 22; pbSignals.push(`Pulling back (${pullbackDepth.toFixed(1)}% from high)`) }
    else                                                  { pbDepthPts = 10; pbSignals.push(`Deep pullback (${pullbackDepth.toFixed(1)}%)`) }

    // Support level (0-25 pts)
    let pbSupport = 0
    let supportLabel = ''
    if (nearSma10 && nearSma20) {
      pbSupport = 25; pbSignals.push('Holding 10 & 20 SMA'); supportLabel = '20 SMA'
    } else if (nearSma20) {
      pbSupport = 22; pbSignals.push(`Holding 20 SMA ($${sma20.toFixed(2)})`); supportLabel = '20 SMA'
    } else if (nearSma10 && sma10) {
      pbSupport = 18; pbSignals.push(`At 10 SMA ($${sma10.toFixed(2)})`); supportLabel = '10 SMA'
    } else if (sma50 && Math.abs(curPrice - sma50) / curPrice * 100 <= 2) {
      pbSupport = 12; pbSignals.push(`At 50 SMA ($${sma50.toFixed(2)})`); supportLabel = '50 SMA'
    }

    // Volume declining on pullback (0-20 pts)
    let pbVolDry = 0
    if      (baseVolRatio <= 0.5)  { pbVolDry = 20; pbSignals.push(`Vol fading on pullback (${Math.round(baseVolRatio * 100)}% avg)`) }
    else if (baseVolRatio <= 0.7)  { pbVolDry = 14; pbSignals.push('Light volume pullback') }
    else if (baseVolRatio <= 0.85) { pbVolDry = 6 }

    // Trend intact (0-15 pts)
    let pbTrend = 0
    if      (smaStacked)          { pbTrend = 15; pbSignals.push('SMAs stacked bullish') }
    else if (aboveSMAsCount >= 2) { pbTrend = 10 }
    else if (curPrice > sma50)    { pbTrend = 5 }

    // No bounce signal server-side (after hours, no intraday data)
    const pbBounce = 0

    const pbScore = Math.round(Math.max(0, pbDepthPts + pbSupport + pbVolDry + pbTrend + pbBounce))

    if (pbScore >= 40 && pbSupport >= 12) {
      const pbStop   = sma50 ? sma50 * 0.98 : sma20 * 0.95
      const pbRisk   = curPrice > 0 ? ((curPrice - pbStop) / curPrice) * 100 : 0
      const pbTarget = curPrice + (curPrice - pbStop) * 2

      pb = {
        ticker,
        category: 'PULLBACK',
        price: curPrice,
        prevClose,
        changePct: Math.round(changePct * 100) / 100,
        score: pbScore,
        signals: pbSignals,
        description: pbSignals.join(' · '),
        pullbackDepth: Math.round(pullbackDepth * 10) / 10,
        supportLevel: supportLabel || 'VWAP',
        range5: Math.round(range5 * 10) / 10,
        baseVolRatio: Math.round(baseVolRatio * 100),
        relativeVol: 0,
        volume: curVol,
        avgVol20: avgVol20_val,
        vwap: 0,
        aboveSMAs: aboveSMAsCount + '/3',
        smaStacked,
        entryPrice: curPrice,
        stopPrice: pbStop,
        targetPrice: pbTarget,
        riskPct: Math.round(pbRisk * 10) / 10,
        components: {
          pullbackQuality: pbDepthPts,
          supportLevel: pbSupport,
          volumeDecline: pbVolDry,
          trendIntact: pbTrend,
          bounceSignal: 0,
        },
      }
    }
  }

  return { eb, pb }
}

// ── Main Handler ─────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Environment setup ──────────────────────────────
    const polygonKey = Deno.env.get('POLYGON_API_KEY')
    if (!polygonKey) {
      return new Response(JSON.stringify({ error: 'POLYGON_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl      = Deno.env.get('SUPABASE_URL')!
    const supabaseKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase         = createClient(supabaseUrl, supabaseKey)

    const scanDate = getLastTradingDay()

    // ── Cache check (bypass with ?force=true) ──────────
    const url   = new URL(req.url)
    const force = url.searchParams.get('force') === 'true'

    if (!force) {
      const { data: existing } = await supabase
        .from('scan_results')
        .select('id')
        .eq('scan_date', scanDate)
        .maybeSingle()

      if (existing) {
        return new Response(JSON.stringify({ message: `Scan already exists for ${scanDate}`, cached: true, scan_date: scanDate }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ══════════════════════════════════════════════════
    // STEP 1: Calculate the list of ~30 trading days to fetch
    // ══════════════════════════════════════════════════
    const tradingDays = getTradingDays(scanDate)
    console.log(`[daily-scanner] Fetching grouped data for ${tradingDays.length} trading days ending ${scanDate}`)

    // ══════════════════════════════════════════════════
    // STEP 2: Fetch grouped daily data in batches of 3
    // Each batch call returns ALL US stocks for that single date.
    // Early-filter tickers during map building to reduce CPU/memory.
    // ══════════════════════════════════════════════════
    //
    // Result structure: Map<ticker, Bar[]> sorted oldest → newest
    const tickerBars: Map<string, Bar[]> = new Map()
    let   successfulDays = 0

    const BATCH_SIZE = 3
    const BATCH_DELAY_MS = 200  // gentle on Polygon API between batches

    for (let i = 0; i < tradingDays.length; i += BATCH_SIZE) {
      const batch = tradingDays.slice(i, i + BATCH_SIZE)

      const batchResults = await Promise.all(
        batch.map(async (date) => {
          try {
            const data = await polyGet(
              `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
              polygonKey,
            )
            return { date, bars: data.results ?? [] }
          } catch (e: any) {
            console.warn(`[daily-scanner] Failed to fetch grouped data for ${date}: ${e.message}`)
            return { date, bars: [] }
          }
        })
      )

      // Merge each day's results into the ticker map
      for (const { date, bars: dayBars } of batchResults) {
        if (dayBars.length === 0) {
          console.log(`[daily-scanner] No data for ${date} (holiday or weekend edge case), skipping`)
          continue
        }
        successfulDays++

        for (const bar of dayBars) {
          if (!bar.T || bar.c == null || bar.v == null) continue

          const ticker = bar.T as string

          // ── Early filtering: skip tickers we'd discard anyway ──
          if (ticker.length > 5) continue                // warrants, units, etc.
          if (ticker.includes('.') || ticker.includes('-')) continue  // preferred, rights
          if (KNOWN_ETFS.has(ticker)) continue           // ETFs

          if (!tickerBars.has(ticker)) tickerBars.set(ticker, [])

          tickerBars.get(ticker)!.push({
            o:  bar.o,
            h:  bar.h,
            l:  bar.l,
            c:  bar.c,
            v:  bar.v,
            vw: bar.vw,
            t:  bar.t,
          })
        }
      }

      // Delay between batches to be gentle on Polygon
      if (i + BATCH_SIZE < tradingDays.length) {
        await sleep(BATCH_DELAY_MS)
      }
    }

    console.log(`[daily-scanner] Fetched ${successfulDays} trading days of data. ${tickerBars.size} unique tickers seen.`)

    if (successfulDays === 0) {
      return new Response(JSON.stringify({ error: `No grouped data returned for any day near ${scanDate}. Market may be closed.` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ══════════════════════════════════════════════════
    // STEP 3: Filter tickers
    // Each ticker's bars array is already in time order (we fetched oldest→newest).
    // Apply standard universe filters using the MOST RECENT day's data.
    // ══════════════════════════════════════════════════
    interface TickerCandidate {
      ticker: string
      bars: Bar[]
      latestClose: number
      latestVol: number
    }

    const candidates: TickerCandidate[] = []

    for (const [ticker, bars] of tickerBars.entries()) {
      // Require at least 20 days of data (handles IPOs / thin tickers)
      if (bars.length < 20) continue

      const latestBar = bars[bars.length - 1]
      const latestClose = latestBar.c
      const latestVol   = latestBar.v

      // Price filter: >= $5
      if (latestClose < 5) continue

      // Volume filter: >= 500K shares
      if (latestVol < 500_000) continue

      // Ticker/ETF filters already applied during map building (Step 2)

      candidates.push({ ticker, bars, latestClose, latestVol })
    }

    console.log(`[daily-scanner] ${candidates.length} candidates after filtering`)

    // Sort by dollar volume (highest liquidity first) — same as scanner.js
    candidates.sort((a, b) => (b.latestVol * b.latestClose) - (a.latestVol * a.latestClose))

    // ══════════════════════════════════════════════════
    // STEP 4: Score universe candidates with calcUniverseScore
    // ══════════════════════════════════════════════════
    const scored: Array<{
      ticker: string
      price: number
      volume: number
      score: number
      range5: number
      range10: number
      extFromSma20: number
      aboveSMAs: string
      volDryUp: number
      distToBreakout: number
      pullbackDepth: number
    }> = []

    for (const candidate of candidates) {
      const result = calcUniverseScore(candidate.bars, candidate.latestClose)
      if (result.total > 0) {
        scored.push({
          ticker:        candidate.ticker,
          price:         candidate.latestClose,
          volume:        candidate.latestVol,
          score:         result.total,
          range5:        result.range5,
          range10:       result.range10,
          extFromSma20:  result.extFromSma20,
          aboveSMAs:     result.aboveSMAs,
          volDryUp:      result.volDryUp,
          distToBreakout:result.distToBreakout,
          pullbackDepth: result.pullbackDepth,
        })
      }
    }

    // Sort by score and take top 150
    scored.sort((a, b) => b.score - a.score)
    const top150Initial = scored.slice(0, 150)

    console.log(`[daily-scanner] Universe: ${scored.length} scored, top ${top150Initial.length} candidates (pre-snapshot)`)

    // ══════════════════════════════════════════════════
    // STEP 4b: Fetch live snapshot for the top 150 tickers
    // Overlay live market prices onto the universe before final scoring.
    // This ensures scores reflect current market reality (gaps, premarket moves).
    // ══════════════════════════════════════════════════
    const snapshotTickers = top150Initial.map(s => s.ticker)
    const snapshot = await fetchLiveSnapshot(snapshotTickers, polygonKey)

    // Determine if we're running during market hours (snapshot has data)
    const hasLivePrices = snapshot.size > 0
    const scanMode = hasLivePrices ? 'live' : 'eod'

    // Get current ET time for metadata
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const etHour = nowET.getHours()
    const etMin  = nowET.getMinutes()
    const ampm   = etHour >= 12 ? 'PM' : 'AM'
    const h12    = etHour > 12 ? etHour - 12 : (etHour === 0 ? 12 : etHour)
    const etTimeStr = hasLivePrices
      ? `${h12}:${String(etMin).padStart(2, '0')} ${ampm}`
      : '4:00 PM'

    console.log(`[daily-scanner] Scan mode: ${scanMode}, ET time: ${etTimeStr}`)

    // Re-score universe with live prices where available
    const rescoredUniverse: typeof scored = []
    for (const stock of top150Initial) {
      const bars = tickerBars.get(stock.ticker)
      if (!bars || bars.length < 20) continue

      const snap = snapshot.get(stock.ticker)
      const priceForScoring = snap ? snap.price : stock.price  // live or fallback to bar close

      const result = calcUniverseScore(bars, priceForScoring)
      if (result.total > 0) {
        rescoredUniverse.push({
          ticker:        stock.ticker,
          price:         priceForScoring,  // live price in output
          volume:        snap ? snap.volume : stock.volume,
          score:         result.total,
          range5:        result.range5,
          range10:       result.range10,
          extFromSma20:  result.extFromSma20,
          aboveSMAs:     result.aboveSMAs,
          volDryUp:      result.volDryUp,
          distToBreakout:result.distToBreakout,
          pullbackDepth: result.pullbackDepth,
        })
      }
    }

    // Re-sort by live-price score and take top 150
    rescoredUniverse.sort((a, b) => b.score - a.score)
    const top150 = rescoredUniverse.slice(0, 150)

    console.log(`[daily-scanner] Universe after snapshot re-score: ${rescoredUniverse.length} → top ${top150.length}`)

    // ══════════════════════════════════════════════════
    // STEP 5: Run setup analysis on top 150 universe candidates
    // Uses live snapshot prices when available for accurate scoring.
    // No additional API calls needed — bars + snapshot already in memory.
    // ══════════════════════════════════════════════════
    const earlyBreakouts: EarlyBreakout[] = []
    const pullbackEntries: PullbackEntry[] = []

    for (const stock of top150) {
      // Look up the bars we already have for this ticker
      const bars = tickerBars.get(stock.ticker)
      if (!bars || bars.length < 20) continue

      // Pass live prices if snapshot data exists for this ticker
      const snap = snapshot.get(stock.ticker)
      const { eb, pb } = analyzeSetups(
        stock.ticker,
        bars,
        snap?.price,       // livePrice
        snap?.prevClose,   // livePrevClose
      )
      if (eb) earlyBreakouts.push(eb)
      if (pb) pullbackEntries.push(pb)
    }

    // Sort each category by score descending; cap at 15 each
    earlyBreakouts.sort((a, b) => b.score - a.score)
    pullbackEntries.sort((a, b) => b.score - a.score)
    const topEarlyBreakouts  = earlyBreakouts.slice(0, 15)
    const topPullbackEntries = pullbackEntries.slice(0, 15)

    console.log(`[daily-scanner] Setups: ${topEarlyBreakouts.length} early breakouts, ${topPullbackEntries.length} pullback entries`)

    // ══════════════════════════════════════════════════
    // STEP 6: Build output payload — must match frontend expectations exactly
    // ══════════════════════════════════════════════════
    const momentumUniverse = {
      version: 2,
      date: scanDate,
      ts: Date.now(),
      count: top150.length,
      tickers: top150,
    }

    const breakoutSetups = {
      date: scanDate,
      ts: Date.now(),
      mode: scanMode,              // 'live' during market hours, 'eod' after hours
      etTime: etTimeStr,           // e.g. '9:35 AM' or '4:00 PM'
      earlyBreakouts: topEarlyBreakouts,
      pullbackEntries: topPullbackEntries,
      // Legacy compatibility: combined array
      setups: [...topEarlyBreakouts, ...topPullbackEntries],
    }

    // ══════════════════════════════════════════════════
    // STEP 7: Upsert to scan_results table
    // ══════════════════════════════════════════════════
    const { error: upsertError } = await supabase
      .from('scan_results')
      .upsert(
        {
          scan_date:        scanDate,
          momentum_universe: momentumUniverse,
          breakout_setups:   breakoutSetups,
        },
        { onConflict: 'scan_date' }
      )

    if (upsertError) {
      throw new Error(`Supabase upsert failed: ${upsertError.message}`)
    }

    return new Response(
      JSON.stringify({
        message:            `Scan complete for ${scanDate}`,
        scan_date:          scanDate,
        trading_days_used:  successfulDays,
        tickers_seen:       tickerBars.size,
        candidates_filtered:candidates.length,
        universe_count:     top150.length,
        early_breakouts:    topEarlyBreakouts.length,
        pullback_entries:   topPullbackEntries.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (e: any) {
    console.error('[daily-scanner] Fatal error:', e)
    return new Response(
      JSON.stringify({ error: e?.message ?? 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
