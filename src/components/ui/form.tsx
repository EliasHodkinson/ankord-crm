"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/shared";

type Action = (
  prev: ActionState | undefined,
  formData: FormData,
) => Promise<ActionState>;

type FormContextValue = {
  state: ActionState | undefined;
  /** What was typed on the last failed submit, so nothing is lost. */
  retained: Record<string, string> | null;
};

const FormContext = React.createContext<FormContextValue>({
  state: undefined,
  retained: null,
});

/** Field-level errors returned by the last submit, keyed by input name. */
export function useFieldError(name: string): string | undefined {
  return React.useContext(FormContext).state?.fieldErrors?.[name]?.[0];
}

/**
 * The value this field held on the last failed submit.
 *
 * React 19 resets an uncontrolled form once its action resolves, which would
 * otherwise empty a long form the moment one field fails validation. Fields
 * fall back to this before their own default.
 */
export function useRetainedValue(name: string): string | undefined {
  return React.useContext(FormContext).retained?.[name];
}

/** Same, for checkboxes. */
export function useRetainedChecked(name: string): boolean | undefined {
  const retained = React.useContext(FormContext).retained;
  if (!retained) return undefined;
  return name in retained;
}

export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  id,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  onSuccess?: () => void;
  id?: string;
}) {
  const [result, formAction] = useActionState(
    async (previous: Attempt | undefined, formData: FormData): Promise<Attempt> => {
      // Read the entries here, on the client, before the action is dispatched.
      const values: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") values[key] = value;
      }

      const state = await action(previous?.state, formData);
      return {
        state,
        retained: state.ok ? null : values,
        attempt: (previous?.attempt ?? 0) + 1,
      };
    },
    undefined,
  );

  const state = result?.state;

  useEffect(() => {
    if (state?.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <FormContext.Provider value={{ state, retained: result?.retained ?? null }}>
      <form
        id={id}
        // Remounting after a failed submit is what lets the retained values
        // take effect — React reset the live inputs the moment it resolved.
        key={result?.retained ? result.attempt : "clean"}
        action={formAction}
        className={className}
        noValidate
      >
        {state && !state.ok && state.message ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2.5 text-[13px] text-[var(--danger)]"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {state.message}
          </div>
        ) : null}
        {children}
      </form>
    </FormContext.Provider>
  );
}

type Attempt = {
  state: ActionState;
  retained: Record<string, string> | null;
  attempt: number;
};

/** Reads the parent form's pending state — never renders a bare spinner. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant = "primary",
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={cn("min-w-24", className)}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Small "Saved." confirmation that fades away, for inline edit forms. */
export function SaveIndicator() {
  const { state } = React.useContext(FormContext);
  // Remembering which result has been acknowledged keeps the only setState
  // inside the timeout, rather than in the effect body.
  const [dismissed, setDismissed] = React.useState<ActionState | undefined>(undefined);
  const visible = Boolean(state?.ok) && state !== dismissed;

  React.useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(() => setDismissed(state), 2600);
    return () => clearTimeout(timer);
  }, [state]);

  if (!visible) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ok)]"
    >
      <Check className="size-3.5" />
      {state?.message ?? "Saved."}
    </span>
  );
}
