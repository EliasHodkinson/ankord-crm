# Sales & purchasing in The Gangway: design spec

Status: **draft v2 for review** · 2026-10-18 · Owner: Elias

v2 reworks v1 around the workflow Elias described:

- Quote → Sales Order.
- Order stock from suppliers on POs.
- Book it in, or book it in against the supplier's bill.
- Allocate it to the Sales Order.
- Invoice. Sometimes the invoice comes first, as a Reserve Invoice, and the
  goods are delivered against it later.

Two rules come with it: **anything sent to a customer or supplier is sent from
Xero, and Xero assigns the numbers.**

This spec brings EduCom IT Hub's Sales/ERP workflow into The Gangway, backed by
Gangway's own Postgres instead of SAP Business One, with Xero as the ledger and
the place documents go out from. It is written so that each build phase (§10)
can be done by someone who has **not** read EduCom's code.

Read `CLAUDE.md`, `AGENTS.md`, `DESIGN.md` and `PRODUCT.md` first. House rules
apply throughout:

- reads in `src/lib/data`, writes in `src/lib/actions` (async exports only);
- tokens from `globals.css`;
- enum wording in `components/ui/status.tsx`;
- forms through `ActionForm` and `form-kit.tsx`;
- overlays portalled to `document.body`.

---

## 0. Decisions on one page

| # | Decision | Why |
|---|---|---|
| D1 | **The Gangway runs the workflow; Xero holds the money, the numbers and the outbound documents.** Gangway knows what was quoted, ordered, received, allocated, invoiced and delivered. Xero knows what was sent, owed and paid. | Xero is a poor ERP, but a good ledger and sender. |
| D2 | **Every customer- or supplier-facing document lives in Xero**: Quotes, AR Invoices (normal and reserve), Purchase Orders and Bills. Gangway creates it in Xero as a **DRAFT on first save**, Xero assigns the number, and Gangway stores it. The document is **sent from Xero**. Gangway gives an "Open in Xero" link and reads the status back. | "Documents generated and sent to customers should still be done in Xero. Document numbers too." Xero numbers drafts on creation, so the number exists from the first save. |
| D3 | **Internal documents are Gangway-only**: Sales Orders, Goods Receipts (booking stock in) and Deliveries (stock out against a reserve invoice). Gangway numbers these itself (`SO-`, `GR-`, `DN-`). Xero is told about them through **history notes** on the related Xero document and through the `Reference` field, so someone in Xero can follow what is going on. | Xero has no sales order, receipt or delivery document. |
| D4 | **Gangway tracks stock quantities, not stock value.** Items that track stock have on hand, allocated and available quantities derived from receipts and deliveries. Xero items stay **untracked**. Cost is handled by the purchase account on each bill line. | Xero's tracked inventory moves stock on the bill. Elias's flow books stock in before, after or with the bill, which Xero cannot represent. |
| D5 | **Every PO line, Sales Order line and Reserve Invoice line has two independent counters.** A PO line counts *received* and *billed*. A sales line counts *invoiced* and *delivered*. Each counter is derived from the documents drawn against the line. | Prepaid bills before stock, stock before the bill, and both at once all fall out of this naturally. The same goes for invoicing before or after delivery. |
| D6 | **Items carry their Xero accounts and tax types** (sales account, purchase account, sales tax, purchase tax), chosen from pickers loaded from Xero. They are synced to Xero as Xero Items. | "When we define an Item in the Gangway, we should be able to select the relevant accounts." |
| D7 | **Payments happen in Xero** (bank feed reconciliation, prepaying suppliers). Gangway pulls paid status and payments back so it shows what is paid and what is owed. Recording a payment inside Gangway is an open question (Q5). | "Some will go straight in." Xero is where the bank is. |
| D8 | **Amounts follow Xero's arithmetic exactly**: a per-document `amountsAre` setting (exclusive, inclusive or no tax), a per-line discount, and per-line tax rounded to the cent. There is no document-level discount. | A pushed invoice can never be a cent different from what Gangway shows. |
| D9 | **Real database transactions for multi-row writes.** Phase A adds a `withTransaction()` helper. | The current `neon-http` driver cannot do interactive transactions, and allocation, receipt and delivery writes must land together. |
| D10 | Organisations stay in `customers`, using the existing `isCustomer` and `isSupplier` flags, which mirror Xero's IsCustomer and IsSupplier. | Already modelled. One Xero contact per CRM record, as today. |

---

## 1. The workflow end to end

```
 SALES                                   PURCHASING                          XERO sees
 ─────                                   ──────────                          ─────────
 Quote (Xero DRAFT → sent from Xero)                                         Quote QU-0042  DRAFT → SENT
   │ accepted (in Xero or Gangway)                                           Quote ACCEPTED
   ▼
 Sales Order SO-00017 (Gangway only)  ── "Raise POs" ──►  Purchase Order    PO-0031 (Reference "SO-00017 Maple St")
   line: 500 × business cards                              (Xero DRAFT → sent from Xero)
   needs ordering → on order                                 │
                                                             ├─ Bill (supplier invoice)   Bill 4471 (prepaid, or paid later)
                                                             │    may come before, with or after the stock
                                                             └─ Goods Receipt GR-00009    PO history note: "Received 500 — GR-00009"
                                                                  (Gangway only)
   ◄──────── received stock auto-allocated to the SO line ───────┘
   ready to invoice
   │
   ├─ Invoice (normal): bills and delivers together         ─►               Invoice INV-0123 (Reference "SO-00017")
   │
   └─ Reserve Invoice: bill now, deliver later              ─►               Invoice INV-0124, history note "Goods to follow"
        └─ Delivery DN-00004 (Gangway only) closes it off   ─►               history note "Delivered DN-00004"
```

Variations that must all work:

| Situation | How it is done |
|---|---|
| Supplier wants payment up front | Record the **Bill** against the PO first (it goes to Xero, and is paid in Xero). Later, **Receive** against the same PO. |
| Stock arrives before the bill | **Receive** against the PO. The bill is entered against the PO when it turns up. |
| Stock and bill arrive together | **Enter bill** with "Goods arrived with this invoice" ticked. That creates the receipt in the same step. |
| Customer must be invoiced before the stock arrives | **Reserve Invoice** from the Sales Order. Once the stock is received and allocated, make a **Delivery** against the reserve invoice. |
| Stock already on the shelf (not ordered for this job) | **Allocate** on-hand stock to the SO line by hand. |
| Services (design time, setup fees) | Items with `tracksStock = false` skip ordering, receiving, allocation and delivery. They are just invoiced. |
| Quote straight to invoice (no order needed) | Allowed: Quote → Invoice. |
| Bill with no PO (subscriptions, ad-hoc) | Entered straight in **Xero**, not in Gangway. Gangway only creates bills against its own POs (Q7). |

---

## 2. What EduCom does today (reference)

Condensed so that later sessions need not open EduCom. Behaviour that is kept
is restated in §4–§7.

### 2.1 Document types

| EduCom key | SAP entity (object code) | Created in hub? | Gangway |
|---|---|---|---|
| `quotation` | `Quotations` (23) | yes | `quote`: Xero Quote |
| `order` | `Orders` (17) | yes | `sales_order`: local |
| `invoice` | `Invoices` (13), `ReserveInvoice = tNO` | yes | `invoice`: Xero ACCREC |
| `reserve_invoice` | `Invoices` (13), `ReserveInvoice = tYES` | yes | `invoice` with `isReserve = true`: Xero ACCREC |
| `delivery` | `DeliveryNotes` (15) | only by Copy To from a reserve invoice | `delivery`: local |
| `purchase_order` | `PurchaseOrders` (22) | from the Purchasing "Orders" flow (one PO per supplier from an SO) | `purchase_order`: Xero PurchaseOrder |
| `goods_receipt_po` | `PurchaseDeliveryNotes` (20) | **no** (keyed in the SAP client) | `goods_receipt`: local (new behaviour) |
| `ap_invoice` | `PurchaseInvoices` (18) | **no** (SAP client) | `bill`: Xero ACCPAY (new behaviour) |
| `incoming_payment` | `IncomingPayments` (24) | yes (cash and card, split tenders) | payments pulled from Xero (D7) |
| returns, credit notes, down payments, transfers | | read-only / transfers | dropped (§9.3) |

EduCom never creates goods receipts or AP invoices. Gangway's purchasing side
is therefore designed from standard SAP B1 semantics, as set out in §6, rather
than ported.

### 2.2 SAP header fields → Gangway

| SAP field | EduCom meaning | Gangway `documents` column |
|---|---|---|
| `DocEntry` / `DocNum` | internal key / printed number (series-prefixed 933 quote, 934 order, 937 invoice, 924 PO…) | `id` / `number` (from Xero for Xero types, Gangway series for local types) |
| `CardCode` / `CardName` | customer (supplier on purchasing documents) | `partnerId` → customers, plus a `partnerName` snapshot |
| `ContactPersonCode` | contact | `contactId` → contacts, plus a snapshot |
| `DocDate` | posting date | `docDate` |
| `DocDueDate` | quote: valid until (+30d); order and PO: delivery date; invoice: due date | `dueDate` (labelled per type) |
| `NumAtCard` | customer's PO / reference; supplier's invoice number on AP | `reference` (sales) / `supplierInvoiceNumber` (bills) |
| `Comments` | remarks, printed | `remarks` (goes to Xero as described in §8.4) |
| `SalesPersonCode` | sales employee / buyer | `ownerId` → users |
| `PaymentGroupCode` | payment terms | `dueDate` derived from `termsDays` |
| `Address` / `Address2` | bill-to / ship-to | `shipToText` (delivery address; bill-to comes from the Xero contact) |
| `ReserveInvoice` | reserve flag | `isReserve` |
| `DocumentStatus`, `Cancelled` | open/closed, cancelled | `status` (§4.6) |
| `DiscountPercent` (document), `U_*` UDFs, `Series`, `DocumentReferences` | | dropped |

### 2.3 SAP line fields → Gangway

| SAP field | Meaning | Gangway `document_lines` column |
|---|---|---|
| `LineNum` / `VisualOrder` | id / order | `id` / `position` |
| `LineType` (`dlt_Alternative`) + `DocumentSpecialLines` (`dslt_Text`, `dslt_Subtotal`) | alternative (quote only), text row, subtotal row | `rowType`: `item`, `alternative`, `text`, `subtotal` (inline) |
| `ItemCode`, `ItemDescription` (≤100), `FreeText` (≤100) | item, description, printed note | `itemId`, `itemCode`, `description`, `note` |
| `Quantity`, `UnitPrice`, `DiscountPercent`, `VatGroup` | qty, ex-GST price, discount, tax code | `quantity`, `unitPrice`, `discountPercent`, `taxType` + `taxRate` |
| `LineTotal`, `TaxTotal` | net, tax | `lineAmount`, `taxAmount` |
| `BaseType` / `BaseEntry` / `BaseLine` | Copy To link | `baseLineId` (self-reference) |
| `RemainingOpenQuantity` | open quantity | replaced by the two counters per line (D5, §4.4) |
| `POTargetEntry` | the PO raised from an SO line | `sourceLineId` on the PO line (§6.2) |
| `WarehouseCode` | warehouse | dropped: one stock location (Q2) |
| `SerialNumbers[]`, `BatchNumbers[]` | serial and batch allocation | dropped |

### 2.4 SAP Service Layer calls and what replaces them

| Purpose | SAP calls | Gangway replacement |
|---|---|---|
| Login | `POST /Login` per user | Entra session |
| Lookups | `GET SalesPersons`, `Warehouses`, `PriceLists`, `PaymentTermsTypes`, `VatGroups('X')` | `users`; Xero `/Accounts` and `/TaxRates` (cached); `customers.termsDays` |
| Lists and search | `GET {Entity}?$filter&$orderby=DocNum desc&$top=20`; `SeriesService_GetDocumentSeries` for number → type | `data/documents.ts`; ⌘K matches numbers |
| Detail | `GET {Entity}(n)` (full read) | `getDocument` |
| Customer context | `GET BusinessPartners('C')` (contacts, addresses, price list, tax group) | `customers` + `contacts` |
| Pricing | `GET Items`, `POST CompanyService_GetItemPrice`, B01 buy price list | `data/items.ts#priceItems` (§4.3) |
| Create / edit | `POST` / `PATCH {Entity}` with `If-Match` + `B1S-ReplaceCollectionsOnPatch` | local write in a transaction, then push to Xero (§8) |
| Copy To | `POST target` with `BaseType/BaseEntry/BaseLine`; SAP decrements open quantity | `?from=` prefilled editor, `baseLineId`, counters recomputed (§4.4) |
| Close / cancel | `POST {Entity}(n)/Close`, `/Cancel`; invoice cancel refused while `PaidToDate > 0` | `closeDocument`, `cancelDocument` + Xero status |
| SO → POs | `POST Orders`, `POST PurchaseOrders` × supplier, `PATCH Orders(n)` remark links | `raisePurchaseOrders` (§6.2), with real FKs |
| PO edit | `PATCH PurchaseOrders(n)` with received-quantity rules | §6.3 |
| Reserve invoice → delivery | `POST DeliveryNotes` with `BaseType 13` lines and serials | `createDelivery` (§5.5) |
| Incoming payment | `GET Invoices` (open), re-check, `POST IncomingPayments`, read-back | Xero payments pulled (§8.6) |
| PDFs, email | fpdf2 layouts; Graph `sendMail` from the user's mailbox | **Xero** renders and sends. Gangway can fetch Xero's PDF to save to SharePoint (§9.2) |
| Relationship map | BFS over `$crossjoin` bases/targets, Activities, references | "Related documents" list from FKs |
| Repairs, consignments, daily banking, stock transfers, serial search | various | dropped |

---

## 3. Data model overview

```
customers ──< documents >── document_lines ── items (Xero accounts + tax types)
 (isCustomer/       │            │ baseLineId   → line it was drawn from (copy-to)
  isSupplier,       │            │ sourceLineId → SO line a PO line was raised for
  xeroContactId)    │            └──< stock_allocations >── (SO line, receipt line)
                    └── projectId (optional)

number_series (local types only)        xero_sync_log        xero_cache (accounts, tax rates)
```

Conventions: `uuid` PKs with `defaultRandom()`; timestamps with time zone;
`createdById` → users with `set null`; snake_case columns (`casing:
"snake_case"`). Money is `numeric(14,2)`. Quantities and unit prices are
`numeric(14,4)`. Convert numerics in one place (`lib/sales/money.ts`).

---

## 4. Shared foundation (phase A)

### 4.1 Enums

```ts
export const documentTypeEnum = pgEnum("document_type", [
  "quote",           // Xero Quote
  "sales_order",     // local
  "invoice",         // Xero ACCREC; isReserve marks a reserve invoice
  "delivery",        // local; only against a reserve invoice (phase C)
  "purchase_order",  // Xero PurchaseOrder (phase B)
  "goods_receipt",   // local (phase B)
  "bill",            // Xero ACCPAY (phase B)
]);

export const documentStatusEnum = pgEnum("document_status", [
  "draft",      // editable. Xero types exist in Xero as DRAFT already
  "open",       // live: quote sent, order confirmed, invoice/PO/bill approved, receipt/delivery recorded
  "closed",     // finished (auto: fully converted/invoiced+delivered/received+billed; or by hand)
  "cancelled",  // voided/deleted; keeps its number
]);

export const quoteOutcomeEnum = pgEnum("quote_outcome", ["accepted", "declined", "expired"]);
export const rowTypeEnum = pgEnum("row_type", ["item", "alternative", "text", "subtotal"]);
export const amountsAreEnum = pgEnum("amounts_are", ["exclusive", "inclusive", "no_tax"]);

export const xeroSyncStateEnum = pgEnum("xero_sync_state", [
  "local_only",  // sales_order, goods_receipt, delivery
  "pending",     // queued
  "pushing",     // claimed by a push
  "synced",      // Xero matches xeroPushedVersion == version
  "stale",       // edited since the last push
  "failed",      // last attempt failed (xeroError); retry allowed
  "blocked",     // needs a person: contact not linked, account/tax not mapped, Xero not connected
]);
```

### 4.2 `items`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| code | text unique not null | ≤30 characters (Xero `Item.Code`) |
| name | text not null | ≤50 sent to Xero `Name` |
| description | text | default sales line text (Xero `Description`) |
| purchaseDescription | text null | default PO line text (Xero `PurchaseDescription`) |
| tracksStock | boolean not null default false | true for physical goods (print, hardware). False for services. Drives ordering, receiving, allocation and delivery |
| unit | text null | "ea", "hr", "box of 500" |
| isSold / isPurchased | boolean | which pickers offer it |
| salePrice / purchasePrice | numeric(14,4) null | ex GST. A missing buy price is shown, never guessed (EduCom rule) |
| **salesAccountCode** | text null | Xero account code (picker over Xero REVENUE/SALES accounts). Null falls back to the settings default |
| **purchaseAccountCode** | text null | Xero account code (picker over DIRECTCOSTS/EXPENSE accounts, or an inventory asset account if Q3 says so) |
| **salesTaxType** / **purchaseTaxType** | text null | Xero `TaxType` (picker over `/TaxRates`: `OUTPUT`, `EXEMPTOUTPUT`, `INPUT`, `EXEMPTINPUT`, `BASEXCLUDED`…). Null uses the settings default |
| preferredSupplierId | uuid → customers null | default supplier when raising POs |
| xeroItemId | text null | set by item sync |
| xeroSyncState, xeroError, xeroSyncedAt | | as for documents |
| archivedAt, createdAt, updatedAt, createdById | | |

An item is synced to Xero on save, and also from an admin "Sync all items"
action:

- Create or update a Xero Item with `Code`, `Name`, `Description`,
  `PurchaseDescription`, `IsSold`, `IsPurchased`,
  `SalesDetails {UnitPrice, AccountCode, TaxType}` and
  `PurchaseDetails {UnitPrice, AccountCode, TaxType}`. It is always untracked
  (D4).
- Match on `Code` before creating, so an item that already exists in Xero gets
  linked, not duplicated.

The item form shows the account pickers with Xero's names ("200 · Sales",
"310 · Cost of Goods Sold"). When Xero is not connected, the pickers show "Connect
Xero in Settings to choose accounts", and the item still saves.

Tax rates: there is no local tax table. Gangway caches Xero's `/TaxRates`
(`TaxType`, `Name`, `EffectiveRate`, `Status`) in `xero_cache` (refreshed
daily and on demand). Each line snapshots `taxType` and `taxRate`, so totals
can be previewed, and Xero stays the authority.

Pricing (`data/items.ts#priceItems(partnerId, itemIds, side)`):

- Sales: `salePrice`, else 0 flagged `priceMissing`.
- Purchase: `purchasePrice`, else 0 flagged `priceMissing`.
- Tax type: the item's, else the settings default for that side.
- Customer-specific price lists are out of scope (Q8).

As in EduCom, only lines that are new, not drawn from another document and not
hand-edited are re-priced. A typed price is never overwritten.

### 4.3 `documents` and `document_lines`

`documents`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| type | `document_type` | |
| number | text null | Xero types: Xero's QuoteNumber, InvoiceNumber or PurchaseOrderNumber, written back after the first push (null until then, shown as "Draft · not in Xero yet"). Bills: the supplier's invoice number. Local types: from `number_series` on create. Unique per type where not null |
| status | `document_status` default `draft` | |
| isReserve | boolean default false | invoices only |
| quoteOutcome | `quote_outcome` null | quotes only |
| partnerId | uuid → customers, restrict | customer or supplier |
| partnerName | text | snapshot |
| contactId, contactName, contactEmail | | snapshots. Xero sends to the contact's email set in Xero |
| reference | text null | sales: the customer's PO or reference. PO: free reference. Pushed per §8.4 |
| supplierInvoiceNumber | text null | bills only, required. Unique per supplier among bills that are not cancelled |
| docDate | date | |
| dueDate | date null | quote: valid until (required, +30d default). SO and PO: delivery date (required). Invoice and bill: due date (`docDate + termsDays`) |
| termsDays | integer null | from `customers.termsDays` / `supplierTermsDays`, else settings |
| shipToText | text null | delivery address. Quote/SO/invoice: the customer's site. PO: where the supplier delivers (our address, or the customer's for drop-ship; see §6.2) |
| ownerId | uuid → users null | |
| projectId | uuid → projects null, set null | |
| salesOrderId | uuid → documents null | denormalised "job" link set on POs, receipts, invoices and deliveries that trace to one SO. Drives references and history notes (§8.4) |
| amountsAre | `amounts_are` default `exclusive` | |
| title, summary, terms | text null | quote fields → Xero Quote `Title` / `Summary` / `Terms` |
| remarks | text null | |
| internalNotes | text null | never leaves Gangway |
| subtotal, taxTotal, total | numeric(14,2) | recomputed server-side on every write (§4.7) |
| amountPaid, amountDue | numeric(14,2) default 0 | invoices and bills: pulled from Xero (§8.6) |
| fulfilment | text null | derived summary for lists: SO `to_order` / `on_order` / `ready` / `part_invoiced` / `invoiced`. Reserve invoice `to_deliver` / `delivered`. PO `to_receive` / `part_received` / `received` |
| version | integer default 1 | optimistic lock (replaces SAP's ETag) |
| issuedAt, closedAt, closedBy (`'auto'`/`'person'`), cancelledAt, cancelledById, cancelReason | | |
| xeroId, xeroStatus, xeroSyncState (set on insert: `local_only` for local types, else `pending`), xeroPushedVersion, xeroError, xeroAttempts, xeroLastAttemptAt, xeroSyncedAt, xeroUpdatedAt | | §8. `xeroUpdatedAt` is Xero's `UpdatedDateUTC`, for change detection |
| createdById, createdAt, updatedAt | | |

Indexes: `(type, status, docDate)`, `(partnerId, type)`, `(salesOrderId)`,
`(projectId)`, `(type, xeroSyncState)`, unique `(type, number)` where not
null, and unique `xeroId` where not null.

`document_lines`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| documentId | uuid → documents, cascade | |
| position | integer | text and subtotal rows inline |
| rowType | `row_type` default `item` | `alternative` only on quotes |
| itemId | uuid → items null | null = free-text line (still priced) |
| itemCode, unit | text null | snapshots |
| tracksStock | boolean | snapshot of `items.tracksStock` |
| description | text default '' | ≤4000 |
| note | text null | printed under the description (merged into the Xero `Description`) |
| quantity | numeric(14,4) | > 0 on item and alternative rows |
| unitPrice | numeric(14,4) | ≥ 0. Ex or inc per `amountsAre` |
| discountPercent | numeric(7,4) default 0 | 0–100 (Xero `DiscountRate`) |
| accountCode | text null | snapshot of the item's account, overridable per line |
| taxType, taxRate | text, numeric(7,4) | snapshot |
| lineAmount, taxAmount | numeric(14,2) | computed |
| baseLineId | uuid → document_lines null, restrict | copy-to source |
| sourceLineId | uuid → document_lines null, set null | PO line → the SO line it was raised for |
| *Derived counters (recomputed, never typed)* | numeric(14,4) default 0 | |
| qtyConverted | | quote line: drawn into SO or invoice lines |
| qtyOrdered | | SO line: on PO lines whose `sourceLineId` = this line (POs not cancelled) |
| qtyAllocated | | SO line: Σ active allocations (§4.5) |
| qtyInvoiced | | SO line: on invoice lines based on it |
| qtyDelivered | | SO line: delivered by normal invoices + deliveries. Reserve invoice line: on delivery lines based on it |
| qtyReceived | | PO line: on goods-receipt lines based on it |
| qtyBilled | | PO line: on bill lines based on it |

### 4.4 Copy-to and the counters

Allowed paths (`lib/sales/doc-types.ts#COPY_TO`, client-safe):

| From (open) | To | Counter moved on the source line |
|---|---|---|
| quote | sales_order, invoice | `qtyConverted` |
| sales_order | invoice (normal) | `qtyInvoiced` **and** `qtyDelivered` (stock goes out with the invoice) |
| sales_order | invoice (reserve) | `qtyInvoiced` only |
| reserve invoice | delivery | the invoice line's `qtyDelivered`, **and** the SO line's `qtyDelivered` when the invoice line traces to one (via `baseLineId`) |
| purchase_order | goods_receipt | `qtyReceived` |
| purchase_order | bill | `qtyBilled` |
| sales_order | purchase_order (raise) | `qtyOrdered` via `sourceLineId`, not `baseLineId` (raising a PO does not consume the SO line, as in SAP) |

Rules, from EduCom and SAP:

- Only item rows with room left on the relevant counter are offered, each
  defaulting to what is left. Alternatives are not copied. Text rows are
  copied. A subtotal row with nothing above it is dropped.
- The target line copies the item, description, note, unit, price, discount,
  account and tax, and sets `baseLineId`. The target inherits `amountsAre`,
  which is locked while any line has a base.
- The header copies partner, contact, ship-to, reference, owner, project and
  terms, and sets `salesOrderId`. Remarks get "Based on Quote QU-0042." /
  "From sales order SO-00017.".
- Partial quantities are fine. Going over what is left is refused on the
  server with "Only 3 left to invoice on SO-00017 line 2".
- **Duplicate** makes a same-type copy with no links and full quantities,
  starting as a draft.

**Counters are derived, never decremented by hand.**
`actions/documents-core.ts#recomputeCounters(tx, lineIds)` recalculates them
from the links. It counts child lines whose document is not `cancelled`.
Drafts count, so two drafts cannot claim the same quantity. It runs in the same
transaction as every write that adds, changes or cancels linked lines, and
running it twice is harmless. It then sets the source documents' `status` and
`fulfilment`:

| Document | Auto-closes (`closedBy='auto'`) when | Re-opens when a child is cancelled, if auto-closed |
|---|---|---|
| quote | every item row fully converted (sets `quoteOutcome='accepted'`) | yes |
| sales_order | every item row fully invoiced **and** (for stock lines) fully delivered | yes |
| reserve invoice | its delivery is complete (`fulfilment = delivered`). Its **status** follows Xero (open until paid) | n/a (fulfilment re-computes) |
| purchase_order | every item row fully received **and** fully billed | yes |

Edit guards: a line's quantity cannot go below its largest counter, and a line
with children cannot be deleted.

### 4.5 Stock: on hand, allocations, availability

Stock is tracked only for `tracksStock` items, at one location (Q2), as
quantities only (D4).

```
received(item)  = Σ goods_receipt lines (not cancelled)
delivered(item) = Σ normal-invoice lines (not cancelled, issued) + Σ delivery lines (not cancelled)
adjusted(item)  = Σ stock_adjustments.quantity                  (± corrections; admin only)
onHand          = received − delivered + adjusted
allocated       = Σ stock_allocations.quantity where releasedAt is null and not yet delivered
available       = onHand − allocated
```

`stock_allocations`:

| column | notes |
|---|---|
| id | uuid pk |
| salesOrderLineId | uuid → document_lines (SO line), cascade |
| itemId | uuid → items |
| quantity | numeric(14,4) > 0 |
| receiptLineId | uuid → document_lines null (where it came from, when auto-allocated) |
| releasedAt, releasedById | set when un-allocated by hand |
| consumed | numeric(14,4) default 0, the part already delivered against this allocation (recomputed) |
| createdById, createdAt | |

`stock_adjustments`: `id`, `itemId`, `quantity` (±), `reason`, `createdById`,
`createdAt`. Used for stocktakes and breakages. Admin only.

Allocation rules:

- **Auto-allocate on receipt.** When a receipt line is based on a PO line whose
  `sourceLineId` points at an SO line, allocate
  `min(received qty, SO line still needing allocation)` to that SO line. Any
  extra stays unallocated on hand.
- **Allocate by hand** on the SO: "Allocate from stock" shows `available` per
  line and lets the person allocate up to
  `quantity − qtyDelivered − qtyAllocated(active, unconsumed)`.
- **Release** an allocation (back to available) from the SO.
- **Delivering consumes allocations.** Posting a normal invoice line, or a
  delivery line, for a stock item consumes that SO line's allocations first.
  If what is allocated is less than what is going out, the action warns: "Only
  300 of 500 allocated to SO-00017. Invoice anyway, or make it a reserve
  invoice and deliver later?" The person can go ahead, and `onHand` may go
  negative. That is shown in red on the item, not blocked: the business keeps
  moving and the shortfall is visible.
- The derived SO line state (shown as a chip per line, and rolled up into
  `documents.fulfilment`):
  - `to_order`: stock line where `qtyOrdered + qtyAllocated < quantity − qtyDelivered`
  - `on_order`: the shortfall is covered by POs not yet received
  - `ready`: `qtyAllocated ≥ quantity − qtyDelivered`
  - `invoiced`: `qtyInvoiced = quantity` (still to deliver if it was reserve-invoiced)
  - `done`: `qtyInvoiced = quantity` and `qtyDelivered = quantity`

  Non-stock lines go straight from open to `invoiced`.

This is exactly "so I can see it either needs to be ordered or has been".

### 4.6 Statuses per type

These live in `components/ui/status.tsx` as `DOCUMENT_STATUS` (labels per type),
`FULFILMENT`, `QUOTE_OUTCOME` and `XERO_SYNC`.

| Type | draft | open | closed | cancelled | Fulfilment chip |
|---|---|---|---|---|---|
| quote | Draft | Sent (Xero SENT) | Accepted / Declined / Expired | Deleted | — |
| sales_order | Draft | Confirmed | Complete (auto) / Closed (by hand) | Cancelled | To order · On order · Ready · Part invoiced · Invoiced, to deliver |
| invoice | Draft | Awaiting payment; the UI derives Overdue and Part paid | Paid (from Xero) | Voided | reserve only: To deliver · Delivered |
| delivery | — (created open) | Delivered | — | Cancelled | |
| purchase_order | Draft | Ordered (Xero AUTHORISED) | Complete (auto: received + billed) / Closed (by hand) | Deleted | To receive · Part received · Received |
| goods_receipt | — (created open) | Received | — | Cancelled | |
| bill | Draft | Awaiting payment | Paid (from Xero) | Voided | |

Tones: draft `neutral`, open `info` (overdue or `to_order` `warn`), closed `ok`,
cancelled `muted`. They use `Badge` tones, which are reserved state colours.

Actions (`actions/documents.ts`):

| Action | From | Effect |
|---|---|---|
| `saveDocument` (create/update) | draft; open SO/PO within the guards; open invoice/bill header only (reference, owner, project, internal notes) | Writes locally in a transaction, recomputes totals and counters, bumps `version`, marks Xero `pending`/`stale` and pushes (§8). A stale `version` gives "This document changed after you opened it. Reload to see the latest." |
| `approveDocument` | draft invoice, PO or bill | Sets `open` and pushes Xero status AUTHORISED. Invoice confirmation: "Approve INV-0123 for Maple Street Kitchens, $1,650.00 inc GST, due 14 Nov? Its lines are locked once approved. Send it from Xero." Approving in Xero instead is also picked up (§8.6) |
| `markQuoteSent` / accept / decline | quote | Usually happens in Xero (sending sets SENT; the customer accepting online sets ACCEPTED) and is pulled back. Gangway also offers "Mark accepted" and "Mark declined", which push the status |
| `confirmOrder` | draft SO | open |
| `deleteDocument` | draft with no children | Local delete, plus Xero DELETED for Xero types |
| `closeDocument` / `reopenDocument` | open quote (declined/expired), SO, PO | by hand |
| `cancelDocument` | open (and a closed invoice or bill with nothing paid) | Refused while children are live ("Cancel GR-00009 first"). Invoice or bill refused while `amountPaid > 0` (EduCom rule: "has payments applied. Remove them in Xero first"). Xero: VOIDED (AUTHORISED) or DELETED (DRAFT). Counters and allocations recomputed |

Expiry is derived: an open quote past `dueDate` shows "Expired". There is no
job.

### 4.7 Totals (`lib/sales/totals.ts`, pure, shared by client and server)

Round half away from zero to the cent. Do not do money arithmetic in floats:
use integer cents/10⁻⁴ or a decimal helper. Per item row (alternative, text and
subtotal rows are not counted):

```
lineAmount = round2(quantity × unitPrice × (1 − discountPercent/100))
exclusive: taxAmount = round2(lineAmount × taxRate/100);          total = Σ lineAmount + Σ taxAmount
inclusive: taxAmount = round2(lineAmount × taxRate/(100+taxRate)); total = Σ lineAmount; subtotal = total − Σ tax
no_tax:    taxAmount = 0
```

This matches Xero's line-level rounding. After every push, Gangway compares its
total with Xero's returned `Total` and flags any difference (§8.5).

Validation (zod, `lib/sales/schemas.ts`):

- The partner must have the right flag (`isCustomer` / `isSupplier`). Offer
  "Mark Northwind as a supplier?" rather than a bare refusal.
- At least one item row (on a quote, at least one that is not an
  alternative).
- Text rows must not be empty, and a subtotal row needs an item row above it.
- Item rows: `qty > 0`, `price ≥ 0`, `discount` 0–100, a tax type unless
  `no_tax`, and an item or a description.
- `dueDate` is required on quotes, SOs and POs.
- Bills: `supplierInvoiceNumber` is required and unique per supplier.
- At most 300 lines. Optional fields go through the `optional*` helpers.

### 4.8 Numbering

- **Xero types** (quote, invoice, PO): Xero assigns the number when the
  document is first created in Xero as a DRAFT. Gangway never sends
  `QuoteNumber`, `InvoiceNumber` or `PurchaseOrderNumber`, and copies back what
  Xero returns. Until that first push succeeds, the document shows "Draft · not
  in Xero yet", with Retry. Bills are identified by the supplier's invoice
  number, which goes into the bill's `InvoiceNumber` (that is Xero's meaning of
  the field on ACCPAY).
- **Local types**: `number_series` (`key` pk: `sales_order` `SO-`,
  `goods_receipt` `GR-`, `delivery` `DN-`; columns `prefix`, `nextValue`,
  `padTo` default 5). Allocate inside the write transaction with
  `UPDATE number_series SET next_value = next_value + 1 WHERE key=$1 RETURNING prefix, next_value - 1, pad_to`.
  Admins can change the prefix and next value in Settings.

### 4.9 Transactions (D9)

Add `withTransaction<T>(fn: (tx) => Promise<T>)` to `src/lib/db/index.ts`:

- Production: `drizzle-orm/neon-serverless` with a `Pool` from
  `@neondatabase/serverless` (already a dependency, using Node 22's global
  WebSocket), created per call and ended in `finally`.
- Local: the existing node-postgres client's `.transaction`.

Reads keep using `getDb()` over HTTP. **Xero calls never happen inside a
transaction**: write locally, commit, then push.

---

## 5. Sales (phases A and C)

### 5.1 Quote (phase A)

- Fields per §4.3. Rows: item, alternative, text, subtotal.
- **Lifecycle**:
  1. Saving in Gangway creates or updates the Xero Quote as a DRAFT, and the
     number comes back.
  2. "Open in Xero" lets the person send it from Xero (which moves it to SENT).
  3. The customer accepts online, or someone marks it ACCEPTED in Xero or in
     Gangway. Gangway picks that up and sets `quoteOutcome = accepted`.
- **Convert**: "Convert to sales order" (primary once accepted) or "Invoice
  directly". Converting fully closes the quote. Xero already shows it ACCEPTED,
  and gets a history note: "Converted to sales order SO-00017 in The Gangway."
- Edits after SENT: allowed while the quote is open. Xero allows editing a sent
  quote, and the push updates it. The detail page warns: "Already sent. The
  customer has the earlier version until you resend from Xero."
- Actions: Save, Open in Xero, Mark accepted, Mark declined, Convert to sales
  order, Invoice, Duplicate, Close, Delete (draft), Save PDF to SharePoint
  (Xero's PDF, §9.2).

### 5.2 Sales order (phase A; fulfilment in phase B)

- Local only, numbered `SO-`. `dueDate` is "Delivery date".
- Header: customer, contact, customer reference (their PO number), ship-to,
  owner, project, remarks.
- **Lines table with fulfilment** (the reason the SO exists):

  `item · qty · ordered (PO links) · allocated · invoiced · delivered · state chip`

  Clicking "ordered" lists the PO lines. Clicking "allocated" lists the
  allocations with Release.
- Actions:
  - Confirm.
  - Edit, within the guards.
  - **Raise purchase orders** (phase B, §6.2).
  - **Allocate from stock** (phase B).
  - **Invoice**: copy to a normal invoice, offering "ready" quantities by
    default.
  - **Reserve invoice**: copy to an invoice with `isReserve`, offering
    everything not yet invoiced.
  - Duplicate, Close, Cancel.
- The SO list's default view is "Open orders", with the fulfilment chip as a
  column and a filter `fulfilment=to_order` ("Needs ordering"), which is a
  natural saved view.

### 5.3 Invoice (phase A; reserve in phase C)

- Created from an SO or a quote (copy-to), or blank (rare; a warning nudges
  toward an SO for stock items).
- Saving pushes a Xero ACCREC **DRAFT**, and the number comes back.
  **Approve** (in Gangway or Xero) makes it AUTHORISED and locks its lines.
  Xero sends it.
- `dueDate` = `docDate + termsDays`. Terms of 0 days are allowed (EduCom
  refused "immediate" terms only because of an SAP limitation).
- **Normal invoice**: posting it (approval) delivers the stock lines. This
  counts toward `delivered`, consumes allocations, and runs the shortfall
  warning from §4.5.
- Paid status is pulled from Xero (§8.6): amount paid, amount due, Paid.
- Actions: Save, Approve, Open in Xero, Void (refused while paid), Duplicate,
  Save PDF to SharePoint.

### 5.4 Reserve invoice (phase C)

- An invoice with `isReserve = true`, created from an SO ("Reserve invoice")
  or a quote. In Xero it is an ordinary ACCREC invoice: the customer is billed
  now.
- It **does not deliver**. Its lines count only toward `invoiced` on the SO.
  The reserve invoice shows "To deliver" until delivered.
- On approval, Xero gets the history note "Reserve invoice: goods to follow,
  delivery tracked in The Gangway (SO-00017)."
- **Deliver** (primary once stock is allocated) opens §5.5.
- It counts as closed off when every stock line is delivered
  (`fulfilment = delivered`). Its money status stays whatever Xero says.

### 5.5 Delivery (phase C)

- Local only, numbered `DN-`, created only from a reserve invoice ("Deliver"),
  as in EduCom.
- The page lists each stock line of the reserve invoice with invoiced, already
  delivered, allocated to the SO, and "delivering now" (default: the smaller of
  what is left and what is allocated). "Deliver all" fills every line.
- Created `open` (no draft) in one transaction. It recomputes the reserve
  invoice line and SO line `qtyDelivered`, consumes allocations, and recomputes
  fulfilment.
- Xero gets a history note on the invoice: "Delivered 500 × BC-500 (DN-00004)
  on 21 Oct 2026."
- Cancel: allowed. It reverses the counters and adds a Xero note "DN-00004
  cancelled".
- **Delivery docket**: Xero has no delivery document. Whether Gangway prints a
  simple packing slip is Q4. Default: no printout, the delivery is internal.

### 5.6 Lists and pages

Each list is a server component with `force-dynamic`, using
`TableShell/Table/Th/Td/Tr`, `FilterBar` and `SavedViews`. The entity keys are
`quotes`, `sales_orders`, `invoices`, `purchase_orders`, `receipts` and
`bills`.

- Columns: number (with "Draft" muted if not in Xero yet) · customer/supplier ·
  date · valid until / delivery / due · total (tabular-nums, right) · owner ·
  status · fulfilment (SO/PO/reserve) · Xero dot.
- Filters: `q` (number, partner, reference), `status` (default open + draft),
  `owner`, partner chip, `project`, `fulfilment`, `overdue=1`, `xero=failed`.
- 50 per page with `?page=`. Sorted by `docDate desc`.

Detail pages, two columns:

- **Left**:
  - header: kicker type, number, status, fulfilment chip, partner link, total;
  - one primary (Sunrise) next step: Convert / Raise POs / Invoice / Approve /
    Receive / Deliver;
  - secondary menu;
  - info as `DataRow`s, then lines, then totals.
- **Right**:
  - **Xero panel**: sync state, Xero number and status, "Open in Xero", last
    error with Retry, and the contact link if missing;
  - **Related documents** (bases up, children down, POs for an SO, allocations,
    payments from Xero);
  - activity.

**Editor**: one client `DocumentEditor` inside `ActionForm`.

- Header fields come from `form-kit`.
- The lines grid is controlled state serialised into a hidden `lines` JSON
  input, plus hidden `version` and `baseDocumentId`.
- Partner and item comboboxes are backed by server actions `searchPartners`
  and `searchItems`, in the style of `searchXeroForLink`.
- Choosing a customer fills the contact, ship-to and terms, and re-prices the
  eligible lines.
- Adding the same item again bumps its new, unbased line (EduCom).
- Rows: Text, Subtotal, and on quotes Item ↔ Alternative. Drag or arrow keys
  reorder.
- The "Amounts are" segmented control is locked when lines have bases.
- Totals preview comes from `totals.ts`. `beforeunload` guards unsaved edits.

`logActivity` on every action, with `customerId` and `projectId`, so it shows
on timelines. **Never `touchRecords()`**: paperwork is not a conversation.

Customer page:

- A "Sales" section (customers) and a "Purchasing" section (suppliers) in
  `RecordNav`: recent documents, open SOs with fulfilment, unpaid invoices
  (from the pulled Xero status), and New quote / New PO.
- The existing Xero balance panel stays.

Project page: a "Commercials" card listing documents with that `projectId`.

---

## 6. Purchasing (phase B)

### 6.1 Purchase order

- Xero PurchaseOrder. Saving pushes a DRAFT, and Xero assigns `PO-0031`.
- **Approve** (in Gangway or Xero) makes it AUTHORISED. **Send it from Xero.**
- Fields:
  - supplier;
  - contact (AttentionTo);
  - delivery date;
  - deliver-to (our address from settings by default; "Deliver to customer"
    copies the SO's ship-to for drop-ship, replacing EduCom's warehouse-902
    direct delivery);
  - reference (default "SO-00017 · Maple Street Kitchens" when raised from an
    SO, so Xero shows which job it is for);
  - delivery instructions (remarks);
  - owner (buyer).
- Prices default to `purchasePrice`. A missing price shows "No buy price set".
- Lines table with `received` and `billed` columns and the
  To receive / Part received / Received chip.
- Actions: Save, Approve, Open in Xero, **Receive**, **Enter bill**, Duplicate,
  Close, Cancel.

### 6.2 Raise purchase orders from a sales order

Replaces EduCom's "Orders" workspace, simplified.
`/purchasing/orders/raise?from=<soId>`:

- One row per SO stock line still `to_order` (and any purchasable line the
  person ticks). Each row shows: SO qty, already on PO, qty to order (default
  the shortfall), buy price (default `purchasePrice`), supplier (default
  `preferredSupplierId`, with type-ahead) and a "Raise" checkbox.
- Shortcuts: "Supplier for all lines", "Deliver to customer". Header: delivery
  date, remarks.
- **Review** groups the rows by supplier. **Create N purchase orders** creates
  one draft PO per supplier (up to 20) in **one transaction**:
  - each PO line gets `sourceLineId` → the SO line;
  - each PO gets `salesOrderId` and the default reference;
  - counters are recomputed.
- Each PO is then pushed to Xero, one after another. Each gets its number as
  it lands.
- This replaces EduCom's remark-text links, run/lock/resume tables and
  attempt-once checkpoints. All of those existed only because SAP writes
  weren't transactional.

### 6.3 PO edit rules (EduCom `purchase_orders.py`)

- The supplier can change only while nothing is received or billed.
- A line's quantity cannot go below `max(qtyReceived, qtyBilled)`.
- Only lines with nothing received or billed can be removed.
- Closed and cancelled POs cannot be edited.
- Edits to an AUTHORISED PO push to Xero. Xero allows editing authorised POs;
  if it refuses, the result is `failed` with Xero's message.

### 6.4 Goods receipt (booking stock in)

- Local only, numbered `GR-`, created from a PO ("Receive").
- The page shows each PO stock line with ordered, received so far, and
  "receiving now" (default: what is left). "Receive all" fills every line.
  Header fields: date, supplier docket number, remarks.
- Created `open` in one transaction. It recomputes `qtyReceived`, and
  **auto-allocates** to the SO lines (§4.5).
- Lines can be received regardless of billing. The page shows "Billed: 4471,
  paid" when a bill came first.
- Xero gets a history note on the PO: "Received 500 × BC-500 (GR-00009) on
  21 Oct 2026." When the PO is fully received, the note says "Fully received".
- Cancel: refused while any of its stock has been delivered. Otherwise it
  reverses the receipt and releases the allocations that came from it.
- The SO detail shows the line moving to "Ready", and the SO list's fulfilment
  updates.

### 6.5 Bill (supplier invoice)

- Xero ACCPAY, created from a PO with "Enter bill". Saving pushes a DRAFT.
  "Approve" makes it AUTHORISED, or accounts approve it in Xero (Q6 sets
  whether Gangway approves at all).
- Fields: supplier invoice number (required, unique per supplier), invoice
  date, due date (supplier terms), reference (default the PO number, e.g.
  "PO-0031"), and lines based on PO lines. Quantity and price may differ from
  the PO, because SAP allows variances. A variance hint is shown, not blocked.
- **"Goods arrived with this invoice"** checkbox: also creates a goods receipt
  for the same lines in the same transaction, with the bill number as the
  docket.
- Counts toward `qtyBilled`. When every PO line is fully billed, Gangway
  updates the Xero PO to **BILLED**, which matches what Xero does when a bill
  is copied from a PO in its own UI.
- Prepaying: the bill is paid in Xero. Gangway shows "Paid" when it pulls the
  status, and the receipt can come later.
- Actions: Save, Approve, Open in Xero, Void (refused while paid).

### 6.6 Lists

| List | Columns |
|---|---|
| POs | Number · Supplier · Reference (job) · Date · Delivery · Total · Received · Billed · Status |
| Receipts | Number · Supplier · PO · Date · Lines |
| Bills | Supplier inv # · Supplier · PO · Date · Due · Total · Due amount · Status |

---

## 7. Payments (phase C)

Default (D7): payments are recorded in **Xero**, where the bank feed is.
Gangway shows them, and keeps nothing it can't get from Xero.

- `xero_payments` (read model): `id`, `xeroPaymentId` unique, `documentId` →
  documents (invoice or bill), `date`, `amount`, `reference`, `accountCode`,
  `status` (`AUTHORISED` / `DELETED`), `pulledAt`.
- These rows are filled by the pull (§8.6) and by the import (§8.8). The
  invoice and bill detail pages list them under "Payments (from Xero)". The
  table and the detail-page card were built with the import (migration 0015),
  ahead of phase C; `/sales/payments` is still phase C. `amountPaid` and `amountDue` on the
  document come from Xero's own figures.
- `/sales/payments` is a read-only list of recent receipts with links into
  Xero. It is useful for "what came in this week" and replaces EduCom's
  incoming-payments list.
- If Q5 asks for in-Gangway entry, add "Record payment" on an invoice:
  `PUT /Payments` with `Invoice.InvoiceID`, `Account.Code` (the chosen bank
  account), `Date`, `Amount` and `Reference`, needing the `accounting.payments`
  scope.
  - One Xero payment per invoice.
  - Keep EduCom's rules: the balance is re-checked just before the write,
    partial payments are allowed up to the balance, and no invoice appears
    twice.
- Dropped from EduCom: split cash/card tenders (POS), SAP user default
  accounts, dummy card details, on-account receipts (those are prepayments in
  Xero).

---

## 8. Xero

### 8.1 Today

- `lib/xero/config.ts`: granular **read** scopes (`accounting.contacts.read`,
  `accounting.invoices.read`, `accounting.reports.aged.read`,
  `offline_access`).
- `auth.ts`: a singleton connection with encrypted, single-use refresh tokens.
- `client.ts`: GET-only `xeroFetch`, contact search and detail, and invoices
  per contact.
- `actions/xero.ts`: link `customers.xeroContactId`, with one Xero contact per
  record and no name matching.

### 8.2 Scopes (phase A)

Re-verify the names at
<https://developer.xero.com/documentation/guides/oauth2/scopes/>. Apps created
after 2 March 2026 must use granular scopes.

| Scope | For |
|---|---|
| `accounting.invoices` (replaces `.read`) | invoices, bills, **quotes**, **purchase orders**, **items** (all under the invoices scope in the granular set), and their history notes |
| `accounting.contacts` (replaces `.read`) | creating a Xero contact for an unlinked organisation |
| `accounting.settings.read` | `/Accounts`, `/TaxRates`, `/BrandingThemes` for the pickers |
| `accounting.payments.read` | pulling payments (`accounting.payments` instead if Q5 = record in Gangway) |
| keep `offline_access`, `accounting.reports.aged.read` | |

Rewrite the "Read-only throughout" comment in `config.ts`. Add `scope text` to
`xero_connection` (from the token response or the JWT `scope` claim). Add
`missingScopes` to `readXeroConnection()`. The settings panel then says
"Reconnect Xero to let The Gangway create documents", and pushes are `blocked`
until that is done.

### 8.3 Mapping per document

| Gangway | Xero | Created in Xero | Status mapping |
|---|---|---|---|
| quote | **Quote** `/Quotes` | on first save, DRAFT | sent in Xero → SENT (pulled); accepted → ACCEPTED (pulled or pushed); declined → DECLINED; converted → stays ACCEPTED plus a history note (try `INVOICED` when it is invoiced, and if Xero refuses the transition, leave it and log it); deleted/cancelled → DELETED |
| sales_order | none | never | history notes on the quote; referenced from PO, invoice and bill `Reference` |
| invoice (normal and reserve) | **Invoice ACCREC** `/Invoices` | on first save, DRAFT | approve → AUTHORISED; void → VOIDED (AUTHORISED, unpaid) or DELETED (DRAFT); PAID set by Xero; reserve and delivery state as history notes |
| delivery | none | never | history note on the reserve invoice |
| purchase_order | **PurchaseOrder** `/PurchaseOrders` | on first save, DRAFT | approve → AUTHORISED; fully billed → BILLED; cancel → DELETED; manual close → no Xero change, plus a note |
| goods_receipt | none | never | history note on the PO |
| bill | **Invoice ACCPAY** `/Invoices` | on first save, DRAFT | approve → AUTHORISED (per Q6); void → VOIDED/DELETED; PAID set by Xero |
| item | **Item** `/Items` | on save | untracked; `IsSold` / `IsPurchased` |

Line mapping (`lib/xero/mapping.ts`, pure):

| Gangway row | Xero `LineItems[]` |
|---|---|
| item | `{ Description: description + "\n" + note, Quantity, UnitAmount, DiscountRate, AccountCode, TaxType, ItemCode? }`. `ItemCode` when the item has `xeroItemId`. Account = line override → item → settings default |
| alternative (quote) | description-only `{ Description: "Optional: <desc> — $<amount>" }`, which carries no amount, so totals match |
| text | description-only `{ Description }` |
| subtotal | description-only `{ Description: "Subtotal $X" }` |

Headers:

- **Quote**: `{ Contact:{ContactID}, Date, ExpiryDate: dueDate, Reference, Title,
  Summary, Terms, LineAmountTypes, CurrencyCode:"AUD", Status, LineItems,
  BrandingThemeID? }`
- **ACCREC**: `{ Type:"ACCREC", Contact, Date, DueDate, Reference, LineAmountTypes,
  Status, LineItems, BrandingThemeID? }`
- **PurchaseOrder**: `{ Contact, Date, DeliveryDate: dueDate, DeliveryAddress:
  shipToText, AttentionTo: contactName, DeliveryInstructions: remarks, Reference,
  LineAmountTypes, Status, LineItems, BrandingThemeID? }`
- **ACCPAY**: `{ Type:"ACCPAY", InvoiceNumber: supplierInvoiceNumber, Reference:
  PO number, Contact, Date, DueDate, LineAmountTypes, Status, LineItems }`

Dates are `YYYY-MM-DD`. Send `?unitdp=4`.

### 8.4 Making Xero readable ("someone could go into Xero and know what's going on")

- **Reference** carries the job:
  - invoice: `"<customer ref> · SO-00017"` (or just `"SO-00017"`);
  - PO: `"SO-00017 · <customer name>"`;
  - bill: `"PO-0031"`.

  Truncate to Xero's field limit, keeping the SO number.
- **History notes** (`PUT /<Resource>/{id}/History` with `{ HistoryRecords:[{ Details }] }`)
  record every local-only event against the Xero document it belongs to:

| Event | Note goes on | Example |
|---|---|---|
| quote converted | quote | "Converted to sales order SO-00017 in The Gangway." |
| PO raised for an SO | PO | "Raised for SO-00017 (Maple Street Kitchens)." |
| goods received | PO | "Received 500 × BC-500 (GR-00009) on 21 Oct 2026. Fully received." |
| reserve invoice approved | invoice | "Reserve invoice: goods to follow. Delivery tracked in The Gangway (SO-00017)." |
| delivery | reserve invoice | "Delivered 500 × BC-500 (DN-00004) on 21 Oct 2026. All goods delivered." |
| receipt/delivery cancelled | same | "GR-00009 cancelled." |

  Notes are best-effort. A failed note is logged and retried, and never blocks
  anything. Confirm the History endpoint for Quotes and PurchaseOrders when
  building.
- Gangway never writes Xero tracking categories or custom fields. Xero has no
  custom fields.

### 8.5 Push mechanics

`lib/xero/client.ts` gains `xeroSend<T>(method, path, body, { idempotencyKey })`.
It parses Xero's 400 `Elements[].ValidationErrors[].Message` and honours
`Retry-After`. Per-type push functions live in `lib/xero/push.ts`, and
user-facing actions in `actions/xero-sync.ts`.

1. **Trigger.** A save, approve, void or cancel commits locally with
   `xeroSyncState = 'pending'` (or `stale`). Then, after the commit:
   - **First push of a Xero-type document** runs **inline** (awaited), so the
     person lands on the page with Xero's number. If Xero fails or is slow
     (timeout of about 8s), the page still saves and shows "Draft · not in Xero
     yet · Retry".
   - **Later pushes** (edits, status changes, notes) run with `after()` from
     `next/server`, so the person doesn't wait. Check the Next 16 docs in
     `node_modules/next/dist/docs`.
2. **Claim**:
   `UPDATE documents SET xero_sync_state='pushing', xero_last_attempt_at=now() WHERE id=$1 AND xero_sync_state IN ('pending','stale','failed') AND (xero_last_attempt_at IS NULL OR xero_last_attempt_at < now()-interval '2 minutes') RETURNING version`.
   No row means someone else has it.
3. **Preconditions** (a failure sets `blocked` with a fix-it message):
   - Xero connected and scopes present.
   - Partner has `xeroContactId`. If not, the panel offers the existing link
     search and **Create in Xero**: `POST /Contacts` with `Name`,
     `EmailAddress`, `TaxNumber` (the ABN) and the address. Search by name
     first and warn on a clash, since Xero names are unique. Never auto-link
     by name.
   - Every line has an account and a tax type.
4. **Create** (`xeroId` null): `PUT` with
   `Idempotency-Key: gw-<documentId>-v<version>` (confirm the header when
   building).
   - **Lost-response recovery**: Gangway does not know the number in advance,
     so it stamps each create with a marker and finds it by that. Before
     re-creating after an unknown outcome (timeout, network error or 5xx), read
     back recent drafts for the contact (`where=Contact.ContactID==Guid(…) AND
     Status=="DRAFT"`, ordered by `UpdatedDateUTC DESC`) and match on the
     marker.
     - Quotes and POs: the marker is `Reference` ending with
       ` · gw:<first 8 of documentId>`.
     - Invoices and bills: a first history note `gw:<documentId>`, or the
       reference marker.

     That makes duplicates impossible. The equivalent of EduCom's "settle by
     reading back, never by re-sending".
5. **Update** (`xeroId` set): `POST /<Resource>/{xeroId}` with the full payload.
   Locked documents (paid, voided) are refused by Xero and become `failed`.
6. **Success**: store `xeroId`, `number` (first time), `xeroStatus`,
   `xeroPushedVersion`, `xeroUpdatedAt` and `xeroSyncedAt`, and reset the
   error and attempts. If `version` moved on during the push, set `stale` and
   queue again. Compare Xero's `Total` with ours, and log a difference to
   `xero_sync_log` shown on the panel.
7. **Failure**:
   - 400 → `failed`, no auto-retry; the message is shown.
   - 401 → `blocked` (reconnect).
   - 429 → `failed` with `Retry-After`.
   - 5xx or network → `failed` and auto-retried.
8. **Retry**: a Retry button on the panel, plus
   `src/app/api/cron/xero-sync/route.ts` (`CRON_SECRET`, `vercel.json` every 5
   minutes).
   - The cron picks up `pending`, `stale`, retryable `failed`, and unwritten
     history notes.
   - Backoff is 1, 5, 15 and 60 minutes; it stops after 6 attempts.
   - At most 40 calls per run, serially, never `Promise.all` writes. Xero
     allows 60 calls a minute, 5,000 a day and 5 concurrent.
9. **Log**: `xero_sync_log` (`entityType`, `entityId`, `action`,
   `httpStatus`, `xeroId`, `message`, `durationMs`, `createdAt`). No payloads.
   Pruned after 90 days.

Never push a local-only type. Never send numbers to Xero. Never retry a 400
without a change.

### 8.6 Pull (Xero → Gangway)

Gangway owns lines and quantities. Xero owns numbers, sent/approved status and
money. The pull reads:

- **Changed documents**: `GET /Quotes`, `/Invoices` and `/PurchaseOrders` with
  `If-Modified-Since: <last pull>` (and `where` on the known IDs where that's
  cheaper). The cron runs this every 5 minutes. It also runs on opening a
  document's or a customer's Xero panel, and from "Refresh from Xero" on lists.
  For each Gangway-linked document:
  - Store `xeroStatus` and `xeroUpdatedAt`.
  - Quote SENT, ACCEPTED or DECLINED → set Gangway's outcome. Accepted makes
    "Convert to sales order" the primary action.
  - Invoice, PO or bill moved DRAFT → AUTHORISED in Xero (approved there) →
    set Gangway `open` and lock the lines. Approving a normal invoice also
    triggers its stock delivery (§5.3).
  - Invoices and bills: copy `AmountPaid` and `AmountDue`. PAID → `closed`.
    Replace the document's `xero_payments` rows with `Payments[]`
    (`lib/xero/payments.ts`) — only when Xero sent the list, so a summary
    response never reads as "every payment was removed". The invoice pull
    therefore does not use `summaryOnly`.
  - VOIDED or DELETED in Xero while open in Gangway: do **not** mirror it
    automatically. Set `failed` with "Voided in Xero but still open here. Void
    it here too, or re-push." A person decides.
  - Line or total edits made in Xero: not pulled. If Xero's `Total` differs,
    show "Changed in Xero ($X there, $Y here). Re-push to overwrite, or edit
    here to match."
- **Webhooks** (optional, phase C): Xero offers webhooks for invoices and
  contacts (confirm the current event list). If they're configured
  (`XERO_WEBHOOK_KEY`, `src/app/api/xero/webhook/route.ts` with HMAC check and
  Xero's intent-to-receive handshake), invoice events trigger an immediate
  pull. Quotes and POs still rely on polling.

### 8.7 Settings → "Sales & Xero" (admin)

- Default accounts: sales, purchases (picker over Xero `/Accounts`).
- Default tax types: sales and purchases.
- Default branding themes: quote, invoice and PO (`/BrandingThemes`).
- Whether Gangway may approve bills (Q6).
- Our delivery address (PO deliver-to default) and default terms (customers,
  suppliers, quote validity).
- Local number series (SO, GR, DN).
- Sync health: counts of `failed` and `blocked` with links, last pull time and
  Reconnect.

### 8.8 Import from Xero (Q11)

Q11 is answered: **existing Xero records are imported** rather than starting
fresh. `/sales/import` (staff only; writes need a member) has three steps, in
the order they depend on each other. Each step reads Xero live and shows what
would happen before anything does, so the screen is its own dry run.

**The rule that matters: importing reads Xero and writes only to The
Gangway.** Everything under `lib/xero/import/` reaches Xero through
`xeroGet()` (GET only — there is no method to get wrong). An imported
document lands `xeroSyncState = 'synced'` with `xeroPushedVersion = version`,
and an imported item lands `synced`: the one state the push engine's claim and
the cron leave alone. No push, queue or history note is called. Editing an
imported document afterwards is an ordinary edit and pushes like one; that is
the workflow carrying on. An imported quote keeps its Reference as Xero had it
(no `gw:` marker: that only serves lost-create recovery).

1. **Contacts → business partners.** Every active Xero contact, with a
   suggested partner (`lib/xero/import/match.ts`, pure and tested):
   - stored `xeroContactId` → **linked**;
   - else exactly one unlinked partner with the same 11-digit **ABN**;
   - else exactly one with the same **email**;
   - else exactly one with the same normalised **name** ("Pty Ltd",
     punctuation and case ignored) — shown as "Name only — check", never
     preselected and never applied in bulk.

   A partner already linked to a different contact is never suggested (one
   ContactID ↔ one partner). Per row: **Link** (through `linkXeroContact` in
   `actions/xero.ts`, which enforces that rule; Xero's customer/supplier flags
   are added, never removed), **Create** a partner from the contact (name, ABN,
   email, phone, street address, website, flags from Xero, already linked; a
   contact that is neither starts as a customer), or **Skip**
   (`xero_import_skips`, undoable). "Link N ABN and email matches" applies the
   strong suggestions in one go. Creating or linking never writes the contact
   back to Xero.
2. **Items.** `GET /Items`, keyed by `ItemID`, then by `Code` (unique index on
   `items.xero_item_id`). Xero's fields are copied (code, name, descriptions,
   prices, accounts, tax types, sold/purchased); Gangway's own (`tracksStock`,
   unit, usual supplier) are kept. An item saved here that has not reached Xero
   yet is left alone, and a code linked to a different Xero item is shown as a
   clash. Re-running updates in place.
3. **Quotes and invoices.** Scope: **open in Xero** (default: quotes DRAFT,
   SENT, ACCEPTED; ACCREC DRAFT, SUBMITTED, AUTHORISED), **dated between**
   (any live status, paid included), or **by number** ("INV-0028"). Deleted and
   voided documents, ACCPAY bills and non-AUD documents are never imported.
   Each row shows what will happen:
   - **New**: inserted with Xero's number, status, lines, totals, amount
     paid/due and payments (`lib/xero/import/map.ts`, pure and tested). Status
     follows §4.6: quote SENT → open, ACCEPTED → open + accepted (so "Convert
     to sales order" leads), INVOICED → closed accepted, DECLINED → closed;
     invoice SUBMITTED → draft, AUTHORISED → open, PAID → closed. A line with
     no quantity and no price becomes a text row; item rows link to the item
     with the same code. Totals are recomputed with Gangway's arithmetic and
     Xero's total is kept in `xeroTotal`, so a difference shows on the page.
     A quote without an expiry gets `docDate + quoteValidityDays`.
   - **Update from Xero**: imported before and untouched since (`updatedAt <=
     importedAt`, still `synced`, and nothing drawn from it) — header, lines,
     money and payments are refreshed in one transaction, and `version` is
     bumped so an open editor is told to reload.
   - **Already here**: made in Gangway, or worked on since import, or has a
     sales order or invoice drawn from it. Gangway owns its lines (§8.6), so
     only the pull's rules apply (`applyQuote` / `applyInvoice`) plus payments.
   - **Contact not matched**: waits for step 1, with a link to that contact.

   Imported documents carry `documents.importedAt` and say so in their Xero
   panel. They continue the flow with the ordinary copy-to (quote → sales
   order → invoice). Every document is its own transaction; a failure is
   reported and the rest carry on.

**Purchasing (phase B) plugs in without touching the engine:** add
`"purchase_orders"` and `"bills"` to `IMPORT_SOURCE_KEYS`
(`lib/xero/import/scope.ts`), a `normalisePurchaseOrder` beside
`normaliseQuote` in `map.ts` (`normaliseInvoice` already returns `bill` for
ACCPAY), a status rule in `gangwayState`, and an entry in `IMPORT_SOURCES`
(`sources.ts`). `documents.ts` works only on `ImportedDoc`. Bills keep the
supplier's invoice number in `supplierInvoiceNumber`, not `number`.

---

## 9. UI, routes, files

### 9.1 Navigation

`nav.tsx` gains two sections between Pipeline and Delivery:

```
Sales        Quotes · Sales orders · Invoices · Payments · Items
Purchasing   Purchase orders · Receipts · Bills
```

Rail badges:

- Sales orders: count of `to_order` (lines needing ordering).
- Invoices: overdue (from the pulled `amountDue` and `dueDate`).

⌘K gains New quote / New PO and number search (`QU-`, `SO-`, `INV-`, `PO-`,
`GR-`, `DN-`).

### 9.2 Routes

All server components with `force-dynamic`, under `src/app/(app)/`:

| Route | Phase |
|---|---|
| `/sales/quotes` · `/new` · `/[id]` · `/[id]/edit` | A |
| `/sales/orders` · `/new` · `/[id]` · `/[id]/edit` · `/[id]/allocate` | A (allocate B) |
| `/sales/invoices` · `/new?from=&reserve=1` · `/[id]` · `/[id]/edit` | A (reserve C) |
| `/sales/deliveries/new?from=<invoiceId>` · `/sales/deliveries/[id]` | C |
| `/sales/payments` | C |
| `/sales/items` · `/new` · `/[id]` | A |
| `/purchasing/orders` · `/new` · `/[id]` · `/[id]/edit` · `/raise?from=<soId>` | B |
| `/purchasing/receipts/new?from=<poId>` · `/purchasing/receipts` · `/[id]` | B |
| `/purchasing/bills` · `/new?from=<poId>` · `/[id]` · `/[id]/edit` | B |
| `/api/documents/[id]/xero-pdf`: streams Xero's own PDF (`GET /<Resource>/{id}` with `Accept: application/pdf`; confirm per resource), used for "Save PDF to SharePoint" and "View PDF" | A |
| `/api/cron/xero-sync`, `/api/xero/webhook` | A (cron), C (webhook) |
| `/sales/import` (tabs: contacts, items, documents): Import from Xero (§8.8), staff only | Q11 |

One implementation serves them all: `components/app/documents/` holds
`DocumentList`, `DocumentDetail`, `DocumentEditor`, `LinesEditor`,
`PartnerPicker`, `ItemPicker`, `TotalsBox`, `RelatedDocuments`, `XeroPanel` and
`FulfilmentChip`, each configured by `lib/sales/doc-types.ts`. That module
(client-safe) holds per type: labels, `dueDate` meaning, row types, partner
side, route base, copy targets, Xero resource, local or Xero numbering.

**"Save PDF to SharePoint"**: fetch Xero's PDF, upload it to the customer's (or
project's) SharePoint folder with the existing delegated Graph helpers, and pin
it in `pinned_files`. Gangway renders no customer PDFs of its own (D2), so
there is no PDF library.

### 9.3 EduCom behaviours: keep or drop

**Kept**:

- Quote → Order → Invoice copy-to with partial quantities.
- Reserve invoice → Delivery.
- SO → POs per supplier.
- PO edit rules against received quantities.
- Duplicate.
- Text, subtotal and alternative rows, and line notes.
- Re-price only new, unbased, unedited lines.
- The same item added twice bumps its quantity.
- Lines locked once an invoice is approved.
- Void refused while paid.
- Optimistic concurrency.
- Confirmations that name the consequence.
- Missing buy price shown, never guessed.
- `beforeunload` guard.

**Changed**:

- Numbers come from Xero (or Gangway series for local documents).
- Documents are sent from Xero, not emailed from Gangway.
- Goods receipts and bills are created in Gangway (EduCom left them to SAP),
  and bill and receipt are independent of each other.
- Stock allocation to SO lines is explicit (EduCom used serial allocation).
- SO ↔ PO links are FKs, not remark text.
- Payments come from Xero.

**Dropped**:

- Warehouses, serial and batch numbers.
- Stock transfers, transfer requests and consignments.
- Store branding by warehouse.
- S02/S04 price lists and SAP special prices.
- Document-level discount.
- Returns, credit notes and down payments.
- Repairs links and the Return/Credit form.
- The relationship-map graph, Link Document and favourites.
- Serial search.
- Gangway-rendered PDFs and email.
- Daily banking and split POS tenders.
- SAP user defaults.
- PO batch ZIP and bulk delivery mapping.
- SAP Service Layer workarounds.

### 9.4 Files by kind

| File | Kind | Exports |
|---|---|---|
| `lib/sales/{doc-types,totals,money,schemas,fulfilment}.ts` | plain, client-safe | config, totals, zod schemas, `lineState()` |
| `lib/data/{items,documents,stock,xero-cache}.ts` | server-only | lists, detail, copy drafts, `stockFor(itemIds)`, `allocationsFor(soId)`, cached accounts and tax rates |
| `lib/actions/documents-core.ts` | `server-only` (**not** `"use server"`) | `allocateNumber`, `recomputeTotals`, `recomputeCounters`, `recomputeFulfilment`, `queueXeroPush` |
| `lib/actions/{documents,items,stock,purchasing,sales-settings,xero-sync}.ts` | `"use server"` | the actions named in §4–§8 |
| `lib/xero/{mapping,push,pull}.ts` | server | payload builders, push engine, pull |
| `lib/auth/session.ts` | | add `requireMember()` (admin or member) for all document, stock and item writes; settings use `requireAdmin()` (Q9) |

---

## 10. Build phases

Each phase is one session in its own worktree. All must pass
`npx tsc --noEmit && npx eslint . && npm run build`, plus `npm test` once phase
A adds it (`"test": "tsx --test src/**/*.test.ts"` with `node:test`, no new
dependency). Each phase:

- adds a migration;
- extends `scripts/seed.ts` with demo documents (removed by `--clean`). Seeded
  Xero-type documents stay `pending` (no number yet) unless a Xero demo company
  is connected;
- updates README (features, env vars, Xero scopes).

Test against the **Xero demo company**, never the live organisation.

**Phase order.** Xero is now part of the core, because numbers come from it.
So the push engine moves into phase A, and the phases follow the workflow.

### Phase A: foundation, Xero write path, items, quote → sales order → invoice

Build:

- **Schema**:
  - the enums;
  - `items`;
  - `documents` and `document_lines`, including every counter column, so B
    and C add no columns to them;
  - `stock_allocations` and `stock_adjustments` (tables only, used in B);
  - `number_series` (seeded with SO, GR, DN);
  - `xero_sync_log` and `xero_cache`;
  - on `customers`: `termsDays`, `supplierTermsDays`;
  - on `settings`: default accounts, tax types, branding themes, delivery
    address, terms, quote validity;
  - `xero_connection.scope`.
- `withTransaction`, `requireMember`.
- **Xero**: scopes plus a reconnect prompt, `xeroSend`, accounts, tax rates and
  branding cache, contact create/link from the document panel, push engine
  (§8.5) with inline first push and `after()` later pushes, pull (§8.6, minus
  payments and webhooks), cron route, history notes.
- **Items**: CRUD with Xero account and tax pickers, item sync to Xero.
- **Quotes**: everything in §5.1.
- **Sales orders**: everything in §5.2 except Raise POs and Allocate. The
  fulfilment columns show ordered and allocated as 0 and `to_order` for stock
  lines.
- **Invoices**: normal invoices from SO or quote (§5.3), with approve, void,
  paid status from the pull, and stock delivery counting.
- Lists, detail, editor, Xero panel, related documents, nav, ⌘K, customer and
  project sections, settings section, "Save Xero PDF to SharePoint".
- Tests: totals (exclusive, inclusive, no tax, discounts, rounding), copy
  drafts and counters, Xero payload mapping (rows, alternatives, references).

Done when, against the Xero demo company:

1. An admin reconnects Xero with the new scopes. The item form's account and
   tax pickers show Xero's accounts. Saving an item creates it in Xero with
   those accounts.
2. Saving a new quote creates a Xero DRAFT quote, and Gangway shows Xero's
   number (e.g. QU-0042).
   - Sending it from Xero shows "Sent" in Gangway after a refresh, or within
     5 minutes.
   - Marking it accepted in Xero makes "Convert to sales order" primary.
3. Converting creates SO-00001 with a partial line. The quote stays open with
   the remainder, and closes as accepted when the rest is converted. The Xero
   quote gets a history note.
4. Invoicing the SO creates a Xero DRAFT ACCREC whose number appears in
   Gangway, with Reference containing SO-00001, and lines, accounts, tax and
   total identical to the cent for exclusive, inclusive and no-tax documents.
   Approving (in Gangway, or in Xero then refreshing) locks it.
5. Paying it in Xero shows Paid in Gangway after a refresh.
6. Guards hold:
   - over-converting is refused;
   - deleting a converted line is refused;
   - voiding a paid invoice is refused;
   - two tabs editing the same document get "changed since you opened it";
   - a viewer cannot write.
7. Failure handling:
   - An unlinked customer gives `blocked` with a working "Create in Xero".
   - A bad account code gives `failed` with Xero's message, and Retry works.
   - Killing the network on the first push and retrying creates no duplicate
     in Xero.
   - Disconnecting Xero never stops a document from saving or opening.
8. SOs never call Xero. No document action calls `touchRecords`.

### Phase B: purchasing, receiving, allocation

Build:

- POs (§6.1) as Xero PurchaseOrders.
- Raise POs from an SO (§6.2).
- PO edit rules (§6.3).
- Goods receipts with auto-allocation (§6.4).
- Bills with "Goods arrived with this invoice" and BILLED on the PO (§6.5).
- Allocate from stock and Release on the SO (§4.5).
- Stock on hand, allocated and available on items, with admin adjustments.
- SO fulfilment chips, live.
- Shortfall warning on normal invoices.
- Purchasing nav, lists and customer "Purchasing" section.
- History notes for PO raised and goods received.
- Tests: PO edit rules, receipt counters and auto-allocation, the bill and
  receipt independence matrix, `lineState()`.
- Import from Xero for Purchase Orders and Bills (ACCPAY), through the seams
  in §8.8, so existing POs (e.g. PO-0011, paid and shipped, not yet received)
  can be received in Gangway.

Done when:

1. From an SO with two stock lines from different suppliers, "Raise purchase
   orders" creates two Xero DRAFT POs (Xero numbers shown, Reference
   "SO-0000x · customer"). The SO shows both lines "On order".
2. All three orders of events work and leave the counters right:
   - **PO A**: bill first (prepaid in Xero, shows Paid), receive later.
   - **PO B**: receive in two partial receipts, then bill.
   - **PO C**: bill with "Goods arrived" ticked.
3. Receipts auto-allocate. The SO lines move to "Ready". The Xero PO carries
   "Received …" notes and becomes BILLED when fully billed. The PO closes
   when it is received and billed.
4. Hand allocation from on-hand stock and Release work. `available` is right
   on the item page.
5. Invoicing a line with only part allocated shows the shortfall warning.
6. Guards hold:
   - the supplier is locked after the first receipt or bill;
   - a quantity can't drop below received or billed;
   - a receipt whose stock was delivered can't be cancelled;
   - a duplicate supplier invoice number is refused.

**As built (2026-10-18, migration 0016).** Additions and decisions beyond
the list above:

- **Courier tracking.** `shipments` (carrier, tracking number and link, sent,
  ETA, notes, `receiptId`), several per PO. Links are built from the carrier
  (`lib/sales/carriers.ts`) or typed for "Other". A shipment is in transit
  until a receipt closes it or the PO is fully received; past its ETA it says
  so. It shows on the PO, on the sales lines the PO was raised for, and as a
  chip on the SO, PO and invoice lists. Adding one writes a Xero PO history note.
- **Demand lines.** A PO line's `sourceLineId`, and `stock_allocations`
  (column still named `sales_order_line_id`), may point at a sales-order line
  **or a reserve-invoice line**, for an invoice raised before the stock was
  bought with no order behind it. Allocations are consumed oldest first as the
  demand line's `qtyDelivered` grows (`recomputeConsumption`).
- **Reserve invoices and deliveries (§5.4–5.5) pulled forward** so an invoice
  paid in Xero before the goods were bought can be carried through:
  "Goods to follow" on any invoice with stock lines (and back while nothing
  is delivered, ordered or allocated), linking a PO to an invoice makes it
  reserve, and Deliver makes a DN- with its Xero note and cancel.
- **Import (§8.8) covers POs and bills.** PO statuses: DRAFT/SUBMITTED → draft,
  AUTHORISED/BILLED → open. A PO Xero calls BILLED counts as billed with or
  without a bill here. "Open" POs include BILLED ones from the last 120 days.
  Bills are found by supplier number or by a PO number in their Reference, and
  a bill whose Reference names exactly one of the supplier's POs is entered
  against it at import. Linking or adding a shipment marks a document as
  worked on here, so re-imports only refresh its Xero status.
- **Stock.** Invoices imported from Xero are not counted as stock going out —
  those goods left before The Gangway counted stock. A PO whose items are not
  physical goods is still received line by line. Switching an item to
  physical goods updates its lines on live documents; linking a PO or marking
  goods to follow refreshes the flag on those documents, paid ones included.
- **Pull** reads POs (`If-Modified-Since` listing, or one by one) and bills
  with invoices.

### Phase C: reserve invoices, deliveries, payments, hardening

Build:

- Reserve invoices (§5.4).
- Deliveries (§5.5), including history notes and the delivery docket if Q4 says
  yes.
- Payments read model and list (§7), and "Record payment" if Q5 says yes.
- Invoice webhooks (optional).
- Sync health in settings.
- Saved views: "Needs ordering", "Ready to invoice", "To deliver", "Xero
  problems".
- README.

Done when:

1. From an SO whose stock hasn't arrived, a reserve invoice goes to Xero (as a
   normal ACCREC, with its "goods to follow" note) and can be sent and paid
   there, while the SO shows "Invoiced, to deliver".
2. After the PO is received and allocated, "Deliver" on the reserve invoice
   creates DN-00001. The reserve invoice shows Delivered and gets its Xero
   note. The SO completes when it is fully invoiced and fully delivered.
3. Cancelling the delivery reverses everything.
4. Payments made in Xero appear under the invoice and in `/sales/payments`.
5. The cron clears a backlog of failed pushes within the rate limit. Sync
   health shows zero problems after a clean run.

---

## 11. Out of scope (later)

- Credit notes and refunds (AR and AP).
- Customer price lists.
- Multi-currency.
- Recurring invoices: Xero `RepeatingInvoices` are read-only via the API.
- A sales dashboard: quoted against won, invoiced by month, on `--chart-*`.
- Bulk actions on lists.
- Bills with no PO: those are entered in Xero.
- Stock valuation.
- Multiple stock locations.

---

## 12. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | **Which Xero accounts** are the defaults: sales income (`200 Sales`?) and purchases (`310 Cost of Goods Sold` or `300 Purchases`)? Do some items need their own (e.g. print vs hardware vs services income)? | Admin picks the defaults in settings. Items override where set |
| Q2 | **One stock location** (the office), or do suppliers sometimes ship straight to the customer, so stock is "received" at the customer's site? | One location. Drop-ship POs are received in Gangway like any other (it just means "it's arrived") |
| Q3 | **Stock held between jobs**: is stock mostly bought per job (expense the bill to cost of goods, as now) or do you hold shelf stock worth carrying as an asset (inventory account on the bill, journal to cost of goods when sold)? | Per job: bill lines go to the item's purchase account (cost of goods), and Gangway tracks quantities only |
| Q4 | **Delivery docket**: Xero has no delivery document. Do you need a packing slip or proof of delivery to hand over with the goods? | No. Deliveries are internal records with a Xero note |
| Q5 | **Recording payments**: always in Xero (bank feed), or do you also want "Record payment" in The Gangway (pushed to Xero against the invoice)? | Xero only, shown in Gangway |
| Q6 | **Bill approval**: should Gangway approve supplier bills, or leave them as Xero drafts for whoever does accounts to approve in Xero? | Gangway can approve. A setting can turn it off |
| Q7 | **Bills without a PO** (subscriptions, ad-hoc purchases): keep entering those directly in Xero? | Yes. Gangway only does bills against its POs |
| Q8 | **Customer-specific pricing**: one price per item, or price lists per customer? | One price per item |
| Q9 | **Who can do what**: may every member approve invoices and POs, or should approval be limited (e.g. an Entra app role `CRM.Finance`)? | Members can do everything except settings. Viewers read only |
| Q10 | **Approve in Gangway or Xero?** Are invoices usually approved in Xero by someone else, or by the person raising them? | Both work. Gangway shows Approve, and approving in Xero is picked up |
| Q11 | **Existing Xero quotes, invoices and POs**: import open ones into Gangway at go-live, or start fresh? | **Answered: import.** Existing Xero records are brought in so the workflow carries on from them (e.g. INV-0028 for Mister Fixed, already paid, whose mat is on PO-0011). See §8.8 |
| Q12 | **Projects**: should invoicing be driven from projects (deposits and milestones), beyond the optional project link? | Optional link and a "Commercials" card only |
