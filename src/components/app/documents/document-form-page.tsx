import { notFound, redirect } from "next/navigation";
import { and, asc, inArray } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { DocumentEditor, type EditorLine } from "./document-editor";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { customerScope, getAccess } from "@/lib/access";
import { copyDraft, getDocument, partnerDefaults, type EditorHeader } from "@/lib/data/documents";
import { getSettings, listTeam } from "@/lib/data/common";
import { readXeroRefs } from "@/lib/data/xero-cache";
import { DOC_TYPES, docHref, documentTitle, typeLabel, type DocType } from "@/lib/sales/doc-types";
import { num } from "@/lib/sales/money";
import {
  FALLBACK_PURCHASE_TAX,
  FALLBACK_SALES_TAX,
  isPurchaseAccount,
  isSalesAccount,
} from "@/lib/sales/xero-refs";
import { isoDate } from "@/lib/utils";

/**
 * New and edit pages for every document type. `from` makes a copy-to draft
 * (quote → order, order → invoice); `partner` preselects who it is for.
 */
export async function DocumentFormPage({
  type,
  documentId,
  from,
  partnerId,
  reserve,
}: {
  type: DocType;
  documentId?: string;
  from?: string;
  partnerId?: string;
  reserve?: boolean;
}) {
  const { user } = await requireUser();
  const config = DOC_TYPES[type];
  if (!config.available || config.recordOnly) notFound();
  const section = side0(type) === "supplier" ? "Purchasing" : "Sales";

  if (!canWriteSales(user.role)) {
    return (
      <>
        <PageHeader title={`New ${config.label.toLowerCase()}`} crumbs={[{ label: section }, { label: config.plural, href: config.base }]} />
        <PageBody>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title="You can look, but not change sales documents"
              description="Writing quotes, orders and invoices is for Ankor'd staff. Ask an admin if you need it."
              action={<ButtonLink href={config.base}>Back to {config.plural.toLowerCase()}</ButtonLink>}
            />
          </div>
        </PageBody>
      </>
    );
  }

  const access = await getAccess();
  const side = config.side;
  const [settings, team, refs, projectRows] = await Promise.all([
    getSettings(),
    listTeam(),
    readXeroRefs(),
    getDb()
      .select({ id: projects.id, name: projects.name, customerId: projects.customerId })
      .from(projects)
      .where(and(inArray(projects.status, ["planning", "active", "on_hold"]), customerScope(access, projects.customerId)))
      .orderBy(asc(projects.name)),
  ]);

  const validity = settings?.quoteValidityDays ?? 30;
  const defaultTaxType =
    (side === "customer" ? settings?.defaultSalesTaxType : settings?.defaultPurchaseTaxType) ??
    (side === "customer" ? FALLBACK_SALES_TAX : FALLBACK_PURCHASE_TAX);
  const accounts = refs.accounts.filter(side === "customer" ? isSalesAccount : isPurchaseAccount);
  const taxRates = refs.taxRates.filter((t) => (side === "customer" ? t.canApplyToRevenue : t.canApplyToExpenses));

  let header: EditorHeader;
  let lines: EditorLine[] = [];
  let version: number | null = null;
  let locked = false;
  let sourceNote: string | null = null;
  let isReserve = Boolean(reserve);
  let title = `New ${typeLabel(type, isReserve).toLowerCase()}`;
  let cancelHref = config.base;
  let fromError: string | null = null;

  if (documentId) {
    const detail = await getDocument(documentId);
    if (!detail || detail.doc.type !== type) notFound();
    const { doc } = detail;
    const editable =
      doc.status !== "cancelled" &&
      !(doc.status === "closed" && (type === "quote" || type === "sales_order" || type === "purchase_order"));
    if (!editable) redirect(docHref(doc));
    locked = (type === "invoice" || type === "bill") && doc.status !== "draft";
    isReserve = doc.isReserve;
    version = doc.version;
    title = `Edit ${documentTitle(doc)}`;
    cancelHref = docHref(doc);
    header = {
      partnerId: doc.partnerId,
      partnerName: doc.partnerName,
      contactId: doc.contactId,
      reference: doc.reference,
      docDate: doc.docDate,
      dueDate: doc.dueDate,
      termsDays: doc.termsDays,
      shipToText: doc.shipToText,
      ownerId: doc.ownerId,
      projectId: doc.projectId,
      amountsAre: doc.amountsAre,
      title: doc.title,
      summary: doc.summary,
      terms: doc.terms,
      remarks: doc.remarks,
      internalNotes: doc.internalNotes,
      isReserve: doc.isReserve,
      supplierInvoiceNumber: doc.supplierInvoiceNumber,
    };
    lines = detail.lines.map((l) => ({
      key: l.id,
      id: l.id,
      rowType: l.rowType,
      itemId: l.itemId,
      itemCode: l.itemCode,
      unit: l.unit,
      description: l.description,
      note: l.note,
      quantity: trim(l.quantity),
      unitPrice: trim(l.unitPrice),
      discountPercent: trim(l.discountPercent),
      accountCode: l.accountCode,
      taxType: l.taxType,
      baseLineId: l.baseLineId,
      maxQuantity: null,
      drawn: Math.max(
        num(l.qtyConverted),
        num(l.qtyInvoiced),
        num(l.qtyDelivered),
        num(l.qtyOrdered),
        num(l.qtyReceived),
        num(l.qtyBilled),
      ),
    }));
  } else if (from) {
    const draft = await copyDraft(from, type, isReserve);
    if (!draft) notFound();
    if ("error" in draft) {
      fromError = draft.error;
      header = blankHeader(type, validity, partnerId);
    } else {
      header = draft.header;
      sourceNote = `From ${typeLabel(draft.source.type).toLowerCase()} ${draft.source.number ?? "(draft)"}. Quantities default to what is left; partial quantities are fine.`;
      cancelHref = docHref({ type: draft.source.type, id: draft.source.id });
      lines = draft.lines.map((l, i) => ({
        key: `c${i}`,
        rowType: l.rowType,
        itemId: l.itemId,
        itemCode: l.itemCode,
        unit: l.unit,
        description: l.description,
        note: l.note,
        quantity: trim(l.quantity),
        unitPrice: trim(l.unitPrice),
        discountPercent: trim(l.discountPercent),
        accountCode: l.accountCode,
        taxType: l.taxType,
        baseLineId: l.baseLineId,
        maxQuantity: l.maxQuantity,
        drawn: 0,
      }));
    }
  } else {
    header = blankHeader(type, validity, partnerId);
  }

  const partner = header.partnerId ? await partnerDefaults(header.partnerId, side) : null;
  if ((type === "invoice" || type === "bill") && !documentId && partner && header.termsDays === null) {
    header = { ...header, termsDays: partner.termsDays };
  }

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: section }, { label: config.plural, href: config.base }, { label: documentId ? "Edit" : "New" }]}
        description={
          type === "bill"
            ? "Saving creates the bill in Xero as a draft under the supplier's invoice number. Pay it in Xero."
            : config.xero
              ? `Saving creates it in Xero as a draft, and Xero's number comes back here. Send it from Xero.`
              : `Sales orders stay in The Gangway and are numbered here. Xero sees the number on what is drawn from them.`
        }
      />
      <PageBody className="max-w-[72rem]">
        {fromError ? (
          <p role="alert" className="mb-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
            {fromError}
          </p>
        ) : null}
        <DocumentEditor
          type={type}
          documentId={documentId ?? null}
          isReserve={isReserve}
          version={version}
          header={header}
          lines={lines}
          partner={partner}
          team={team.map((t) => ({ id: t.id, name: t.name }))}
          projects={projectRows}
          accounts={accounts}
          taxRates={taxRates}
          defaultTaxType={defaultTaxType}
          locked={locked}
          sourceNote={sourceNote}
          cancelHref={cancelHref}
          validityDays={validity}
        />
      </PageBody>
    </>
  );

  function blankHeader(t: DocType, validityDays: number, partner?: string): EditorHeader {
    return {
      partnerId: partner ?? null,
      partnerName: null,
      contactId: null,
      reference: null,
      docDate: isoDate(),
      dueDate: t === "quote" ? isoDate(validityDays) : t === "sales_order" || t === "purchase_order" ? isoDate(14) : null,
      termsDays: null,
      // Suppliers deliver to us unless told otherwise.
      shipToText: t === "purchase_order" ? (settings?.deliveryAddress ?? null) : null,
      ownerId: user.id,
      projectId: null,
      amountsAre: "exclusive",
      title: null,
      summary: null,
      terms: null,
      remarks: null,
      internalNotes: null,
      isReserve: false,
    };
  }
}

const side0 = (t: DocType) => DOC_TYPES[t].side;

/** "500.0000" → "500" for the editor's inputs. */
function trim(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") || "0" : value;
}

