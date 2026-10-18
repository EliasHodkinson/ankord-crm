import Link from "next/link";
import { Plus } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar, type FilterSpec } from "@/components/app/filter-bar";
import { SavedViews } from "@/components/app/saved-views";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  DOCUMENT_STATUS,
  documentStatus,
  FULFILMENT,
  SHIPMENT_STATE,
  StatusBadge,
  XERO_SYNC,
} from "@/components/ui/status";
import { inTransitAmong } from "@/lib/data/stock";
import { Badge } from "@/components/ui/badge";
import { listDocuments, PAGE_SIZE, type DocumentFilters } from "@/lib/data/documents";
import { listSavedViews } from "@/lib/data/saved-views";
import { requireUser, canWriteSales } from "@/lib/auth/session";
import { getAccess } from "@/lib/access";
import { DOC_TYPES, documentTitle, docHref, type DocType } from "@/lib/sales/doc-types";
import { formatMoney } from "@/lib/sales/money";
import { formatDate, isoDate } from "@/lib/utils";

/**
 * Every document list — quotes, orders, invoices, deliveries, POs, receipts
 * and bills — is this one component, configured by type.
 */

const DESCRIPTIONS: Partial<Record<DocType, string>> = {
  quote: "Quotes are created in Xero as drafts and sent from Xero. Accepted ones become sales orders.",
  sales_order:
    "The job, as the customer ordered it. Each line shows whether it still needs ordering, is on order, or is ready.",
  invoice: "Created in Xero as drafts, approved here or in Xero, and sent from Xero. Paid status comes back from Xero.",
  delivery: "Goods handed over against a reserve invoice. Gangway-only; Xero's invoice gets a note.",
  purchase_order:
    "Created in Xero as drafts and sent from Xero. Couriers' tracking, receipts and bills are recorded against them here.",
  goods_receipt: "Stock booked in against a purchase order. Received goods are allocated to the job they were ordered for.",
  bill: "Suppliers' invoices against our purchase orders, created in Xero and paid there. Bills without a PO stay in Xero.",
};

/** Which part of the rail a type lives under. */
const SECTION = (type: DocType) => (DOC_TYPES[type].side === "supplier" ? "Purchasing" : "Sales");

/** Types made from another document, not from a New button. */
const NO_NEW: DocType[] = ["goods_receipt", "delivery", "bill"];

export async function DocumentList({ type, filters }: { type: DocType; filters: DocumentFilters }) {
  const { user } = await requireUser();
  const access = await getAccess();
  const config = DOC_TYPES[type];
  const canWrite = canWriteSales(user.role);
  const [{ rows, count, page }, views] = await Promise.all([
    listDocuments(type, filters, user.id),
    listSavedViews(config.entity),
  ]);
  const today = isoDate();
  const showFulfilment = type === "sales_order" || type === "purchase_order" || type === "invoice";
  const isInvoice = type === "invoice" || type === "bill";
  const transit =
    type === "sales_order" || type === "purchase_order" || type === "invoice"
      ? await inTransitAmong(rows.map((r) => r.doc.id))
      : new Set<string>();
  const labels = DOCUMENT_STATUS[type] ?? {};
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const filterSpecs: FilterSpec[] = [
    {
      param: "status",
      label: "Status",
      defaultValue: "live",
      options: [
        { value: "live", label: "Draft and open" },
        { value: "draft", label: "Drafts" },
        { value: "open", label: labels.open?.label ?? "Open" },
        ...(labels.closed ? [{ value: "closed", label: labels.closed.label }] : []),
        { value: "cancelled", label: "Cancelled" },
        { value: "all", label: "Everything" },
      ],
    },
    {
      param: "owner",
      label: "Owner",
      defaultValue: "",
      options: [
        { value: "", label: "Anyone's" },
        { value: "me", label: "Mine" },
      ],
    },
  ];
  if (type === "purchase_order") {
    filterSpecs.push({
      param: "fulfilment",
      label: "Received",
      defaultValue: "",
      options: [
        { value: "", label: "Any" },
        { value: "to_receive", label: "To receive" },
        { value: "part_received", label: "Part received" },
        { value: "received", label: "Received" },
      ],
    });
  }
  if (type === "sales_order") {
    filterSpecs.push({
      param: "fulfilment",
      label: "Fulfilment",
      defaultValue: "",
      options: [
        { value: "", label: "Any fulfilment" },
        { value: "to_order", label: "Needs ordering" },
        { value: "on_order", label: "On order" },
        { value: "ready", label: "Ready to invoice" },
        { value: "part_invoiced", label: "Part invoiced" },
      ],
    });
  }
  if (isInvoice) {
    filterSpecs.push({
      param: "overdue",
      label: "Overdue",
      defaultValue: "",
      options: [
        { value: "", label: "Due any time" },
        { value: "1", label: "Overdue" },
      ],
    });
  }
  if (config.xero && !access.restricted) {
    filterSpecs.push({
      param: "xero",
      label: "Xero",
      defaultValue: "",
      options: [
        { value: "", label: "Any Xero state" },
        { value: "problems", label: "Xero problems" },
      ],
    });
  }

  const hasFilters = Object.entries(filters).some(([k, v]) => v && k !== "page");
  const pageHref = (n: number) => {
    const next = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v) as [string, string][],
    );
    next.set("page", String(n));
    return `${config.base}?${next}`;
  };

  return (
    <>
      <PageHeader
        title={config.plural}
        description={DESCRIPTIONS[type]}
        crumbs={[{ label: SECTION(type) }, { label: config.plural }]}
        meta={
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">{count}</span> shown
          </p>
        }
        actions={
          NO_NEW.includes(type) ? null : canWrite && type !== "sales_order" ? (
            <ButtonLink href={`${config.base}/new`} variant="primary">
              <Plus />
              New {config.label.toLowerCase()}
            </ButtonLink>
          ) : canWrite ? (
            <ButtonLink href={`${config.base}/new`} variant="secondary">
              <Plus />
              New {config.label.toLowerCase()}
            </ButtonLink>
          ) : null
        }
      />
      <PageBody className="flex flex-col gap-4">
        <SavedViews entity={config.entity} views={views} currentUserId={user.id} />
        <FilterBar searchPlaceholder={`Search ${config.plural.toLowerCase()} by number, partner or reference…`} filters={filterSpecs} />

        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={hasFilters ? "Nothing matches that" : `No ${config.plural.toLowerCase()} yet`}
              description={
                hasFilters
                  ? "Try another status or clear the search."
                  : type === "sales_order"
                    ? "Sales orders are usually made by converting an accepted quote. You can also start one from scratch."
                    : type === "invoice"
                      ? "Invoices usually come from a sales order or a quote. A blank one is fine for one-off services."
                      : type === "purchase_order"
                        ? "Raise purchase orders from a sales order, start one here, or import the ones already in Xero."
                        : type === "goods_receipt"
                          ? "Receipts are made with Receive on a purchase order."
                          : type === "bill"
                            ? "Bills are entered with Enter bill on a purchase order, or imported from Xero."
                            : type === "delivery"
                              ? "Deliveries are made with Deliver on a reserve invoice."
                              : "Write a quote here; it lands in Xero as a draft with Xero's number, ready to send."
              }
              action={
                canWrite && !hasFilters && !NO_NEW.includes(type) ? (
                  <ButtonLink href={`${config.base}/new`} variant="primary">
                    <Plus />
                    New {config.label.toLowerCase()}
                  </ButtonLink>
                ) : undefined
              }
            />
          </div>
        ) : (
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>{config.side === "customer" ? "Customer" : "Supplier"}</Th>
                  <Th>Date</Th>
                  {config.dueLabel ? <Th>{config.dueLabel}</Th> : null}
                  <Th numeric>Total</Th>
                  {isInvoice ? <Th numeric>Due</Th> : null}
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  {showFulfilment ? <Th>Fulfilment</Th> : null}
                  {config.xero && !access.restricted ? <Th className="w-16">Xero</Th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ doc, ownerName, ownerPhoto }) => {
                  const status = documentStatus({ ...doc, today });
                  return (
                    <Tr key={doc.id}>
                      <Td className="whitespace-nowrap">
                        <Link
                          href={docHref(doc)}
                          className="font-medium text-[var(--text)] hover:text-[var(--accent)] hover:underline underline-offset-2"
                        >
                          {doc.number ?? <span className="text-[var(--text-muted)]">{documentTitle(doc)}</span>}
                        </Link>
                        {doc.reference ? (
                          <span className="block max-w-48 truncate text-[12px] text-[var(--text-muted)]">{doc.reference}</span>
                        ) : null}
                      </Td>
                      <Td className="max-w-64">
                        <Link
                          href={`/customers/${doc.partnerId}`}
                          className="block truncate text-[var(--text)] hover:underline underline-offset-2"
                        >
                          {doc.partnerName}
                        </Link>
                      </Td>
                      <Td className="tabular whitespace-nowrap text-[var(--text-muted)]">{formatDate(doc.docDate)}</Td>
                      {config.dueLabel ? (
                        <Td className="tabular whitespace-nowrap text-[var(--text-muted)]">{formatDate(doc.dueDate)}</Td>
                      ) : null}
                      <Td numeric className="whitespace-nowrap">{formatMoney(doc.total)}</Td>
                      {isInvoice ? (
                        <Td numeric className="whitespace-nowrap text-[var(--text-muted)]">
                          {doc.status === "open" ? formatMoney(doc.amountDue) : "—"}
                        </Td>
                      ) : null}
                      <Td>
                        {ownerName ? (
                          <span className="flex items-center gap-1.5">
                            <Avatar name={ownerName} src={ownerPhoto} size="xs" />
                            <span className="truncate text-[12px]">{ownerName}</span>
                          </span>
                        ) : (
                          <span className="text-[12px] text-[var(--text-faint)]">Unassigned</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={status.tone} dot>
                          {status.label}
                        </Badge>
                      </Td>
                      {showFulfilment ? (
                        <Td>
                          <span className="flex flex-wrap items-center gap-1">
                            {doc.fulfilment && doc.status !== "cancelled" ? <StatusBadge map={FULFILMENT} value={doc.fulfilment} /> : null}
                            {transit.has(doc.id) ? <StatusBadge map={SHIPMENT_STATE} value="in_transit" /> : null}
                            {!doc.fulfilment && !transit.has(doc.id) ? "—" : null}
                          </span>
                        </Td>
                      ) : null}
                      {config.xero && !access.restricted ? (
                        <Td>
                          <span
                            title={XERO_SYNC[doc.xeroSyncState]?.label}
                            aria-label={XERO_SYNC[doc.xeroSyncState]?.label}
                            className={
                              doc.xeroSyncState === "synced"
                                ? "inline-block size-2 rounded-full bg-[var(--ok)]"
                                : doc.xeroSyncState === "failed"
                                  ? "inline-block size-2 rounded-full bg-[var(--danger)]"
                                  : doc.xeroSyncState === "blocked"
                                    ? "inline-block size-2 rounded-full bg-[var(--warn)]"
                                    : "inline-block size-2 rounded-full bg-[var(--color-coastal-200)]"
                            }
                          />
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableShell>
        )}

        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-[13px]">
            {page > 1 ? (
              <ButtonLink href={pageHref(page - 1)} size="sm" variant="ghost">
                Previous
              </ButtonLink>
            ) : null}
            <span className="text-[var(--text-muted)]">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <ButtonLink href={pageHref(page + 1)} size="sm" variant="ghost">
                Next
              </ButtonLink>
            ) : null}
          </nav>
        ) : null}
      </PageBody>
    </>
  );
}
