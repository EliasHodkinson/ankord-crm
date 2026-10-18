"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Lock,
  Plus,
  Sigma,
  StickyNote,
  Trash2,
  Type,
} from "lucide-react";
import { ActionForm, SubmitButton, useFormResult } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, Button } from "@/components/ui/button";
import {
  CheckboxField,
  FormRow,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/app/form-kit";
import { AMOUNTS_ARE } from "@/components/ui/status";
import { SearchBox } from "./search-box";
import {
  loadPartnerDefaults,
  saveDocument,
  searchItems,
  searchPartners,
  type PartnerOption,
} from "@/lib/actions/documents";
import type { PartnerDefaults, EditorHeader } from "@/lib/data/documents";
import type { PricedItem } from "@/lib/data/items";
import { DOC_TYPES, type DocType } from "@/lib/sales/doc-types";
import { computeTotals, type AmountsMode } from "@/lib/sales/totals";
import { formatMoney, formatQty, num } from "@/lib/sales/money";
import { addDays } from "@/lib/sales/dates";
import { accountLabel, taxLabel, type XeroAccountRef, type XeroTaxRateRef } from "@/lib/sales/xero-refs";
import { cn } from "@/lib/utils";

/**
 * One editor for every document type, configured by lib/sales/doc-types.
 *
 * The lines grid is controlled state, serialised into a hidden `lines` input.
 * That state lives here, *outside* ActionForm, because ActionForm remounts
 * its <form> after a failed submit to restore typed values — anything kept
 * inside it would be lost with the remount.
 */

export type EditorLine = {
  key: string;
  id?: string;
  rowType: "item" | "alternative" | "text" | "subtotal";
  itemId: string | null;
  itemCode: string | null;
  unit: string | null;
  description: string;
  note: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  accountCode: string | null;
  taxType: string | null;
  baseLineId: string | null;
  /** The most this line may draw from its source (copy-to). */
  maxQuantity: string | null;
  /** The most already drawn from this line by other documents (edit guard). */
  drawn: number;
  priceMissing?: boolean;
};

export type EditorProps = {
  type: DocType;
  documentId: string | null;
  isReserve?: boolean;
  version: number | null;
  header: EditorHeader;
  lines: EditorLine[];
  partner: PartnerDefaults | null;
  team: { id: string; name: string }[];
  projects: { id: string; name: string; customerId: string }[];
  accounts: XeroAccountRef[];
  taxRates: XeroTaxRateRef[];
  defaultTaxType: string;
  /** "header": an approved invoice — only Gangway-side fields may change. */
  locked?: boolean;
  /** "From quote QU-0042" when this is a copy. */
  sourceNote?: string | null;
  cancelHref: string;
  validityDays: number;
};

let keySeed = 0;
const newKey = () => `n${Date.now().toString(36)}${(keySeed += 1)}`;

export function DocumentEditor(props: EditorProps) {
  const config = DOC_TYPES[props.type];
  const side = config.side;
  const [lines, setLines] = React.useState<EditorLine[]>(props.lines);
  const [partner, setPartner] = React.useState<PartnerDefaults | null>(props.partner);
  const [amountsAre, setAmountsAre] = React.useState<AmountsMode>(props.header.amountsAre);
  const [docDate, setDocDate] = React.useState(props.header.docDate);
  const [termsDays, setTermsDays] = React.useState<string>(
    props.header.termsDays !== null ? String(props.header.termsDays) : partner ? String(partner.termsDays) : "",
  );
  const [dueDate, setDueDate] = React.useState(props.header.dueDate ?? "");
  const [dirty, setDirty] = React.useState(false);

  const rates = React.useMemo(
    () => new Map(props.taxRates.map((t) => [t.taxType, t.rate])),
    [props.taxRates],
  );
  const hasBases = lines.some((l) => l.baseLineId);
  // A PO's supplier is fixed after the first receipt or bill (§6.3).
  const supplierFixed = props.type === "purchase_order" && props.lines.some((l) => l.drawn > 0);

  // Unsaved edits are not lost to a stray click on a link or a closed tab.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => setDirty(true);

  const update = (key: string, patch: Partial<EditorLine>) => {
    touch();
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const move = (key: string, by: -1 | 1) => {
    touch();
    setLines((all) => {
      const i = all.findIndex((l) => l.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const remove = (key: string) => {
    touch();
    setLines((all) => all.filter((l) => l.key !== key));
  };

  const addRow = (rowType: EditorLine["rowType"]) => {
    touch();
    setLines((all) => [
      ...all,
      {
        key: newKey(),
        rowType,
        itemId: null,
        itemCode: null,
        unit: null,
        description: "",
        note: null,
        quantity: rowType === "item" || rowType === "alternative" ? "1" : "0",
        unitPrice: "0",
        discountPercent: "0",
        accountCode: null,
        taxType: amountsAre === "no_tax" ? null : props.defaultTaxType,
        baseLineId: null,
        maxQuantity: null,
        drawn: 0,
      },
    ]);
  };

  const addItem = (item: PricedItem) => {
    touch();
    setLines((all) => {
      // Adding the same item again bumps its new, unlinked line (EduCom).
      const same = all.find((l) => l.itemId === item.itemId && !l.id && !l.baseLineId && l.rowType === "item");
      if (same) {
        return all.map((l) =>
          l.key === same.key ? { ...l, quantity: String(num(l.quantity) + 1) } : l,
        );
      }
      return [
        ...all,
        {
          key: newKey(),
          rowType: "item",
          itemId: item.itemId,
          itemCode: item.code,
          unit: item.unit,
          description: item.description,
          note: null,
          quantity: "1",
          unitPrice: item.unitPrice,
          discountPercent: "0",
          accountCode: item.accountCode,
          taxType: amountsAre === "no_tax" ? null : item.taxType,
          baseLineId: null,
          maxQuantity: null,
          drawn: 0,
          priceMissing: item.priceMissing,
        },
      ];
    });
  };

  const choosePartner = async (option: PartnerOption) => {
    touch();
    const defaults = await loadPartnerDefaults(option.id, side);
    setPartner(defaults);
    if (defaults && (props.type === "invoice" || props.type === "bill")) {
      setTermsDays(String(defaults.termsDays));
      setDueDate(addDays(docDate, defaults.termsDays));
    }
  };

  const totals = computeTotals(
    lines.map((l) => ({
      rowType: l.rowType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRate: amountsAre === "no_tax" || !l.taxType ? "0" : (rates.get(l.taxType) ?? "0"),
    })),
    amountsAre,
  );

  const serialised = JSON.stringify(
    lines.map((l) => ({
      id: l.id ?? null,
      rowType: l.rowType,
      itemId: l.itemId,
      description: l.description,
      note: l.note,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      accountCode: l.accountCode,
      taxType: amountsAre === "no_tax" ? null : l.taxType,
      baseLineId: l.baseLineId,
    })),
  );

  const action = saveDocument.bind(null, props.type, props.documentId, { isReserve: props.isReserve });
  const projectOptions = props.projects.filter((p) => !partner || p.customerId === partner.id);
  const salesAccounts = props.accounts;
  const locked = Boolean(props.locked);

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      <AfterSave onSaved={() => setDirty(false)} />
      <input type="hidden" name="lines" value={serialised} />
      <input type="hidden" name="partnerId" value={partner?.id ?? ""} />
      <input type="hidden" name="amountsAre" value={amountsAre} />
      {props.version !== null ? <input type="hidden" name="version" value={props.version} /> : null}

      {props.sourceNote ? (
        <p className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-muted)]">
          {props.sourceNote}
        </p>
      ) : null}
      {locked ? (
        <p className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text-muted)]">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          This invoice is approved, so its lines and amounts are locked. You can still change its
          reference, owner, project and internal notes.
        </p>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <CardBody className="flex flex-col gap-4" onChange={touch}>
          <FormRow cols={2}>
            <Field
              label={side === "customer" ? "Customer" : "Supplier"}
              required
            >
              {partner ? (
                <div className="flex h-9.5 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
                  <span className="truncate font-medium text-[var(--text)]">{partner.name}</span>
                  {hasBases || locked || supplierFixed ? (
                    <Lock
                      className="size-3.5 text-[var(--text-faint)]"
                      aria-label={supplierFixed ? "Fixed once goods are received or billed" : "Fixed by the source document"}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPartner(null)}
                      className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-2"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <SearchBox<PartnerOption>
                  label={side === "customer" ? "Find a customer" : "Find a supplier"}
                  placeholder={side === "customer" ? "Find a customer…" : "Find a supplier…"}
                  fetcher={(term) => searchPartners(term, side)}
                  getKey={(p) => p.id}
                  onPick={choosePartner}
                  emptyText={`No ${side}s match. Tick ${side === "customer" ? "Customer" : "Supplier"} on a business partner to offer it here.`}
                  render={(p) => (
                    <span className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{p.name}</span>
                        {p.suburb ? <span className="ml-1.5 text-[var(--text-muted)]">{p.suburb}</span> : null}
                      </span>
                      {p.linked ? null : <Badge tone="neutral">Not in Xero</Badge>}
                    </span>
                  )}
                />
              )}
            </Field>
            <SelectField
              key={`contact-${partner?.id ?? "none"}`}
              name="contactId"
              id="doc-contactId"
              label="Contact"
              disabled={locked}
              defaultValue={
                props.header.contactId ??
                partner?.contacts.find((c) => c.isPrimary)?.id ??
                ""
              }
              options={[
                { value: "", label: partner?.contacts.length ? "No one in particular" : "No contacts on record" },
                ...(partner?.contacts ?? []).map((c) => ({
                  value: c.id,
                  label: c.email ? `${c.name} · ${c.email}` : c.name,
                })),
              ]}
            />
          </FormRow>

          <FormRow cols={3}>
            <Field label="Date" required htmlFor="doc-docDate">
              <Input
                id="doc-docDate"
                type="date"
                name="docDate"
                value={docDate}
                readOnly={locked}
                onChange={(e) => {
                  setDocDate(e.target.value);
                  if ((props.type === "invoice" || props.type === "bill") && termsDays !== "" && e.target.value) {
                    setDueDate(addDays(e.target.value, Number(termsDays)));
                  }
                }}
              />
            </Field>
            {props.type === "invoice" || props.type === "bill" ? (
              <Field label="Terms (days)" hint="0 means due on the day" htmlFor="doc-termsDays">
                <Input
                  id="doc-termsDays"
                  type="number"
                  min={0}
                  name="termsDays"
                  value={termsDays}
                  readOnly={locked}
                  onChange={(e) => {
                    setTermsDays(e.target.value);
                    if (e.target.value !== "" && docDate) setDueDate(addDays(docDate, Number(e.target.value)));
                  }}
                />
              </Field>
            ) : null}
            {config.dueLabel ? (
              <Field
                label={config.dueLabel}
                required={config.dueRequired}
                hint={props.type === "quote" ? `Defaults to ${props.validityDays} days` : undefined}
                htmlFor="doc-dueDate"
              >
                <Input
                  id="doc-dueDate"
                  type="date"
                  name="dueDate"
                  value={dueDate}
                  readOnly={locked}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            ) : null}
          </FormRow>

          {props.type === "bill" ? (
            <FormRow cols={2}>
              <TextField
                name="supplierInvoiceNumber"
                id="doc-supplierInvoiceNumber"
                label="Supplier's invoice number"
                required
                readOnly={locked}
                hint="As printed on their invoice. It becomes the bill's number in Xero."
                defaultValue={props.header.supplierInvoiceNumber ?? ""}
              />
              {!props.documentId && hasBases ? (
                <div className="flex flex-col justify-end">
                  <CheckboxField
                    name="goodsArrived"
                    id="doc-goodsArrived"
                    label="Goods arrived with this invoice"
                    hint="Also books the goods in, as a receipt against the purchase order."
                  />
                </div>
              ) : null}
            </FormRow>
          ) : null}

          <FormRow cols={2}>
            <TextField
              name="reference" id="doc-reference"
              label={side === "customer" ? "Customer reference" : "Reference"}
              hint={
                side === "customer"
                  ? "Their PO number, if they gave one"
                  : props.type === "purchase_order"
                    ? "Xero shows it on the PO. Raised from an order, it names the job."
                    : props.type === "bill"
                      ? "The purchase order number, so Xero shows which order it pays for"
                      : undefined
              }
              defaultValue={props.header.reference ?? ""}
            />
            <SelectField
              name="ownerId"
              id="doc-ownerId"
              label="Owner"
              defaultValue={props.header.ownerId ?? ""}
              options={[{ value: "", label: "Unassigned" }, ...props.team.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </FormRow>

          <FormRow cols={2}>
            <SelectField
              key={`project-${partner?.id ?? "none"}`}
              name="projectId"
              id="doc-projectId"
              label="Project"
              defaultValue={props.header.projectId ?? ""}
              options={[
                { value: "", label: projectOptions.length ? "No project" : "No projects for this partner" },
                ...projectOptions.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {locked || props.type === "bill" ? null : (
              <TextAreaField
                key={`ship-${partner?.id ?? "none"}`}
                name="shipToText" id="doc-shipToText"
                label="Deliver to"
                hint={props.type === "purchase_order" ? "Where the supplier sends it. Printed on the PO." : undefined}
                rows={2}
                className="[&_textarea]:min-h-16"
                defaultValue={props.header.shipToText ?? (side === "customer" ? partner?.shipTo : null) ?? ""}
              />
            )}
          </FormRow>

          {props.type === "quote" && !locked ? (
            <FormSection title="On the quote" description="Xero prints these on the quote it sends.">
              <TextField name="title" id="doc-title" label="Title" defaultValue={props.header.title ?? ""} />
              <TextAreaField name="summary" id="doc-summary" label="Summary" rows={2} defaultValue={props.header.summary ?? ""} />
              <TextAreaField name="terms" id="doc-terms" label="Terms" rows={2} defaultValue={props.header.terms ?? ""} />
            </FormSection>
          ) : null}

          <FormRow cols={2}>
            {locked ? null : (
              <TextAreaField
                name="remarks" id="doc-remarks"
                label={props.type === "purchase_order" ? "Delivery instructions" : "Remarks"}
                rows={2}
                hint={props.type === "purchase_order" ? "Printed on the PO in Xero" : "Kept with the document here"}
                defaultValue={props.header.remarks ?? ""}
              />
            )}
            <TextAreaField
              name="internalNotes" id="doc-internalNotes"
              label="Internal notes"
              rows={2}
              hint="Never leaves The Gangway"
              defaultValue={props.header.internalNotes ?? ""}
            />
          </FormRow>
        </CardBody>
      </Card>

      {locked ? null : (
        <Card>
          <CardHeader
            title="Lines"
            meta={`${lines.filter((l) => l.rowType === "item").length} priced · amounts are ${AMOUNTS_ARE[amountsAre].label.toLowerCase()}`}
            action={
              <AmountsToggle
                value={amountsAre}
                locked={hasBases}
                onChange={(v) => {
                  touch();
                  setAmountsAre(v);
                }}
              />
            }
          />
          <div className="overflow-x-auto scrollbar-slim">
            <table className="w-full min-w-[66rem] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                  <th className="w-14 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2" />
                  <th className="min-w-64 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2">Description</th>
                  <th className="w-24 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-right">Qty</th>
                  <th className="w-28 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-right">Price</th>
                  <th className="w-20 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-right">Disc %</th>
                  <th className="w-40 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2">Account</th>
                  <th className="w-40 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2">Tax</th>
                  <th className="w-28 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-right">Amount</th>
                  <th className="w-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
                      No lines yet. Find an item below, or add a free line.
                    </td>
                  </tr>
                ) : (
                  lines.map((line, i) => (
                    <LineRow
                      key={line.key}
                      line={line}
                      index={i}
                      last={i === lines.length - 1}
                      figures={totals.lines[i]}
                      amountsAre={amountsAre}
                      accounts={salesAccounts}
                      taxRates={props.taxRates}
                      allowAlternative={config.rows.includes("alternative")}
                      onChange={(patch) => update(line.key, patch)}
                      onMove={(by) => move(line.key, by)}
                      onRemove={() => remove(line.key)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:max-w-md">
              <SearchBox<PricedItem>
                label="Add an item"
                placeholder="Add an item by code or name…"
                fetcher={(term) => searchItems(term, side)}
                getKey={(item) => item.itemId}
                onPick={addItem}
                emptyText="No items match. Add one under Sales → Items."
                render={(item) => (
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-mono text-[12px] text-[var(--text-muted)]">{item.code}</span>{" "}
                      <span className="font-medium">{item.name}</span>
                    </span>
                    <span className="tabular shrink-0 text-[12px] text-[var(--text-muted)]">
                      {item.priceMissing ? "No price" : formatMoney(item.unitPrice)}
                    </span>
                  </span>
                )}
              />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => addRow("item")}>
                  <Plus />
                  Free line
                </Button>
                {config.rows.includes("text") ? (
                  <Button size="sm" variant="ghost" onClick={() => addRow("text")}>
                    <Type />
                    Text
                  </Button>
                ) : null}
                {config.rows.includes("subtotal") ? (
                  <Button size="sm" variant="ghost" onClick={() => addRow("subtotal")}>
                    <Sigma />
                    Subtotal
                  </Button>
                ) : null}
              </div>
            </div>
            <TotalsBox
              subtotal={totals.subtotal}
              tax={totals.taxTotal}
              total={totals.total}
              amountsAre={amountsAre}
            />
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <ButtonLink href={props.cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
        <SubmitButton pendingLabel={config.xero && !props.documentId ? "Saving and sending to Xero…" : "Saving…"}>
          {props.documentId ? "Save changes" : `Save ${config.label.toLowerCase()}`}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Navigates to the saved document once the action succeeds. */
function AfterSave({ onSaved }: { onSaved: () => void }) {
  const result = useFormResult();
  const router = useRouter();
  React.useEffect(() => {
    if (!result?.ok) return;
    onSaved();
    const href = result.data?.href;
    if (href) {
      const message = result.message ? `?saved=${encodeURIComponent(result.message)}` : "";
      router.push(`${href}${message}`);
    }
  }, [result, router, onSaved]);
  return null;
}

function AmountsToggle({
  value,
  locked,
  onChange,
}: {
  value: AmountsMode;
  locked: boolean;
  onChange: (v: AmountsMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Amounts are"
      title={locked ? "Fixed by the document these lines came from" : undefined}
      className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {(Object.keys(AMOUNTS_ARE) as AmountsMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={locked && value !== mode}
          onClick={() => onChange(mode)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-40",
            value === mode
              ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          {AMOUNTS_ARE[mode].label}
        </button>
      ))}
    </div>
  );
}

const cell = "border-b border-[var(--border-soft)] px-2 py-1.5 align-top";
const small = "h-8 px-2 text-[13px]";

function LineRow({
  line,
  index,
  last,
  figures,
  amountsAre,
  accounts,
  taxRates,
  allowAlternative,
  onChange,
  onMove,
  onRemove,
}: {
  line: EditorLine;
  index: number;
  last: boolean;
  figures: { lineAmount: string; subtotalValue: string | null };
  amountsAre: AmountsMode;
  accounts: XeroAccountRef[];
  taxRates: XeroTaxRateRef[];
  allowAlternative: boolean;
  onChange: (patch: Partial<EditorLine>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [showNote, setShowNote] = React.useState(Boolean(line.note));
  const over =
    line.maxQuantity !== null && num(line.quantity) > num(line.maxQuantity);
  const under = line.drawn > 0 && num(line.quantity) < line.drawn;
  const canRemove = line.drawn === 0;

  const controls = (
    <td className={cell}>
      <div className="flex flex-col items-center">
        <button
          type="button"
          aria-label={`Move line ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="rounded p-0.5 text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-30"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <span className="text-[11px] tabular text-[var(--text-faint)]">{index + 1}</span>
        <button
          type="button"
          aria-label={`Move line ${index + 1} down`}
          disabled={last}
          onClick={() => onMove(1)}
          className="rounded p-0.5 text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-30"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>
    </td>
  );

  const removeCell = (
    <td className={cn(cell, "text-center")}>
      <button
        type="button"
        aria-label={`Remove line ${index + 1}`}
        disabled={!canRemove}
        title={canRemove ? undefined : "Already drawn into another document"}
        onClick={onRemove}
        className="mt-1.5 rounded p-1 text-[var(--text-faint)] hover:text-[var(--danger)] disabled:opacity-30"
      >
        <Trash2 className="size-4" />
      </button>
    </td>
  );

  if (line.rowType === "text") {
    return (
      <tr className="bg-[var(--surface-2)]">
        {controls}
        <td className={cell} colSpan={7}>
          <Input
            aria-label={`Text on line ${index + 1}`}
            value={line.description}
            placeholder="A heading or note…"
            onChange={(e) => onChange({ description: e.target.value })}
            className={cn(small, "font-medium")}
          />
        </td>
        {removeCell}
      </tr>
    );
  }

  if (line.rowType === "subtotal") {
    return (
      <tr className="bg-[var(--surface-2)]">
        {controls}
        <td className={cn(cell, "pt-3 text-[12px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase")} colSpan={6}>
          Subtotal
        </td>
        <td className={cn(cell, "tabular pt-3 text-right font-semibold")}>
          {formatMoney(figures.subtotalValue ?? "0")}
        </td>
        {removeCell}
      </tr>
    );
  }

  const alternative = line.rowType === "alternative";

  return (
    <tr className={alternative ? "bg-[var(--surface-2)]" : undefined}>
      {controls}
      <td className={cell}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            {line.itemCode ? (
              <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{line.itemCode}</span>
            ) : null}
            {alternative ? <Badge tone="neutral">Optional</Badge> : null}
            {line.baseLineId ? <Badge tone="brand">Linked</Badge> : null}
          </div>
          <Textarea
            aria-label={`Description on line ${index + 1}`}
            value={line.description}
            rows={1}
            onChange={(e) => onChange({ description: e.target.value })}
            className="min-h-8 px-2 py-1 text-[13px] leading-5"
          />
          {showNote ? (
            <Input
              aria-label={`Note on line ${index + 1}`}
              value={line.note ?? ""}
              placeholder="Printed under the description"
              onChange={(e) => onChange({ note: e.target.value || null })}
              className={cn(small, "text-[12px]")}
            />
          ) : null}
          <div className="flex gap-2 text-[11px]">
            {showNote ? null : (
              <button
                type="button"
                onClick={() => setShowNote(true)}
                className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                <StickyNote className="size-3" /> Add note
              </button>
            )}
            {allowAlternative && !line.baseLineId ? (
              <button
                type="button"
                onClick={() => onChange({ rowType: alternative ? "item" : "alternative" })}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {alternative ? "Make it a normal line" : "Make it optional"}
              </button>
            ) : null}
          </div>
        </div>
      </td>
      <td className={cell}>
        <Input
          aria-label={`Quantity on line ${index + 1}`}
          inputMode="decimal"
          value={line.quantity}
          aria-invalid={over || under ? true : undefined}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className={cn(small, "tabular text-right")}
        />
        {line.unit ? <p className="mt-0.5 text-right text-[11px] text-[var(--text-faint)]">{line.unit}</p> : null}
        {over ? (
          <p className="mt-0.5 text-right text-[11px] text-[var(--danger)]">
            Only {formatQty(line.maxQuantity)} left
          </p>
        ) : line.maxQuantity !== null ? (
          <p className="mt-0.5 text-right text-[11px] text-[var(--text-faint)]">of {formatQty(line.maxQuantity)} left</p>
        ) : null}
        {under ? (
          <p className="mt-0.5 text-right text-[11px] text-[var(--danger)]">
            {formatQty(line.drawn)} already drawn
          </p>
        ) : null}
      </td>
      <td className={cell}>
        <Input
          aria-label={`Price on line ${index + 1}`}
          inputMode="decimal"
          value={line.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value, priceMissing: false })}
          className={cn(small, "tabular text-right")}
        />
        {line.priceMissing ? (
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[var(--warn)]">
            <AlertTriangle className="size-3" /> No price set
          </p>
        ) : null}
      </td>
      <td className={cell}>
        <Input
          aria-label={`Discount on line ${index + 1}`}
          inputMode="decimal"
          value={line.discountPercent === "0" ? "" : line.discountPercent}
          placeholder="0"
          onChange={(e) => onChange({ discountPercent: e.target.value || "0" })}
          className={cn(small, "tabular text-right")}
        />
      </td>
      <td className={cell}>
        <Select
          aria-label={`Account on line ${index + 1}`}
          value={line.accountCode ?? ""}
          onChange={(e) => onChange({ accountCode: e.target.value || null })}
          className={cn(small, "pr-7")}
        >
          <option value="">{accounts.length ? "Default account" : "Default (connect Xero)"}</option>
          {line.accountCode && !accounts.some((a) => a.code === line.accountCode) ? (
            <option value={line.accountCode}>{line.accountCode}</option>
          ) : null}
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {accountLabel(a)}
            </option>
          ))}
        </Select>
      </td>
      <td className={cell}>
        {amountsAre === "no_tax" ? (
          <span className="block pt-1.5 text-[12px] text-[var(--text-faint)]">No tax</span>
        ) : (
          <Select
            aria-label={`Tax on line ${index + 1}`}
            value={line.taxType ?? ""}
            aria-invalid={!line.taxType ? true : undefined}
            onChange={(e) => onChange({ taxType: e.target.value || null })}
            className={cn(small, "pr-7")}
          >
            <option value="">Choose…</option>
            {taxRates.map((t) => (
              <option key={t.taxType} value={t.taxType}>
                {taxLabel(t)}
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className={cn(cell, "tabular pt-3 text-right", alternative && "text-[var(--text-faint)]")}>
        {formatMoney(figures.lineAmount)}
      </td>
      {removeCell}
    </tr>
  );
}

export function TotalsBox({
  subtotal,
  tax,
  total,
  amountsAre,
}: {
  subtotal: string;
  tax: string;
  total: string;
  amountsAre: AmountsMode;
}) {
  return (
    <dl className="w-full shrink-0 text-[13px] sm:w-64">
      <div className="flex justify-between py-1">
        <dt className="text-[var(--text-muted)]">Subtotal{amountsAre === "inclusive" ? " (ex GST)" : ""}</dt>
        <dd className="tabular">{formatMoney(subtotal)}</dd>
      </div>
      {amountsAre === "no_tax" ? null : (
        <div className="flex justify-between py-1">
          <dt className="text-[var(--text-muted)]">{amountsAre === "inclusive" ? "Includes GST" : "GST"}</dt>
          <dd className="tabular">{formatMoney(tax)}</dd>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-2 text-[15px] font-semibold">
        <dt>Total</dt>
        <dd className="tabular">{formatMoney(total)}</dd>
      </div>
    </dl>
  );
}
