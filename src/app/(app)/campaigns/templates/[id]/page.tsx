import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { getTemplate, listAssets } from "@/lib/data/campaigns";
import { logoUrl } from "@/lib/campaigns/compose";
import { cleanBlocks, cleanTheme } from "@/lib/campaigns/model";
import { appUrl } from "@/lib/env";
import { EmailEditor } from "../../editor/email-editor";

export const metadata: Metadata = { title: "Edit template" };
export const dynamic = "force-dynamic";

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  await requireStaffPage();
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t || t.archivedAt) notFound();
  const [settings, assets] = await Promise.all([getSettings(), listAssets()]);

  return (
    <EmailEditor
      kind="template"
      id={t.id}
      name={t.name}
      initial={{ subject: t.subject, preheader: t.preheader, blocks: cleanBlocks(t.blocks), theme: cleanTheme(t.theme) }}
      footer={settings?.marketingFooter ?? ""}
      social={settings?.marketingSocial ?? {}}
      defaultLogoUrl={logoUrl(settings)}
      fromLabel={`Ankor'd <${settings?.marketingMailbox ?? "marketing@ankord.com.au"}>`}
      assets={assets.map((a) => ({ id: a.id, name: a.name, url: `${appUrl()}/m/i/${a.id}` }))}
      backHref="/campaigns/templates"
    />
  );
}
