"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton, useFieldError, useRetainedValue } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { FormRow, TextAreaField, TextField } from "@/components/app/form-kit";
import { SHIPMENT_STATE, StatusBadge } from "@/components/ui/status";
import { deleteShipment, saveShipment } from "@/lib/actions/purchasing";
import { CARRIER_KEYS, CARRIERS, carrierLabel, trackingUrl, type CarrierKey } from "@/lib/sales/carriers";
import { shipmentState } from "@/lib/sales/purchasing";
import { formatDate } from "@/lib/utils";

/**
 * Couriers' shipments against a PO: who is carrying it, the consignment
 * number and the tracking link, sent and expected. Several are fine — a
 * supplier often ships in parts. A shipment is in transit until a receipt
 * says it arrived.
 */

export type ShipmentRow = {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedOn: string | null;
  eta: string | null;
  notes: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
};

export function ShipmentsPanel({
  purchaseOrderId,
  shipments,
  received,
  canWrite,
  today,
}: {
  purchaseOrderId: string;
  shipments: ShipmentRow[];
  /** Every stock line received: every shipment has arrived. */
  received: boolean;
  canWrite: boolean;
  today: string;
}) {
  const [editing, setEditing] = React.useState<string | "new" | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {shipments.length === 0 && editing !== "new" ? (
        <p className="text-[13px] leading-6 text-[var(--text-muted)]">
          Nothing shipped yet. When the supplier sends tracking, add it here: it shows on this order, on the sales
          documents it is for, and in Xero&apos;s history.
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
        {shipments.map((s) =>
          editing === s.id ? (
            <li key={s.id} className="py-3 first:pt-0">
              <ShipmentForm purchaseOrderId={purchaseOrderId} shipment={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <ShipmentItem
              key={s.id}
              shipment={s}
              state={shipmentState(s, received, today)}
              canWrite={canWrite}
              onEdit={() => setEditing(s.id)}
            />
          ),
        )}
      </ul>

      {editing === "new" ? (
        <ShipmentForm purchaseOrderId={purchaseOrderId} onDone={() => setEditing(null)} />
      ) : canWrite ? (
        <div>
          <Button size="sm" variant={shipments.length ? "ghost" : "secondary"} onClick={() => setEditing("new")}>
            <Plus />
            {shipments.length ? "Add another shipment" : "Add shipment"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ShipmentItem({
  shipment: s,
  state,
  canWrite,
  onEdit,
}: {
  shipment: ShipmentRow;
  state: ReturnType<typeof shipmentState>;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [asking, setAsking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
          <Truck className="size-4 text-[var(--text-muted)]" aria-hidden />
          {carrierLabel(s.carrier)}
          {s.trackingNumber ? <span className="font-mono text-[12px] font-normal">{s.trackingNumber}</span> : null}
        </span>
        <StatusBadge map={SHIPMENT_STATE} value={state} />
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-muted)]">
        {s.shippedOn ? <span>Sent {formatDate(s.shippedOn)}</span> : null}
        {s.eta ? <span className={state === "overdue" ? "text-[var(--warn)]" : undefined}>ETA {formatDate(s.eta)}</span> : null}
        {s.receiptId ? (
          <span>
            Arrived on{" "}
            <Link href={`/purchasing/receipts/${s.receiptId}`} className="text-[var(--text)] hover:underline underline-offset-2">
              {s.receiptNumber}
            </Link>
          </span>
        ) : null}
      </p>
      {s.notes ? <p className="whitespace-pre-line text-[12px] text-[var(--text-muted)]">{s.notes}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {s.trackingUrl ? (
          <a
            href={s.trackingUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-2)]"
          >
            Track
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens {carrierLabel(s.carrier)}&apos;s tracking page)</span>
          </a>
        ) : null}
        {canWrite ? (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil />
              Edit
            </Button>
            {asking ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await deleteShipment(s.id);
                      if (!result.ok) setError(result.message ?? "Could not remove it.");
                      router.refresh();
                    })
                  }
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Remove shipment
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                  Not now
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="text-[var(--danger)] hover:text-[var(--danger)]" onClick={() => setAsking(true)}>
                <Trash2 />
                Remove
              </Button>
            )}
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ShipmentForm({
  purchaseOrderId,
  shipment,
  onDone,
}: {
  purchaseOrderId: string;
  shipment?: ShipmentRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const action = saveShipment.bind(null, purchaseOrderId, shipment?.id ?? null);
  const done = React.useCallback(() => {
    onDone();
    router.refresh();
  }, [onDone, router]);

  return (
    <ActionForm action={action} onSuccess={done} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <Fields shipment={shipment} />
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Saving…">
          {shipment ? "Save shipment" : "Add shipment"}
        </SubmitButton>
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

/** Inside the form, so the typed values survive a failed save and feed the link preview. */
function Fields({ shipment }: { shipment?: ShipmentRow }) {
  const retainedCarrier = useRetainedValue("carrier");
  const retainedNumber = useRetainedValue("trackingNumber");
  const retainedUrl = useRetainedValue("trackingUrl");
  const [carrier, setCarrier] = React.useState<string>(retainedCarrier ?? shipment?.carrier ?? "auspost");
  const [number, setNumber] = React.useState(retainedNumber ?? shipment?.trackingNumber ?? "");
  const [typed, setTyped] = React.useState(retainedUrl ?? (shipment?.carrier === "other" ? (shipment.trackingUrl ?? "") : ""));
  const preview = trackingUrl(carrier, number, typed);
  const other = carrier === "other";
  const id = shipment?.id ?? "new";
  const numberError = useFieldError("trackingNumber");
  const urlError = useFieldError("trackingUrl");

  return (
    <>
      <FormRow>
        <Field label="Courier" htmlFor={`ship-carrier-${id}`}>
          <Select id={`ship-carrier-${id}`} name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {CARRIER_KEYS.map((k) => (
              <option key={k} value={k}>
                {CARRIERS[k as CarrierKey].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tracking or consignment number" htmlFor={`ship-number-${id}`} required={!other} error={numberError}>
          <Input
            id={`ship-number-${id}`}
            name="trackingNumber"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={numberError ? true : undefined}
          />
        </Field>
      </FormRow>
      {other ? (
        <Field label="Tracking link" htmlFor={`ship-url-${id}`} hint="The courier's tracking page for this consignment" error={urlError}>
          <Input
            id={`ship-url-${id}`}
            name="trackingUrl"
            placeholder="https://"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="url"
            aria-invalid={urlError ? true : undefined}
          />
        </Field>
      ) : null}
      <FormRow>
        <TextField name="shippedOn" id={`ship-sent-${id}`} label="Sent" type="date" defaultValue={shipment?.shippedOn ?? ""} />
        <TextField name="eta" id={`ship-eta-${id}`} label="Expected" type="date" defaultValue={shipment?.eta ?? ""} />
      </FormRow>
      <TextAreaField name="notes" id={`ship-notes-${id}`} label="Notes" rows={2} defaultValue={shipment?.notes ?? ""} />
      <p className="min-h-5 text-[12px] text-[var(--text-muted)]">
        {preview ? (
          <a href={preview} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline underline-offset-2">
            Check the tracking link
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : other ? (
          "Paste the courier's tracking link, if there is one."
        ) : (
          "The tracking link is made from the number."
        )}
      </p>
    </>
  );
}
