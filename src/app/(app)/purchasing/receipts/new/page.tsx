import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CountForm } from "@/components/app/documents/count-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { getDocument, relatedDocuments } from "@/lib/data/documents";
import { shipmentsFor } from "@/lib/data/stock";
import { docHref, documentTitle } from "@/lib/sales/doc-types";
import { carrierLabel } from "@/lib/sales/carriers";
import { num } from "@/lib/sales/money";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Receive goods" };
export const dynamic = "force-dynamic";

/** Receive against a PO (spec §6.4): what arrived, line by line. */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  if (!from) redirect("/purchasing/orders");
  const { user } = await requireUser();
  const detail = await getDocument(from);
  if (!detail || detail.doc.type !== "purchase_order") notFound();
  const { doc, lines } = detail;
  const back = docHref(doc);

  if (!canWriteSales(user.role) || doc.status !== "open") {
    return (
      <>
        <PageHeader title="Receive goods" crumbs={[{ label: "Purchasing" }, { label: "Purchase orders", href: "/purchasing/orders" }, { label: doc.number ?? "Draft" }]} />
        <PageBody>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={doc.status === "draft" ? "Approve the order first" : "Nothing to receive here"}
              description={
                doc.status === "draft"
                  ? "Goods are received against an approved purchase order."
                  : canWriteSales(user.role)
                    ? `${documentTitle(doc)} is ${doc.status}.`
                    : "Receiving goods is for Ankor'd staff."
              }
              action={<ButtonLink href={back}>Back to {documentTitle(doc)}</ButtonLink>}
            />
          </div>
        </PageBody>
      </>
    );
  }

  const items = lines.filter((l) => l.rowType === "item");
  const goods = items.some((l) => l.tracksStock) ? items.filter((l) => l.tracksStock) : items;
  const open = goods.filter((l) => num(l.qtyReceived) < num(l.quantity));
  const [shipped, related] = await Promise.all([shipmentsFor(doc.id), relatedDocuments(doc)]);
  const bills = related.filter((d) => d.type === "bill" && d.status !== "cancelled");
  const billNote = bills.length
    ? `Billed: ${bills.map((b) => `${b.number ?? "draft"}${b.status === "closed" ? ", paid" : num(b.amountPaid) > 0 ? ", part paid" : ""}`).join("; ")}.`
    : doc.xeroStatus === "BILLED"
      ? "Billed in Xero."
      : null;
  const untracked = items.filter((l) => !l.tracksStock && l.itemId);

  return (
    <>
      <PageHeader
        title={`Receive against ${documentTitle(doc)}`}
        description={`From ${doc.partnerName}. Receiving books the goods in as stock and sets them aside for the job they were ordered for.`}
        crumbs={[{ label: "Purchasing" }, { label: "Purchase orders", href: "/purchasing/orders" }, { label: doc.number ?? "Draft", href: back }, { label: "Receive" }]}
      />
      <PageBody className="max-w-[56rem]">
        {untracked.length && !items.some((l) => l.tracksStock) ? (
          <p className="mb-4 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[13px] leading-5 text-[var(--warn)]">
            {untracked.map((l) => l.itemCode).join(", ")} {untracked.length === 1 ? "isn't" : "aren't"} marked as physical goods, so
            receiving here marks the order received but sets nothing aside to deliver.{" "}
            <Link href={`/sales/items/${untracked[0].itemId}`} className="font-medium underline underline-offset-2">
              Mark it as physical goods
            </Link>{" "}
            first if it goes out to a customer.
          </p>
        ) : null}
        {open.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title="Everything is received"
              description={`Every line on ${documentTitle(doc)} has been received.`}
              action={<ButtonLink href={back}>Back to {documentTitle(doc)}</ButtonLink>}
            />
          </div>
        ) : (
          <CountForm
            mode="receive"
            documentId={doc.id}
            cancelHref={back}
            billNote={billNote}
            shipments={shipped
              .filter(({ shipment }) => !shipment.receiptId)
              .map(({ shipment }) => ({
                id: shipment.id,
                label: [
                  carrierLabel(shipment.carrier),
                  shipment.trackingNumber,
                  shipment.shippedOn ? `sent ${formatDate(shipment.shippedOn)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))}
            rows={open.map((l) => ({
              lineId: l.id,
              itemCode: l.itemCode,
              description: l.description,
              unit: l.unit,
              quantity: l.quantity,
              done: l.qtyReceived,
              suggested: Math.max(0, num(l.quantity) - num(l.qtyReceived)),
              hint: num(l.qtyBilled) > 0 ? `${num(l.qtyBilled)} billed` : null,
            }))}
          />
        )}
      </PageBody>
    </>
  );
}
