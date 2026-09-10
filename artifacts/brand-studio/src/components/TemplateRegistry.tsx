import { useEffect } from "react";
import { useListTemplates, getListTemplatesQueryKey } from "@workspace/api-client-react";
import { registerTemplateConfigs } from "@/components/TemplateRenderer";

/**
 * Loads user-defined custom templates once and registers their render configs so
 * the renderer (and gif/zip export) can resolve custom template keys everywhere.
 */
export function TemplateRegistry() {
  const { data } = useListTemplates({ include: "knowledge" }, { query: { queryKey: getListTemplatesQueryKey({ include: "knowledge" }), staleTime: 10 * 60_000 } });

  useEffect(() => {
    if (data) registerTemplateConfigs(data);
  }, [data]);

  return null;
}
