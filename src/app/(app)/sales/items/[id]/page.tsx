import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, XERO_SYNC } from "@/components/ui/status";
import { getItem } from "@/lib/data/items";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils";
import { ItemForm } from "../item-form";
import { itemFormOptions } from "../item-data";
import { ItemControls } from "../item-controls";

export const metadata: Metadata = { title: "Item" };
export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { user } = await requireUser();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  const item = await getItem(id);
  if (!item) notFound();
  const options = await itemFormOptions();
  const canWrite = canWriteSales(user.role);

  return (
    <>
      <PageHeader
        title={item.name}
        crumbs={[{ label: "Sales" }, { label: "Items", href: "/sales/items" }, { label: item.code }]}
        eyebrow={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] text-[var(--text-muted)]">{item.code}</span>
            <Badge tone="neutral">{item.tracksStock ? "Physical goods" : "Service"}</Badge>
            {item.archivedAt ? <Badge tone="muted">Archived</Badge> : null}
          </span>
        }
      />
      <PageBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-5">
          {saved ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-3 py-2 text-[13px] text-[var(--ok)]">
              <Check className="mt-0.5 size-4 shrink-0" />
              {saved}
            </p>
          ) : null}
          <Card>
            <CardBody>
              {canWrite ? (
                <ItemForm item={item} {...options} />
              ) : (
                <p className="text-[13px] text-[var(--text-muted)]">You can view items, but not change them.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Xero" />
            <CardBody className="flex flex-col gap-3">
              <StatusBadge map={XERO_SYNC} value={item.xeroSyncState} dot />
              <p className="text-[12px] text-[var(--text-muted)]">
                {item.xeroSyncedAt ? `Last saved in Xero ${formatDateTime(item.xeroSyncedAt)}` : "Not in Xero yet."}
              </p>
              {item.xeroError ? (
                <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger)]">
                  {item.xeroError}
                </p>
              ) : null}
              {canWrite ? <ItemControls itemId={item.id} archived={Boolean(item.archivedAt)} /> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Stock" meta="Counted from receipts and deliveries" />
            <CardBody>
              <p className="text-[13px] leading-6 text-[var(--text-muted)]">
                {item.tracksStock
                  ? "On hand, allocated and available appear here once purchasing and receiving are in place."
                  : "Services are not counted."}
              </p>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
