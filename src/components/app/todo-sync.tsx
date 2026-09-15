"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { syncMyTodo } from "@/lib/actions/todo";

const ONCE_KEY = "ankord_todo_synced";

/**
 * Keeps the signed-in person's follow-ups in step with their Microsoft To Do.
 *
 * Syncs once per browser session automatically, then only on request. To Do
 * cannot be written on anyone else's behalf, so this is always the caller's own
 * list — a follow-up someone else set for you appears here when you sync, and
 * the Teams message is what tells you at the time.
 */
export function TodoSync() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fired = useRef(false);

  function run() {
    start(async () => {
      const outcome = await syncMyTodo();
      setResult({
        ok: outcome.ok,
        message: outcome.message ?? (outcome.ok ? "Synced." : "That didn't work."),
      });
    });
  }

  useEffect(() => {
    // Once a session, not once a navigation — this page is visited often and
    // each sync is several Graph calls.
    if (fired.current) return;
    fired.current = true;

    let already = false;
    try {
      already = sessionStorage.getItem(ONCE_KEY) === "1";
      sessionStorage.setItem(ONCE_KEY, "1");
    } catch {
      // Private windows and blocked storage: fall back to syncing this once.
    }
    if (!already) run();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--color-coastal-600)] disabled:opacity-60"
      >
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing with To Do…" : "Sync with Microsoft To Do"}
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
