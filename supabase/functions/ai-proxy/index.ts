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
//
// Rate limiting: max 20 AI calls per user per hour (tracked in-memory per instance)

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

    } else {
      return new Response(JSON.stringify({ error: `Unknown task: ${task}. Supported: generate_analysis, analysis_chat` }), {
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
