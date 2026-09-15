import "server-only";

/**
 * Posts Adaptive Cards to a Microsoft Teams channel.
 *
 * The target is a **Power Automate Workflows** webhook, not an Office 365
 * connector — those were disabled across Teams in May 2026. Create one in Teams
 * with "Workflows → Post to a channel when a webhook request is received" and
 * put the URL it gives you in TEAMS_WEBHOOK_URL.
 *
 * Notifications are a courtesy, never a dependency: with no URL configured this
 * is a no-op, and a failure is swallowed. Nobody should lose a stage change
 * because a webhook was slow.
 */

const TIMEOUT_MS = 4000;

export type CardFact = { title: string; value: string };

export type Notification = {
  title: string;
  subtitle?: string;
  facts?: CardFact[];
  /** Deep link back into the CRM. */
  url?: string;
  urlLabel?: string;
  /** Adaptive Card colour for the heading. */
  tone?: "default" | "good" | "warning" | "attention";
  /**
   * When set, the flow should send this as a direct message to that person
   * rather than posting it to the channel. Their Microsoft 365 address.
   *
   * The message arrives from Flow bot, not from The Gangway — rebranding the
   * sender needs a registered Teams bot. The card carries the name instead.
   */
  toEmail?: string;
};

export function teamsNotificationsConfigured(): boolean {
  return Boolean(process.env.TEAMS_WEBHOOK_URL);
}

function buildCard(input: Notification) {
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: input.title,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
      color: input.tone ?? "default",
    },
  ];

  if (input.subtitle) {
    body.push({
      type: "TextBlock",
      text: input.subtitle,
      wrap: true,
      isSubtle: true,
      spacing: "Small",
    });
  }

  if (input.facts?.length) {
    body.push({
      type: "FactSet",
      facts: input.facts.map((f) => ({ title: f.title, value: f.value })),
      spacing: "Medium",
    });
  }

  // The flow reads `to` to decide between a channel post and a direct message,
  // and `source` so a card is identifiable if the flow is ever reused.
  return {
    type: "message",
    source: "The Gangway",
    to: input.toEmail ?? null,
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(input.url
            ? {
                actions: [
                  {
                    type: "Action.OpenUrl",
                    title: input.urlLabel ?? "Open in the CRM",
                    url: input.url,
                  },
                ],
              }
            : {}),
        },
      },
    ],
  };
}

export type NotifyResult = { ok: boolean; detail: string };

/**
 * Never throws. Real notifications ignore the result — a missed card must not
 * surface as a failed user action — but the result is returned so the test
 * button in Settings can say what actually happened.
 */
export async function notifyTeams(input: Notification): Promise<NotifyResult> {
  const webhook = process.env.TEAMS_WEBHOOK_URL;
  if (!webhook) return { ok: false, detail: "no webhook configured" };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildCard(input)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        detail: `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`,
      };
    }
    return { ok: true, detail: `${res.status}` };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error && error.name === "TimeoutError"
          ? `no response within ${TIMEOUT_MS / 1000}s`
          : "the request failed",
    };
  }
}
