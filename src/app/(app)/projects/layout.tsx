import { requireSectionPage } from "@/lib/access";

/**
 * Not found to a restricted person with Projects switched off (lib/sections.ts).
 * The reads behind these pages refuse them too; this spares them an empty page.
 */
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireSectionPage("projects");
  return children;
}
