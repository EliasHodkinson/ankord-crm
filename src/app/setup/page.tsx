import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { AnkordLogo } from "@/components/brand/logo";
import { GRAPH_SCOPES } from "@/lib/auth/entra";
import { appUrl, missingEnv, optionalEnv, redirectUri } from "@/lib/env";

export const metadata: Metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<string, string> = {
  DATABASE_URL: "Neon pooled connection string (the one ending in -pooler).",
  AZURE_AD_TENANT_ID: "Directory (tenant) ID from the Entra app registration overview.",
  AZURE_AD_CLIENT_ID: "Application (client) ID from the same overview page.",
  AZURE_AD_CLIENT_SECRET:
    "Client secret VALUE (not the secret ID) from Certificates & secrets.",
  APP_ENCRYPTION_KEY: "32 random bytes, base64. Generate with: openssl rand -base64 32",
  APP_URL: "This deployment's origin, no trailing slash.",
};

export default async function SetupPage() {
  const missing = missingEnv();
  if (missing.length === 0) redirect("/");

  const keys = Object.keys(DESCRIPTIONS);

  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <AnkordLogo className="h-5 w-auto text-[var(--color-coastal-800)] dark:text-white" />

        <h1 className="mt-10 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-[var(--text)]">
          Finish connecting the CRM
        </h1>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-6 text-[var(--text-muted)]">
          {missing.length} of {keys.length} settings are still missing. Add them to{" "}
          <code className="rounded bg-[var(--surface-3)] px-1 py-0.5 text-[13px]">
            .env.local
          </code>{" "}
          locally, or to the Vercel project&rsquo;s environment variables, then reload.
        </p>

        <ol className="mt-8 divide-y divide-[var(--border-soft)] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          {keys.map((key) => {
            const present = Boolean(optionalEnv(key as never));
            return (
              <li key={key} className="flex gap-3 px-4 py-3.5">
                {present ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-[var(--ok)]" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-[var(--text-faint)]" />
                )}
                <div className="min-w-0">
                  <p
                    className={
                      present
                        ? "font-mono text-[13px] text-[var(--text-muted)] line-through"
                        : "font-mono text-[13px] font-medium text-[var(--text)]"
                    }
                  >
                    {key}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-muted)]">
                    {DESCRIPTIONS[key]}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <section className="mt-10">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
            Entra ID app registration
          </h2>
          <p className="mt-1.5 text-[13px] leading-6 text-[var(--text-muted)]">
            In the Microsoft Entra admin centre, create a single-tenant app registration
            with this exact redirect URI:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 font-mono text-[12px] text-[var(--text)] scrollbar-slim">
            {redirectUri()}
          </pre>
          <p className="mt-1.5 text-[12px] text-[var(--text-faint)]">
            Platform: <strong>Web</strong>. Derived from APP_URL, currently {appUrl()}.
          </p>

          <p className="mt-5 text-[13px] leading-6 text-[var(--text-muted)]">
            Grant these <strong>delegated</strong> Microsoft Graph permissions and click
            &ldquo;Grant admin consent&rdquo;:
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {GRAPH_SCOPES.filter((s) => !["openid", "profile", "email"].includes(s)).map(
              (scope) => (
                <li
                  key={scope}
                  className="rounded-md bg-[var(--surface-3)] px-2 py-1 font-mono text-[12px] text-[var(--text)]"
                >
                  {scope}
                </li>
              ),
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
