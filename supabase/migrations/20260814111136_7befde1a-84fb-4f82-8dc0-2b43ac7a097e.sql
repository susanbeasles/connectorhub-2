CREATE TABLE public.signing_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kid TEXT NOT NULL UNIQUE,
  public_jwk JSONB NOT NULL,
  private_jwk_encrypted TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT ALL ON public.signing_keys TO service_role;
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX signing_keys_active_one ON public.signing_keys (active) WHERE active;