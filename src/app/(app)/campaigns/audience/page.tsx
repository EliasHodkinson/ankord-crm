import type { Metadata } from "next";
import { PageBody } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/charts";
import { FilterBar } from "@/components/app/filter-bar";
import { requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { audienceHealth, listMarketingContacts, listSegments, listSuppressions } from "@/lib/data/campaigns";
import { percent } from "@/lib/campaigns/model";
import { MARKETING_CONSENT, MARKETING_CONSENT_HINT } from "@/components/ui/status";
import { MarketingHeader } from "../marketing-header";
import { ConsentTable, SegmentList, SuppressionForm, SuppressionList } from "./audience-forms";

export const metadata: Metadata = { title: "Audience" };
export const dynamic = "force-dynamic";

export default async function AudiencePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; consent?: string }>;
}) {
  const { user } = await requireUser();
  await requireStaffPage();
  const writer = user.role === "admin" || user.role === "member";
  const { q, consent } = await searchParams;
  const [health, people, suppressions, segments] = await Promise.all([
    audienceHealth(),
    listMarketingContacts({ q, consent }),
    listSuppressions(),
    listSegments(),
  ]);

  return (
    <>
      <MarketingHeader
        title="Campaigns"
        description="Everyone with an email address in The Gangway is a possible recipient. This is where consent is recorded and opt-outs are kept."
      />
      <PageBody className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="People with an email" value={health.withEmail.toLocaleString("en-AU")} />
          <StatTile label={MARKETING_CONSENT.express.label} value={health.express.toLocaleString("en-AU")} detail={percent(health.express, health.withEmail)} />
          <StatTile label={MARKETING_CONSENT.inferred.label} value={health.inferred.toLocaleString("en-AU")} detail={percent(health.inferred, health.withEmail)} />
          <StatTile label="Can't be emailed" value={health.suppressed.toLocaleString("en-AU")} detail="Unsubscribed, bounced or removed" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="flex min-w-0 flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text)]">Consent</h2>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-6 text-[var(--text-muted)]">
                Australia&rsquo;s Spam Act asks for consent before marketing email.{" "}
                <strong className="font-medium text-[var(--text)]">{MARKETING_CONSENT.express.label}</strong> —{" "}
                {MARKETING_CONSENT_HINT.express.toLowerCase()}{" "}
                <strong className="font-medium text-[var(--text)]">{MARKETING_CONSENT.inferred.label}</strong> —{" "}
                {MARKETING_CONSENT_HINT.inferred.toLowerCase()} A campaign can be limited to either.
              </p>
            </div>
            <FilterBar
              searchPlaceholder="Search people…"
              filters={[
                {
                  param: "consent",
                  label: "Consent",
                  defaultValue: "all",
                  options: [
                    { value: "all", label: "Everyone" },
                    { value: "express", label: MARKETING_CONSENT.express.label },
                    { value: "inferred", label: MARKETING_CONSENT.inferred.label },
                    { value: "none", label: MARKETING_CONSENT.none.label },
                  ],
                },
              ]}
            />
            <ConsentTable people={people} writer={writer} />
          </section>

          <aside className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Don't email" meta={`${suppressions.length} ${suppressions.length === 1 ? "address" : "addresses"}`} />
              <CardBody className="flex flex-col gap-4">
                <p className="text-[12px] leading-5 text-[var(--text-muted)]">
                  Unsubscribes and bounces land here on their own. No campaign reaches these addresses, whichever contact or lead they belong to.
                </p>
                {writer ? <SuppressionForm /> : null}
              </CardBody>
              <SuppressionList rows={suppressions} writer={writer} />
            </Card>

            <Card>
              <CardHeader title="Saved audiences" meta="Made with “Save for reuse” on a campaign" />
              <SegmentList segments={segments.map((s) => ({ id: s.id, name: s.name }))} writer={writer} />
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
