import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { TrackVisit } from "@/components/app/track-visit";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataRow } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { documentStatus, FULFILMENT, StatusBadge, XERO_SYNC } from "@/components/ui/status";
import { DocumentActions, type DocAction } from "./document-actions";
import { XeroDocPanel } from "./xero-doc-panel";
import { LinesView } from "./lines-view";
import { TotalsBox } from "./document-editor";
import { ShipmentsPanel } from "./shipments-panel";
import { LinkBillPanel, LinkSalesPanel } from "./link-panels";
import { AllocationsPanel } from "./allocations-panel";
import { allocationsFor, availableStock, shipmentsFor, trackingForSales } from "@/lib/data/stock";
import { billOptions, demandCounters, draftShortfalls, salesLinksFor, suggestedSalesFor } from "@/lib/data/purchasing";
import { getDb } from "@/lib/db";
import {
  documentActivity,
  documentPayments,
  getDocument,
  lastXeroProblem,
  relatedDocuments,
  type DocumentDetail as Detail,
  type RelatedDoc,
} from "@/lib/data/documents";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { getAccess } from "@/lib/access";
import { DOC_TYPES, docHref, documentTitle, typeLabel, type DocType } from "@/lib/sales/doc-types";
import { lineState } from "@/lib/sales/fulfilment";
import { formatMoney, formatQty, num, toCents } from "@/lib/sales/money";
import { xeroWebUrl } from "@/lib/xero/links";
import { formatDate, formatDateTime, isoDate, relativeTime } from "@/lib/utils";

/** The page for one document of any type. */
export async function DocumentDetailPage({
  type,
  id,
  saved,
}: {
  type: DocType;
  id: string;
  saved?: string;
}) {
  const { user } = await requireUser();
  const access = await getAccess();
  const detail = await getDocument(id);
  if (!detail || detail.doc.type !== type) notFound();
  const { doc, lines, partner, owner, project, salesOrder } = detail;

  const hasPayments = type === "invoice" || type === "bill";
  const isPo = type === "purchase_order";
  const reserve = type === "invoice" && doc.isReserve;
  const demandDoc = (type === "sales_order" && doc.status === "open") || (reserve && doc.status !== "cancelled");
  const itemLines = lines.filter((l) => l.rowType === "item");
  const stockItems = [...new Set(itemLines.filter((l) => l.tracksStock && l.itemId).map((l) => l.itemId!))];
  const [related, trail, problem, payments, shipped, tracking, allocations, stock, links, suggested, demand, poChoices, short] =
    await Promise.all([
      relatedDocuments(doc),
      documentActivity(doc.id),
      lastXeroProblem(doc.id),
      hasPayments && !access.restricted ? documentPayments(doc.id) : Promise.resolve([]),
      isPo ? shipmentsFor(doc.id) : Promise.resolve([]),
      type === "sales_order" || reserve ? trackingForSales(doc.id) : Promise.resolve(new Map()),
      demandDoc ? allocationsFor(doc.id) : Promise.resolve([]),
      demandDoc ? availableStock(getDb(), stockItems) : Promise.resolve(new Map()),
      isPo ? salesLinksFor(doc.id) : Promise.resolve([]),
      isPo ? suggestedSalesFor(doc) : Promise.resolve([]),
      reserve ? demandCounters(doc.id) : Promise.resolve({} as Record<string, { ordered: string; allocated: string }>),
      type === "bill" && !itemLines.some((l) => l.baseLineId) ? billOptions(doc) : Promise.resolve([]),
      type === "invoice" && !doc.isReserve && doc.status === "draft" ? draftShortfalls(doc.id) : Promise.resolve([]),
    ]);
  const fullyReceived = doc.fulfilment === "received";

  const config = DOC_TYPES[type];
  const today = isoDate();
  const status = documentStatus({ ...doc, today });
  const canWrite = canWriteSales(user.role);
  const title = documentTitle(doc);
  const label = typeLabel(type, doc.isReserve);
  const actions = canWrite ? actionsFor(detail, today, { shortfall: short, shipments: shipped.length }) : [];

  const mismatch =
    doc.xeroTotal !== null &&
    doc.xeroSyncState === "synced" &&
    toCents(doc.xeroTotal) !== toCents(doc.total)
      ? { xero: doc.xeroTotal, ours: doc.total }
      : problem && doc.xeroSyncedAt && problem.createdAt > doc.xeroSyncedAt && doc.xeroTotal
        ? { xero: doc.xeroTotal, ours: doc.total }
        : null;

  return (
    <>
      <TrackVisit href={docHref(doc)} label={`${label} ${doc.number ?? ""}`.trim()} kind="document" />
      <PageHeader
        title={title}
        crumbs={[
          { label: config.side === "supplier" ? "Purchasing" : "Sales" },
          { label: config.plural, href: config.base },
          { label: doc.number ?? "Draft" },
        ]}
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{label}</Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {doc.fulfilment && doc.status !== "cancelled" ? (
              <StatusBadge map={FULFILMENT} value={doc.fulfilment} />
            ) : null}
          </span>
        }
        meta={
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--text-muted)]">
            <Link href={`/customers/${doc.partnerId}`} className="font-medium text-[var(--text)] hover:underline underline-offset-2">
              {doc.partnerName}
            </Link>
            {type === "goods_receipt" || type === "delivery" ? null : (
              <span className="tabular text-[15px] font-semibold text-[var(--text)]">{formatMoney(doc.total)}</span>
            )}
            {hasPayments && doc.status !== "draft" && num(doc.amountPaid) > 0 ? (
              <span className="tabular">
                {formatMoney(doc.amountPaid)} paid · {formatMoney(doc.amountDue)} due
              </span>
            ) : null}
          </p>
        }
      />

      <PageBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {saved ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-3 py-2 text-[13px] text-[var(--ok)]"
            >
              <Check className="mt-0.5 size-4 shrink-0" />
              {saved}
            </p>
          ) : null}

          {type === "quote" && doc.status === "open" && doc.xeroStatus && doc.xeroStatus !== "DRAFT" && doc.xeroSyncState !== "synced" ? (
            <p className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn)]">
              Already sent. The customer has the earlier version until you resend it from Xero.
            </p>
          ) : null}

          {actions.length ? (
            <Card>
              <CardBody>
                <DocumentActions documentId={doc.id} actions={actions} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid divide-y divide-[var(--border-soft)] xl:grid-cols-2 xl:gap-x-8 xl:divide-y-0">
                <DataRow label={config.side === "customer" ? "Customer" : "Supplier"}>
                  <Link href={`/customers/${doc.partnerId}`} className="hover:underline underline-offset-2">
                    {doc.partnerName}
                  </Link>
                </DataRow>
                <DataRow label="Contact">
                  {doc.contactName ? (
                    <span className="[overflow-wrap:anywhere]">
                      {doc.contactName}
                      {doc.contactEmail ? (
                        <span className="block text-[12px] text-[var(--text-muted)]">{doc.contactEmail}</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </DataRow>
                <DataRow label="Date">{formatDate(doc.docDate)}</DataRow>
                {config.dueLabel ? <DataRow label={config.dueLabel}>{formatDate(doc.dueDate)}</DataRow> : null}
                <DataRow label={config.side === "customer" ? "Their reference" : "Reference"}>{doc.reference ?? "—"}</DataRow>
                <DataRow label="Owner">{owner?.name ?? "Unassigned"}</DataRow>
                <DataRow label="Project">
                  {project ? (
                    <Link href={`/projects/${project.id}`} className="hover:underline underline-offset-2">
                      {project.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </DataRow>
                {salesOrder && salesOrder.id !== doc.id ? (
                  <DataRow label="Sales order">
                    <Link href={docHref({ type: "sales_order", id: salesOrder.id })} className="hover:underline underline-offset-2">
                      {salesOrder.number}
                    </Link>
                  </DataRow>
                ) : null}
                {doc.shipToText ? (
                  <DataRow label="Deliver to">
                    <span className="whitespace-pre-line">{doc.shipToText}</span>
                  </DataRow>
                ) : null}
                {doc.title ? <DataRow label="Title">{doc.title}</DataRow> : null}
              </dl>
              {doc.summary || doc.terms || doc.remarks || doc.internalNotes ? (
                <dl className="mt-3 flex flex-col gap-2 border-t border-[var(--border-soft)] pt-3 text-[13px]">
                  {doc.summary ? <Note label="Summary" text={doc.summary} /> : null}
                  {doc.terms ? <Note label="Terms" text={doc.terms} /> : null}
                  {doc.remarks ? <Note label="Remarks" text={doc.remarks} /> : null}
                  {doc.internalNotes ? <Note label="Internal notes" text={doc.internalNotes} /> : null}
                </dl>
              ) : null}
              {doc.status === "cancelled" ? (
                <p className="mt-3 border-t border-[var(--border-soft)] pt-3 text-[12px] text-[var(--text-muted)]">
                  {doc.cancelReason === "Deleted" ? "Deleted" : "Cancelled"} {formatDateTime(doc.cancelledAt)}
                  {doc.cancelReason && doc.cancelReason !== "Deleted" ? ` — ${doc.cancelReason}` : ""}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Lines"
              meta={
                reserve
                  ? "Invoiced now; the goods go out on a delivery once they are here"
                  : type === "goods_receipt"
                    ? "Booked in"
                    : type === "delivery"
                      ? "Handed over"
                      : undefined
              }
            />
            <LinesView
              type={type}
              lines={lines}
              amountsAre={doc.amountsAre}
              isReserve={doc.isReserve}
              tracking={Object.fromEntries(tracking)}
              demand={demand}
              today={today}
            />
            {type === "goods_receipt" || type === "delivery" ? null : (
              <div className="flex justify-end border-t border-[var(--border-soft)] p-4">
                <TotalsBox subtotal={doc.subtotal} tax={doc.taxTotal} total={doc.total} amountsAre={doc.amountsAre} />
              </div>
            )}
          </Card>

          {isPo && doc.status !== "cancelled" ? (
            <Card>
              <CardHeader title="Shipments" meta="Couriers' tracking" />
              <CardBody>
                <ShipmentsPanel
                  purchaseOrderId={doc.id}
                  shipments={shipped.map(({ shipment, receiptNumber }) => ({ ...shipment, receiptNumber }))}
                  received={fullyReceived}
                  canWrite={canWrite}
                  today={today}
                />
              </CardBody>
            </Card>
          ) : null}

          {demandDoc &&
          stockItems.length &&
          (allocations.length || itemLines.some((l) => l.tracksStock && num(l.qtyDelivered) < num(l.quantity))) ? (
            <Card>
              <CardHeader title="Stock set aside" meta={reserve ? "For this invoice's goods" : "For this order"} />
              <CardBody>
                <AllocationsPanel
                  canWrite={canWrite && !(reserve && Object.keys(demand).length > 0)}
                  allocations={allocations}
                  lines={itemLines
                    .filter((l) => l.tracksStock && l.itemId && !demand[l.id])
                    .map((l) => ({
                      id: l.id,
                      label: l.itemCode ?? l.description.split("\n")[0],
                      need: Math.max(0, num(l.quantity) - num(l.qtyDelivered) - num(l.qtyAllocated)),
                      available: Math.max(0, stock.get(l.itemId!)?.available ?? 0),
                    }))}
                />
                {reserve && Object.keys(demand).length ? (
                  <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                    Stock for this invoice is set aside on its sales order.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {config.xero && !access.restricted ? (
            <Card>
              <CardHeader title="Xero" meta={XERO_SYNC[doc.xeroSyncState]?.label} />
              <CardBody>
                <XeroDocPanel
                  documentId={doc.id}
                  syncState={doc.xeroSyncState}
                  error={doc.xeroError}
                  number={doc.number}
                  xeroStatus={doc.xeroStatus}
                  xeroUrl={xeroWebUrl(type, doc.xeroId)}
                  inXero={Boolean(doc.xeroId)}
                  syncedAt={doc.xeroSyncedAt}
                  partner={{ id: doc.partnerId, name: doc.partnerName, linked: Boolean(partner?.xeroContactId) }}
                  canWrite={canWrite}
                  mismatch={mismatch}
                />
                {doc.importedAt ? (
                  <p className="mt-3 border-t border-[var(--border-soft)] pt-3 text-[12px] leading-5 text-[var(--text-muted)]">
                    Imported from Xero {formatDateTime(doc.importedAt)}. It was already in Xero, so importing sent nothing there.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : !config.xero ? (
            <Card>
              <CardHeader title="Xero" />
              <CardBody>
                <p className="text-[13px] leading-6 text-[var(--text-muted)]">
                  {type === "goods_receipt"
                    ? `Receipts stay in The Gangway; Xero has no such document. The purchase order in Xero has a note saying ${doc.number ?? "it"} was received.`
                    : type === "delivery"
                      ? `Deliveries stay in The Gangway; Xero has no such document. The invoice in Xero has a note saying ${doc.number ?? "it"} was delivered.`
                      : `${label}s stay in The Gangway; Xero has no such document. Xero sees ${doc.number ?? "it"} in the reference of the invoices and purchase orders drawn from it.`}
                </p>
              </CardBody>
            </Card>
          ) : null}

          {hasPayments && !access.restricted && (payments.length || num(doc.amountPaid) > 0) ? (
            <Card>
              <CardHeader title="Payments" meta="Recorded in Xero" />
              <CardBody>
                {payments.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-muted)]">
                    {formatMoney(doc.amountPaid)} paid in Xero. The individual payments appear after the next refresh.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
                    {payments.map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px] first:pt-0 last:pb-0">
                        <span className="min-w-0">
                          <span className="tabular">{formatDate(p.date)}</span>
                          {p.reference ? (
                            <span className="block truncate text-[12px] text-[var(--text-muted)]">{p.reference}</span>
                          ) : null}
                        </span>
                        <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 flex justify-between border-t border-[var(--border-soft)] pt-3 text-[12px] text-[var(--text-muted)]">
                  <span>Still due</span>
                  <span className="tabular font-medium text-[var(--text)]">{formatMoney(doc.amountDue)}</span>
                </p>
              </CardBody>
            </Card>
          ) : null}

          {isPo && doc.status !== "cancelled" ? (
            <Card>
              <CardHeader title="Bought for" />
              <CardBody>
                <LinkSalesPanel purchaseOrderId={doc.id} linked={links} suggestions={suggested} canWrite={canWrite} />
              </CardBody>
            </Card>
          ) : null}

          {type === "bill" && doc.status !== "cancelled" && !itemLines.some((l) => l.baseLineId) ? (
            <Card>
              <CardHeader title="Purchase order" />
              <CardBody>
                <LinkBillPanel billId={doc.id} options={poChoices} canWrite={canWrite} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Related documents" />
            <CardBody>
              <RelatedList items={related} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              {trail.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)]">Nothing yet.</p>
              ) : (
                <ol className="flex flex-col gap-2.5">
                  {trail.map((entry) => (
                    <li key={entry.id} className="text-[13px] leading-5">
                      <p className="text-[var(--text)]">{entry.summary}</p>
                      <p className="text-[12px] text-[var(--text-faint)]">
                        {entry.actorName ?? "Someone"} · {relativeTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-[12px] text-[var(--text-muted)]">{label}</dt>
      <dd className="whitespace-pre-line text-[var(--text)]">{text}</dd>
    </div>
  );
}

/** "Fast Couriers'", "Quokka's". */
const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`);

const RELATION: Record<RelatedDoc["relation"], string> = {
  base: "From",
  child: "Drawn into",
  ordered: "Ordered on",
  for: "Bought for",
};

function RelatedList({ items }: { items: RelatedDoc[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-[var(--text-muted)]">Nothing drawn from this, and it wasn&apos;t drawn from anything.</p>;
  }
  const today = isoDate();
  return (
    <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
      {items.map((d) => {
        const status = documentStatus({ ...d, today });
        return (
          <li key={d.id}>
            <Link href={docHref(d)} className="flex items-center justify-between gap-2 py-2 hover:underline underline-offset-2">
              <span className="min-w-0">
                <span className="block text-[11px] text-[var(--text-faint)]">
                  {RELATION[d.relation]} · {typeLabel(d.type, d.isReserve)}
                </span>
                <span className="block truncate text-[13px] font-medium text-[var(--text)]">{documentTitle(d)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <Badge tone={status.tone}>{status.label}</Badge>
                {d.type === "goods_receipt" || d.type === "delivery" ? null : (
                  <span className="tabular text-[12px] text-[var(--text-muted)]">{formatMoney(d.total)}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The buttons a document offers, by type and state. One is primary at most. */
function actionsFor(
  { doc, lines }: Detail,
  today: string,
  extra: { shortfall: { label: string; quantity: number; allocated: number }[]; shipments: number },
): DocAction[] {
  const config = DOC_TYPES[doc.type];
  const edit: DocAction = { kind: "link", label: "Edit", href: `${docHref(doc)}/edit` };
  const duplicate: DocAction = { kind: "run", id: "duplicate", label: "Duplicate" };
  const del: DocAction = {
    kind: "run",
    id: "delete",
    label: "Delete",
    danger: true,
    confirm: `Delete ${documentTitle(doc)}?${config.xero && doc.xeroId ? " It will be deleted in Xero too." : ""}`,
  };
  const items = lines.filter((l) => l.rowType === "item");

  switch (doc.type) {
    case "quote": {
      if (doc.status === "cancelled") return [duplicate];
      if (doc.status === "closed") {
        return doc.closedBy === "person" ? [{ kind: "run", id: "reopen", label: "Reopen" }, duplicate] : [duplicate];
      }
      const accepted = doc.quoteOutcome === "accepted";
      const left = items.some((l) => num(l.qtyConverted) < num(l.quantity));
      const out: DocAction[] = [];
      if (left) {
        out.push({
          kind: "link",
          label: "Convert to sales order",
          href: `/sales/orders/new?from=${doc.id}`,
          primary: accepted,
        });
      }
      if (!accepted) {
        // Once it has been sent, hearing back is the next step.
        out.push({ kind: "run", id: "accept", label: "Mark accepted", primary: doc.status === "open" });
      }
      out.push(edit);
      if (left) out.push({ kind: "link", label: "Invoice directly", href: `/sales/invoices/new?from=${doc.id}` });
      if (!accepted) {
        out.push({
          kind: "run",
          id: "decline",
          label: "Mark declined",
          confirm: `Mark ${documentTitle(doc)} declined? It closes, and Xero shows it declined.`,
        });
      }
      out.push(duplicate);
      if (doc.status === "draft") out.push(del);
      else {
        out.push({
          kind: "run",
          id: "close",
          label: "Close",
          confirm: `Close ${documentTitle(doc)}${doc.dueDate && doc.dueDate < today ? " as expired" : ""}? Nothing more can be converted from it until it is reopened.`,
        });
      }
      return out;
    }

    case "sales_order": {
      if (doc.status === "cancelled") return [duplicate];
      if (doc.status === "closed") {
        return doc.closedBy === "person" ? [{ kind: "run", id: "reopen", label: "Reopen" }, duplicate] : [duplicate];
      }
      if (doc.status === "draft") {
        return [{ kind: "run", id: "confirm", label: "Confirm order", primary: true }, edit, duplicate, del];
      }
      const toInvoice = items.some((l) => num(l.qtyInvoiced) < num(l.quantity));
      const toOrder = items.some((l) => lineState(l) === "to_order");
      const out: DocAction[] = [];
      if (toOrder) {
        out.push({ kind: "link", label: "Raise purchase orders", href: `/purchasing/orders/raise?from=${doc.id}`, primary: true });
      }
      if (toInvoice) {
        out.push({ kind: "link", label: "Invoice", href: `/sales/invoices/new?from=${doc.id}`, primary: !toOrder });
        if (items.some((l) => l.tracksStock)) {
          out.push({ kind: "link", label: "Reserve invoice", href: `/sales/invoices/new?from=${doc.id}&reserve=1` });
        }
      }
      if (!toOrder && items.some((l) => l.tracksStock)) {
        out.push({ kind: "link", label: "Raise purchase orders", href: `/purchasing/orders/raise?from=${doc.id}` });
      }
      return [
        ...out,
        edit,
        duplicate,
        {
          kind: "run",
          id: "close",
          label: "Close",
          confirm: `Close ${documentTitle(doc)} by hand? Anything not yet invoiced stays uninvoiced.`,
        },
        {
          kind: "run",
          id: "cancel",
          label: "Cancel order",
          danger: true,
          confirm: `Cancel ${documentTitle(doc)}? The quote it came from reopens for whatever this order took.`,
        },
      ];
    }

    case "invoice": {
      if (doc.status === "cancelled") return [duplicate];
      const stockLines = items.filter((l) => l.tracksStock);
      if (doc.status === "draft") {
        const due = doc.dueDate ? ` due ${formatDate(doc.dueDate, "day")}` : "";
        const short = extra.shortfall[0];
        const out: DocAction[] = [
          short
            ? {
                kind: "run",
                id: "approve_anyway",
                label: "Approve",
                confirmLabel: "Approve anyway",
                primary: true,
                confirm: `Only ${formatQty(short.allocated)} of ${formatQty(short.quantity)} ${short.label} allocated${
                  extra.shortfall.length > 1 ? `, and ${extra.shortfall.length - 1} more line${extra.shortfall.length > 2 ? "s" : ""} short` : ""
                }. Approve anyway, and count the goods as delivered with it? Or make it a reserve invoice and deliver later.`,
              }
            : {
                kind: "run",
                id: "approve",
                label: "Approve",
                primary: true,
                confirm: `Approve ${documentTitle(doc)} for ${doc.partnerName}, ${formatMoney(doc.total)}${
                  doc.amountsAre === "no_tax" ? "" : " inc GST"
                },${due}? Its lines are locked once approved. Send it from Xero.`,
              },
          edit,
        ];
        if (!doc.isReserve && stockLines.length) {
          out.push({ kind: "run", id: "goods_to_follow", label: "Make it a reserve invoice" });
        }
        out.push(duplicate, del);
        return out;
      }
      const out: DocAction[] = [];
      if (doc.isReserve) {
        const left = stockLines.some((l) => num(l.qtyDelivered) < num(l.quantity));
        // The next step once the goods are here and set aside for it.
        const ready = Boolean(doc.salesOrderId) || stockLines.some((l) => num(l.qtyAllocated) > 0);
        if (left) out.push({ kind: "link", label: "Deliver", href: `/sales/deliveries/new?from=${doc.id}`, primary: ready });
        const untouched = stockLines.every((l) => num(l.qtyDelivered) === 0 && num(l.qtyOrdered) === 0 && num(l.qtyAllocated) === 0);
        if (untouched) {
          out.push({
            kind: "run",
            id: "goods_with_invoice",
            label: "Goods went with the invoice",
            confirm: `Make ${documentTitle(doc)} a normal invoice again? Its goods count as delivered with it.`,
          });
        }
      } else if (stockLines.length) {
        out.push({
          kind: "run",
          id: "goods_to_follow",
          label: "Goods to follow",
          confirm: `Mark ${documentTitle(doc)} goods to follow? It stays as it is in Xero; the goods go out on a delivery from here once they arrive.`,
        });
      }
      out.push(edit, duplicate);
      if (num(doc.amountPaid) === 0) {
        out.push({
          kind: "run",
          id: "cancel",
          label: "Void",
          danger: true,
          confirm: `Void ${documentTitle(doc)}? It is voided in Xero too, and its lines go back to the order.`,
        });
      }
      return out;
    }

    case "purchase_order": {
      if (doc.status === "cancelled") return [duplicate];
      if (doc.status === "closed") {
        return doc.closedBy === "person" ? [{ kind: "run", id: "reopen", label: "Reopen" }, duplicate] : [duplicate];
      }
      if (doc.status === "draft") {
        return [
          {
            kind: "run",
            id: "approve",
            label: "Approve",
            primary: true,
            confirm: `Approve ${documentTitle(doc)} to ${doc.partnerName}, ${formatMoney(doc.total)}${
              doc.amountsAre === "no_tax" ? "" : " inc GST"
            }? Send it from Xero once it is approved.`,
          },
          edit,
          duplicate,
          del,
        ];
      }
      const goods = items.some((l) => l.tracksStock) ? items.filter((l) => l.tracksStock) : items;
      const toReceive = goods.some((l) => num(l.qtyReceived) < num(l.quantity));
      const toBill = doc.xeroStatus !== "BILLED" && items.some((l) => num(l.qtyBilled) < num(l.quantity));
      const out: DocAction[] = [];
      if (toReceive) out.push({ kind: "link", label: "Receive", href: `/purchasing/receipts/new?from=${doc.id}`, primary: true });
      if (toBill) out.push({ kind: "link", label: "Enter bill", href: `/purchasing/bills/new?from=${doc.id}`, primary: !toReceive });
      out.push(edit, duplicate, {
        kind: "run",
        id: "close",
        label: "Close",
        confirm: `Close ${documentTitle(doc)} by hand? Nothing more is expected against it. Xero's PO is left as it is, with a note.`,
      });
      if (!items.some((l) => num(l.qtyReceived) > 0 || num(l.qtyBilled) > 0) && extra.shipments === 0) {
        out.push({
          kind: "run",
          id: "cancel",
          label: "Cancel order",
          danger: true,
          confirm: `Cancel ${documentTitle(doc)}? It is deleted in Xero too, and the lines it was ordered for go back to "To order".`,
        });
      }
      return out;
    }

    case "bill": {
      if (doc.status === "cancelled") return [];
      if (doc.status === "draft") {
        return [
          {
            kind: "run",
            id: "approve",
            label: "Approve",
            primary: true,
            confirm: `Approve ${possessive(doc.partnerName)} invoice ${doc.number ?? ""} for ${formatMoney(doc.total)}? Pay it in Xero.`,
          },
          edit,
          del,
        ];
      }
      const out: DocAction[] = [edit];
      if (num(doc.amountPaid) === 0) {
        out.push({
          kind: "run",
          id: "cancel",
          label: "Void",
          danger: true,
          confirm: `Void this bill? It is voided in Xero too, and its lines go back to the purchase order as unbilled.`,
        });
      }
      return out;
    }

    case "goods_receipt":
      return doc.status === "open"
        ? [
            {
              kind: "run",
              id: "cancel",
              label: "Cancel receipt",
              danger: true,
              confirm: `Cancel ${documentTitle(doc)}? Its goods come off the order as not received, and the stock it allocated is released.`,
            },
          ]
        : [];

    case "delivery":
      return doc.status === "open"
        ? [
            {
              kind: "run",
              id: "cancel",
              label: "Cancel delivery",
              danger: true,
              confirm: `Cancel ${documentTitle(doc)}? The goods count as still here and set aside for the invoice.`,
            },
          ]
        : [];

    default:
      return [];
  }
}
