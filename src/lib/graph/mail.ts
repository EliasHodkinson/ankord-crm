import "server-only";
import { graphFetch, graphList } from "./client";

/**
 * Outlook mail, read with the signed-in user's delegated token. Linking a
 * message copies the header and body into the CRM timeline and keeps the Graph
 * identifiers so the original can always be opened in Outlook.
 */

export type GraphRecipient = { emailAddress?: { name?: string; address?: string } };

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  webLink?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  body?: { contentType: "text" | "html"; content: string };
};

const LIST_SELECT =
  "$select=id,internetMessageId,conversationId,subject,bodyPreview,receivedDateTime,sentDateTime,hasAttachments,isDraft,webLink,from,sender,toRecipients,ccRecipients";

/**
 * Full-text search across the user's mailbox. Graph's $search cannot be
 * combined with $orderby, so results come back in relevance order.
 */
export function searchMessages(
  token: string,
  query: string,
  top = 40,
): Promise<GraphMessage[]> {
  const escaped = query.replace(/"/g, '\\"');
  return graphList<GraphMessage>(
    token,
    `/me/messages?$search="${encodeURIComponent(escaped)}"&${LIST_SELECT}&$top=${top}`,
    top,
  );
}

/** Everything to or from a set of addresses, newest first. */
export function messagesWithAddresses(
  token: string,
  addresses: string[],
  top = 40,
): Promise<GraphMessage[]> {
  const clean = addresses.filter(Boolean).slice(0, 12);
  if (clean.length === 0) return Promise.resolve([]);
  // "from:a OR to:a" across every known address for the customer.
  const query = clean.map((a) => `participants:${a}`).join(" OR ");
  return searchMessages(token, query, top);
}

export function recentMessages(token: string, top = 40): Promise<GraphMessage[]> {
  return graphList<GraphMessage>(
    token,
    `/me/messages?${LIST_SELECT}&$top=${top}&$orderby=receivedDateTime desc`,
    top,
  );
}

export function getMessage(token: string, id: string): Promise<GraphMessage> {
  return graphFetch<GraphMessage>(
    token,
    `/me/messages/${encodeURIComponent(id)}?${LIST_SELECT.replace(
      "$select=",
      "$select=body,",
    )}`,
  );
}

export const addressOf = (r: GraphRecipient | undefined) =>
  r?.emailAddress?.address?.toLowerCase() ?? null;

export const nameOf = (r: GraphRecipient | undefined) =>
  r?.emailAddress?.name ?? r?.emailAddress?.address ?? null;

export function recipientList(list: GraphRecipient[] | undefined) {
  return (list ?? [])
    .map((r) => ({ name: r.emailAddress?.name, address: r.emailAddress?.address ?? "" }))
    .filter((r) => r.address);
}

/**
 * Marketing senders pad the preheader so the inbox preview shows only their
 * first line. The padding is a mix of zero-width formatting characters and
 * exotic spaces — combining grapheme joiners and figure spaces are the usual
 * pair. Left in, they fill the whole preview with nothing.
 */
const INVISIBLE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFA0]/g;

/** Spaces that are not U+0020, plus the blank braille cell. */
const ODD_SPACE = /[\u00A0\u2000-\u200A\u202F\u205F\u2800\u3000]/g;

/** Normalises any mail text for display: no invisibles, no runaway spacing. */
export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(ODD_SPACE, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strips an HTML body down to readable text for the timeline preview. */
export function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}
