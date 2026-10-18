import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Info,
  Pencil,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { ChartFrame, Columns, StatTile } from "@/components/ui/charts";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { CAMPAIGN_STATUS, RECIPIENT_STATUS, StatusBadge } from "@/components/ui/status";
import { requireUser, sessionScopes } from "@/lib/auth/session";
import { hasScopeSet } from "@/lib/auth/entra";
import { getAccess, requireStaffPage } from "@/lib/access";
import { getDb } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { getSettings, listTeam } from "@/lib/data/common";
import { campaignReport, getCampaign, listSegments, listSentCampaigns } from "@/lib/data/campaigns";
import { audienceOptions, resolveAudience } from "@/lib/campaigns/audience";
import { checkContent } from "@/lib/campaigns/checks";
import { previewHtml } from "@/lib/campaigns/compose";
import { cleanBlocks, ENGAGEMENT_LABELS, normaliseAudience, percent } from "@/lib/campaigns/model";
import { formatDateTime, relativeTime, truncate } from "@/lib/utils";
import { AudienceBuilder } from "../audience-builder";
import { PreviewThumb } from "../editor/preview-frame";
import { AllowSending, CampaignActions, CampaignSettingsForm, ScheduleForm, SendingPoller, TestSendForm } from "./campaign-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const found = await getCampaign(id).catch(() => null);
  return { title: found?.campaign.name ?? "Campaign" };
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { user } = await requireUser();
  await requireStaffPage();
  const { id } = await params;
  const { show } = await searchParams;
  const found = await getCampaign(id);
  if (!found) notFound();

  const { campaign: c, stats } = found;
  const started = Boolean(c.startedAt);
  const writer = user.role === "admin" || user.role === "member";
  const canSend = hasScopeSet(await sessionScopes(), "marketing");
  const allowHref = `/api/auth/signin?scopes=marketing&next=${encodeURIComponent(`/campaigns/${id}`)}`;
  const settings = await getSettings();

  const header = (
    <PageHeader
      title={c.name}
      crumbs={[{ label: "Campaigns", href: "/campaigns" }, { label: c.name }]}
      eyebrow={<StatusBadge map={CAMPAIGN_STATUS} value={c.status} dot={c.status === "sending" || c.status === "testing"} />}
      meta={
        <p className="text-[13px] text-[var(--text-muted)]">
          {c.status === "scheduled" && c.scheduledAt
            ? `Goes out ${formatDateTime(c.scheduledAt)} · from ${c.fromMode === "marketing" ? (settings?.marketingMailbox ?? "the marketing mailbox") : (found.senderEmail ?? "the sender")}`
            : started
              ? `Started ${formatDateTime(c.startedAt)} by ${found.senderName ?? "someone"} · from ${c.fromAddress}`
              : `Draft by ${found.creatorName ?? "someone"} · edited ${relativeTime(c.updatedAt)}`}
        </p>
      }
      actions={
        writer ? (
          <CampaignActions
            id={c.id}
            name={c.name}
            status={c.status}
            started={started}
            canResume={canSend && !(c.fromMode === "me" && c.senderId && c.senderId !== user.id)}
          />
        ) : null
      }
    />
  );

  const lastError = c.lastError ? (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3.5 py-3 text-[13px] text-[var(--warn)]"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {c.lastError}
        {c.status === "paused" && !canSend ? (
          <>
            {" "}
            <a href={allowHref} className="font-medium underline underline-offset-2">
              Allow sending
            </a>{" "}
            then resume.
          </>
        ) : null}
      </span>
    </div>
  ) : null;

  if (!started) {
    return (
      <>
        {header}
        <SetupView
          id={id}
          campaign={c}
          writer={writer}
          canSend={canSend}
          allowHref={allowHref}
          userEmail={user.email}
          settings={settings}
          lastError={lastError}
        />
      </>
    );
  }

  /* ── report ────────────────────────────────────────────────────── */

  const report = await campaignReport(id, show);
  const active = c.status === "sending" || c.status === "testing";
  const done = stats.sent + stats.failed;
  const totalClicks = report.links.reduce((n, l) => n + l.clicks, 0);
  const firstDay = report.timeline.slice(0, 24);
  const ab = c.abTest?.subjectB ? c.abTest : null;

  return (
    <>
      {header}
      <SendingPoller id={id} active={active} />
      <PageBody className="flex flex-col gap-5">
        {lastError}

        {active || stats.waiting ? (
          <Card>
            <CardBody className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-medium text-[var(--text)]">
                  {c.status === "testing"
                    ? `Testing subject lines — the winner goes to the rest ${c.abDecideAt ? relativeTime(c.abDecideAt) : "soon"}`
                    : active
                      ? "Sending — about 25 a minute, so Exchange stays happy"
                      : "Paused"}
                </p>
                <p className="text-[12px] text-[var(--text-muted)] tabular">
                  {done.toLocaleString("en-AU")} of {stats.recipients.toLocaleString("en-AU")}
                </p>
              </div>
              <ProgressBar done={done} total={stats.recipients} />
              <p className="text-[12px] text-[var(--text-faint)]">
                You can close this page — sending carries on in the background as {found.senderName ?? "the sender"}.
              </p>
            </CardBody>
          </Card>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Delivered to Exchange" value={stats.sent.toLocaleString("en-AU")} detail={`of ${stats.recipients.toLocaleString("en-AU")} recipients`} />
          <StatTile label="Opened" value={percent(stats.opened, stats.sent)} detail={`${stats.opened} ${stats.opened === 1 ? "person" : "people"}`} />
          <StatTile label="Clicked" value={percent(stats.clicked, stats.sent)} detail={`${stats.clicked} ${stats.clicked === 1 ? "person" : "people"} · ${percent(stats.clicked, stats.opened)} of openers`} />
          <StatTile label="Unsubscribed" value={stats.unsubscribed.toLocaleString("en-AU")} detail={percent(stats.unsubscribed, stats.sent)} tone={stats.unsubscribed && stats.unsubscribed / Math.max(stats.sent, 1) > 0.01 ? "danger" : undefined} />
          <StatTile label="Bounced or failed" value={(stats.bounced + stats.failed).toLocaleString("en-AU")} detail={`${stats.bounced} bounced · ${stats.failed} failed`} tone={stats.bounced + stats.failed ? "danger" : undefined} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-5">
            <ChartFrame
              title="First opens, by hour after sending"
              subtitle="The first 24 hours"
              table={{ head: ["Hour", "Opens", "Clicks"], rows: firstDay.map((t) => [`${t.hour}–${t.hour + 1}h`, t.opens, t.clicks]) }}
            >
              <Columns
                data={firstDay.map((t) => ({ label: t.hour % 3 === 0 ? `${t.hour}h` : "", value: t.opens }))}
                emptyLabel="No opens recorded yet"
              />
            </ChartFrame>

            {ab ? (
              <Card>
                <CardHeader
                  title="Subject line test"
                  meta={
                    c.abWinner
                      ? `Subject ${c.abWinner.toUpperCase()} won on ${ab.metric} and went to everyone else.`
                      : ab.testPercent >= 100
                        ? "The whole audience was split; this compares the two."
                        : `The winner is chosen by ${ab.metric} ${c.abDecideAt ? relativeTime(c.abDecideAt) : ""}.`
                  }
                />
                <CardBody className="grid gap-3 sm:grid-cols-2">
                  {(["a", "b"] as const).map((v) => {
                    const r = report.variants[v];
                    return (
                      <div
                        key={v}
                        className={
                          "rounded-lg border p-3 " +
                          (c.abWinner === v ? "border-[var(--ok)]/40 bg-[var(--ok-bg)]" : "border-[var(--border)]")
                        }
                      >
                        <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-muted)]">
                          Subject {v.toUpperCase()}
                          {c.abWinner === v ? <Badge tone="ok">Winner</Badge> : null}
                        </p>
                        <p className="mt-1 text-[14px] font-medium text-[var(--text)]">{v === "a" ? c.subject : ab.subjectB}</p>
                        <p className="mt-2 text-[12px] text-[var(--text-muted)] tabular">
                          {r.sent} sent · {percent(r.opened, r.sent)} opened · {percent(r.clicked, r.sent)} clicked
                        </p>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Links" meta={totalClicks ? `${totalClicks} ${totalClicks === 1 ? "click" : "clicks"} in all` : "No clicks yet"} />
              {report.links.length ? (
                <ul>
                  {report.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-2.5 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--text)]">{l.label}</p>
                        <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[12px] text-[var(--text-muted)] hover:underline underline-offset-2">
                          {truncate(l.url, 80)}
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </div>
                      <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--chart-track)]" aria-hidden>
                        <div
                          className="h-full rounded-r-[4px] bg-[var(--chart-series)]"
                          style={{ width: `${totalClicks ? Math.round((l.clicks / totalClicks) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="w-24 shrink-0 text-right text-[12px] text-[var(--text-muted)] tabular">
                        {l.people} {l.people === 1 ? "person" : "people"}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody>
                  <p className="text-[13px] text-[var(--text-muted)]">This email had no trackable links.</p>
                </CardBody>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-5">
            <Card className="overflow-hidden">
              <CardHeader
                title="The email"
                meta={c.subject}
                action={
                  <a href={`/api/campaigns/${id}/preview`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
                    Open
                    <ExternalLink className="size-3.5" />
                  </a>
                }
              />
              <PreviewThumb html={previewHtml(c, settings)} className="h-80 bg-[var(--surface-3)]" />
            </Card>
            <Card>
              <CardBody className="flex gap-2.5 text-[12px] leading-5 text-[var(--text-muted)]">
                <Info className="mt-0.5 size-4 shrink-0 text-[var(--info)]" />
                <span>
                  Opens are an estimate: Apple Mail loads every image, so it can look opened, and some clients block images.
                  Security scanners can click links before a person does. Clicks are the better signal.
                </span>
              </CardBody>
            </Card>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Recipients</h2>
            <nav aria-label="Show recipients" className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
              {[
                ["all", "All"],
                ["opened", "Opened"],
                ["clicked", "Clicked"],
                ["not_opened", "Not opened"],
                ["unsubscribed", "Unsubscribed"],
                ["bounced", "Bounced"],
                ["failed", "Failed"],
                ...(stats.waiting ? [["waiting", "Waiting"]] : []),
              ].map(([value, label]) => {
                const on = (show ?? "all") === value;
                return (
                  <Link
                    key={value}
                    href={value === "all" ? `/campaigns/${id}` : `/campaigns/${id}?show=${value}`}
                    scroll={false}
                    aria-current={on ? "true" : undefined}
                    className={
                      "inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium transition-colors duration-150 " +
                      (on ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]" : "text-[var(--text-muted)] hover:text-[var(--text)]")
                    }
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Status</Th>
                  {ab ? <Th>Subject</Th> : null}
                  <Th numeric>Opens</Th>
                  <Th numeric>Clicks</Th>
                  <Th>Sent</Th>
                </tr>
              </thead>
              <tbody>
                {report.recipients.length ? (
                  report.recipients.map((r) => {
                    const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;
                    return (
                      <Tr key={r.id}>
                        <Td>
                          {r.customerId ? (
                            <Link href={`/customers/${r.customerId}`} className="font-medium text-[var(--text)] hover:underline underline-offset-2">
                              {name}
                            </Link>
                          ) : r.leadId ? (
                            <Link href={`/leads/${r.leadId}`} className="font-medium text-[var(--text)] hover:underline underline-offset-2">
                              {name}
                            </Link>
                          ) : (
                            <span className="font-medium">{name}</span>
                          )}
                          <span className="block text-[12px] text-[var(--text-muted)]">
                            {r.email}
                            {r.company ? ` · ${r.company}` : ""}
                          </span>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge map={RECIPIENT_STATUS} value={r.status} />
                            {r.unsubscribedAt ? <Badge tone="warn">Unsubscribed</Badge> : null}
                            {r.bouncedAt ? <Badge tone="danger">Bounced</Badge> : null}
                          </div>
                          {r.error ? <span className="mt-0.5 block max-w-[28ch] text-[11px] text-[var(--text-faint)]">{r.error}</span> : null}
                        </Td>
                        {ab ? <Td className="text-[var(--text-muted)]">{r.variant ? r.variant.toUpperCase() : "—"}</Td> : null}
                        <Td numeric>{r.openCount || "—"}</Td>
                        <Td numeric>{r.clickCount || "—"}</Td>
                        <Td className="whitespace-nowrap text-[var(--text-muted)]">{r.sentAt ? formatDateTime(r.sentAt) : "—"}</Td>
                      </Tr>
                    );
                  })
                ) : (
                  <Tr>
                    <Td colSpan={ab ? 6 : 5} className="py-8 text-center text-[var(--text-muted)]">
                      Nobody here.
                    </Td>
                  </Tr>
                )}
              </tbody>
            </Table>
          </TableShell>
          {report.recipients.length >= 500 ? (
            <p className="text-[12px] text-[var(--text-faint)]">Showing the first 500 — most engaged first.</p>
          ) : null}
        </section>
      </PageBody>
    </>
  );
}

/* ── before sending ──────────────────────────────────────────────── */

async function SetupView({
  id,
  campaign: c,
  writer,
  canSend,
  allowHref,
  userEmail,
  settings,
  lastError,
}: {
  id: string;
  campaign: NonNullable<Awaited<ReturnType<typeof getCampaign>>>["campaign"];
  writer: boolean;
  canSend: boolean;
  allowHref: string;
  userEmail: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  lastError: React.ReactNode;
}) {
  const access = await getAccess();
  const rule = normaliseAudience(c.audience);
  const [options, team, segments, sentCampaigns, audience] = await Promise.all([
    audienceOptions(access),
    listTeam(),
    listSegments(),
    listSentCampaigns(),
    resolveAudience(rule, access),
  ]);
  const picked = [...rule.includeContactIds, ...rule.excludeContactIds];
  const names = picked.length
    ? Object.fromEntries(
        (
          await getDb()
            .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
            .from(contacts)
            .where(inArray(contacts.id, picked))
        ).map((r) => [r.id, [r.firstName, r.lastName].filter(Boolean).join(" ")]),
      )
    : {};

  const checks = checkContent({ subject: c.subject, preheader: c.preheader, blocks: cleanBlocks(c.blocks) });
  const errors = checks.filter((x) => x.level === "error");
  const footerOk = Boolean(settings?.marketingFooter?.trim());
  const mailboxOk = c.fromMode === "me" || Boolean(settings?.marketingMailbox);

  const steps = [
    { done: audience.recipients.length > 0, label: "Audience", detail: audience.recipients.length ? `${audience.recipients.length} ${audience.recipients.length === 1 ? "person" : "people"}` : "Nobody yet" },
    { done: Boolean(c.subject.trim()) && mailboxOk, label: "From and subject", detail: c.subject || "No subject yet" },
    { done: errors.length === 0, label: "Email content", detail: errors.length ? `${errors.length} to fix` : `${cleanBlocks(c.blocks).length} blocks` },
    { done: Boolean(c.testSentAt), label: "Test sent", detail: c.testSentAt ? relativeTime(c.testSentAt) : "Recommended", optional: true },
    { done: footerOk, label: "Sender details in the footer", detail: footerOk ? "Set" : "Required by the Spam Act" },
  ];
  const blocked =
    !writer
      ? "Viewers can't send campaigns."
      : !audience.recipients.length
        ? "Choose who it goes to first."
        : !c.subject.trim()
          ? "Write a subject line first."
          : errors.length
            ? "Fix the problems in the email first."
            : !mailboxOk
              ? "Set the marketing mailbox in Campaigns → Settings."
              : !footerOk
                ? "Add the sender details in Campaigns → Settings."
                : null;

  return (
    <PageBody className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {lastError}
        <Card>
          <CardHeader title="Who it goes to" meta={rule.engagement ? `Follow-up to “${rule.engagement.campaignName}”: ${ENGAGEMENT_LABELS[rule.engagement.kind].toLowerCase()}` : "Built from the people already in The Gangway"} />
          <CardBody>
            <AudienceBuilder
              campaignId={id}
              initial={rule}
              options={options}
              team={team.map((t) => ({ id: t.id, name: t.name }))}
              segments={segments}
              sentCampaigns={sentCampaigns.filter((s) => s.id !== id)}
              names={names}
              readOnly={!writer || c.status === "scheduled"}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="From and subject" />
          <CardBody>
            <CampaignSettingsForm
              id={id}
              values={{
                name: c.name,
                subject: c.subject,
                preheader: c.preheader,
                fromMode: c.fromMode,
                replyTo: c.replyTo,
                trackOpens: c.trackOpens,
                trackClicks: c.trackClicks,
                abTest: c.abTest,
              }}
              you={userEmail}
              marketingMailbox={settings?.marketingMailbox ?? null}
              readOnly={!writer || c.status === "scheduled"}
            />
          </CardBody>
        </Card>
      </div>

      <aside className="flex flex-col gap-5 xl:sticky xl:top-20 xl:self-start">
        <Card className="overflow-hidden">
          <CardHeader
            title="The email"
            meta={`${cleanBlocks(c.blocks).length} blocks`}
            action={
              writer && c.status !== "scheduled" ? (
                <ButtonLink href={`/campaigns/${id}/design`} size="sm" variant="secondary">
                  <Pencil />
                  Edit
                </ButtonLink>
              ) : null
            }
          />
          <Link href={writer && c.status !== "scheduled" ? `/campaigns/${id}/design` : `/api/campaigns/${id}/preview`} className="block">
            <PreviewThumb html={previewHtml(c, settings)} className="h-72 bg-[var(--surface-3)]" />
          </Link>
          {checks.length ? (
            <ul className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] px-4 py-3">
              {checks.map((x, i) => (
                <li key={i} className={"flex items-start gap-2 text-[12px] leading-5 " + (x.level === "error" ? "text-[var(--danger)]" : "text-[var(--warn)]")}>
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {x.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Before it goes" />
          <CardBody className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {steps.map((s) => (
                <li key={s.label} className="flex items-start gap-2.5">
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--ok)]" />
                  ) : (
                    <Circle className={"mt-0.5 size-4 shrink-0 " + (s.optional ? "text-[var(--text-faint)]" : "text-[var(--warn)]")} />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[var(--text)]">{s.label}</span>
                    <span className="block truncate text-[12px] text-[var(--text-muted)]">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!writer ? null : !canSend ? (
              <div className="border-t border-[var(--border-soft)] pt-4">
                <AllowSending href={allowHref} />
              </div>
            ) : (
              <>
                <div className="border-t border-[var(--border-soft)] pt-4">
                  <TestSendForm id={id} defaultTo={userEmail} />
                </div>
                {c.status === "scheduled" ? (
                  <p className="border-t border-[var(--border-soft)] pt-4 text-[13px] text-[var(--text)]">
                    Scheduled for <strong>{formatDateTime(c.scheduledAt)}</strong>. Unschedule it to make changes.
                  </p>
                ) : (
                  <div className="border-t border-[var(--border-soft)] pt-4">
                    <ScheduleForm id={id} count={audience.recipients.length} blocked={blocked} />
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </aside>
    </PageBody>
  );
}
