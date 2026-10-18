import "server-only";
import { appUrl } from "@/lib/env";
import type { Campaign, CampaignRecipient, Settings } from "@/lib/db/schema";
import { cleanBlocks, cleanTheme, fillMergeTags, SAMPLE_MERGE, type MergeValues } from "./model";
import { renderEmail } from "./render";

/**
 * One campaign, rendered for one person: their merge values, their subject
 * variant, and links that carry their token. Also used, without tracking, for
 * test sends and the "view in your browser" page.
 */

export type Sender = { name: string; jobTitle: string | null };

export type MarketingSettings = Pick<
  Settings,
  "marketingFooter" | "marketingLogoUrl" | "marketingSocial" | "marketingMailbox"
>;

export const DEFAULT_LOGO_PATH = "/brand/ankord-logo-email.png";

/**
 * For an email served as a page on The Gangway's own origin (the web version,
 * the full-size preview): images and inline styles, never script. A custom
 * HTML block is scrubbed, but this is what makes that not matter.
 */
export const EMAIL_PAGE_CSP =
  "default-src 'none'; img-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src *; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export const trackingUrls = (token: string) => {
  const base = appUrl();
  return {
    open: `${base}/m/o/${token}`,
    click: (linkId: string) => `${base}/m/c/${token}/${linkId}`,
    unsubscribe: `${base}/m/u/${token}`,
    web: `${base}/m/v/${token}`,
  };
};

export function mergeValuesFor(
  recipient: Pick<CampaignRecipient, "firstName" | "lastName" | "company" | "jobTitle" | "email"> | null,
  sender: Sender | null,
): MergeValues {
  const full = recipient ? [recipient.firstName, recipient.lastName].filter(Boolean).join(" ") : "";
  return {
    first_name: recipient?.firstName ?? null,
    last_name: recipient?.lastName ?? null,
    full_name: full || null,
    company: recipient?.company ?? null,
    job_title: recipient?.jobTitle ?? null,
    email: recipient?.email ?? null,
    sender_name: sender?.name ?? null,
    sender_title: sender?.jobTitle ?? null,
  };
}

/** The subject and preheader a recipient gets, A or B. */
export function variantCopy(campaign: Pick<Campaign, "subject" | "preheader" | "abTest">, variant: "a" | "b" | null) {
  if (variant === "b" && campaign.abTest?.subjectB) {
    return {
      subject: campaign.abTest.subjectB,
      preheader: campaign.abTest.preheaderB || campaign.preheader,
    };
  }
  return { subject: campaign.subject, preheader: campaign.preheader };
}

export function composeEmail(opts: {
  campaign: Pick<Campaign, "subject" | "preheader" | "abTest" | "blocks" | "theme" | "trackOpens" | "trackClicks">;
  recipient: CampaignRecipient | null;
  sender: Sender | null;
  settings: MarketingSettings | null;
  /** Destination → link row id, for click tracking. */
  links?: Map<string, string>;
  /** `send` tracks; `test` and `web` do not. */
  mode: "send" | "test" | "web";
  /** For a test: whose details fill the merge tags. */
  merge?: MergeValues;
}): { subject: string; html: string } {
  const { campaign, recipient, settings, mode } = opts;
  const urls = recipient ? trackingUrls(recipient.token) : null;
  const copy = variantCopy(campaign, recipient?.variant ?? null);
  const merge = opts.merge ?? mergeValuesFor(recipient, opts.sender);
  const track = mode === "send" && urls;

  const html = renderEmail(cleanBlocks(campaign.blocks), cleanTheme(campaign.theme), {
    subject: copy.subject,
    preheader: copy.preheader,
    merge,
    footer: settings?.marketingFooter ?? "",
    social: settings?.marketingSocial ?? {},
    unsubscribeUrl: urls?.unsubscribe ?? `${appUrl()}/m/u/test`,
    webVersionUrl: mode === "send" && urls ? urls.web : null,
    openPixelUrl: track && campaign.trackOpens ? urls.open : null,
    trackLink:
      track && campaign.trackClicks && opts.links
        ? (href) => {
            const id = opts.links!.get(href);
            return id ? urls.click(id) : href;
          }
        : undefined,
    defaultLogoUrl: settings?.marketingLogoUrl || `${appUrl()}${DEFAULT_LOGO_PATH}`,
  });

  // The subject is plain text, so merge tags are filled but nothing is escaped.
  return { subject: fillMergeTags(copy.subject, merge).trim(), html };
}

/** A sample render — template cards, the campaign summary — with sample merge values. */
export function previewHtml(
  content: { subject: string; preheader: string; blocks: unknown; theme: unknown },
  settings: MarketingSettings | null,
): string {
  return renderEmail(cleanBlocks(content.blocks), cleanTheme(content.theme), {
    subject: content.subject,
    preheader: content.preheader,
    merge: SAMPLE_MERGE,
    footer: settings?.marketingFooter ?? "",
    social: settings?.marketingSocial ?? {},
    unsubscribeUrl: "#",
    defaultLogoUrl: logoUrl(settings),
  });
}

export const logoUrl = (settings: MarketingSettings | null) =>
  settings?.marketingLogoUrl || `${appUrl()}${DEFAULT_LOGO_PATH}`;
