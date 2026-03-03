// ==================== polygon-proxy ====================
// Supabase Edge Function that proxies Polygon.io API requests.
// The Polygon key lives server-side as a secret — never exposed to the client.
//
// SECURITY: The client sends only the Polygon path (e.g. /v2/aggs/ticker/SPY/...).
// The key is appended server-side. Requires a valid Supabase JWT.
//
// Rate limiting: 5 requests/second per user (Polygon paid tier is generous,
// but we don't want runaway loops).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const POLYGON_BASE = "https://api.polygon.io";
const POLYGON_KEY = Deno.env.get("POLYGON_API_KEY") || "";

// Simple per-user rate limiter: max 5 requests per second
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRate(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (bucket.count >= 5) return false;
  bucket.count++;
  return true;
}

// Allowed Polygon path prefixes — only proxy known endpoints
const ALLOWED_PREFIXES = [
  "/v2/aggs/",           // aggregate bars
  "/v2/snapshot/",       // snapshots
  "/v3/snapshot/",       // options snapshots
  "/v2/reference/news",  // news
  "/v2/reference/tickers", // ticker search
  "/v3/reference/",      // reference data
];

function isAllowedPath(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    // Verify Polygon key is configured
    if (!POLYGON_KEY) {
      return new Response(
        JSON.stringify({ error: "Polygon API key not configured on server." }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Authenticate user via Supabase JWT
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Rate limit check
    if (!checkRate(user.id)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Max 5 requests/second." }),
        { status: 429, headers: corsHeaders }
      );
    }

    // Parse request body
    const body = await req.json();
    const { path } = body;

    if (!path || typeof path !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'path' parameter." }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate the path is an allowed Polygon endpoint
    if (!isAllowedPath(path)) {
      return new Response(
        JSON.stringify({ error: "Requested Polygon endpoint is not allowed." }),
        { status: 403, headers: corsHeaders }
      );
    }

    // Build the full Polygon URL with key appended server-side
    const sep = path.includes("?") ? "&" : "?";
    const polygonUrl = POLYGON_BASE + path + sep + "apiKey=" + POLYGON_KEY;

    // Forward the request to Polygon
    const polyResp = await fetch(polygonUrl);
    const polyData = await polyResp.json();

    if (!polyResp.ok) {
      return new Response(
        JSON.stringify({ error: polyData.error || `Polygon returned ${polyResp.status}` }),
        { status: polyResp.status, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(polyData), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
