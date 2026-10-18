import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { listTemplates } from "@/lib/data/campaigns";
import { previewHtml } from "@/lib/campaigns/compose";
import { STARTERS } from "@/lib/campaigns/starters";
import { relativeTime } from "@/lib/utils";
import { MarketingHeader } from "../marketing-header";
import { PreviewThumb } from "../editor/preview-frame";
import { NewTemplateForm, TemplateMenu } from "./template-forms";

export const metadata: Metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { user } = await requireUser();
  await requireStaffPage();
  const writer = user.role === "admin" || user.role === "member";
  const [settings, templates] = await Promise.all([getSettings(), listTemplates()]);

  return (
    <>
      <MarketingHeader
        title="Campaigns"
        description="Templates are where a good email starts. The team's own sit beside the Ankor'd starters."
      />
      <PageBody className="flex flex-col gap-8">
        {writer ? <NewTemplateForm starters={STARTERS.map((s) => ({ value: s.id, label: s.name }))} /> : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold text-[var(--text)]">The team&rsquo;s templates</h2>
          {templates.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {templates.map(({ template: t, authorName }) => (
                <Card key={t.id} className="overflow-hidden">
                  <Link href={writer ? `/campaigns/templates/${t.id}` : `/campaigns/new?template=${t.id}`} className="block">
                    <PreviewThumb html={previewHtml(t, settings)} className="border-b border-[var(--border-soft)] bg-[var(--surface-3)]" />
                  </Link>
                  <div className="flex items-start justify-between gap-2 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--text)]">{t.name}</p>
                      <p className="truncate text-[12px] text-[var(--text-muted)]">
                        {authorName ? `${authorName} · ` : ""}edited {relativeTime(t.updatedAt)}
                      </p>
                    </div>
                    {writer ? <TemplateMenu id={t.id} /> : null}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="rounded-[10px] border border-dashed border-[var(--border)] px-4 py-6 text-[13px] text-[var(--text-muted)]">
              None yet. Make one above, or save any campaign as a template from its page.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--text)]">Ankor&rsquo;d starters</h2>
            <p className="text-[12px] text-[var(--text-muted)]">Built in, always here. Start a campaign from one, or copy it into a template to make it yours.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {STARTERS.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <PreviewThumb
                  html={previewHtml({ subject: s.subject, preheader: s.preheader, blocks: s.blocks(), theme: s.theme }, settings)}
                  className="border-b border-[var(--border-soft)] bg-[var(--surface-3)]"
                />
                <div className="flex flex-col gap-2 px-3.5 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text)]">{s.name}</p>
                    <p className="line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{s.description}</p>
                  </div>
                  {writer ? (
                    <ButtonLink href="/campaigns/new" size="sm" variant="secondary" className="self-start">
                      Use in a campaign
                    </ButtonLink>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </section>
      </PageBody>
    </>
  );
}
