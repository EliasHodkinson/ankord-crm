import { requireSectionPage } from "@/lib/access";

/**
 * Not found to a restricted person with Follow-ups switched off (lib/sections.ts).
 * The reads behind these pages refuse them too; this spares them an empty page.
 */
export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  await requireSectionPage("tasks");
  return children;
}
