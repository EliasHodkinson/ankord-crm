import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { AnkordLogo, AnkordMark } from "@/components/brand/logo";
import { getSession } from "@/lib/auth/session";
import { isAuthConfigured, isDatabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) redirect("/setup");
  if (await getSession()) redirect("/");

  const { error, next } = await searchParams;
  const target = `/api/auth/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — the one place the emblem is allowed to be large */}
      <div className="relative hidden overflow-hidden bg-[var(--color-coastal-800)] lg:block">
        <AnkordMark
          className="absolute -right-24 -bottom-32 size-[42rem] rotate-12 text-[var(--color-sunrise-500)] opacity-[0.10]"
          title=""
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <AnkordLogo className="h-6 w-auto text-white" />
          <div className="max-w-[26rem]">
            <p className="text-[32px] leading-[1.15] font-semibold tracking-[-0.03em] text-white text-balance">
              Every client, every project, every conversation — in one place.
            </p>
            <p className="mt-4 text-[14px] leading-6 text-[var(--color-coastal-200)]">
              Anchored to the Ankor&rsquo;d Microsoft 365 tenant. Files stay in SharePoint,
              email stays in Outlook, and the CRM keeps the thread.
            </p>
          </div>
          <p className="text-[12px] text-[var(--color-coastal-200)]">
            Ankor&rsquo;d Pty Ltd · Internal system
          </p>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center bg-[var(--surface)] px-6 py-16">
        <div className="w-full max-w-sm">
          <AnkordLogo className="mb-10 h-5 w-auto text-[var(--color-coastal-800)] lg:hidden dark:text-white" />

          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-[var(--text)]">
            Sign in to Ankor&rsquo;d CRM
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">
            Use your Ankor&rsquo;d work account. There is no separate CRM password —
            access follows your Microsoft 365 sign-in and MFA.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-6 flex gap-2.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2.5"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
              <div>
                <p className="text-[13px] font-medium text-[var(--danger)]">
                  That sign-in didn&rsquo;t complete
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-muted)]">{error}</p>
              </div>
            </div>
          ) : null}

          <a
            href={target}
            className="mt-7 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-[var(--color-coastal-800)] px-5 text-[14px] font-medium text-white shadow-[var(--shadow-md)] transition-colors duration-150 hover:bg-[var(--color-coastal-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <MicrosoftLogo />
            Continue with Microsoft
          </a>

          <p className="mt-6 text-[12px] leading-5 text-[var(--text-faint)]">
            Only accounts in the Ankor&rsquo;d tenant can sign in. The CRM reads your
            mail and SharePoint files as you, so you will never see anything in here
            that you cannot already see in Microsoft 365.
          </p>
        </div>
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
