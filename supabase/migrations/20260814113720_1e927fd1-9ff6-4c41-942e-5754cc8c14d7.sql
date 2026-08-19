
CREATE TYPE public.operator_role AS ENUM ('owner', 'admin', 'viewer');

CREATE TABLE public.operators (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email text NOT NULL,
  role public.operator_role NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX operators_single_owner ON public.operators (role) WHERE role = 'owner';
CREATE UNIQUE INDEX operators_email_key ON public.operators (lower(email));

CREATE TABLE public.operator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.operator_role NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX operator_invites_email_key ON public.operator_invites (lower(email));

GRANT SELECT ON public.operators TO authenticated;
GRANT ALL ON public.operators TO service_role;
GRANT SELECT ON public.operator_invites TO authenticated;
GRANT ALL ON public.operator_invites TO service_role;

ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_operator(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.operators WHERE user_id = _user_id)
$$;

CREATE POLICY "Operators can read the roster" ON public.operators
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE POLICY "Operators can read invites" ON public.operator_invites
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
