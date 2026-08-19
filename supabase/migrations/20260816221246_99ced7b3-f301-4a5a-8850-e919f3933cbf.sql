DELETE FROM public.mfa_factors WHERE label = 'Passkey' AND kind = 'passkey' AND created_at > now() - interval '30 minutes';
DELETE FROM public.webauthn_credentials WHERE created_at > now() - interval '30 minutes';
DELETE FROM public.mfa_recovery_codes WHERE created_at > now() - interval '30 minutes';