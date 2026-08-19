import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { currentOperator } from "@/lib/operator.functions";
import { useAuth } from "./useAuth";

/** Single source of truth for "may this identity use the console at all". */
export function useOperator() {
  const { session, loading } = useAuth();
  const fetchOperator = useServerFn(currentOperator);
  const query = useQuery({
    queryKey: ["operator", session?.user.id ?? null],
    enabled: !!session,
    staleTime: 60_000,
    queryFn: () => fetchOperator({ data: undefined }),
  });

  return {
    operator: query.data ?? null,
    loading: loading || (!!session && query.isLoading),
    signedIn: !!session,
  };
}
