"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { provisionFolder } from "@/lib/actions/files";

export function ConnectFolder({
  scope,
  libraryReady,
  canConfigure,
}: {
  scope: { customerId: string } | { projectId: string };
  libraryReady: boolean;
  canConfigure: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!libraryReady) {
    return (
      <EmptyState
        compact
        title="No SharePoint library connected"
        description={
          canConfigure ? (
            <>
              Choose the document library that holds client files in{" "}
              <Link
                href="/settings"
                className="font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
              >
                Settings
              </Link>
              . Every customer and project folder is created inside it.
            </>
          ) : (
            "An administrator needs to pick the SharePoint library in Settings before files can be stored here."
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <EmptyState
        compact
        title="No folder yet"
        description="Create the SharePoint folder for this record. Files stay in SharePoint — the CRM just knows where to find them."
        action={
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await provisionFolder(scope);
                setError(result.ok ? null : (result.message ?? "That didn't work."));
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            {pending ? "Creating…" : "Create SharePoint folder"}
          </Button>
        }
      />
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
