import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, XERO_SYNC } from "@/components/ui/status";
import { getItem } from "@/lib/data/items";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import Link from "next/link";
import { cn, formatDateTime } from "@/lib/utils";
import { stockFor, stockMovements } from "@/lib/data/stock";
import { docHref, typeLabel } from "@/lib/sales/doc-types";
import { formatQty } from "@/lib/sales/money";
import { StockAdjust } from "../stock-adjust";
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
  const [options, stockMap, moves] = await Promise.all([itemFormOptions(), stockFor([item.id]), stockMovements(item.id)]);
  const stock = stockMap.get(item.id) ?? null;
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
            <CardBody className="flex flex-col gap-3">
              {item.tracksStock && stock ? (
                <>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "On hand", value: stock.onHand },
                      { label: "Allocated", value: stock.allocated },
                      { label: "Available", value: stock.available },
                    ].map((f) => (
                      <div key={f.label} className="rounded-lg border border-[var(--border-soft)] px-2 py-2">
                        <dt className="text-[11px] text-[var(--text-muted)]">{f.label}</dt>
                        <dd className={cn("tabular text-[17px] font-semibold", f.value < 0 ? "text-[var(--danger)]" : "text-[var(--text)]")}>
                          {formatQty(f.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {stock.onHand < 0 ? (
                    <p className="text-[12px] text-[var(--danger)]">
                      More has gone out than was booked in. Receive what arrived, or correct the count.
                    </p>
                  ) : null}
                  {moves.moves.length || moves.adjustments.length ? (
                    <ul className="flex flex-col divide-y divide-[var(--border-soft)] text-[12px]">
                      {moves.moves.slice(0, 8).map((m) => (
                        <li key={m.id} className="flex justify-between gap-2 py-1.5">
                          <Link href={docHref({ type: m.type, id: m.documentId })} className="truncate hover:underline underline-offset-2">
                            {m.number ?? typeLabel(m.type)} · {m.partnerName}
                          </Link>
                          <span className="tabular shrink-0">
                            {m.type === "goods_receipt" ? "+" : "−"}
                            {formatQty(m.quantity)}
                          </span>
                        </li>
                      ))}
                      {moves.adjustments.slice(0, 5).map((a) => (
                        <li key={a.id} className="flex justify-between gap-2 py-1.5 text-[var(--text-muted)]">
                          <span className="truncate">Corrected: {a.reason}</span>
                          <span className="tabular shrink-0">
                            {Number(a.quantity) > 0 ? "+" : ""}
                            {formatQty(a.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-[var(--text-muted)]">Nothing received or delivered yet.</p>
                  )}
                  {user.role === "admin" ? <StockAdjust itemId={item.id} /> : null}
                </>
              ) : (
                <p className="text-[13px] leading-6 text-[var(--text-muted)]">
                  Services are not counted. Tick &quot;Physical goods&quot; for goods that are received, set aside and delivered.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
