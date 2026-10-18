import { PageHeader } from "@/components/app/page-header";
import { CampaignTabs } from "./tabs";

/** The marketing area's header: title, actions, then its own tabs. */
export function MarketingHeader(props: React.ComponentProps<typeof PageHeader>) {
  return (
    <>
      <PageHeader {...props} className="border-b-0" />
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto w-full max-w-[88rem] px-4 sm:px-6">
          <CampaignTabs />
        </div>
      </div>
    </>
  );
}
