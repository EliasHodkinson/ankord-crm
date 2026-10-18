"use client";

import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button, ButtonLink } from "@/components/ui/button";
import { CheckboxField, FormRow, TextAreaField, TextField } from "@/components/app/form-kit";
import { SearchBox } from "./search-box";
import { searchPartners, type PartnerOption } from "@/lib/actions/documents";
import { raisePurchaseOrders } from "@/lib/actions/purchasing";
import { formatMoney, formatQty, num } from "@/lib/sales/money";
import { cn } from "@/lib/utils";

/**
 * Raise purchase orders from a sales order (spec §6.2): one row per line
 * still to order, each with how many, the buy price and the supplier. Rows
 * are grouped by supplier into one draft PO each, in one go.
 */

export type RaiseRow = {
  lineId: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  ordered: string;
  shortfall: number;
  buyPrice: string;
  priceMissing: boolean;
  supplier: { id: string; name: string } | null;
  stock: boolean;
};

type RowState = { raise: boolean; quantity: string; price: string; supplier: { id: string; name: string } | null };

const fetchSuppliers = (term: string) => searchPartners(term, "supplier");

export function RaiseForm({
  salesOrderId,
  rows,
  defaultDue,
  cancelHref,
  canDropShip,
}: {
  salesOrderId: string;
  rows: RaiseRow[];
  defaultDue: string;
  cancelHref: string;
  canDropShip: boolean;
}) {
  const [state, setState] = React.useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.lineId,
        { raise: r.stock && r.shortfall > 0, quantity: formatQty(r.shortfall), price: r.buyPrice, supplier: r.supplier },
      ]),
    ),
  );
  const set = (id: string, patch: Partial<RowState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const chosen = rows.filter((r) => state[r.lineId].raise && num(state[r.lineId].quantity) > 0);
  const groups = new Map<string, { name: string; rows: RaiseRow[]; total: number }>();
  for (const r of chosen) {
    const s = state[r.lineId];
    const key = s.supplier?.id ?? "";
    const group = groups.get(key) ?? { name: s.supplier?.name ?? "No supplier chosen", rows: [], total: 0 };
    group.rows.push(r);
    group.total += num(s.quantity) * num(s.price);
    groups.set(key, group);
  }
  const missingSupplier = groups.has("");
  const serialised = JSON.stringify(
    chosen.map((r) => ({
      lineId: r.lineId,
      quantity: state[r.lineId].quantity,
      unitPrice: state[r.lineId].price,
      supplierId: state[r.lineId].supplier?.id ?? "",
    })),
  );

  return (
    <ActionForm action={raisePurchaseOrders.bind(null, salesOrderId)} className="flex flex-col gap-5">
      <input type="hidden" name="rows" value={serialised} />
      <Card>
        <CardHeader title="Lines to order" meta="Defaults to what each line is short" />
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[52rem] border-collapse text-[13px]">
            <thead>
              <tr>
                {["", "Item", "On order", "Order", "Buy price", "Supplier"].map((h, i) => (
                  <th
                    key={h || i}
                    className={cn(
                      "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase",
                      i >= 2 && i <= 4 ? "text-right" : "text-left",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = state[r.lineId];
                return (
                  <tr key={r.lineId} className={s.raise ? undefined : "text-[var(--text-muted)]"}>
                    <td className="border-b border-[var(--border-soft)] px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Order ${r.itemCode ?? r.description}`}
                        checked={s.raise}
                        onChange={(e) => set(r.lineId, { raise: e.target.checked })}
                        className="mt-0.5 size-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="border-b border-[var(--border-soft)] px-3 py-2 align-top">
                      <span className="flex items-center gap-1.5">
                        {r.itemCode ? <span className="font-mono text-[11px]">{r.itemCode}</span> : null}
                        {r.stock ? null : <Badge tone="muted">Not stock</Badge>}
                      </span>
                      <p className="whitespace-pre-line">{r.description}</p>
                      <p className="text-[12px] text-[var(--text-faint)]">
                        {formatQty(r.quantity)} on the order{r.unit ? ` ${r.unit}` : ""}
                      </p>
                    </td>
                    <td className="tabular border-b border-[var(--border-soft)] px-3 py-2 text-right align-top">{formatQty(r.ordered)}</td>
                    <td className="border-b border-[var(--border-soft)] px-3 py-1.5 text-right align-top">
                      <Input
                        aria-label={`Quantity to order of ${r.itemCode ?? r.description}`}
                        inputMode="decimal"
                        value={s.quantity}
                        onChange={(e) => set(r.lineId, { quantity: e.target.value, raise: true })}
                        className="tabular h-8 w-20 text-right"
                      />
                    </td>
                    <td className="border-b border-[var(--border-soft)] px-3 py-1.5 text-right align-top">
                      <Input
                        aria-label={`Buy price of ${r.itemCode ?? r.description}`}
                        inputMode="decimal"
                        value={s.price}
                        onChange={(e) => set(r.lineId, { price: e.target.value })}
                        className="tabular h-8 w-24 text-right"
                      />
                      {r.priceMissing && num(s.price) === 0 ? (
                        <p className="mt-0.5 text-[11px] text-[var(--warn)]">No buy price set</p>
                      ) : null}
                    </td>
                    <td className="min-w-56 border-b border-[var(--border-soft)] px-3 py-1.5 align-top">
                      {s.supplier ? (
                        <span className="flex h-8 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5">
                          <span className="truncate">{s.supplier.name}</span>
                          <button type="button" onClick={() => set(r.lineId, { supplier: null })} className="text-[12px] text-[var(--text-muted)] hover:underline underline-offset-2">
                            Change
                          </button>
                        </span>
                      ) : (
                        <SearchBox<PartnerOption>
                          label={`Supplier for ${r.itemCode ?? r.description}`}
                          placeholder="Find a supplier…"
                          fetcher={fetchSuppliers}
                          getKey={(p) => p.id}
                          onPick={(p) => set(r.lineId, { supplier: { id: p.id, name: p.name }, raise: true })}
                          emptyText="No suppliers match. Tick Supplier on a business partner to offer it here."
                          render={(p) => <span className="font-medium">{p.name}</span>}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 1 ? (
          <div className="border-t border-[var(--border-soft)] p-3">
            <SupplierForAll onPick={(supplier) => setState((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.raise ? { ...v, supplier } : v])))} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="The orders" />
        <CardBody className="flex flex-col gap-4">
          <FormRow cols={2}>
            <TextField name="dueDate" id="raise-due" label="Delivery date" type="date" required defaultValue={defaultDue} />
            {canDropShip ? (
              <div className="flex flex-col justify-end">
                <CheckboxField name="deliverToCustomer" id="raise-dropship" label="Deliver to the customer" hint="Uses the order's deliver-to address instead of ours." />
              </div>
            ) : null}
          </FormRow>
          <TextAreaField name="remarks" id="raise-remarks" label="Delivery instructions" rows={2} hint="Printed on each PO in Xero" />
          {chosen.length ? (
            <ul className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px]">
              {[...groups.entries()].map(([key, g]) => (
                <li key={key} className={cn("flex justify-between gap-2", !key && "text-[var(--warn)]")}>
                  <span>
                    {key ? "Purchase order to " : ""}
                    <span className="font-medium">{g.name}</span> · {g.rows.length} line{g.rows.length === 1 ? "" : "s"}
                  </span>
                  <span className="tabular">{formatMoney(g.total.toFixed(2))} ex GST</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">Tick the lines to order.</p>
          )}
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <SubmitButton disabled={chosen.length === 0 || missingSupplier} pendingLabel="Creating…">
          {groups.size > 1 ? `Create ${groups.size} purchase orders` : "Create purchase order"}
        </SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </ActionForm>
  );
}

function SupplierForAll({ onPick }: { onPick: (supplier: { id: string; name: string }) => void }) {
  const [open, setOpen] = React.useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Same supplier for every ticked line
      </Button>
    );
  }
  return (
    <div className="max-w-sm">
      <SearchBox<PartnerOption>
        label="Supplier for every ticked line"
        placeholder="Find a supplier…"
        fetcher={fetchSuppliers}
        getKey={(p) => p.id}
        autoFocus
        onPick={(p) => {
          onPick({ id: p.id, name: p.name });
          setOpen(false);
        }}
        render={(p) => <span className="font-medium">{p.name}</span>}
      />
    </div>
  );
}
