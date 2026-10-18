"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveItem, syncItem } from "@/lib/actions/items";
import type { ActionState } from "@/lib/actions/shared";
import { cn } from "@/lib/utils";

export function ItemControls({ itemId, archived }: { itemId: string; archived: boolean }) {
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("sync", () => syncItem(itemId))}>
          {busy === "sync" ? <Loader2 className="animate-spin" /> : <UploadCloud />}
          Save in Xero now
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("archive", () => archiveItem(itemId, !archived))}>
          {busy === "archive" ? <Loader2 className="animate-spin" /> : <Archive />}
          {archived ? "Restore" : "Archive"}
        </Button>
      </div>
      {result?.message ? (
        <p role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
