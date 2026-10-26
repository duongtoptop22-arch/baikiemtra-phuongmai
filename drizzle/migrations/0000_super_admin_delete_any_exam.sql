CREATE POLICY "Super admin deletes any exam"
  ON public.exams
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));