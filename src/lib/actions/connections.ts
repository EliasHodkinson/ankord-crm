"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

/**
 * Ends a Claude (MCP) connection: its session row goes, and with it the
 * connection's Microsoft tokens and every token issued to the client. Your
 * own, or anyone's if you are an admin.
 */
export async function endConnection(sessionId: string): Promise<void> {
  const { user } = await requireUser();
  await getDb()
    .delete(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.kind, "mcp"),
        user.role === "admin" ? undefined : eq(sessions.userId, user.id),
      ),
    );
  revalidatePath("/settings/connections");
}
