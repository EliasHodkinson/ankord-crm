"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { FormRow, TextField } from "@/components/app/form-kit";
import { adjustStock } from "@/lib/actions/purchasing";

/** An admin's stocktake or breakage correction: plus to add, minus to take away. */
export function StockAdjust({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const done = React.useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Correct stock
      </Button>
    );
  }
  return (
    <ActionForm action={adjustStock.bind(null, itemId)} onSuccess={done} className="flex flex-col gap-3">
      <FormRow cols={2}>
        <TextField name="quantity" id="adjust-qty" label="Change" inputMode="decimal" placeholder="-2" required />
        <TextField name="reason" id="adjust-reason" label="Why" placeholder="Stocktake" required />
      </FormRow>
      <div className="flex gap-2">
        <SubmitButton size="sm">Save correction</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
