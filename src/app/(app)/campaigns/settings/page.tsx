import type { Metadata } from "next";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { PageBody } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser, sessionScopes } from "@/lib/auth/session";
import { hasScopeSet } from "@/lib/auth/entra";
import { requireStaffPage } from "@/lib/access";
import { getSettings } from "@/lib/data/common";
import { MarketingHeader } from "../marketing-header";
import { AllowSending } from "../[id]/campaign-forms";
import { MarketingSettingsForm } from "./marketing-settings-form";

export const metadata: Metadata = { title: "Campaign settings" };
export const dynamic = "force-dynamic";

export default async function CampaignSettingsPage() {
  const { user } = await requireUser();
  await requireStaffPage();
  const isAdmin = user.role === "admin";
  const [settings, scopes] = await Promise.all([getSettings(), sessionScopes()]);
  const canSend = hasScopeSet(scopes, "marketing");
  const mailbox = settings?.marketingMailbox ?? "marketing@ankord.com.au";

  return (
    <>
      <MarketingHeader
        title="Campaigns"
        description="Where campaigns send from, and what every one of them says at the bottom."
      />
      <PageBody className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeader title="Sender and footer" meta={isAdmin ? "Applies to every campaign" : "Only an admin can change these"} />
          <CardBody>
            <MarketingSettingsForm
              readOnly={!isAdmin}
              values={{
                marketingMailbox: settings?.marketingMailbox ?? "",
                marketingFooter: settings?.marketingFooter ?? "",
                marketingLogoUrl: settings?.marketingLogoUrl ?? "",
                social: settings?.marketingSocial ?? {},
              }}
            />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Sending through Microsoft 365" />
            <CardBody className="flex flex-col gap-4 text-[13px] leading-6 text-[var(--text-muted)]">
              <p>
                Campaigns go out through Exchange Online with your own Microsoft sign-in — there is no separate email
                service and no stored password. Each message is sent one at a time, about 25 a minute, inside Exchange&rsquo;s
                limit of 30 a minute and 10,000 a day per mailbox.
              </p>
              <Status ok={canSend} label={canSend ? "You've allowed The Gangway to send email" : "You haven't allowed sending yet"} />
              {canSend ? null : <AllowSending href={`/api/auth/signin?scopes=marketing&next=${encodeURIComponent("/campaigns/settings")}`} />}
              <div>
                <p className="font-medium text-[var(--text)]">To send as {mailbox}</p>
                <p>
                  An Exchange admin gives each sender <strong className="font-medium text-[var(--text)]">Send As</strong> on that
                  mailbox: Exchange admin centre → Recipients → Mailboxes → {mailbox} → Delegation → Send as. Until then,
                  send a test — Exchange will say if it&rsquo;s refused.
                </p>
              </div>
              <div>
                <p className="font-medium text-[var(--text)]">Keeping it out of junk</p>
                <p>
                  Sending from Exchange means SPF and DKIM already line up with ankord.com.au. Keep lists to people who
                  know Ankor&rsquo;d, and it stays that way.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className={"flex items-center gap-2 font-medium " + (ok ? "text-[var(--ok)]" : "text-[var(--warn)]")}>
      {ok ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
      {label}
    </p>
  );
}
