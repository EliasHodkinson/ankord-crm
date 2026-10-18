"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DownloadCloud, EyeOff, Link2, Loader2, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  createPartnerFromXero,
  importXeroItems,
  linkContactToPartner,
  linkStrongMatches,
  skipXeroContact,
} from "@/lib/actions/xero-import";
import type { ActionState } from "@/lib/actions/shared";
import type { Suggestion } from "@/lib/xero/import/match";
import { cn } from "@/lib/utils";

function useAct() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ActionState | null>(null);
  const act = (name: string, fn: () => Promise<ActionState>) => {
    setBusy(name);
    start(async () => {
      setResult(await fn());
      setBusy(null);
      router.refresh();
    });
  };
  return { pending, busy, result, act };
}

function Result({ result }: { result: ActionState | null }) {
  if (!result?.message) return null;
  return (
    <span role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
      {result.message}
    </span>
  );
}

const CREATE = "__create";

/**
 * One contact's decision: link it to a partner, create a new partner from
 * it, or skip it. The suggestion is preselected — but only a strong one. A
 * name-only match starts unchosen, so linking on a name is always a choice.
 */
export function ContactDecision({
  contactId,
  contactName,
  suggestion,
  partners,
  skipped,
}: {
  contactId: string;
  contactName: string;
  suggestion: Suggestion | null;
  partners: { id: string; name: string }[];
  skipped: boolean;
}) {
  const { pending, busy, result, act } = useAct();
  const strong = suggestion && suggestion.reason !== "name";
  const [choice, setChoice] = React.useState(strong ? suggestion.partnerId : suggestion ? "" : CREATE);

  if (skipped) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--text-muted)]">Skipped</span>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("restore", () => skipXeroContact(contactId, contactName, false))}>
          {busy === "restore" ? <Loader2 className="animate-spin" /> : <Undo2 />}
          Bring back
        </Button>
        <Result result={result} />
      </span>
    );
  }

  const others = partners.filter((p) => p.id !== suggestion?.partnerId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`What to do with ${contactName}`}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="h-8 min-w-0 flex-1 text-[13px]"
        >
          {suggestion && !strong ? <option value="">Choose…</option> : null}
          {suggestion ? <option value={suggestion.partnerId}>Link to {suggestion.partnerName}</option> : null}
          <option value={CREATE}>New business partner</option>
          {others.length ? (
            <optgroup label="Link to another business partner">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !choice}
          onClick={() =>
            act("apply", () => (choice === CREATE ? createPartnerFromXero(contactId) : linkContactToPartner(contactId, choice)))
          }
        >
          {busy === "apply" ? <Loader2 className="animate-spin" /> : choice === CREATE ? <Plus /> : <Link2 />}
          {choice === CREATE ? "Create" : "Link"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Skip ${contactName}`}
          onClick={() => act("skip", () => skipXeroContact(contactId, contactName, true))}
        >
          {busy === "skip" ? <Loader2 className="animate-spin" /> : <EyeOff />}
          Skip
        </Button>
      </div>
      <Result result={result} />
    </div>
  );
}

/** Links every ABN or email match in one go. Name matches are left for a person. */
export function LinkStrongButton({ count }: { count: number }) {
  const { pending, result, act } = useAct();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Result result={result} />
      {/* Stays mounted at zero so the result of the last run is still shown. */}
      {count > 0 ? (
        <Button variant="secondary" disabled={pending} onClick={() => act("strong", linkStrongMatches)}>
          {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
          Link {count} ABN and email {count === 1 ? "match" : "matches"}
        </Button>
      ) : null}
    </span>
  );
}

export function ImportItemsButton({ count }: { count: number }) {
  const { pending, result, act } = useAct();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Result result={result} />
      <Button variant={count === 0 ? "secondary" : "primary"} disabled={pending || count === 0} onClick={() => act("items", importXeroItems)}>
        {pending ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
        {count === 0 ? "Items are up to date" : `Import ${count} ${count === 1 ? "item" : "items"}`}
      </Button>
    </span>
  );
}
