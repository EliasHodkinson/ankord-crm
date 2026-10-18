"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { disconnectXero } from "@/lib/xero/auth";
import {
  notifyTeams,
  teamsDirectMessagesConfigured,
  teamsNotificationsConfigured,
} from "@/lib/notify";
import { appUrl } from "@/lib/env";
import {
  emptyToNull,
  fail,
  fromZod,
  logActivity,
  optionalText,
  type ActionState,
} from "./shared";

const librarySchema = z.object({
  spSiteId: z.string().trim().min(1, "Choose a SharePoint site."),
  spSiteUrl: optionalText,
  spDriveId: z.string().trim().min(1, "Choose a document library."),
  // Blank is allowed: it puts customer folders straight at the library root.
  spRootFolder: z.preprocess(
    emptyToNull,
    z.string().trim().nullable(),
  ),
  // Blank switches lead folders off entirely.
  spLeadFolder: z.preprocess(emptyToNull, z.string().trim().nullable()),
  spAutoProvision: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean(),
  ),
  // One folder per line. A textarea sends \r\n, and blank is a real choice —
  // it means the client folder is created with nothing inside it.
  spFolderTemplate: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : ""),
    z.string(),
  ),
});

/** Points the CRM at the document library that holds client files. */
export async function saveLibrary(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = librarySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fromZod(parsed.error);

  await getDb()
    .insert(settings)
    .values({ id: "singleton", ...parsed.data, updatedById: user.id })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...parsed.data, updatedById: user.id, updatedAt: new Date() },
    });

  await logActivity({
    entityType: "settings",
    entityId: "singleton",
    verb: "updated",
    summary: "Changed the SharePoint library the CRM stores files in",
  });

  revalidatePath("/settings");
  return { ok: true, message: "SharePoint library saved." };
}

/** Drops the Xero connection. Admin-only, like connecting it. */
export async function disconnectXeroAction(): Promise<ActionState> {
  const { user } = await requireAdmin();
  await disconnectXero();

  await logActivity({
    entityType: "settings",
    entityId: "singleton",
    verb: "xero_disconnected",
    summary: `${user.name} disconnected Xero`,
  });

  revalidatePath("/settings");
  return { ok: true, message: "Xero disconnected." };
}

/**
 * Posts a card to the configured Teams webhook so the connection can be
 * checked without waiting for a lead to reach Proposal.
 *
 * Reports the failure rather than swallowing it, unlike real notifications —
 * the whole point here is to find out what is wrong.
 */
export async function sendTestNotification(toSelf: boolean): Promise<ActionState> {
  const { user } = await requireAdmin();

  if (!teamsNotificationsConfigured()) {
    return fail(
      "No TEAMS_WEBHOOK_URL is set on this deployment. Add it in Vercel and redeploy.",
    );
  }

  const delivered = await notifyTeams({
    title: "Test from The Gangway",
    subtitle: toSelf
      ? "If you can read this as a direct message, the flow's condition branch works."
      : "If you can read this in the channel, notifications are working.",
    tone: "good",
    facts: [
      { title: "Sent by", value: user.name },
      { title: "Route", value: toSelf ? "Direct message" : "Channel" },
    ],
    url: appUrl(),
    urlLabel: "Open The Gangway",
    ...(toSelf ? { toEmail: user.email } : {}),
  });

  if (!delivered.ok) {
    return fail(
      `Teams did not accept the card: ${delivered.detail}. Check the webhook URL, and that the flow is turned on in Power Automate.`,
    );
  }

  if (toSelf && !teamsDirectMessagesConfigured()) {
    return {
      ok: true,
      message:
        "Sent — but to the channel, because no TEAMS_DM_WEBHOOK_URL is set. Create the direct-message flow and add its URL to see this arrive as a chat.",
    };
  }

  return {
    ok: true,
    message: toSelf
      ? "Sent as a direct message. Check your Teams chat with Flow bot."
      : "Sent to the channel. It should appear within a few seconds.",
  };
}
