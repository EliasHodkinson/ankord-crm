import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { RaiseForm } from "@/components/app/documents/raise-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { customers, items } from "@/lib/db/schema";
import { getDocument } from "@/lib/data/documents";
import { priceItems } from "@/lib/data/items";
import { docHref, documentTitle } from "@/lib/sales/doc-types";
import { num } from "@/lib/sales/money";
import { isoDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Raise purchase orders" };
export const dynamic = "force-dynamic";

/** Raise POs for what a confirmed sales order still needs (spec §6.2). */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  if (!from) redirect("/sales/orders");
  const { user } = await requireUser();
  const detail = await getDocument(from);
  if (!detail || detail.doc.type !== "sales_order") notFound();
  const { doc, lines } = detail;
  const back = docHref(doc);

  const candidates = lines.filter((l) => l.rowType === "item" && num(l.qtyDelivered) < num(l.quantity));
  const blocked = !canWriteSales(user.role)
    ? "Raising purchase orders is for Ankor'd staff."
    : doc.status !== "open"
      ? `Confirm ${documentTitle(doc)} before ordering stock for it.`
      : candidates.length === 0
        ? "Everything on this order has gone out already."
        : null;

  const itemIds = [...new Set(candidates.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  const [priced, itemRows] = await Promise.all([
    priceItems(itemIds, "supplier"),
    itemIds.length
      ? getDb().select({ id: items.id, supplierId: items.preferredSupplierId }).from(items).where(inArray(items.id, itemIds))
      : Promise.resolve([]),
  ]);
  const supplierIds = [...new Set(itemRows.map((r) => r.supplierId).filter((id): id is string => Boolean(id)))];
  const suppliers = supplierIds.length
    ? await getDb().select({ id: customers.id, name: customers.name, isSupplier: customers.isSupplier }).from(customers).where(inArray(customers.id, supplierIds))
    : [];
  const preferred = new Map(itemRows.map((r) => [r.id, suppliers.find((s) => s.id === r.supplierId && s.isSupplier) ?? null]));

  return (
    <>
      <PageHeader
        title={`Raise purchase orders for ${documentTitle(doc)}`}
        description={`For ${doc.partnerName}. One draft PO per supplier goes to Xero with its number, referencing ${doc.number}. Approve and send them from Xero.`}
        crumbs={[{ label: "Sales" }, { label: "Sales orders", href: "/sales/orders" }, { label: doc.number ?? "Draft", href: back }, { label: "Raise POs" }]}
      />
      <PageBody className="max-w-[72rem]">
        {blocked ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState title="Nothing to order here" description={blocked} action={<ButtonLink href={back}>Back to {documentTitle(doc)}</ButtonLink>} />
          </div>
        ) : (
          <RaiseForm
            salesOrderId={doc.id}
            cancelHref={back}
            defaultDue={doc.dueDate && doc.dueDate > isoDate() ? doc.dueDate : isoDate(7)}
            canDropShip={Boolean(doc.shipToText)}
            rows={candidates.map((l) => {
              const price = l.itemId ? priced.get(l.itemId) : undefined;
              const supplier = l.itemId ? preferred.get(l.itemId) : null;
              return {
                lineId: l.id,
                itemCode: l.itemCode,
                description: l.description,
                unit: l.unit,
                quantity: l.quantity,
                ordered: l.qtyOrdered,
                shortfall: Math.max(0, num(l.quantity) - num(l.qtyDelivered) - num(l.qtyOrdered) - num(l.qtyAllocated)),
                buyPrice: price ? String(num(price.unitPrice)) : "0",
                priceMissing: price?.priceMissing ?? true,
                supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
                stock: l.tracksStock,
              };
            })}
          />
        )}
      </PageBody>
    </>
  );
}
