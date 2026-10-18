import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AlertTriangle, PlugZap } from "lucide-react";
import { AnkordLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { labelFor, USER_ROLE } from "@/components/ui/status";
import { REQUEST_COOKIE, SESSION_COOKIE, loadPending, openRequest, openSession } from "@/lib/mcp/grants";

export const metadata: Metadata = { title: "Connect to The Gangway" };
export const dynamic = "force-dynamic";

/**
 * Where a person approves an MCP client (Claude) to act as them. Reached from
 * /oauth/authorize by way of the Microsoft sign-in; the request and the new
 * session travel in signed cookies, never in the URL.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (error) return <Shell><Problem message={error} /></Shell>;

  const jar = await cookies();
  const request = await openRequest(jar.get(REQUEST_COOKIE)?.value);
  const sessionId = await openSession(jar.get(SESSION_COOKIE)?.value);
  const pending = request && sessionId ? await loadPending(request, sessionId) : null;
  if (!request || !pending) {
    return (
      <Shell>
        <Problem message="This connection request has expired or was already answered. Start connecting again from Claude." />
      </Shell>
    );
  }

  const { user, client } = pending;
  const returnTo = new URL(request.redirectUri);
  const restricted = user.role === "restricted";

  return (
    <Shell>
      <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--info-bg)] text-[var(--info)]">
        <PlugZap className="size-5" />
      </div>
      <h1 className="mt-5 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-[var(--text)]">
        Connect {client.name} to The Gangway?
      </h1>
      <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">
        {client.name} will act as <strong className="font-medium text-[var(--text)]">{user.name}</strong>{" "}
        ({user.email}). It can read and change whatever your {labelFor(USER_ROLE, user.role)} role
        allows{restricted ? " — only the business partners granted to you" : ""}, and use your
        Microsoft 365 access the way The Gangway does. Everything it changes is logged as you, marked
        as coming through {client.name}.
      </p>

      <dl className="mt-5 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-[12px]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-muted)]">Client</dt>
          <dd className="truncate text-right font-medium text-[var(--text)]">{client.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-muted)]">Identified by</dt>
          <dd className="truncate text-right text-[var(--text)]">
            {client.kind === "cimd" ? new URL(client.clientId).host : "Self-registered"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-muted)]">Returns to</dt>
          <dd className="truncate text-right font-mono text-[var(--text)]">
            {returnTo.protocol === "https:" ? returnTo.host : returnTo.origin}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-[12px] leading-5 text-[var(--text-faint)]">
        Only approve a connection you started yourself, just now. You can end it at any time in
        Settings → Claude connections.
      </p>

      <form method="post" action="/oauth/consent/decision" className="mt-6 flex gap-3">
        <Button type="submit" name="decision" value="approve" variant="primary" size="lg" className="flex-1">
          Allow
        </Button>
        <Button type="submit" name="decision" value="decline" size="lg">
          Decline
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-4 py-16">
      <div className="w-full max-w-md rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-md)] sm:p-8">
        <AnkordLogo className="mb-8 h-5 w-auto text-[var(--color-coastal-800)] dark:text-white" />
        {children}
      </div>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
      <div>
        <p className="text-[13px] font-medium text-[var(--danger)]">Can&rsquo;t connect</p>
        <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
  );
}
