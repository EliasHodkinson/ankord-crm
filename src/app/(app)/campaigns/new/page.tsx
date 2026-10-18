import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { listCampaigns, listTemplates } from "@/lib/data/campaigns";
import { previewHtml } from "@/lib/campaigns/compose";
import { STARTERS } from "@/lib/campaigns/starters";
import { StartPicker } from "./start-picker";

export const metadata: Metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  await requireUser();
  await requireStaffPage();
  const { template } = await searchParams;
  const [settings, templates, past] = await Promise.all([getSettings(), listTemplates(), listCampaigns({ status: "sent" })]);

  const starters = STARTERS.map((s) => ({
    value: `starter:${s.id}`,
    name: s.name,
    description: s.description,
    html: previewHtml({ subject: s.subject, preheader: s.preheader, blocks: s.blocks(), theme: s.theme }, settings),
  }));
  const saved = templates.map(({ template: t, authorName }) => ({
    value: `template:${t.id}`,
    name: t.name,
    description: t.description ?? (authorName ? `Saved by ${authorName}` : "Saved template"),
    html: previewHtml(t, settings),
  }));
  const copies = past.slice(0, 6).map(({ campaign: c }) => ({
    value: `campaign:${c.id}`,
    name: c.name,
    description: c.subject,
    html: previewHtml(c, settings),
  }));

  return (
    <>
      <PageHeader
        title="New campaign"
        crumbs={[{ label: "Campaigns", href: "/campaigns" }, { label: "New" }]}
        description="Name it, pick a starting point, and you'll go straight to the editor. Nothing is sent until you say so."
      />
      <PageBody>
        <StartPicker
          starters={starters}
          saved={saved}
          copies={copies}
          initial={template ? `template:${template}` : "starter:newsletter"}
        />
      </PageBody>
    </>
  );
}
