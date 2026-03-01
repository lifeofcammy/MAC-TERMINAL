-- Feedback table migration
-- Run this in the Supabase SQL Editor to create the feedback table.
-- Until then, feedback is stored in user_settings as a fallback.

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  user_email text,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to insert feedback
CREATE POLICY "allow_authenticated_insert" ON public.feedback 
  FOR INSERT TO authenticated 
  WITH CHECK (true);

-- Allow service role full access (for admin viewing)
CREATE POLICY "service_role_all" ON public.feedback 
  FOR ALL TO service_role 
  USING (true);

-- Allow users to read their own feedback
CREATE POLICY "users_read_own" ON public.feedback
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
