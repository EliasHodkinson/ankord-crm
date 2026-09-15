"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { customers, projects } from "@/lib/db/schema";
import { getGraphToken, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/data/common";
import { ensureChildFolders, ensureFolderPath } from "@/lib/graph/sharepoint";
import { parseFolderTemplate } from "@/lib/folder-template";
import { describeGraphFailure } from "@/lib/graph/errors";
import { fail, logActivity, type ActionState } from "./shared";

/**
 * Creates the SharePoint folder that backs a customer or project and records
 * where it landed. Safe to run twice — an existing folder is reused.
 */
export async function provisionFolder(
  scope: { customerId: string } | { projectId: string },
): Promise<ActionState> {
  await requireUser();
  const db = getDb();
  const settings = await getSettings();

  if (!settings?.spDriveId) {
    return fail(
      "No SharePoint library is connected yet. An admin can choose one in Settings.",
    );
  }

  // A blank client folder means customer folders sit at the library root.
  const root = settings.spRootFolder?.trim() ?? "";

  try {
    const token = await getGraphToken();

    if ("customerId" in scope) {
      const [customer] = await db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.id, scope.customerId))
        .limit(1);
      if (!customer) return fail("That customer no longer exists.");

      const folder = await ensureFolderPath(token, settings.spDriveId, [
        root,
        customer.name,
      ]);

      // The numbered client structure lives inside the customer folder. A
      // project folder is deliberately left bare — the structure is per-client.
      const template = parseFolderTemplate(settings.spFolderTemplate);
      const structure = template.length
        ? await ensureChildFolders(token, settings.spDriveId, folder.id, template)
        : { created: [], failed: [] };

      await db
        .update(customers)
        .set({
          spDriveId: settings.spDriveId,
          spItemId: folder.id,
          spWebUrl: folder.webUrl,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customer.id));

      await logActivity({
        entityType: "customer",
        entityId: customer.id,
        customerId: customer.id,
        verb: "files_linked",
        summary: `Connected the SharePoint folder for ${customer.name}`,
      });

      // Auto-provisioning swallows its errors so a Graph problem cannot cost
      // someone the record they just created — which would otherwise make a
      // half-built structure invisible. Put it in the timeline instead.
      if (structure.failed.length) {
        await logActivity({
          entityType: "customer",
          entityId: customer.id,
          customerId: customer.id,
          verb: "files_incomplete",
          summary: `Could not create ${structure.failed.join(", ")} in SharePoint — use "Check folder structure" to finish`,
        });
      }

      revalidatePath(`/customers/${customer.id}`);

      if (structure.failed.length) {
        return {
          ok: true,
          message: `SharePoint folder ready, but ${structure.failed.join(", ")} could not be created. Try again to finish the structure.`,
        };
      }
      return { ok: true, message: "SharePoint folder ready." };
    }

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        customerId: projects.customerId,
        customerName: customers.name,
      })
      .from(projects)
      .innerJoin(customers, eq(customers.id, projects.customerId))
      .where(eq(projects.id, scope.projectId))
      .limit(1);
    if (!project) return fail("That project no longer exists.");

    const folder = await ensureFolderPath(token, settings.spDriveId, [
      root,
      project.customerName,
      project.name,
    ]);

    await db
      .update(projects)
      .set({
        spDriveId: settings.spDriveId,
        spItemId: folder.id,
        spWebUrl: folder.webUrl,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    await logActivity({
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      customerId: project.customerId,
      verb: "files_linked",
      summary: `Connected the SharePoint folder for ${project.name}`,
    });

    revalidatePath(`/projects/${project.id}`);
    return { ok: true, message: "SharePoint folder ready." };
  } catch (error) {
    return fail(describeGraphFailure(error));
  }
}

/**
 * Provisions the folder when a record is first created, honouring the
 * auto-provision setting — and never throwing.
 *
 * A SharePoint outage must not cost someone the customer they just typed in.
 * The record is already committed by the time this runs; if provisioning
 * fails, the record simply has no folder yet and the detail page offers
 * "Create SharePoint folder" as the retry.
 */
export async function autoProvisionFolder(
  scope: { customerId: string } | { projectId: string },
): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings?.spAutoProvision || !settings.spDriveId) return;
    await provisionFolder(scope);
  } catch {
    /* Deliberately swallowed — see above. */
  }
}
