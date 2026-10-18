import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { AnkordLogo } from "@/components/brand/logo";
import { isSuppressed, recipientByToken } from "@/lib/campaigns/tracking";

export const metadata: Metadata = { title: { absolute: "Unsubscribe · Ankor'd" } };
export const dynamic = "force-dynamic";

/** w•••@example.com.au — enough to recognise, not enough to harvest. */
function mask(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(user.length - 1, 6)))}@${domain}`;
}

/**
 * The public unsubscribe page every campaign links to. It asks before it
 * acts: mail scanners open every link in a message, and a GET that
 * unsubscribed would unsubscribe people who never asked to be.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const recipient = token === "test" ? null : await recipientByToken(token);
  const already = recipient ? await isSuppressed(recipient.email) : false;

  let body: React.ReactNode;
  if (token === "test") {
    body = (
      <Message title="This was a test email">
        Unsubscribe links in test sends don&rsquo;t do anything. In the real campaign, this is where
        each person can opt out.
      </Message>
    );
  } else if (!recipient) {
    body = (
      <Message title="We couldn't find that email">
        The link may be incomplete. To stop hearing from us, reply to any of our emails with
        &ldquo;unsubscribe&rdquo; and we&rsquo;ll take care of it.
      </Message>
    );
  } else if (done === "1" || already) {
    body = (
      <Message title="You're unsubscribed" icon>
        {mask(recipient.email)} won&rsquo;t receive marketing email from Ankor&rsquo;d again. You may
        still hear from us about work we&rsquo;re doing together.
      </Message>
    );
  } else {
    body = (
      <>
        <Message title="Unsubscribe from Ankor'd emails?">
          {mask(recipient.email)} will stop receiving our marketing email. Emails about work
          we&rsquo;re doing together aren&rsquo;t affected.
        </Message>
        <form method="post" action={`/m/u/${encodeURIComponent(token)}/confirm`} className="mt-6">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-5 text-[14px] font-medium text-[var(--accent-fg)] shadow-[var(--shadow-sm)] transition-colors duration-150 hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            Unsubscribe
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-2)] px-4 py-16">
      <div className="w-full max-w-md rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow-sm)]">
        <AnkordLogo className="mb-8 h-5 w-auto text-[var(--color-coastal-800)] dark:text-white" />
        {body}
      </div>
    </div>
  );
}

function Message({ title, icon, children }: { title: string; icon?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="flex items-center gap-2 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-[var(--text)]">
        {icon ? <CheckCircle2 className="size-5 text-[var(--ok)]" aria-hidden /> : null}
        {title}
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-[var(--text-muted)]">{children}</p>
    </div>
  );
}
