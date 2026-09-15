"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, FolderSync, Loader2 } from "lucide-react";
import { provisionFolder } from "@/lib/actions/files";

/**
 * Re-runs provisioning on a customer that already has a folder, to fill in any
 * part of the client structure that failed the first time.
 *
 * Auto-provisioning on create deliberately swallows its errors, and the
 * "Create SharePoint folder" prompt disappears once the folder exists — so
 * without this, a folder missing one subfolder could not be repaired from the
 * app at all. Provisioning is idempotent, so pressing this is always safe.
 */
export function CheckStructure({ customerId }: { customerId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border-soft)] pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await provisionFolder({ customerId });
            setResult({
              ok: outcome.ok,
              message: outcome.message ?? (outcome.ok ? "Structure checked." : "That didn't work."),
            });
          })
        }
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--color-coastal-600)] disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FolderSync className="size-3.5" />
        )}
        {pending ? "Checking…" : "Check folder structure"}
      </button>

      {result ? (
        <span
          role="status"
          className={`inline-flex items-start gap-1.5 text-[11px] leading-4 ${
            result.ok ? "text-[var(--text-faint)]" : "text-[var(--danger)]"
          }`}
        >
          {result.ok ? (
            <Check className="mt-0.5 size-3 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          )}
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
