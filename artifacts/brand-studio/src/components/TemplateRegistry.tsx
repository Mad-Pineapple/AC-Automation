import { useEffect } from "react";
import { useListTemplates } from "@workspace/api-client-react";
import { registerTemplateConfigs } from "@/components/TemplateRenderer";

/**
 * Loads user-defined custom templates once and registers their render configs so
 * the renderer (and gif/zip export) can resolve custom template keys everywhere.
 */
export function TemplateRegistry() {
  const { data } = useListTemplates();

  useEffect(() => {
    if (data) registerTemplateConfigs(data);
  }, [data]);

  return null;
}
