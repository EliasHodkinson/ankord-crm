import "server-only";
import { taxRateMap } from "@/lib/data/xero-cache";
import {
  DEAD_STATUSES,
  normaliseInvoice,
  normaliseQuote,
  OPEN_STATUSES,
  type ImportedDoc,
  type RawInvoice,
  type RawQuote,
} from "./map";
import { xeroDateTime, xeroGet, xeroGetAll } from "./read";
import type { ImportScope, ImportSourceKey } from "./scope";

/**
 * Where importable documents come from: one entry per Xero listing.
 *
 * Phase B adds `purchase_orders` (GET /PurchaseOrders, Status=DRAFT|SUBMITTED|
 * AUTHORISED, a `normalisePurchaseOrder` in map.ts) and `bills` (the invoices
 * listing with `Type=="ACCPAY"` — `normaliseInvoice` already returns type
 * `bill` for those). Nothing else in the import changes: documents.ts works
 * on `ImportedDoc` and never on Xero's shapes.
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

export const IMPORT_SOURCES: Record<ImportSourceKey, ImportSource> = { quotes, invoices };
