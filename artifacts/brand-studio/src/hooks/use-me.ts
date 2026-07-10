import { useQuery } from "@tanstack/react-query";

export interface MeData {
  id: number;
  clerkId: string;
  role: string;
  email: string | null;
  name: string | null;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me", { credentials: "include" });
      // Only 401 means "not authenticated" (returns null). Other non-OK
      // statuses (e.g. 500/502 while the API server restarts) must throw so
      // callers see an error state rather than a false "signed out" — the
      // Layout "session unrecognized" banner keys off `data === null`.
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`);
      return res.json() as Promise<MeData>;
    },
    staleTime: 60_000,
  });
}
