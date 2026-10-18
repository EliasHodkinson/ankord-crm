"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncAllItems } from "@/lib/actions/items";
import type { ActionState } from "@/lib/actions/shared";
import { cn } from "@/lib/utils";

/** Pushes every item to Xero, matching ones that already exist there by code. */
export function SyncAllItems() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<ActionState | null>(null);
  return (
    <span className="flex items-center gap-2">
      {result?.message ? (
        <span role={result.ok ? "status" : "alert"} className={cn("text-[12px]", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]")}>
          {result.message}
        </span>
      ) : null}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(await syncAllItems());
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <UploadCloud />}
        Sync all to Xero
      </Button>
    </span>
  );
}
