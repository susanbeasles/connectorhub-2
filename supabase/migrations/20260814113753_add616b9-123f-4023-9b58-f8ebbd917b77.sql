
REVOKE EXECUTE ON FUNCTION public.is_operator(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_operator(uuid) TO authenticated, service_role;
