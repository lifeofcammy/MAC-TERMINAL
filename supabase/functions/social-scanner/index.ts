// ==================== social-scanner ====================
// Supabase Edge Function that aggregates social signal data for stocks.
// Fetches Reddit mentions, news volume, and Google Trends data for given tickers.
//
// Tasks:
//   - reddit_mentions: Fetch mention frequency from Reddit investing subs
//   - news_volume: Count Polygon news articles per ticker (uses server-side Polygon key)
//   - google_trends: Fetch Google Trends interest data for ticker brand names
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

// ==================== GOOGLE TRENDS ====================
// Scrapes Google Trends internal API (same approach as open-source google-trends-api npm package).
// No API key needed. Returns relative search interest (0-100) for each keyword.

// Ticker → brand/company name mapping for consumer-facing companies
const TICKER_BRANDS: Record<string, string> = {
  AAPL: "Apple", AMZN: "Amazon", TSLA: "Tesla", NFLX: "Netflix", DIS: "Disney",
  NKE: "Nike", SBUX: "Starbucks", MCD: "McDonalds", COST: "Costco", WMT: "Walmart",
  TGT: "Target", LULU: "Lululemon", CROX: "Crocs", ELF: "elf Beauty", CELH: "Celsius energy drink",
  DKNG: "DraftKings", RBLX: "Roblox", SPOT: "Spotify", ABNB: "Airbnb", UBER: "Uber",
  META: "Instagram", SNAP: "Snapchat", PINS: "Pinterest", ETSY: "Etsy", CHWY: "Chewy",
  DASH: "DoorDash", BROS: "Dutch Bros", CAVA: "Cava restaurant", DUOL: "Duolingo", HIMS: "Hims",
  PLTR: "Palantir", SHOP: "Shopify", SQ: "Cash App", PYPL: "PayPal", COIN: "Coinbase",
  RIVN: "Rivian", LCID: "Lucid Motors", GME: "GameStop", AMC: "AMC Theatres", SOFI: "SoFi",
  NVDA: "Nvidia", AMD: "AMD", MSFT: "Microsoft", GOOGL: "Google", SMCI: "Supermicro",
  DECK: "UGG boots", SPHR: "Sphere Las Vegas", BIRD: "Allbirds", LEVI: "Levis",
  ROKU: "Roku", TTD: "The Trade Desk", MTCH: "Tinder", BMBL: "Bumble",
  CMG: "Chipotle", SHAK: "Shake Shack", WING: "Wingstop", PZZA: "Papa Johns",
  PTON: "Peloton", YETI: "Yeti cooler", COOK: "Traeger grill", ONON: "On Running shoes",
  MNST: "Monster energy", KO: "Coca Cola", PEP: "Pepsi", SBUX: "Starbucks",
};

interface TrendResult {
  ticker: string;
  keyword: string;
  trendScore: number;       // Current interest (0-100)
  avgInterest: number;      // Average over period
  spikeRatio: number;       // Current vs average (>1.5 = spike)
  trending: "up" | "down" | "flat";
}

async function fetchGoogleTrends(tickers: string[]): Promise<TrendResult[]> {
  const results: TrendResult[] = [];

  for (const ticker of tickers) {
    // Map ticker to a consumer brand/product keyword
    const keyword = TICKER_BRANDS[ticker] || ticker;

    try {
      // Step 1: Get the explore widget token
      const exploreReq = {
        comparisonItem: [{ keyword, geo: "US", time: "today 3-m" }],
        category: 0,
        property: "",
      };
      const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=300&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
      const exploreResp = await fetch(exploreUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });

      if (!exploreResp.ok) {
        results.push({ ticker, keyword, trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: "flat" });
        continue;
      }

      // Google prepends ")]}',\n" to the response — strip it
      const exploreText = await exploreResp.text();
      const exploreJson = JSON.parse(exploreText.replace(/^\)\]\}\',?\n/, ""));

      // Find the TIMESERIES widget
      const timeWidget = exploreJson.widgets?.find(
        (w: any) => w.id === "TIMESERIES"
      );
      if (!timeWidget || !timeWidget.token) {
        results.push({ ticker, keyword, trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: "flat" });
        continue;
      }

      // Step 2: Fetch interest over time using the widget token
      const multiReq = timeWidget.request;
      const multiUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=300&req=${encodeURIComponent(JSON.stringify(multiReq))}&token=${timeWidget.token}`;
      const multiResp = await fetch(multiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });

      if (!multiResp.ok) {
        results.push({ ticker, keyword, trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: "flat" });
        continue;
      }

      const multiText = await multiResp.text();
      const multiJson = JSON.parse(multiText.replace(/^\)\]\}\',?\n/, ""));

      const timelineData = multiJson?.default?.timelineData || [];
      if (timelineData.length === 0) {
        results.push({ ticker, keyword, trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: "flat" });
        continue;
      }

      // Extract values (each entry has value[0] = interest score 0-100)
      const values = timelineData.map((d: any) => d.value?.[0] || 0);
      const current = values[values.length - 1] || 0;
      const avg = values.reduce((s: number, v: number) => s + v, 0) / values.length;
      const spikeRatio = avg > 0 ? current / avg : 0;

      // Determine trend direction from last 4 data points
      const recent = values.slice(-4);
      let trending: "up" | "down" | "flat" = "flat";
      if (recent.length >= 4) {
        const firstHalf = (recent[0] + recent[1]) / 2;
        const secondHalf = (recent[2] + recent[3]) / 2;
        if (secondHalf > firstHalf * 1.15) trending = "up";
        else if (secondHalf < firstHalf * 0.85) trending = "down";
      }

      results.push({
        ticker,
        keyword,
        trendScore: current,
        avgInterest: Math.round(avg),
        spikeRatio: Math.round(spikeRatio * 100) / 100,
        trending,
      });
    } catch (_e) {
      results.push({ ticker, keyword, trendScore: 0, avgInterest: 0, spikeRatio: 0, trending: "flat" });
    }
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
    } else if (task === "google_trends") {
      const results = await fetchGoogleTrends(cleanTickers);
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown task: ${task}. Supported: reddit_mentions, news_volume, google_trends` }),
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
