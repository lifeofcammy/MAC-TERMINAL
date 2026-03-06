// ==================== ai-proxy ====================
// Supabase Edge Function that proxies Anthropic API requests.
// The Anthropic key lives server-side as a secret — never exposed to the client.
//
// SECURITY: The client can NOT control the model, prompt, or max_tokens.
// Instead, the client sends a structured "task" request with only the data needed.
// Prompts are built server-side from hardcoded templates.
//
// Supported tasks:
//   - generate_analysis: Generate end-of-day market analysis for a given date
//   - analysis_chat: Chat with the AI about a specific day's analysis
//   - generate_themes: Generate today's market themes from biggest movers
//
// Rate limiting: max 20 AI calls per user per hour (tracked in-memory per instance)
// Last deployed: 2026-03-04

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ==================== RATE LIMITING (in-memory per instance) ====================
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

// ==================== SERVER-SIDE PROMPT TEMPLATES ====================

function buildAnalysisPrompt(date: string, spyChange: number, sectorContext: string, moverContext: string): string {
  return `You are a professional market analyst. Generate a full end-of-day analysis for ${date}.

SPY change: ${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}%

SECTOR PERFORMANCE:
${sectorContext}

BIGGEST MOVERS:
${moverContext}

Generate a complete analysis in this EXACT JSON format. Return ONLY the JSON object:
{
  "marketContext": "2-3 sentence summary of the day. What drove the session. Key headlines.",
  "movers": [
    {"ticker": "DELL", "changePct": 21.8, "sector": "Technology", "catchable": "yes|partial|no", "why": "1-2 sentences on what caused the move", "lesson": "1-2 sentences — what a trader should learn from this"}
  ],
  "sectorRotation": "MONEY FLOWING INTO: ... MONEY FLOWING OUT OF: ... NOTABLE: ...",
  "patterns": "DEVELOPING: bullet points of multi-day patterns building. FADING: patterns losing steam.",
  "missed": "Opportunities that were catchable but may have been missed. Actionable lessons.",
  "tomorrowWatch": "Priority setups for tomorrow. Specific tickers, levels, and strategies.",
  "probabilityMap": [
    {"ticker": "CRWD", "probability": 75, "tier": 1, "direction": "long|short|both", "catalyst": "short label", "thesis": "2-3 sentences", "keyLevels": "Support: $X | Resistance: $Y", "optionsPlay": "specific options strategy"}
  ],
  "watchlist": [
    {"theme": "Theme Name", "status": "active|watch|fading", "tickers": ["TICK1","TICK2"], "note": "Why this theme matters"}
  ],
  "mindset": {"score": 7, "scoreNote": "Brief note on discipline", "violations": [{"rule": "Rule name", "detail": "what happened"}], "wins": ["What went right"]}
}

RULES:
- Include 6-10 movers (biggest absolute % changes with clear catalysts)
- "catchable" = yes if the setup was visible pre-market or early session, partial if needed fast reaction, no if purely news-driven
- probabilityMap: 4-6 tickers ranked by probability of 3%+ move TOMORROW
- watchlist: 3-5 thematic groupings
- For mindset: since we dont know the users trades, give a general score of 7 with note "Auto-generated — update with your actual trades"
- Keep everything concise and trader-focused. No fluff.
- Return ONLY the JSON object.`
}

function buildChatSystemPrompt(analysisContext: string, patternData: string): string {
  return `You are Claude, embedded in a trader's MAC Terminal (Market Action Center) dashboard on the Analysis tab.

The trader uses options strategies including put spreads and covered calls. Morning setups before 10am tend to have highest win rates.
Key rules: Stick to your system. Avoid impulsive trades. Cash is a position.

RESPONSE RULES:
- Keep responses concise (2-4 short paragraphs max)
- Be specific with tickers, strikes, and levels
- Reference the analysis data
- Think like a trading partner
- If asked about setups, give actionable entry/exit/risk

TODAY'S ANALYSIS:
${analysisContext}${patternData}`
}

// ==================== INPUT VALIDATION ====================

function validateTicker(t: string): boolean {
  return typeof t === 'string' && /^[A-Z]{1,5}$/.test(t)
}

function sanitizeString(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return ''
  return s.slice(0, maxLen)
}

function validateMoverData(movers: unknown): { ticker: string; pct: number; close: number; newsHeadlines: string[] }[] {
  if (!Array.isArray(movers)) return []
  return movers.slice(0, 20).filter((m: any) =>
    m && validateTicker(m.ticker) && typeof m.pct === 'number' && typeof m.close === 'number'
  ).map((m: any) => ({
    ticker: m.ticker,
    pct: Number(m.pct),
    close: Number(m.close),
    newsHeadlines: Array.isArray(m.newsHeadlines) ? m.newsHeadlines.slice(0, 5).map((h: any) => sanitizeString(h, 200)) : []
  }))
}

function validateSectorData(sectors: unknown): { etf: string; name: string; pct: number }[] {
  if (!Array.isArray(sectors)) return []
  return sectors.slice(0, 15).filter((s: any) =>
    s && validateTicker(s.etf) && typeof s.name === 'string' && typeof s.pct === 'number'
  ).map((s: any) => ({
    etf: s.etf,
    name: sanitizeString(s.name, 50),
    pct: Number(s.pct)
  }))
}

function validateChatMessages(messages: unknown): { role: string; content: string }[] {
  if (!Array.isArray(messages)) return []
  return messages.slice(0, 20).filter((m: any) =>
    m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  ).map((m: any) => ({
    role: m.role,
    content: sanitizeString(m.content, 2000)
  }))
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the user is authenticated via Supabase JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limit check
    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the Anthropic key from secrets
    const anthropicKey = Deno.env.get('ANTHROPIC_KEY')
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Anthropic key not configured on server' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse the client request
    const body = await req.json()
    const { task } = body

    if (!task || typeof task !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid task parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ==================== TASK ROUTING ====================
    let anthropicBody: Record<string, unknown>

    if (task === 'generate_analysis') {
      // Validate inputs
      const date = sanitizeString(body.date, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const spyChange = typeof body.spyChange === 'number' ? body.spyChange : 0
      const movers = validateMoverData(body.movers)
      const sectors = validateSectorData(body.sectors)

      if (movers.length === 0) {
        return new Response(JSON.stringify({ error: 'No valid mover data provided.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Build context strings from validated data
      const moverContext = movers.map(m => {
        const dir = m.pct > 0 ? 'UP' : 'DOWN'
        const newsStr = m.newsHeadlines.length > 0
          ? '\n  Headlines: ' + m.newsHeadlines.slice(0, 3).join('; ')
          : '\n  No specific headlines.'
        return `${m.ticker} ${dir} ${m.pct.toFixed(1)}% (Close: $${m.close.toFixed(2)})${newsStr}`
      }).join('\n\n')

      const sectorContext = sectors.map(s =>
        `${s.name} (${s.etf}): ${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%`
      ).join('\n')

      const prompt = buildAnalysisPrompt(date, spyChange, sectorContext, moverContext)

      anthropicBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }

    } else if (task === 'analysis_chat') {
      // Validate inputs
      const chatMessages = validateChatMessages(body.chatHistory)
      if (chatMessages.length === 0) {
        return new Response(JSON.stringify({ error: 'No chat messages provided.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const analysisContext = sanitizeString(body.analysisContext, 8000)
      const patternData = sanitizeString(body.patternData, 4000)
      const systemPrompt = buildChatSystemPrompt(analysisContext, patternData)

      anthropicBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: chatMessages,
      }

    } else if (task === 'generate_themes') {
      // Validate inputs: movers array + optional market/news context
      const movers = validateMoverData(body.movers)
      if (movers.length === 0) {
        return new Response(JSON.stringify({ error: 'No valid mover data provided.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const marketContext = sanitizeString(body.marketContext, 500)
      const generalNews = sanitizeString(body.generalNews, 2000)

      const moverContext = movers.map(m => {
        const dir = m.pct > 0 ? 'UP' : 'DOWN'
        const newsStr = m.newsHeadlines.length > 0
          ? '\n  Headlines: ' + m.newsHeadlines.slice(0, 3).join('; ')
          : '\n  No specific headlines found.'
        return `${m.ticker} ${dir} ${m.pct.toFixed(1)}% ($${m.close.toFixed(2)})${newsStr}`
      }).join('\n\n')

      const prompt = `You are a professional market analyst. Here are today's biggest stock movers with their associated headlines.

Market Indices: ${marketContext}

Biggest Movers:
${moverContext}

General Headlines:
${generalNews}

Your task:
1. For each significant mover, write a 1-2 sentence explanation of WHY it moved (the catalyst). Include its SECTOR and specific INDUSTRY.
2. Group the day's action into 2-3 overarching themes (e.g., "AI Infrastructure Boom", "Earnings Season Winners", "Macro Fears").
3. Write a 1-sentence market narrative summary.
4. Create an industry heat check — which specific industries are hot/cold today.

Return JSON ONLY in this exact format:
{
  "narrative": "One sentence market summary",
  "movers": [
    {"ticker": "DELL", "pct": 21.8, "direction": "up", "reason": "Crushed Q4 earnings...", "sector": "Technology", "industry": "Hardware/Servers", "tags": ["Earnings", "AI"]}
  ],
  "themes": [
    {"title": "AI Infrastructure Spending Accelerates", "description": "DELL and... drove gains as AI capex surges."}
  ],
  "industries": [
    {"name": "Semiconductors", "direction": "up", "tickers": ["NVDA","AMD","AVGO"], "note": "AI chip demand driving broad strength"}
  ]
}

Rules:
- Only include movers that moved >2% and have a clear catalyst.
- "direction" must be "up" or "down".
- "pct" should be the actual percentage change (positive number for up, negative for down).
- "sector" is the broad GICS sector (Technology, Healthcare, Financials, etc.).
- "industry" is the specific sub-industry (Semiconductors, Cybersecurity, SaaS, E-commerce, Biotech, etc.).
- "tags" are short category labels like "Earnings", "M&A", "Guidance", "Macro", "AI", etc.
- "industries" array: group movers by their specific industry, show direction and brief note. Include 3-6 industries.
- Keep everything concise and trader-focused. No fluff.
- Return ONLY the JSON object.`

      anthropicBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }

    } else if (task === 'day_trade_scan') {
      // Validate inputs: stocks array with gap/ORB data
      const stocks = body.stocks
      if (!Array.isArray(stocks) || stocks.length === 0) {
        return new Response(JSON.stringify({ error: 'No stock data provided for day trade scan.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Sanitize stock data
      const cleanStocks = stocks.slice(0, 10).filter((s: any) =>
        s && validateTicker(s.ticker) && typeof s.gapPct === 'number'
      ).map((s: any) => ({
        ticker: s.ticker,
        gapPct: Number(s.gapPct),
        direction: s.direction === 'LONG' || s.direction === 'SHORT' ? s.direction : 'LONG',
        rvol: typeof s.rvol === 'number' ? s.rvol : 0,
        orHigh: typeof s.orHigh === 'number' ? s.orHigh : null,
        orLow: typeof s.orLow === 'number' ? s.orLow : null,
        orRangePct: typeof s.orRangePct === 'number' ? s.orRangePct : null,
        breakoutType: sanitizeString(s.breakoutType, 10),
        price: typeof s.price === 'number' ? s.price : 0,
        news: Array.isArray(s.news) ? s.news.slice(0, 3).map((n: any) => sanitizeString(n, 200)) : []
      }))

      if (cleanStocks.length === 0) {
        return new Response(JSON.stringify({ error: 'No valid stock data after validation.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const stockContext = cleanStocks.map((s: any) => {
        const newsStr = s.news.length > 0 ? '\n  News: ' + s.news.join('; ') : '\n  No news found.'
        const orbStr = s.orHigh ? `\n  OR High: $${s.orHigh} | OR Low: $${s.orLow} | OR Range: ${s.orRangePct}% | Breakout: ${s.breakoutType}` : '\n  No ORB data yet.'
        return `${s.ticker} — Gap: ${s.gapPct >= 0 ? '+' : ''}${s.gapPct.toFixed(1)}% | Direction: ${s.direction} | RVol: ${s.rvol.toFixed(1)}x | Price: $${s.price.toFixed(2)}${orbStr}${newsStr}`
      }).join('\n\n')

      const prompt = `You are a day trading analyst specializing in Opening Range Breakout (ORB) strategies.

Given these stocks that gapped today, rank the best day trade candidates.

STOCKS:
${stockContext}

For each stock, provide:
1. A 1-2 sentence thesis explaining why it's a good (or bad) day trade
2. A catalyst_score from 0-15 based on news quality (15 = major catalyst like earnings/FDA, 10 = moderate catalyst, 5 = weak catalyst, 0 = no clear catalyst)

Return JSON ONLY in this exact format:
{
  "picks": [
    {"ticker": "AAPL", "thesis": "Strong gap up on earnings beat with massive volume. Clean ORB breakout above $185 with tight range.", "catalyst_score": 15}
  ]
}

Rules:
- Include ALL provided tickers in your response
- Be specific about price levels and catalysts
- Focus on actionable day trading insights
- Keep thesis to 1-2 sentences max
- Return ONLY the JSON object.`

      anthropicBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }

    } else if (task === 'generate_recap') {
      // Validate inputs
      const indices = sanitizeString(body.indices, 500)
      const breadth = sanitizeString(body.breadth, 300)
      const sectors = sanitizeString(body.sectors, 500)
      const topMovers = sanitizeString(body.topMovers, 2000)
      const scannerSetups = sanitizeString(body.scannerSetups, 1000)

      const prompt = `You are a trading desk analyst writing a concise end-of-day recap for active traders.

TODAY'S INDEX PERFORMANCE:
${indices}

MARKET BREADTH:
${breadth}

SECTOR PERFORMANCE:
${sectors}

TOP MOVERS (by % change, min $10 price, 1M+ volume):
${topMovers}

SCANNER SETUPS (from today's compression/breakout scan):
${scannerSetups}

Write a concise end-of-day recap. Return JSON ONLY in this exact format:
{
  "summary": "2-3 sentence market summary. What drove the session, breadth quality, sector leadership/lagging.",
  "movers": [
    {"ticker": "OKTA", "pct": 9.1, "volume": "9M", "note": "1-2 sentence catalyst + why it matters for tomorrow"}
  ],
  "watchlist": [
    {"ticker": "AAPL", "level": "$185 support", "thesis": "1 sentence why to watch", "direction": "long|short"}
  ],
  "bias": {"direction": "bullish|bearish|neutral", "keyLevel": "SPY $675 support", "reasoning": "1 sentence why"}
}

Rules:
- Include 3-5 movers max (most significant by volume + catalyst quality)
- Include 3-5 watchlist items for tomorrow with specific price levels
- Be direct and actionable. No fluff. Think like a prop desk morning note.
- Return ONLY the JSON object.`

      anthropicBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }

    } else {
      return new Response(JSON.stringify({ error: `Unknown task: ${task}. Supported: generate_analysis, analysis_chat, generate_themes, day_trade_scan, generate_recap` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ==================== FORWARD TO ANTHROPIC ====================
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    })

    const anthropicData = await anthropicResp.json()

    if (!anthropicResp.ok) {
      return new Response(JSON.stringify(anthropicData), {
        status: anthropicResp.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(anthropicData), {
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
