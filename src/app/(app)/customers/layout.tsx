import { requireSectionPage } from "@/lib/access";

/**
 * Not found to a restricted person with Business Partners switched off (lib/sections.ts).
 * The reads behind these pages refuse them too; this spares them an empty page.
 */
export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  await requireSectionPage("customers");
  return children;
}
