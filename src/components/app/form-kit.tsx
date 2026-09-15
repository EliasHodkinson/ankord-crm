"use client";

import * as React from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  useFieldError,
  useRetainedChecked,
  useRetainedValue,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";

/** Shared form furniture, so every form in the CRM is laid out identically. */

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {title ? (
        <div>
          <h2 className="text-[13px] font-semibold tracking-[0.02em] text-[var(--text-muted)]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-faint)]">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FormRow({
  children,
  cols = 2,
}: {
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 3 && "sm:grid-cols-3",
        cols === 2 && "sm:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  required,
  defaultValue,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label: string;
  hint?: React.ReactNode;
}) {
  const error = useFieldError(name);
  const retained = useRetainedValue(name);
  return (
    <Field label={label} htmlFor={props.id} hint={hint} error={error} required={required}>
      <Input
        name={name}
        defaultValue={retained ?? defaultValue}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  required,
  defaultValue,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  name: string;
  label: string;
  hint?: React.ReactNode;
  /** Applied to the label + control group, not the textarea itself. */
  className?: string;
}) {
  const error = useFieldError(name);
  const retained = useRetainedValue(name);
  return (
    <Field
      label={label}
      htmlFor={props.id}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Textarea
        name={name}
        defaultValue={retained ?? defaultValue}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  hint,
  options,
  required,
  defaultValue,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  label: string;
  hint?: React.ReactNode;
  options: { value: string; label: string }[];
}) {
  const error = useFieldError(name);
  const retained = useRetainedValue(name);
  return (
    <Field label={label} htmlFor={props.id} hint={hint} error={error} required={required}>
      <Select
        name={name}
        defaultValue={retained ?? defaultValue}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
  id,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  id?: string;
}) {
  const retained = useRetainedChecked(name);
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 transition-colors hover:border-[var(--color-coastal-300)] has-[:checked]:border-[var(--color-sunrise-300)] has-[:checked]:bg-[var(--color-sunrise-50)] dark:has-[:checked]:bg-[var(--color-sunrise-900)]/30"
    >
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={retained ?? defaultChecked}
        className="mt-0.5 size-4 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text)]">{label}</span>
        {hint ? (
          <span className="block text-[12px] leading-5 text-[var(--text-muted)]">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
