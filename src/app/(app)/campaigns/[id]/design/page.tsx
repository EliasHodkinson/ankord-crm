import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { getCampaign, listAssets } from "@/lib/data/campaigns";
import { logoUrl } from "@/lib/campaigns/compose";
import { cleanBlocks, cleanTheme } from "@/lib/campaigns/model";
import { appUrl } from "@/lib/env";
import { EmailEditor } from "../../editor/email-editor";

export const metadata: Metadata = { title: "Edit email" };
export const dynamic = "force-dynamic";

export default async function CampaignDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  await requireStaffPage();
  const { id } = await params;
  const found = await getCampaign(id);
  if (!found) notFound();
  const { campaign: c } = found;
  // Only a draft is edited; anything already going out is shown, not changed.
  if (c.status !== "draft" && !(c.status === "paused" && !c.startedAt)) redirect(`/campaigns/${id}`);
  if (user.role !== "admin" && user.role !== "member") redirect(`/campaigns/${id}`);

  const [settings, assets] = await Promise.all([getSettings(), listAssets()]);
  const from =
    c.fromMode === "marketing"
      ? `Ankor'd <${settings?.marketingMailbox ?? "marketing@ankord.com.au"}>`
      : `${user.name} <${user.email}>`;

  return (
    <EmailEditor
      kind="campaign"
      id={c.id}
      name={c.name}
      initial={{ subject: c.subject, preheader: c.preheader, blocks: cleanBlocks(c.blocks), theme: cleanTheme(c.theme) }}
      footer={settings?.marketingFooter ?? ""}
      social={settings?.marketingSocial ?? {}}
      defaultLogoUrl={logoUrl(settings)}
      fromLabel={from}
      assets={assets.map((a) => ({ id: a.id, name: a.name, url: `${appUrl()}/m/i/${a.id}` }))}
      backHref={`/campaigns/${c.id}`}
    />
  );
}
