// Brand-asset folders whose name mentions "template" (e.g. "Signage templates",
// "Video templates") are surfaced on the Templates page instead of the brand
// Library tab. Keep the predicate in one place so both views stay in sync.
export function isTemplateFolder(folder: string | null | undefined): folder is string {
  return !!folder && /template/i.test(folder);
}
