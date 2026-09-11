DROP POLICY IF EXISTS "Anyone can update an attempt" ON public.exam_attempts;
REVOKE UPDATE ON public.exam_attempts FROM anon, authenticated;