import { requireSectionPage } from "@/lib/access";

/**
 * Not found to a restricted person with Link email switched off (lib/sections.ts).
 * The reads behind these pages refuse them too; this spares them an empty page.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  await requireSectionPage("inbox");
  return children;
}
