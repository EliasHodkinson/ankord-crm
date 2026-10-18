import "server-only";
import { taxRateMap } from "@/lib/data/xero-cache";
import {
  DEAD_STATUSES,
  normaliseInvoice,
  normalisePurchaseOrder,
  normaliseQuote,
  OPEN_STATUSES,
  type ImportedDoc,
  type RawInvoice,
  type RawPurchaseOrder,
  type RawQuote,
} from "./map";
import { xeroDateTime, xeroGet, xeroGetAll } from "./read";
import type { ImportScope, ImportSourceKey } from "./scope";

/**
 * Where importable documents come from: one entry per Xero listing.
 * documents.ts works on `ImportedDoc` and never on Xero's shapes.
 */
export type ImportSource = {
  key: ImportSourceKey;
  docType: ImportedDoc["type"];
  list: (scope: ImportScope) => Promise<ImportedDoc[]>;
};

const keepLive = (docs: ImportedDoc[]) => docs.filter((d) => !DEAD_STATUSES.has(d.xeroStatus));

const quotes: ImportSource = {
  key: "quotes",
  docType: "quote",
  async list(scope) {
    const rates = await taxRateMap();
    let raw: RawQuote[];
    if (scope.mode === "numbers") {
      raw = [];
      // Xero's quotes filter takes one number at a time.
      for (const number of scope.numbers) {
        const data = await xeroGet<{ Quotes?: RawQuote[] }>(`/Quotes?QuoteNumber=${encodeURIComponent(number)}`);
        raw.push(...(data.Quotes ?? []).filter((q) => q.QuoteNumber?.toUpperCase() === number.toUpperCase()));
      }
    } else {
      const filter =
        scope.mode === "range"
          ? `&DateFrom=${scope.from}&DateTo=${scope.to}`
          : `&Statuses=${OPEN_STATUSES.quote.join(",")}`;
      raw = await xeroGetAll<RawQuote>((page) => `/Quotes?page=${page}${filter}`, "Quotes");
    }
    return keepLive(raw.map((q) => normaliseQuote(q, rates)));
  },
};

const invoices: ImportSource = {
  key: "invoices",
  docType: "invoice",
  async list(scope) {
    const rates = await taxRateMap();
    let raw: RawInvoice[];
    if (scope.mode === "numbers") {
      const data = await xeroGet<{ Invoices?: RawInvoice[] }>(
        `/Invoices?unitdp=4&InvoiceNumbers=${scope.numbers.map(encodeURIComponent).join(",")}`,
      );
      raw = data.Invoices ?? [];
    } else {
      const clauses = ['Type=="ACCREC"'];
      let statuses = "";
      if (scope.mode === "range") {
        clauses.push(`Date>=${xeroDateTime(scope.from)}`, `Date<=${xeroDateTime(scope.to)}`);
      } else {
        statuses = `&Statuses=${OPEN_STATUSES.invoice.join(",")}`;
      }
      const where = encodeURIComponent(clauses.join(" AND "));
      // `page` is what makes Xero include the line items in a listing.
      raw = await xeroGetAll<RawInvoice>(
        (page) => `/Invoices?page=${page}&pageSize=100&unitdp=4&where=${where}${statuses}&order=${encodeURIComponent("Date DESC")}`,
        "Invoices",
      );
    }
    return keepLive(raw.filter((i) => (i.Type ?? "ACCREC") === "ACCREC").map((i) => normaliseInvoice(i, rates)));
  },
};

/** How far back "open" reaches for POs Xero already calls BILLED. */
const RECENT_BILLED_DAYS = 120;

const purchaseOrders: ImportSource = {
  key: "purchase_orders",
  docType: "purchase_order",
  async list(scope) {
    const rates = await taxRateMap();
    let raw: RawPurchaseOrder[] = [];
    if (scope.mode === "numbers") {
      // Xero fetches a PO by its number as well as by its id.
      for (const number of scope.numbers) {
        const data = await xeroGet<{ PurchaseOrders?: RawPurchaseOrder[] }>(`/PurchaseOrders/${encodeURIComponent(number)}`).catch(
          () => ({ PurchaseOrders: [] as RawPurchaseOrder[] }),
        );
        raw.push(...(data.PurchaseOrders ?? []).filter((p) => p.PurchaseOrderNumber?.toUpperCase() === number));
      }
    } else if (scope.mode === "range") {
      raw = await xeroGetAll<RawPurchaseOrder>(
        (page) => `/PurchaseOrders?page=${page}&DateFrom=${scope.from}&DateTo=${scope.to}`,
        "PurchaseOrders",
      );
    } else {
      // The listing takes one status at a time.
      const since = new Date(Date.now() - RECENT_BILLED_DAYS * 86_400_000).toISOString().slice(0, 10);
      for (const status of OPEN_STATUSES.purchase_order) {
        const extra = status === "BILLED" ? `&DateFrom=${since}` : "";
        raw.push(
          ...(await xeroGetAll<RawPurchaseOrder>(
            (page) => `/PurchaseOrders?page=${page}&Status=${status}${extra}`,
            "PurchaseOrders",
          )),
        );
      }
    }
    const seen = new Set<string>();
    return keepLive(
      raw.filter((p) => !seen.has(p.PurchaseOrderID) && seen.add(p.PurchaseOrderID)).map((p) => normalisePurchaseOrder(p, rates)),
    );
  },
};

/**
 * Supplier bills (ACCPAY). By number, a bill is found by the supplier's
 * invoice number or by the PO number in its Reference — "PO-0011" brings in
 * the bill entered against that order, paid or not.
 */
const bills: ImportSource = {
  key: "bills",
  docType: "bill",
  async list(scope) {
    const rates = await taxRateMap();
    const listing = (clauses: string[], statuses = "") => {
      const where = encodeURIComponent(['Type=="ACCPAY"', ...clauses].join(" AND "));
      return xeroGetAll<RawInvoice>(
        (page) => `/Invoices?page=${page}&pageSize=100&unitdp=4&where=${where}${statuses}&order=${encodeURIComponent("Date DESC")}`,
        "Invoices",
      );
    };
    let raw: RawInvoice[];
    if (scope.mode === "numbers") {
      raw = [];
      for (const number of scope.numbers) {
        const safe = number.replace(/"/g, "");
        raw.push(...(await listing([`(InvoiceNumber=="${safe}" OR Reference.Contains("${safe}"))`])));
      }
    } else if (scope.mode === "range") {
      raw = await listing([`Date>=${xeroDateTime(scope.from)}`, `Date<=${xeroDateTime(scope.to)}`]);
    } else {
      raw = await listing([], `&Statuses=${OPEN_STATUSES.invoice.join(",")}`);
    }
    const seen = new Set<string>();
    return keepLive(
      raw
        .filter((i) => i.Type === "ACCPAY" && !seen.has(i.InvoiceID) && seen.add(i.InvoiceID))
        .map((i) => normaliseInvoice(i, rates)),
    );
  },
};

export const IMPORT_SOURCES: Record<ImportSourceKey, ImportSource> = {
  quotes,
  invoices,
  purchase_orders: purchaseOrders,
  bills,
};
