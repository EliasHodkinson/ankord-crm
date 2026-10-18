"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import {
  createPlannerPlan,
  linkPlannerPlan,
  listPlannerGroups,
  listPlannerPlans,
  syncPlanner,
  unlinkPlannerPlan,
  type GroupOption,
  type PlanOption,
  type PlannerSyncState,
} from "@/lib/actions/planner";
import type { PlannerLinkView } from "@/lib/data/planner";
import { relativeTime } from "@/lib/utils";

/** While the project is open and visible, Planner is checked this often. */
const POLL_MS = 60_000;

/**
 * The project's link to Microsoft Planner: create or link a plan, then keep
 * the two in step. Planner cannot tell the CRM when something changes, so an
 * open project polls; edits made here are pushed straight after they save.
 */
export function PlannerPanel({
  projectId,
  link,
}: {
  projectId: string;
  link: PlannerLinkView | null;
}) {
  return link ? (
    <LinkedPlan projectId={projectId} link={link} />
  ) : (
    <ConnectPlan projectId={projectId} />
  );
}

/* ── linked ──────────────────────────────────────────────────────── */

function LinkedPlan({ projectId, link }: { projectId: string; link: PlannerLinkView }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [unlinking, startUnlink] = useTransition();
  const [result, setResult] = useState<PlannerSyncState | null>(null);
  const [lastSynced, setLastSynced] = useState(link.lastSyncedAt);
  const running = useRef(false);

  const error = result ? (result.ok ? null : result.message) : link.lastError;

  const run = useCallback(
    async (force: boolean) => {
      if (running.current) return;
      running.current = true;
      setSyncing(true);
      try {
        const outcome = await syncPlanner(projectId, { force });
        setResult(outcome);
        if (outcome.ok && !outcome.summary?.skipped) setLastSynced(new Date());
        if (outcome.changedHere) router.refresh();
      } catch {
        setResult({ ok: false, message: "Could not reach The Gangway to sync." });
      } finally {
        running.current = false;
        setSyncing(false);
      }
    },
    [projectId, router],
  );

  useEffect(() => {
    // Deferred a tick so opening the page paints before the first sync starts.
    const first = setTimeout(() => void run(false), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run(false);
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [run]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {syncing ? (
          <Badge tone="info">
            <Loader2 className="size-3 animate-spin" />
            Syncing
          </Badge>
        ) : error ? (
          <Badge tone="danger" dot>
            Sync failed
          </Badge>
        ) : (
          <Badge tone="ok" dot>
            In sync
          </Badge>
        )}
        {link.webUrl ? (
          <a
            href={link.webUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 text-[13px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
          >
            <span className="truncate">{link.title ?? "Open plan"}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="text-[13px] font-medium text-[var(--text)]">{link.title}</span>
        )}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : result?.message && result.message !== "Up to date." ? (
        <p role="status" className="flex items-start gap-1.5 text-[12px] leading-5 text-[var(--text-muted)]">
          <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--ok)]" />
          {result.message}
        </p>
      ) : null}

      <p className="text-[11px] leading-4 text-[var(--text-faint)]">
        {lastSynced ? `Last synced ${relativeTime(lastSynced)}. ` : "Not synced yet. "}
        Phases are buckets, steps are tasks. Edits travel both ways; if a step changes in
        both places at once, Planner&rsquo;s version is kept.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={syncing} onClick={() => void run(true)}>
          <RefreshCw className={syncing ? "animate-spin" : undefined} />
          Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={unlinking}
          onClick={() => {
            if (!confirm("Stop syncing with this plan? Nothing is deleted on either side.")) return;
            startUnlink(async () => {
              await unlinkPlannerPlan(projectId);
              router.refresh();
            });
          }}
        >
          {unlinking ? <Loader2 className="animate-spin" /> : <Unlink />}
          Unlink
        </Button>
      </div>
    </div>
  );
}

/* ── not linked yet ──────────────────────────────────────────────── */

function ConnectPlan({ projectId }: { projectId: string }) {
  const router = useRouter();
  const uid = useId();
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    listPlannerGroups().then((res) => {
      if (!live) return;
      setLoading(false);
      if (!res.ok) return setError(res.message ?? "Could not list your Microsoft 365 groups.");
      setGroups(res.groups ?? []);
      setGroupId(res.defaultGroupId ?? res.groups?.[0]?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!groupId) return;
    let live = true;
    listPlannerPlans(groupId).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.message ?? "Could not list the plans in that group.");
      setPlans(res.plans ?? []);
      setPlanId("");
    });
    return () => {
      live = false;
    };
  }, [groupId]);

  function act(fn: () => Promise<PlannerSyncState>) {
    setError(null);
    start(async () => {
      const res = await fn();
      // Linked even when the first sync reported a problem — the linked view
      // shows that error and lets them retry.
      if (!res.ok && !res.summary) setError(res.message ?? "That didn't work.");
      else router.refresh();
    });
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="size-3.5 animate-spin" />
        Looking up your Planner groups…
      </p>
    );
  }

  const available = (plans ?? []).filter((p) => !p.linkedTo);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Keep this runbook and a Microsoft Planner plan in step: phases become buckets,
        steps become tasks, with owners, due dates, progress and checklists.
      </p>

      {groups && groups.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          You are not in any Microsoft 365 groups, so there is nowhere to put a plan.
        </p>
      ) : groups ? (
        <>
          <Field label="Microsoft 365 group" htmlFor={`${uid}-group`}>
            <Select
              id={`${uid}-group`}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={pending}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>

          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={pending || !groupId}
            onClick={() => act(() => createPlannerPlan(projectId, groupId))}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            Create a plan from this project
          </Button>

          <div className="flex flex-col gap-2 border-t border-[var(--border-soft)] pt-3">
            <Field label="Or link an existing plan" htmlFor={`${uid}-plan`}>
              <Select
                id={`${uid}-plan`}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                disabled={pending || plans === null}
              >
                <option value="">
                  {plans === null
                    ? "Loading plans…"
                    : available.length === 0
                      ? "No unlinked plans to link"
                      : "Choose a plan"}
                </option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={pending || !planId}
              onClick={() => act(() => linkPlannerPlan(projectId, planId))}
            >
              <Link2 />
              Link plan
            </Button>
            <p className="text-[11px] leading-4 text-[var(--text-faint)]">
              Phases and buckets with the same name are paired, as are steps and tasks with
              the same title — where a pair differs, and for the project&rsquo;s name, the
              plan&rsquo;s version is kept. Everything else is copied across in both directions.
            </p>
          </div>
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
