"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  CalendarClock,
  ChevronDown,
  Copy,
  FlaskConical,
  Loader2,
  Pause,
  Play,
  Reply,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { ActionForm, SaveIndicator, SubmitButton, useFormResult } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CheckboxField, FormRow, SelectField, TextField } from "@/components/app/form-kit";
import {
  cancelCampaign,
  deleteCampaign,
  duplicateCampaign,
  followUpCampaign,
  nudgeCampaign,
  pauseCampaign,
  resumeCampaign,
  saveAsTemplate,
  saveCampaignSettings,
  scheduleCampaign,
  sendTestEmail,
  unscheduleCampaign,
} from "@/lib/actions/campaigns";
import type { ActionState } from "@/lib/actions/shared";
import { ENGAGEMENT_LABELS, type AbTest, type EngagementFilter } from "@/lib/campaigns/model";
import { isoDate } from "@/lib/utils";
import { MergeInput } from "../editor/block-fields";

/* ── details: from, subject, A/B ─────────────────────────────────── */

export function CampaignSettingsForm({
  id,
  values,
  you,
  marketingMailbox,
  readOnly,
}: {
  id: string;
  values: {
    name: string;
    subject: string;
    preheader: string;
    fromMode: "me" | "marketing";
    replyTo: string | null;
    trackOpens: boolean;
    trackClicks: boolean;
    abTest: AbTest | null;
  };
  you: string;
  marketingMailbox: string | null;
  readOnly?: boolean;
}) {
  const action = saveCampaignSettings.bind(null, id);
  const [ab, setAb] = React.useState(Boolean(values.abTest));
  const [subject, setSubject] = React.useState(values.subject);
  const [preheader, setPreheader] = React.useState(values.preheader);
  const [subjectB, setSubjectB] = React.useState(values.abTest?.subjectB ?? "");

  return (
    <ActionForm action={action}>
      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        <TextField name="name" label="Campaign name" defaultValue={values.name} hint="Only the team sees this." required />
        <FormRow>
          <SelectField
            name="fromMode"
            label="Send from"
            defaultValue={values.fromMode}
            options={[
              { value: "marketing", label: marketingMailbox ? `Marketing · ${marketingMailbox}` : "The marketing mailbox" },
              { value: "me", label: `You · ${you}` },
            ]}
            hint="Replies go to this mailbox unless you set a reply-to."
          />
          <TextField name="replyTo" label="Reply-to (optional)" type="email" defaultValue={values.replyTo ?? ""} placeholder="hello@ankord.com.au" />
        </FormRow>
        <Field label="Subject line" required>
          <MergeInput name="subject" value={subject} onChange={setSubject} />
        </Field>
        <Field label="Preview text" hint="The line after the subject in most inboxes. Make it earn the open.">
          <MergeInput name="preheader" value={preheader} onChange={setPreheader} />
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            name="abEnabled"
            checked={ab}
            onChange={(e) => setAb(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
              <FlaskConical className="size-4 text-[var(--color-coastal-500)]" />
              Test two subject lines
            </span>
            <span className="block text-[12px] leading-5 text-[var(--text-muted)]">
              Part of the audience gets each; after a wait, the better one goes to everyone else.
            </span>
          </span>
        </label>
        {ab ? (
          <div className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <Field label="Subject B" required>
              <MergeInput name="subjectB" value={subjectB} onChange={setSubjectB} />
            </Field>
            <TextField name="preheaderB" label="Preview text B (optional)" defaultValue={values.abTest?.preheaderB ?? ""} />
            <FormRow cols={3}>
              <SelectField
                name="testPercent"
                label="Test on"
                defaultValue={String(values.abTest?.testPercent ?? 30)}
                options={[20, 30, 40, 50, 100].map((p) => ({
                  value: String(p),
                  label: p === 100 ? "Everyone (just compare)" : `${p}% of the audience`,
                }))}
              />
              <SelectField
                name="waitHours"
                label="Then wait"
                defaultValue={String(values.abTest?.waitHours ?? 4)}
                options={[1, 2, 4, 8, 24].map((h) => ({ value: String(h), label: `${h} hour${h > 1 ? "s" : ""}` }))}
              />
              <SelectField
                name="metric"
                label="Winner by"
                defaultValue={values.abTest?.metric ?? "clicks"}
                options={[
                  { value: "clicks", label: "Clicks (more reliable)" },
                  { value: "opens", label: "Opens" },
                ]}
              />
            </FormRow>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <CheckboxField name="trackOpens" label="Track opens" hint="An invisible image. Approximate — Apple Mail opens everything." defaultChecked={values.trackOpens} />
          <CheckboxField name="trackClicks" label="Track clicks" hint="Links go via The Gangway first." defaultChecked={values.trackClicks} />
        </div>

        {readOnly ? null : (
          <div className="flex items-center gap-3">
            <SubmitButton>Save details</SubmitButton>
            <SaveIndicator />
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}

/* ── test send ───────────────────────────────────────────────────── */

export function TestSendForm({ id, defaultTo }: { id: string; defaultTo: string }) {
  const action = sendTestEmail.bind(null, id);
  return (
    <ActionForm action={action}>
      <div className="flex flex-col gap-3">
        <TextField name="to" label="Send a test to" defaultValue={defaultTo} hint="Up to five addresses, separated by commas. Merge tags use sample values." />
        <div className="flex items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            <Send />
            Send test
          </SubmitButton>
          <Result />
        </div>
      </div>
    </ActionForm>
  );
}

function Result() {
  const result = useFormResult();
  if (!result?.ok || !result.message) return null;
  return (
    <span role="status" className="text-[12px] font-medium text-[var(--ok)]">
      {result.message}
    </span>
  );
}

export function AllowSending({ href }: { href: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3.5 py-3">
      <p className="text-[13px] font-medium text-[var(--warn)]">The Gangway can&rsquo;t send email for you yet</p>
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Microsoft asks once before an app sends mail as you. Nothing is sent until you press Send.
      </p>
      <a
        href={href}
        className="self-start rounded-lg bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)] hover:bg-[var(--surface-2)]"
      >
        Allow sending
      </a>
    </div>
  );
}

/* ── schedule ────────────────────────────────────────────────────── */

export function ScheduleForm({
  id,
  count,
  blocked,
}: {
  id: string;
  count: number;
  /** Why it can't go yet, if anything. */
  blocked: string | null;
}) {
  const action = scheduleCampaign.bind(null, id);
  const [when, setWhen] = React.useState<"now" | "later">("now");
  const [confirming, setConfirming] = React.useState(false);
  // Tomorrow at nine, Sydney time.
  const defaultAt = `${isoDate(1)}T09:00`;

  return (
    <ActionForm action={action} onSuccess={() => setConfirming(false)}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] p-1" role="radiogroup">
          {(
            [
              ["now", "Send now", Send],
              ["later", "Schedule", CalendarClock],
            ] as const
          ).map(([value, label, Icon]) => (
            <label
              key={value}
              className={
                "flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors " +
                (when === value ? "bg-[var(--surface-3)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              <input type="radio" name="when" value={value} checked={when === value} onChange={() => setWhen(value)} className="sr-only" />
              <Icon className="size-4" />
              {label}
            </label>
          ))}
        </div>
        {when === "later" ? (
          <TextField name="at" label="When (Sydney time)" type="datetime-local" defaultValue={defaultAt} />
        ) : null}

        {blocked ? (
          <p className="text-[12px] leading-5 text-[var(--danger)]">{blocked}</p>
        ) : confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-sunrise-200)] bg-[var(--color-sunrise-50)] p-3 dark:border-[var(--color-sunrise-800)] dark:bg-[var(--color-sunrise-900)]/30">
            <p className="text-[13px] text-[var(--text)]">
              {when === "now" ? "Send" : "Schedule"} to <strong>{count.toLocaleString("en-AU")}</strong>{" "}
              {count === 1 ? "person" : "people"}? This can be paused, but not unsent.
            </p>
            <div className="flex gap-2">
              <SubmitButton pendingLabel={when === "now" ? "Starting…" : "Scheduling…"}>
                {when === "now" ? "Yes, send it" : "Yes, schedule it"}
              </SubmitButton>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" size="lg" onClick={() => setConfirming(true)} disabled={!count}>
            {when === "now" ? <Send /> : <CalendarClock />}
            {when === "now" ? `Send to ${count.toLocaleString("en-AU")}` : "Schedule"}
          </Button>
        )}
      </div>
    </ActionForm>
  );
}

/* ── buttons that act on a campaign ──────────────────────────────── */

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.message ?? "That didn't work.");
      router.refresh();
    });
  };
  return { pending, error, run };
}

export function CampaignActions({
  id,
  name,
  status,
  started,
  canResume,
}: {
  id: string;
  name: string;
  status: string;
  started: boolean;
  canResume: boolean;
}) {
  const { pending, error, run } = useAct();
  const [menu, setMenu] = React.useState(false);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pending ? <Loader2 className="size-4 animate-spin text-[var(--text-faint)]" /> : null}
        {status === "sending" || status === "testing" ? (
          <Button variant="secondary" onClick={() => run(() => pauseCampaign(id))} disabled={pending}>
            <Pause />
            Pause
          </Button>
        ) : null}
        {status === "paused" && canResume ? (
          <Button variant="primary" onClick={() => run(() => resumeCampaign(id))} disabled={pending}>
            <Play />
            Resume
          </Button>
        ) : null}
        {status === "scheduled" ? (
          <Button variant="secondary" onClick={() => run(() => unscheduleCampaign(id))} disabled={pending}>
            Unschedule
          </Button>
        ) : null}
        {["scheduled", "sending", "testing", "paused"].includes(status) ? (
          <Button
            variant="ghost"
            onClick={() => run(() => cancelCampaign(id), `Cancel “${name}”? Nobody who hasn't had it yet will get it.`)}
            disabled={pending}
          >
            <XCircle />
            Cancel
          </Button>
        ) : null}
        {started ? (
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              <Reply />
              Follow up
              <ChevronDown />
            </Button>
            {menu ? (
              <div className="absolute top-full right-0 z-30 mt-1 w-60 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]">
                <p className="px-2 pt-1 pb-1.5 text-[11px] text-[var(--text-faint)]">A new draft, with the same email, to people who…</p>
                {(Object.entries(ENGAGEMENT_LABELS) as [EngagementFilter, string][]).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      run(() => followUpCampaign(id, kind));
                    }}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-2)]"
                  >
                    {label.charAt(0).toLowerCase() + label.slice(1)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            const n = window.prompt("Save this email as a template called", name);
            if (n?.trim()) run(() => saveAsTemplate(id, n));
          }}
          disabled={pending}
        >
          <Save />
          Save as template
        </Button>
        <Button variant="ghost" onClick={() => run(() => duplicateCampaign(id))} disabled={pending}>
          <Copy />
          Duplicate
        </Button>
        {status === "draft" ? (
          <Button variant="ghost" onClick={() => run(() => deleteCampaign(id), `Delete the draft “${name}”?`)} disabled={pending}>
            <Trash2 />
            Delete
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * While a campaign is going out, keeps it moving from this tab — the cron
 * does the same every minute — and refreshes the numbers. Sending always uses
 * the campaign's own sender session, not the viewer's.
 */
export function SendingPoller({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    let live = true;
    const tick = async () => {
      await nudgeCampaign(id).catch(() => null);
      if (live) router.refresh();
    };
    void tick();
    const timer = setInterval(tick, 20_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, active, router]);
  return null;
}
