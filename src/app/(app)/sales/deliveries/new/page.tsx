import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CountForm } from "@/components/app/documents/count-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { getDocument } from "@/lib/data/documents";
import { demandCounters } from "@/lib/data/purchasing";
import { docHref, documentTitle } from "@/lib/sales/doc-types";
import { formatQty, num } from "@/lib/sales/money";

export const metadata: Metadata = { title: "Deliver goods" };
export const dynamic = "force-dynamic";

/**
 * Deliver against a reserve invoice (spec §5.5): the goods the customer has
 * already been invoiced for go out. Defaults to the smaller of what is left
 * and what is set aside.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  if (!from) redirect("/sales/invoices");
  const { user } = await requireUser();
  const detail = await getDocument(from);
  if (!detail || detail.doc.type !== "invoice") notFound();
  const { doc, lines } = detail;
  const back = docHref(doc);
  const blocked = !canWriteSales(user.role)
    ? "Delivering goods is for Ankor'd staff."
    : !doc.isReserve
      ? "Only a reserve invoice (goods to follow) is delivered separately. A normal invoice delivers its goods when it is approved."
      : doc.status === "draft"
        ? "Approve the invoice before delivering against it."
        : doc.status === "cancelled"
          ? "This invoice has been voided."
          : null;

  const demand = await demandCounters(doc.id);
  const open = lines.filter((l) => l.rowType === "item" && l.tracksStock && num(l.qtyDelivered) < num(l.quantity));

  return (
    <>
      <PageHeader
        title={`Deliver ${documentTitle(doc)}`}
        description={`To ${doc.partnerName}. Delivering hands over goods they have already been invoiced for; Xero's invoice gets a note.`}
        crumbs={[{ label: "Sales" }, { label: "Invoices", href: "/sales/invoices" }, { label: doc.number ?? "Draft", href: back }, { label: "Deliver" }]}
      />
      <PageBody className="max-w-[56rem]">
        {blocked || open.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={blocked ? "Can't deliver this" : "Everything is delivered"}
              description={blocked ?? `Every stock line on ${documentTitle(doc)} has been delivered.`}
              action={<ButtonLink href={back}>Back to {documentTitle(doc)}</ButtonLink>}
            />
          </div>
        ) : (
          <CountForm
            mode="deliver"
            documentId={doc.id}
            cancelHref={back}
            rows={open.map((l) => {
              const left = num(l.quantity) - num(l.qtyDelivered);
              const allocated = num(demand[l.id]?.allocated ?? l.qtyAllocated);
              return {
                lineId: l.id,
                itemCode: l.itemCode,
                description: l.description,
                unit: l.unit,
                quantity: l.quantity,
                done: l.qtyDelivered,
                suggested: Math.min(left, allocated),
                hint:
                  allocated >= left
                    ? `${formatQty(allocated)} set aside`
                    : allocated > 0
                      ? `Only ${formatQty(allocated)} set aside`
                      : "Nothing set aside yet: receive the stock or allocate it first",
              };
            })}
          />
        )}
      </PageBody>
    </>
  );
}
