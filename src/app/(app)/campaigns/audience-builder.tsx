"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { CUSTOMER_STATUS, LEAD_STAGES, MARKETING_CONSENT } from "@/components/ui/status";
import { previewAudience, saveAudience, saveSegment } from "@/lib/actions/campaigns";
import {
  ENGAGEMENT_LABELS,
  type AudiencePreview,
  type AudienceRule,
  type EngagementFilter,
} from "@/lib/campaigns/model";
import type { AudienceOptions } from "@/lib/campaigns/audience";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/**
 * Who a campaign goes to, built from what the CRM already knows — kind of
 * business partner, status, tags, owner, lead stage — with a live count and
 * a sample of the people it reaches, so nobody sends blind.
 */
export function AudienceBuilder({
  campaignId,
  initial,
  options,
  team,
  segments,
  sentCampaigns,
  names,
  readOnly,
}: {
  campaignId: string;
  initial: AudienceRule;
  options: AudienceOptions;
  team: { id: string; name: string }[];
  segments: { id: string; name: string; rule: AudienceRule }[];
  sentCampaigns: { id: string; name: string }[];
  /** Names for hand-picked people already in the rule. */
  names: Record<string, string>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [rule, setRule] = React.useState<AudienceRule>(initial);
  const [preview, setPreview] = React.useState<AudiencePreview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [known, setKnown] = React.useState(names);

  const change = (patch: Partial<AudienceRule>) => {
    setRule((r) => ({ ...r, ...patch }));
    setDirty(true);
    setMessage(null);
  };

  // A live count, a moment after the last change.
  React.useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await previewAudience(rule).catch(() => null);
      if (live) {
        setPreview(result);
        setLoading(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rule]);

  const save = async () => {
    setSaving(true);
    const result = await saveAudience(campaignId, rule);
    setSaving(false);
    setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Saved." : "Not saved.") });
    if (result.ok) {
      setDirty(false);
      router.refresh();
    }
  };

  const saveAsSegment = async () => {
    const name = window.prompt("Name this audience, so it can be used again");
    if (!name?.trim()) return;
    const result = await saveSegment(name, rule);
    setMessage({ ok: result.ok, text: result.message ?? "" });
    if (result.ok) router.refresh();
  };

  const statusOptions = Object.entries(CUSTOMER_STATUS).map(([value, e]) => ({ value, label: e.label }));
  const stageOptions = Object.entries(LEAD_STAGES).map(([value, e]) => ({ value, label: e.label }));
  const asOptions = (list: string[]) => list.map((v) => ({ value: v, label: v }));

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
        {segments.length ? (
          <Field label="Start from a saved audience">
            <Select
              value=""
              onChange={(e) => {
                const s = segments.find((x) => x.id === e.target.value);
                if (s) change({ ...s.rule, engagement: rule.engagement });
              }}
            >
              <option value="">Choose…</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Group
          title="People at business partners"
          enabled={rule.contacts}
          onToggle={(contacts) => change({ contacts })}
        >
          <Chips
            label="Kind"
            options={[
              { value: "customer", label: "Customers" },
              { value: "supplier", label: "Suppliers" },
              { value: "media", label: "Media" },
            ]}
            value={rule.partnerKinds}
            onChange={(v) => change({ partnerKinds: v as AudienceRule["partnerKinds"] })}
          />
          <Chips label="Status" options={statusOptions} value={rule.partnerStatuses} onChange={(partnerStatuses) => change({ partnerStatuses })} />
          {options.tags.length ? (
            <Chips label="Tags" options={asOptions(options.tags)} value={rule.partnerTags} onChange={(partnerTags) => change({ partnerTags })} />
          ) : null}
          {options.segments.length ? (
            <Chips label="Segment" options={asOptions(options.segments)} value={rule.partnerSegments} onChange={(partnerSegments) => change({ partnerSegments })} />
          ) : null}
          {options.industries.length ? (
            <Chips label="Industry" options={asOptions(options.industries)} value={rule.partnerIndustries} onChange={(partnerIndustries) => change({ partnerIndustries })} />
          ) : null}
          {options.states.length ? (
            <Chips label="State" options={asOptions(options.states)} value={rule.partnerStates} onChange={(partnerStates) => change({ partnerStates })} />
          ) : null}
          <Chips
            label="Account owner"
            options={team.map((t) => ({ value: t.id, label: t.name }))}
            value={rule.ownerIds}
            onChange={(ownerIds) => change({ ownerIds })}
          />
          <PartnerPicker
            partners={options.partners}
            value={rule.customerIds}
            onChange={(customerIds) => change({ customerIds })}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Tick checked={rule.primaryOnly} onChange={(primaryOnly) => change({ primaryOnly })}>
              Primary contact only
            </Tick>
            <Tick checked={rule.decisionMakersOnly} onChange={(decisionMakersOnly) => change({ decisionMakersOnly })}>
              Decision makers only
            </Tick>
          </div>
        </Group>

        <Group title="Leads" enabled={rule.leads} onToggle={(leads) => change({ leads })}>
          <Chips label="Stage" options={stageOptions} value={rule.leadStages} onChange={(leadStages) => change({ leadStages })} />
          {options.leadTags.length ? (
            <Chips label="Tags" options={asOptions(options.leadTags)} value={rule.leadTags} onChange={(leadTags) => change({ leadTags })} />
          ) : null}
          <p className="text-[12px] text-[var(--text-faint)]">Converted leads are left out — they&rsquo;re reached as people at their business partner.</p>
        </Group>

        <section className="flex flex-col gap-4 rounded-[10px] border border-[var(--border)] p-4">
          <h3 className="text-[13px] font-semibold text-[var(--text)]">Add and leave out</h3>
          <PeoplePicker
            label="Also send to"
            ids={rule.includeContactIds}
            names={known}
            onAdd={(id, name) => {
              setKnown((k) => ({ ...k, [id]: name }));
              change({
                includeContactIds: [...new Set([...rule.includeContactIds, id])],
                excludeContactIds: rule.excludeContactIds.filter((x) => x !== id),
              });
            }}
            onRemove={(id) => change({ includeContactIds: rule.includeContactIds.filter((x) => x !== id) })}
          />
          {rule.excludeContactIds.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-[var(--text-muted)]">Left out</p>
              <div className="flex flex-wrap gap-1.5">
                {rule.excludeContactIds.map((id) => (
                  <RemovableChip
                    key={id}
                    label={known[id] ?? "Someone"}
                    onRemove={() => change({ excludeContactIds: rule.excludeContactIds.filter((x) => x !== id) })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 rounded-[10px] border border-[var(--border)] p-4 sm:grid-cols-2">
          <Field
            label="Consent"
            hint={
              rule.consent === "any"
                ? "Everyone who hasn't unsubscribed. Fine for clients you work with; check the rest."
                : "Only people with consent recorded against them in Campaigns → Audience."
            }
          >
            <Select value={rule.consent} onChange={(e) => change({ consent: e.target.value as AudienceRule["consent"] })}>
              <option value="any">Anyone not unsubscribed</option>
              <option value="recorded">{`${MARKETING_CONSENT.express.label} or ${MARKETING_CONSENT.inferred.label.toLowerCase()}`}</option>
              <option value="express">{MARKETING_CONSENT.express.label} only</option>
            </Select>
          </Field>
          <Field label="Don't over-email" hint="Leaves out anyone a campaign reached recently.">
            <Select
              value={String(rule.notEmailedWithinDays ?? "")}
              onChange={(e) => change({ notEmailedWithinDays: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No limit</option>
              <option value="3">Not emailed in 3 days</option>
              <option value="7">Not emailed in a week</option>
              <option value="14">Not emailed in a fortnight</option>
              <option value="30">Not emailed in a month</option>
            </Select>
          </Field>
          <Field label="Based on an earlier campaign" hint="For a follow-up: only the people who did, or didn't, respond.">
            <div className="flex gap-2">
              <Select
                value={rule.engagement?.campaignId ?? ""}
                onChange={(e) => {
                  const c = sentCampaigns.find((x) => x.id === e.target.value);
                  change({
                    engagement: c ? { campaignId: c.id, campaignName: c.name, kind: rule.engagement?.kind ?? "not_opened" } : null,
                  });
                }}
              >
                <option value="">Any — not a follow-up</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {rule.engagement ? (
                <Select
                  className="w-44"
                  value={rule.engagement.kind}
                  onChange={(e) => change({ engagement: { ...rule.engagement!, kind: e.target.value as EngagementFilter } })}
                >
                  {Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </Field>
        </section>

        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save audience
            </Button>
            <Button variant="secondary" onClick={saveAsSegment}>
              Save for reuse
            </Button>
            {message ? (
              <span role="status" className={cn("text-[12px] font-medium", message.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
                {message.text}
              </span>
            ) : dirty ? (
              <span className="text-[12px] text-[var(--text-faint)]">Unsaved changes</span>
            ) : null}
          </div>
        )}
      </fieldset>

      {/* ── live count ── */}
      <aside className="order-first flex flex-col gap-3 2xl:sticky 2xl:top-20 2xl:order-none 2xl:self-start">
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <p className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Users className="size-4" />
            Will receive it
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
          </p>
          <p className="mt-1.5 text-[30px] leading-none font-semibold tracking-[-0.03em] text-[var(--text)] tabular">
            {preview ? preview.count.toLocaleString("en-AU") : "—"}
          </p>
          {preview ? (
            <ul className="mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
              {preview.excluded.suppressed ? <li>{preview.excluded.suppressed} unsubscribed or bounced, left out</li> : null}
              {preview.excluded.consent ? <li>{preview.excluded.consent} without the consent asked for, left out</li> : null}
              {preview.excluded.recent ? <li>{preview.excluded.recent} emailed recently, left out</li> : null}
              {preview.excluded.engagement ? <li>{preview.excluded.engagement} didn&rsquo;t match the earlier campaign</li> : null}
              {preview.unrecordedConsent ? (
                <li className="text-[var(--warn)]">
                  {preview.unrecordedConsent} {preview.unrecordedConsent === 1 ? "has" : "have"} no consent recorded
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        {preview?.sample.length ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
            <p className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[12px] font-semibold text-[var(--text-muted)]">
              {preview.count > preview.sample.length ? `The first ${preview.sample.length}` : "Everyone"}
            </p>
            <ul className="max-h-[16rem] overflow-y-auto scrollbar-slim 2xl:max-h-[26rem]">
              {preview.sample.map((p) => (
                <li key={p.email} className="group flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-[var(--text)]">
                      {p.name}
                      {p.source === "lead" ? (
                        <Badge tone="info" className="ml-1.5">
                          Lead
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-[var(--text-faint)]">{p.company ?? p.email}</p>
                  </div>
                  {p.contactId && !readOnly ? (
                    <button
                      type="button"
                      title="Leave this person out"
                      aria-label={`Leave ${p.name} out`}
                      onClick={() => {
                        setKnown((k) => ({ ...k, [p.contactId!]: p.name }));
                        change({
                          excludeContactIds: [...new Set([...rule.excludeContactIds, p.contactId!])],
                          includeContactIds: rule.includeContactIds.filter((x) => x !== p.contactId),
                        });
                      }}
                      className="grid size-6 place-items-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--surface-3)] hover:text-[var(--text)] focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Group({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--border)]">
      <label className="flex cursor-pointer items-center gap-2.5 px-4 py-3">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        <span className="text-[13px] font-semibold text-[var(--text)]">{title}</span>
      </label>
      {enabled ? <div className="flex flex-col gap-4 border-t border-[var(--border-soft)] px-4 py-4">{children}</div> : null}
    </section>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        {label}
        <span className="ml-1.5 font-normal text-[var(--text-faint)]">{value.length ? "any of these" : "all"}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors",
                on
                  ? "border-[var(--color-sunrise-300)] bg-[var(--color-sunrise-50)] text-[var(--color-sunrise-800)] dark:bg-[var(--color-sunrise-900)]/40 dark:text-[var(--color-sunrise-100)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--color-coastal-300)] hover:text-[var(--text)]",
              )}
            >
              {on ? <Check className="size-3" /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Tick({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[var(--text)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {children}
    </label>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-3)] py-0.5 pr-0.5 pl-2 text-[12px] text-[var(--text)]">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="grid size-5 place-items-center rounded hover:bg-[var(--surface-2)]">
        <X className="size-3" />
      </button>
    </span>
  );
}

function PartnerPicker({
  partners,
  value,
  onChange,
}: {
  partners: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const byId = React.useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);
  const matches = q.trim()
    ? partners.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()) && !value.includes(p.id)).slice(0, 8)
    : [];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        Only these business partners
        <span className="ml-1.5 font-normal text-[var(--text-faint)]">{value.length ? `${value.length} chosen` : "optional"}</span>
      </p>
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <RemovableChip key={id} label={byId.get(id) ?? "Removed partner"} onRemove={() => onChange(value.filter((v) => v !== id))} />
          ))}
        </div>
      ) : null}
      <SearchBox value={q} onChange={setQ} placeholder="Find a business partner…" />
      {matches.length ? (
        <ul className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-sm)]">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...value, p.id]);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--surface-2)]"
              >
                <Plus className="size-3.5 text-[var(--text-faint)]" />
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PeoplePicker({
  label,
  ids,
  names,
  onAdd,
  onRemove,
}: {
  label: string;
  ids: string[];
  names: Record<string, string>;
  onAdd: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<{ id: string; title: string; subtitle: string | null }[]>([]);

  React.useEffect(() => {
    if (q.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { hits: { id: string; kind: string; title: string; subtitle: string | null }[] }) : null;
      if (live) setHits((body?.hits ?? []).filter((h) => h.kind === "contact"));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const shown = q.trim().length >= 2 ? hits.filter((h) => !ids.includes(h.id)) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        {label}
        <span className="ml-1.5 font-normal text-[var(--text-faint)]">whatever the filters say</span>
      </p>
      {ids.length ? (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <RemovableChip key={id} label={names[id] ?? "Someone"} onRemove={() => onRemove(id)} />
          ))}
        </div>
      ) : null}
      <SearchBox value={q} onChange={setQ} placeholder="Find a person…" />
      {shown.length ? (
        <ul className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-sm)]">
          {shown.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(h.id, h.title);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--surface-2)]"
              >
                <Plus className="size-3.5 text-[var(--text-faint)]" />
                <span className="min-w-0">
                  <span className="block truncate text-[var(--text)]">{h.title}</span>
                  {h.subtitle ? <span className="block truncate text-[11px] text-[var(--text-faint)]">{h.subtitle}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-faint)]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pr-3 pl-9 text-[13px] text-[var(--text)] transition-colors hover:border-[var(--color-coastal-300)] focus:border-[var(--ring)] focus:outline-2 focus:outline-[var(--ring)]"
      />
    </div>
  );
}
