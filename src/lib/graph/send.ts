import "server-only";
import { graphFetch, GraphError } from "./client";

/**
 * Sending one message through Graph, for campaigns. Delegated only:
 *
 * - from the signed-in person — `POST /me/sendMail`, needs `Mail.Send`;
 * - from a shared mailbox — `POST /users/{mailbox}/sendMail`, needs
 *   `Mail.Send.Shared` *and* Send As on that mailbox in Exchange. Without
 *   Send As, Exchange refuses with ErrorSendAsDenied.
 *
 * Graph only lets custom headers through when they start with "x-", so a
 * List-Unsubscribe header cannot be set here; the unsubscribe link in every
 * footer is what satisfies the Spam Act.
 */

export type OutgoingMessage = {
  /** Null sends as the signed-in person. */
  mailbox: string | null;
  to: { address: string; name?: string | null };
  subject: string;
  html: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  /** Campaign sends are not kept in Sent Items; test sends are. */
  saveToSentItems?: boolean;
};

export async function sendMessage(token: string, message: OutgoingMessage): Promise<void> {
  const path = message.mailbox
    ? `/users/${encodeURIComponent(message.mailbox)}/sendMail`
    : "/me/sendMail";

  await graphFetch<void>(token, path, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "HTML", content: message.html },
        toRecipients: [
          {
            emailAddress: {
              address: message.to.address,
              ...(message.to.name ? { name: message.to.name } : {}),
            },
          },
        ],
        ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {}),
        ...(message.headers
          ? {
              internetMessageHeaders: Object.entries(message.headers).map(([name, value]) => ({
                name,
                value,
              })),
            }
          : {}),
      },
      saveToSentItems: message.saveToSentItems ?? false,
    }),
  });
}

/** How a send failure should be handled by the engine. */
export function classifySendError(error: unknown): {
  /** Stop the whole campaign — nothing further will work until a person acts. */
  fatal: boolean;
  /** Back off and try the same recipient later. */
  retry: boolean;
  message: string;
} {
  if (error instanceof GraphError) {
    if (error.status === 429 || error.status === 503 || error.status === 504) {
      return { fatal: false, retry: true, message: "Microsoft asked us to slow down." };
    }
    if (error.code === "ErrorSendAsDenied" || /send ?as/i.test(error.message)) {
      return {
        fatal: true,
        retry: false,
        message:
          "Exchange refused to send as that mailbox. The sender needs Send As on it — see Campaigns → Settings.",
      };
    }
    if (error.isPermission || error.status === 401) {
      return {
        fatal: true,
        retry: false,
        message: "Microsoft refused permission to send. The sender needs to allow sending again.",
      };
    }
    if (error.code === "ErrorQuotaExceeded" || error.code === "ErrorExceededMessageLimit" || /quota|limit/i.test(error.message)) {
      return { fatal: false, retry: true, message: "The mailbox has hit Exchange's sending limit." };
    }
    if (error.status === 400) {
      return { fatal: false, retry: false, message: error.message };
    }
    return { fatal: false, retry: true, message: error.message };
  }
  return {
    fatal: false,
    retry: true,
    message: error instanceof Error ? error.message : "Sending failed.",
  };
}
