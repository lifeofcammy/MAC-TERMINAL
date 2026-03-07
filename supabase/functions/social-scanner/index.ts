// ==================== social-scanner ====================
// Supabase Edge Function that aggregates social signal data for stocks.
// Fetches Reddit mention counts and news volume data for given tickers.
//
// Tasks:
//   - reddit_mentions: Fetch mention frequency from Reddit investing subs
//   - news_volume: Count Polygon news articles per ticker (uses server-side Polygon key)
//
// Rate limiting: 10 requests/minute per user

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limiter: 10 req/min per user
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRate(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (bucket.count >= 10) return false;
  bucket.count++;
  return true;
}

// ==================== REDDIT FETCHER ====================
// Uses Reddit's public JSON API (no auth needed, rate-limited to ~60 req/min)
const REDDIT_SUBS = ["wallstreetbets", "stocks", "investing"];

interface RedditResult {
  ticker: string;
  totalMentions: number;
  topPosts: { title: string; score: number; sub: string; url: string }[];
}

async function fetchRedditMentions(tickers: string[]): Promise<RedditResult[]> {
  const results: RedditResult[] = [];

  for (const ticker of tickers) {
    let totalMentions = 0;
    const topPosts: { title: string; score: number; sub: string; url: string }[] = [];

    for (const sub of REDDIT_SUBS) {
      try {
        const url = `https://old.reddit.com/r/${sub}/search.json?q=${ticker}&restrict_sr=on&sort=new&t=week&limit=10`;
        const resp = await fetch(url, {
          headers: { "User-Agent": "MAC-Terminal/1.0 (market scanner)" },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const posts = data?.data?.children || [];
        totalMentions += posts.length;

        for (const p of posts.slice(0, 3)) {
          const d = p.data;
          if (d) {
            topPosts.push({
              title: (d.title || "").slice(0, 200),
              score: d.score || 0,
              sub: sub,
              url: `https://reddit.com${d.permalink || ""}`,
            });
          }
        }
      } catch (_e) {
        // Skip failed sub
      }
    }

    // Sort by score descending, keep top 5
    topPosts.sort((a, b) => b.score - a.score);

    results.push({
      ticker,
      totalMentions,
      topPosts: topPosts.slice(0, 5),
    });
  }

  return results;
}

// ==================== NEWS VOLUME (Polygon) ====================
async function fetchNewsVolume(
  tickers: string[],
  polygonKey: string
): Promise<{ ticker: string; articleCount: number; headlines: string[] }[]> {
  const results: { ticker: string; articleCount: number; headlines: string[] }[] = [];

  // Fetch news for all tickers at once (Polygon supports comma-separated)
  // But we batch in groups of 10 to avoid URL length issues
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += 10) {
    batches.push(tickers.slice(i, i + 10));
  }

  // Track per-ticker counts
  const tickerCounts = new Map<string, { count: number; headlines: string[] }>();
  for (const t of tickers) {
    tickerCounts.set(t, { count: 0, headlines: [] });
  }

  for (const batch of batches) {
    try {
      const tickerParam = batch.join(",");
      const url = `https://api.polygon.io/v2/reference/news?ticker=${tickerParam}&limit=50&order=desc&sort=published_utc&apiKey=${polygonKey}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      const articles = data?.results || [];

      for (const article of articles) {
        const articleTickers: string[] = article.tickers || [];
        const title = article.title || "";
        for (const t of articleTickers) {
          const entry = tickerCounts.get(t);
          if (entry) {
            entry.count++;
            if (entry.headlines.length < 5) {
              entry.headlines.push(title.slice(0, 200));
            }
          }
        }
      }
    } catch (_e) {
      // Skip failed batch
    }
  }

  for (const [ticker, data] of tickerCounts) {
    results.push({ ticker, articleCount: data.count, headlines: data.headlines });
  }

  return results;
}

// ==================== MAIN HANDLER ====================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!checkRate(user.id)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Max 10 requests/minute." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { task, tickers } = body;

    // Validate tickers
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing or empty tickers array." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanTickers = tickers
      .filter((t: unknown) => typeof t === "string" && /^[A-Z]{1,5}$/.test(t as string))
      .slice(0, 50) as string[];

    if (cleanTickers.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid tickers provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (task === "reddit_mentions") {
      const results = await fetchRedditMentions(cleanTickers);
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (task === "news_volume") {
      const polygonKey = Deno.env.get("POLYGON_API_KEY") || "";
      if (!polygonKey) {
        return new Response(
          JSON.stringify({ error: "Polygon API key not configured." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const results = await fetchNewsVolume(cleanTickers, polygonKey);
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown task: ${task}. Supported: reddit_mentions, news_volume` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
