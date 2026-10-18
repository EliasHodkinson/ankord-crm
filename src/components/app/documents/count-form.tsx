"use client";

import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormRow, TextAreaField, TextField } from "@/components/app/form-kit";
import { deliverGoods, receiveGoods } from "@/lib/actions/purchasing";
import { formatQty, num } from "@/lib/sales/money";
import { cn, isoDate } from "@/lib/utils";

/**
 * Counting goods in (a receipt against a PO) or out (a delivery against a
 * reserve invoice): one row per line with what was ordered, what has moved
 * already and what is moving now, which defaults to what is left (or, for a
 * delivery, to what is set aside). "All" fills every line.
 */

export type CountRow = {
  lineId: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  done: string;
  /** What this count defaults to. */
  suggested: number;
  /** Shown under the description: "1 allocated", "Billed: RPT445, paid". */
  hint?: string | null;
};

export type ShipmentChoice = { id: string; label: string };

export function CountForm({
  mode,
  documentId,
  rows,
  shipments = [],
  cancelHref,
  billNote,
}: {
  mode: "receive" | "deliver";
  documentId: string;
  rows: CountRow[];
  shipments?: ShipmentChoice[];
  cancelHref: string;
  /** On a receipt: "Billed: RPT445, paid" when a bill came first. */
  billNote?: string | null;
}) {
  const [counts, setCounts] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.lineId, formatQty(r.suggested)])),
  );
  const action = (mode === "receive" ? receiveGoods : deliverGoods).bind(null, documentId);
  const serialised = JSON.stringify(rows.map((r) => ({ lineId: r.lineId, quantity: counts[r.lineId] ?? "0" })));
  const leftOf = (r: CountRow) => Math.max(0, num(r.quantity) - num(r.done));
  const verb = mode === "receive" ? "Receive" : "Deliver";

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      <input type="hidden" name="lines" value={serialised} />
      <Card>
        <CardHeader title="Details" />
        <CardBody className="flex flex-col gap-4">
          <FormRow cols={2}>
            <TextField name="docDate" id="count-date" label={mode === "receive" ? "Received on" : "Delivered on"} type="date" required defaultValue={isoDate()} />
            <TextField
              name="reference"
              id="count-reference"
              label={mode === "receive" ? "Supplier's docket number" : "Reference"}
              hint={mode === "receive" ? "On the packing slip, if there is one" : "Consignment or signed-for, if any"}
            />
          </FormRow>
          <TextAreaField name="remarks" id="count-remarks" label="Remarks" rows={2} />
          {billNote ? <p className="text-[13px] text-[var(--text-muted)]">{billNote}</p> : null}
          {shipments.length ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[12px] font-medium text-[var(--text-muted)]">Shipments that arrived</legend>
              {shipments.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="shipmentId" value={s.id} defaultChecked={shipments.length === 1} className="size-4 accent-[var(--accent)]" />
                  {s.label}
                </label>
              ))}
            </fieldset>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={mode === "receive" ? "What arrived" : "What is going out"}
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCounts(Object.fromEntries(rows.map((r) => [r.lineId, formatQty(leftOf(r))])))}
            >
              {verb} all
            </Button>
          }
        />
        <div className="overflow-x-auto scrollbar-slim">
          <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <thead>
              <tr>
                {["Item", mode === "receive" ? "Ordered" : "Invoiced", mode === "receive" ? "Received" : "Delivered", mode === "receive" ? "Receiving now" : "Delivering now"].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = counts[r.lineId] ?? "0";
                const over = num(value) > leftOf(r);
                return (
                  <tr key={r.lineId}>
                    <td className="border-b border-[var(--border-soft)] px-3 py-2 align-top">
                      {r.itemCode ? <span className="font-mono text-[11px] text-[var(--text-muted)]">{r.itemCode}</span> : null}
                      <p className="whitespace-pre-line">{r.description}</p>
                      {r.hint ? <p className="text-[12px] text-[var(--text-muted)]">{r.hint}</p> : null}
                    </td>
                    <td className="tabular border-b border-[var(--border-soft)] px-3 py-2 text-right align-top">
                      {formatQty(r.quantity)}
                      {r.unit ? <span className="ml-1 text-[11px] text-[var(--text-faint)]">{r.unit}</span> : null}
                    </td>
                    <td className="tabular border-b border-[var(--border-soft)] px-3 py-2 text-right align-top text-[var(--text-muted)]">{formatQty(r.done)}</td>
                    <td className="border-b border-[var(--border-soft)] px-3 py-1.5 text-right align-top">
                      <Field label={`${verb} ${r.itemCode ?? r.description}`} htmlFor={`count-${r.lineId}`} className="items-end [&>label]:sr-only">
                        <Input
                          id={`count-${r.lineId}`}
                          inputMode="decimal"
                          value={value}
                          onChange={(e) => setCounts((c) => ({ ...c, [r.lineId]: e.target.value }))}
                          aria-invalid={over ? true : undefined}
                          className="tabular h-8 w-24 text-right"
                        />
                      </Field>
                      {over ? <p className="mt-0.5 text-[11px] text-[var(--danger)]">Only {formatQty(leftOf(r))} left</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton pendingLabel={mode === "receive" ? "Receiving…" : "Delivering…"}>{verb}</SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </ActionForm>
  );
}
