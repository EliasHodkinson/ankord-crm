import { requireSectionPage } from "@/lib/access";

/**
 * Not found to a restricted person with Purchasing switched off (lib/sections.ts).
 * The reads behind these pages refuse them too; this spares them an empty page.
 */
export default async function PurchasingLayout({ children }: { children: React.ReactNode }) {
  await requireSectionPage("purchasing");
  return children;
}
