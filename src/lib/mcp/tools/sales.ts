import "server-only";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDb } from "@/lib/db";
import { documentLines, settings } from "@/lib/db/schema";
import { requireMember } from "@/lib/auth/session";
import { copyDraft, getDocument } from "@/lib/data/documents";
import { priceItems } from "@/lib/data/items";
import { shipmentsFor } from "@/lib/data/stock";
import { confirmOrder, saveDocument } from "@/lib/actions/documents";
import { receiveGoods, saveShipment } from "@/lib/actions/purchasing";
import { importXeroDocuments } from "@/lib/actions/xero-import";
import { CARRIER_KEYS } from "@/lib/sales/carriers";
import { FALLBACK_SALES_TAX } from "@/lib/sales/xero-refs";
import { num } from "@/lib/sales/money";
import { isoDate } from "@/lib/utils";
import { expectOk, settle, write, ToolFailure } from "../run";
import { findDocumentId } from "./records";
import { form } from "./updates";

/**
 * Sales, purchasing and Xero. Each tool that reaches Xero says so in its
 * description and is marked open-world, so the client asks before calling it.
 * Every write goes through the same action as the page: staff only
 * (requireMember), partner asserted, one transaction, Xero after the commit.
 */

const LOCAL = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const REACHES_XERO = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const lineSchema = z.object({
  rowType: z.enum(["item", "text", "subtotal", "alternative"]).default("item"),
  itemId: z.uuid().optional().describe("An item from list_items; fills code, description, price, account and tax"),
  description: z.string().max(4000).optional(),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional().describe("Leave out to use the item's price"),
  discountPercent: z.number().min(0).max(100).optional(),
  accountCode: z.string().max(20).optional(),
  taxType: z.string().max(40).optional().describe("Xero tax type, e.g. OUTPUT (GST on income). Defaults from the item or Settings"),
  note: z.string().max(2000).optional(),
});

type LineArg = z.infer<typeof lineSchema>;

/** Lines as the editor would send them, with the same defaults it would fill in. */
async function editorLines(lines: LineArg[]) {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  const [priced, [config]] = await Promise.all([
    priceItems(ids, "customer"),
    getDb().select().from(settings).where(eq(settings.id, "singleton")),
  ]);
  return lines.map((line, index) => {
    const item = line.itemId ? priced.get(line.itemId) : undefined;
    if (line.itemId && !item) throw new ToolFailure(`Line ${index + 1}: that item doesn't exist.`);
    const isMoney = line.rowType === "item" || line.rowType === "alternative";
    return {
      rowType: line.rowType,
      itemId: line.itemId ?? null,
      description: line.description ?? item?.description ?? "",
      note: line.note ?? null,
      quantity: isMoney ? String(line.quantity ?? 1) : "0",
      unitPrice: isMoney ? String(line.unitPrice ?? item?.unitPrice ?? 0) : "0",
      discountPercent: String(line.discountPercent ?? 0),
      accountCode: isMoney ? (line.accountCode ?? item?.accountCode ?? config?.defaultSalesAccount ?? null) : null,
      taxType: isMoney ? (line.taxType ?? item?.taxType ?? config?.defaultSalesTaxType ?? FALLBACK_SALES_TAX) : null,
    };
  });
}

const header = {
  businessPartnerId: z.uuid().describe("The customer — a business partner marked as a customer"),
  contactId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  reference: z.string().max(200).optional(),
  docDate: z.iso.date().optional().describe("Defaults to today (Sydney)"),
  amountsAre: z.enum(["exclusive", "inclusive", "no_tax"]).default("exclusive"),
  remarks: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
};

export function registerSalesTools(server: McpServer) {
  server.registerTool(
    "create_quote",
    {
      title: "Create a quote (sends a draft to Xero)",
      description:
        "Create a quote for a customer. REACHES XERO: saving creates the quote in Xero as a DRAFT and copies Xero's QU- number back. It is not sent to the customer — that is done from Xero. Staff only. Use list_items for item ids; a line without an item needs a description and price.",
      inputSchema: z.object({
        ...header,
        validUntil: z.iso.date().optional().describe("Defaults to 30 days from today"),
        title: z.string().max(200).optional(),
        summary: z.string().max(4000).optional(),
        terms: z.string().max(8000).optional(),
        lines: z.array(lineSchema).min(1).max(200),
      }),
      annotations: REACHES_XERO,
    },
    (args) =>
      write("create_quote", async () => {
        const state = expectOk(
          await saveDocument(
            "quote",
            null,
            undefined,
            undefined,
            form({
              partnerId: args.businessPartnerId,
              contactId: args.contactId,
              projectId: args.projectId,
              reference: args.reference,
              docDate: args.docDate ?? isoDate(),
              dueDate: args.validUntil ?? isoDate(30),
              amountsAre: args.amountsAre,
              title: args.title,
              summary: args.summary,
              terms: args.terms,
              remarks: args.remarks,
              internalNotes: args.internalNotes,
              lines: JSON.stringify(await editorLines(args.lines)),
            }),
          ),
        );
        return { result: { message: state.message, id: state.data?.id, href: state.data?.href }, audit: null };
      }),
  );

  server.registerTool(
    "create_sales_order",
    {
      title: "Create a sales order",
      description:
        "Create a draft sales order (SO-…), either by converting a quote (fromQuote: its id or number; everything not yet converted comes across unless lines are chosen) or from lines given here. Sales orders live in The Gangway, not Xero — but converting a quote adds a history note to that quote in Xero. Confirm it with confirm_sales_order. Staff only.",
      inputSchema: z.object({
        fromQuote: z.string().optional().describe("Quote id or number, e.g. QU-0042"),
        onlyLines: z
          .array(z.object({ quoteLineId: z.uuid(), quantity: z.number().positive() }))
          .optional()
          .describe("When converting: just these quote lines, in these quantities"),
        businessPartnerId: z.uuid().optional().describe("Required unless converting a quote"),
        deliveryDate: z.iso.date().optional().describe("Defaults to 14 days out"),
        contactId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        reference: z.string().max(200).optional(),
        remarks: z.string().max(4000).optional(),
        internalNotes: z.string().max(4000).optional(),
        amountsAre: z.enum(["exclusive", "inclusive", "no_tax"]).optional(),
        lines: z.array(lineSchema).max(200).optional(),
      }),
      annotations: REACHES_XERO,
    },
    (args) =>
      write("create_sales_order", async () => {
        let values: Record<string, string | null | undefined>;
        if (args.fromQuote) {
          const quoteId = await findDocumentId(args.fromQuote);
          const draft = quoteId ? await copyDraft(quoteId, "sales_order", false) : null;
          if (!draft) throw new ToolFailure("That quote doesn't exist, or you can't see it.");
          if ("error" in draft) throw new ToolFailure(draft.error);
          let lines = draft.lines;
          if (args.onlyLines?.length) {
            const wanted = new Map(args.onlyLines.map((l) => [l.quoteLineId, l.quantity]));
            lines = lines
              .filter((l) => l.rowType !== "item" || (l.baseLineId && wanted.has(l.baseLineId)))
              .map((l) => (l.rowType === "item" && l.baseLineId ? { ...l, quantity: String(wanted.get(l.baseLineId)) } : l));
          }
          const h = draft.header;
          values = {
            partnerId: h.partnerId,
            contactId: args.contactId ?? h.contactId,
            projectId: args.projectId ?? h.projectId,
            ownerId: h.ownerId,
            reference: args.reference ?? h.reference,
            docDate: h.docDate,
            dueDate: args.deliveryDate ?? h.dueDate,
            termsDays: h.termsDays === null ? null : String(h.termsDays),
            shipToText: h.shipToText,
            amountsAre: h.amountsAre,
            remarks: args.remarks ?? h.remarks,
            internalNotes: args.internalNotes,
            lines: JSON.stringify(lines),
          };
        } else {
          if (!args.businessPartnerId || !args.lines?.length) {
            throw new ToolFailure("Give fromQuote, or a businessPartnerId and lines.");
          }
          values = {
            partnerId: args.businessPartnerId,
            contactId: args.contactId,
            projectId: args.projectId,
            reference: args.reference,
            docDate: isoDate(),
            dueDate: args.deliveryDate ?? isoDate(14),
            amountsAre: args.amountsAre ?? "exclusive",
            remarks: args.remarks,
            internalNotes: args.internalNotes,
            lines: JSON.stringify(await editorLines(args.lines)),
          };
        }
        const state = expectOk(await saveDocument("sales_order", null, undefined, undefined, form(values)));
        return { result: { message: state.message, id: state.data?.id, href: state.data?.href }, audit: null };
      }),
  );

  server.registerTool(
    "confirm_sales_order",
    {
      title: "Confirm a sales order",
      description: "Confirm a draft sales order so stock can be ordered and it can be invoiced. Stays in The Gangway. Staff only.",
      inputSchema: z.object({ salesOrder: z.string().describe("Sales order id or number, e.g. SO-0007") }),
      annotations: LOCAL,
    },
    ({ salesOrder }) =>
      write("confirm_sales_order", async () => {
        const id = await findDocumentId(salesOrder);
        if (!id) throw new ToolFailure("That sales order doesn't exist, or you can't see it.");
        return { result: expectOk(await confirmOrder(id)).message, audit: null };
      }),
  );

  /* ── purchasing ────────────────────────────────────────────────── */

  server.registerTool(
    "add_po_shipment",
    {
      title: "Add a shipment and tracking to a PO",
      description: `Record that a supplier has dispatched a purchase order: the courier and consignment number (the tracking link is built from them), ship date and ETA. It shows as in transit on the PO and on the sales lines it was bought for. REACHES XERO: adds a history note to the PO in Xero. Couriers: ${CARRIER_KEYS.join(", ")} (use 'other' with trackingUrl for anything else). Staff only.`,
      inputSchema: z.object({
        purchaseOrder: z.string().describe("PO id or number, e.g. PO-0011"),
        carrier: z.string().refine((c) => (CARRIER_KEYS as string[]).includes(c), "Unknown courier."),
        trackingNumber: z.string().max(100).optional(),
        trackingUrl: z.url().optional(),
        shippedOn: z.iso.date().optional(),
        eta: z.iso.date().optional(),
        notes: z.string().max(2000).optional(),
      }),
      annotations: REACHES_XERO,
    },
    ({ purchaseOrder, ...shipment }) =>
      write("add_po_shipment", async () => {
        const id = await findDocumentId(purchaseOrder);
        if (!id) throw new ToolFailure("That purchase order doesn't exist, or you can't see it.");
        return { result: expectOk(await saveShipment(id, null, undefined, form(shipment))).message, audit: null };
      }),
  );

  server.registerTool(
    "receive_goods",
    {
      title: "Receive goods against a PO",
      description:
        "Book goods in against an approved purchase order: makes a goods receipt (GR-…), counts the stock in and sets it aside for the sales lines it was ordered for. Give the PO line ids and quantities that arrived (from get_document), or receiveAll for everything still outstanding. Shipments on the PO are closed by the receipt if listed in shipmentIds (or all open ones with receiveAll). REACHES XERO: adds a 'Received' history note to the PO in Xero. Staff only.",
      inputSchema: z.object({
        purchaseOrder: z.string().describe("PO id or number, e.g. PO-0011"),
        lines: z.array(z.object({ lineId: z.uuid(), quantity: z.number().positive() })).max(300).optional(),
        receiveAll: z.boolean().default(false),
        shipmentIds: z.array(z.uuid()).optional(),
        docDate: z.iso.date().optional().describe("Defaults to today"),
        reference: z.string().max(200).optional().describe("e.g. the supplier's packing slip number"),
        remarks: z.string().max(2000).optional(),
      }),
      annotations: REACHES_XERO,
    },
    (args) =>
      write("receive_goods", async () => {
        await requireMember();
        const id = await findDocumentId(args.purchaseOrder);
        const detail = id ? await getDocument(id) : null;
        if (!id || !detail || detail.doc.type !== "purchase_order") {
          throw new ToolFailure("That purchase order doesn't exist, or you can't see it.");
        }
        let counts = args.lines?.map((l) => ({ lineId: l.lineId, quantity: String(l.quantity) })) ?? [];
        let shipmentIds = args.shipmentIds ?? [];
        if (args.receiveAll) {
          const lines = await getDb()
            .select()
            .from(documentLines)
            .where(eq(documentLines.documentId, id))
            .orderBy(asc(documentLines.position));
          counts = lines
            .filter((l) => l.rowType === "item" && num(l.quantity) - num(l.qtyReceived) > 0)
            .map((l) => ({ lineId: l.id, quantity: String(num(l.quantity) - num(l.qtyReceived)) }));
          if (!args.shipmentIds) {
            shipmentIds = (await shipmentsFor(id)).filter((s) => !s.shipment.receiptId).map((s) => s.shipment.id);
          }
        }
        if (!counts.length) throw new ToolFailure("Nothing to receive: give lines, or receiveAll if anything is outstanding.");
        const state = expectOk(
          await settle(() =>
            receiveGoods(
              id,
              undefined,
              form({
                docDate: args.docDate ?? isoDate(),
                reference: args.reference,
                remarks: args.remarks,
                lines: JSON.stringify(counts),
                shipmentId: shipmentIds,
              }),
            ),
          ),
        );
        return { result: { message: state.message, purchaseOrder: state.data?.href }, audit: null };
      }),
  );

  /* ── Xero import ───────────────────────────────────────────────── */

  server.registerTool(
    "import_from_xero",
    {
      title: "Import documents from Xero",
      description:
        "Bring quotes, invoices, purchase orders or bills that were made in Xero into The Gangway, so work carries on here — by number (e.g. INV-0028, PO-0011; a bill by the supplier's number or the PO in its Reference), by date range, or everything still open. READS XERO and writes only to The Gangway: nothing is created or changed in Xero. Re-running updates in place. Documents whose Xero contact isn't matched to a business partner wait until it is (Sales → Import from Xero). Staff only.",
      inputSchema: z.object({
        source: z.enum(["quotes", "invoices", "purchase_orders", "bills"]),
        numbers: z.array(z.string().min(1).max(40)).max(25).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        allOpen: z.boolean().default(false).describe("Everything still open in Xero"),
      }),
      annotations: { ...REACHES_XERO, readOnlyHint: false },
    },
    (args) =>
      write("import_from_xero", async () => {
        const mode = args.numbers?.length ? "numbers" : args.from && args.to ? "range" : args.allOpen ? "open" : null;
        if (!mode) throw new ToolFailure("Give numbers, a from/to date range, or allOpen.");
        const state = expectOk(
          await importXeroDocuments({
            source: args.source,
            mode,
            numbers: args.numbers?.join(","),
            from: args.from,
            to: args.to,
          }),
        );
        return {
          result: state.message,
          audit: null,
        };
      }),
  );
}
