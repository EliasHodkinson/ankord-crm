import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataRow } from "@/components/ui/field";
import { LibraryPicker } from "./library-picker";
import { TeamTable } from "./team-table";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSettings } from "@/lib/data/common";
import { readLibraries } from "@/lib/data/files";
import { requireUser } from "@/lib/auth/session";
import { GRAPH_SCOPES } from "@/lib/auth/entra";
import { appUrl, redirectUri } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user } = await requireUser();
  const isAdmin = user.role === "admin";

  const [settings, team] = await Promise.all([
    getSettings(),
    getDb()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        photo: users.photo,
        jobTitle: users.jobTitle,
        role: users.role,
        roleSource: users.roleSource,
        isActive: users.isActive,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .orderBy(asc(users.name)),
  ]);

  // Only an admin can see the picker, so only an admin pays for this call.
  const libraries = isAdmin ? await readLibraries(settings?.spSiteId ?? null) : [];

  return (
    <>
      <PageHeader
        title="Settings"
        description="How the CRM connects to Microsoft 365, and who can do what inside it."
      />

      <PageBody className="flex max-w-4xl flex-col gap-5">
        <Card>
          <CardHeader
            title="Microsoft 365 connection"
            meta="Sign-in, mail and files all run through the Ankor'd tenant"
          />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--ok)]/25 bg-[var(--ok-bg)] px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--ok)]" />
              <p className="text-[12px] leading-5 text-[var(--text-muted)]">
                You are signed in as{" "}
                <span className="font-medium text-[var(--text)]">{user.email}</span>. The
                CRM acts as you when it reads mail and SharePoint — it holds no separate
                service account, and it cannot see anything you can&rsquo;t.
              </p>
            </div>

            <dl className="divide-y divide-[var(--border-soft)]">
              <DataRow label="Redirect URI">
                <code className="font-mono text-[12px] break-all">{redirectUri()}</code>
              </DataRow>
              <DataRow label="App URL">
                <code className="font-mono text-[12px] break-all">{appUrl()}</code>
              </DataRow>
              <DataRow label="Graph permissions">
                <span className="flex flex-wrap gap-1">
                  {GRAPH_SCOPES.filter(
                    (s) => !["openid", "profile", "email", "offline_access"].includes(s),
                  ).map((scope) => (
                    <code
                      key={scope}
                      className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {scope}
                    </code>
                  ))}
                </span>
              </DataRow>
              <DataRow label="Last sign-in">{formatDateTime(user.lastSeenAt)}</DataRow>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="SharePoint file storage"
            meta={
              settings?.spDriveId
                ? `Client folders are created under "${settings.spRootFolder}"`
                : "Not connected yet"
            }
            action={
              settings?.spDriveId ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ok)]">
                  <CheckCircle2 className="size-3.5" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--warn)]">
                  <CircleAlert className="size-3.5" />
                  Needs setup
                </span>
              )
            }
          />
          <CardBody>
            {isAdmin ? (
              <LibraryPicker settings={settings} initialDrives={libraries} />
            ) : (
              <p className="text-[13px] leading-6 text-[var(--text-muted)]">
                {settings?.spSiteUrl ? (
                  <>
                    Files are stored in{" "}
                    <a
                      href={settings.spSiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                    >
                      the connected SharePoint site
                    </a>
                    , under the &ldquo;{settings.spRootFolder}&rdquo; folder. An admin can
                    change this.
                  </>
                ) : (
                  "An administrator needs to connect a SharePoint document library before files can be stored against customers and projects."
                )}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Team"
            meta="Anyone who signs in with an Ankor'd account appears here automatically"
          />
          <CardBody>
            {isAdmin ? (
              <TeamTable rows={team} currentUserId={user.id} />
            ) : (
              <ul className="flex flex-col gap-2">
                {team
                  .filter((t) => t.isActive)
                  .map((member) => (
                    <li key={member.id} className="text-[13px] text-[var(--text)]">
                      {member.name}
                      <span className="text-[var(--text-muted)]">
                        {member.jobTitle ? ` · ${member.jobTitle}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
