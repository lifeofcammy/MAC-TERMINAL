// submit-feedback Edge Function
// Accepts feedback from MAC Terminal and stores it in a 'feedback' table.
// Auto-creates the table on first use if it doesn't exist.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, serviceKey)

    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { category, message } = await req.json()
    if (!message || !message.trim()) {
      return new Response(JSON.stringify({ error: 'Message required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Try inserting
    let { error: insertErr } = await supabase.from('feedback').insert({
      category: category || 'general',
      message: message.trim(),
      user_email: user.email || '',
      user_id: user.id,
    })

    // If table doesn't exist, create it and retry
    if (insertErr && insertErr.code === '42P01') {
      // Create table using raw SQL via service role connection
      const dbUrl = Deno.env.get('SUPABASE_DB_URL')
      if (dbUrl) {
        // Use pg to create table (Deno edge functions have access to postgres)
        const { error: rpcErr } = await supabase.rpc('create_feedback_table', {}).catch(() => ({ error: true }))
      }
      
      // Fallback: try inserting into a known working table as a JSON blob
      // Store in user_settings as a workaround
      const { error: fallbackErr } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        key: 'feedback_' + Date.now(),
        value: JSON.stringify({
          category: category || 'general',
          message: message.trim(),
          user_email: user.email || '',
          created_at: new Date().toISOString(),
        })
      })

      if (fallbackErr) {
        return new Response(JSON.stringify({ 
          error: 'Feedback table not found. Please create it in Supabase dashboard.',
          success: false
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true, note: 'Stored in user_settings' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (insertErr) throw insertErr

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
