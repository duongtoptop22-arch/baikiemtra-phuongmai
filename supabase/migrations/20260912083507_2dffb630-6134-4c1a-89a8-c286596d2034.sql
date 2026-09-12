DROP POLICY "Anyone can view exams" ON public.exams;

CREATE POLICY "Public views exams while open"
ON public.exams FOR SELECT TO anon
USING (registration_open AND (close_at IS NULL OR close_at > now()));

CREATE POLICY "Teachers view own exams"
ON public.exams FOR SELECT TO authenticated
USING (auth.uid() = teacher_id);

CREATE POLICY "Super admin views all exams"
ON public.exams FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin views all attempts"
ON public.exam_attempts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin views all questions"
ON public.exam_questions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));