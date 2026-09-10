CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin');

CREATE TABLE public.allowed_teachers (
  email text PRIMARY KEY,
  role public.app_role NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowed_teachers TO authenticated;
GRANT ALL ON public.allowed_teachers TO service_role;
ALTER TABLE public.allowed_teachers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users view own roles" ON public.user_roles
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Super admin views roles" ON public.user_roles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin reads allowlist" ON public.allowed_teachers
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admin manages allowlist" ON public.allowed_teachers
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_allowed_teachers_updated_at
BEFORE UPDATE ON public.allowed_teachers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.allowed_teachers (email, role) VALUES
  ('duongtoptop22@gmail.com', 'super_admin'),
  ('phuongwmai@gmail.com', 'admin');