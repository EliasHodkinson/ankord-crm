"use client";

import { useId, useState, useTransition } from "react";
import {
  ExternalLink,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormRow, FormSection, TextAreaField, TextField } from "@/components/app/form-kit";
import { deleteAccount, saveAccount } from "@/lib/actions/accounts";
import type { ProjectAccount } from "@/lib/db/schema";
import { cn, formatDate, money } from "@/lib/utils";

export function AccountRegister({
  accounts,
  projectId,
  customerId,
  revalidate,
}: {
  accounts: ProjectAccount[];
  projectId?: string;
  customerId?: string;
  revalidate: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-lg border border-[var(--info)]/25 bg-[var(--info-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--info)]" />
        <span>
          Passwords are never stored here. Record which vault entry holds the credential,
          so the register can be handed over without handing over the keys.
        </span>
      </p>

      {accounts.length === 0 && !adding ? (
        <EmptyState
          compact
          title="Nothing registered yet"
          description="List every system this work touches — the tenant, the registrar, hosting, the analytics account — along with who owns it and where its credential lives."
          action={
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add an account
            </Button>
          }
        />
      ) : null}

      {accounts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--color-coastal-500)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-[var(--text)]">
                      {account.system}
                    </h4>
                    {account.ownedBy ? (
                      <Badge tone="brand">Owned by {account.ownedBy}</Badge>
                    ) : null}
                    {account.mfaMethod ? (
                      <Badge tone="ok">MFA: {account.mfaMethod}</Badge>
                    ) : (
                      <Badge tone="warn">MFA not recorded</Badge>
                    )}
                  </div>

                  {account.purpose ? (
                    <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                      {account.purpose}
                    </p>
                  ) : null}

                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                    <Detail label="Username" value={account.username} mono />
                    <Detail label="Vault record" value={account.vaultRecord} />
                    <Detail
                      label="Recovery codes"
                      value={account.recoveryCodesLocation}
                    />
                    <Detail
                      label="Renews"
                      value={
                        account.renewalDate
                          ? `${formatDate(account.renewalDate)}${
                              account.costAud ? ` · ${money(account.costAud)}` : ""
                            }`
                          : null
                      }
                    />
                  </dl>

                  {account.loginUrl ? (
                    <a
                      href={account.loginUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
                    >
                      {account.loginUrl.replace(/^https?:\/\//, "")}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}

                  {account.notes ? (
                    <p className="mt-2 text-[12px] leading-5 whitespace-pre-line text-[var(--text-muted)]">
                      {account.notes}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      editing === account.id ? "Close editor" : `Edit ${account.system}`
                    }
                    onClick={() => setEditing(editing === account.id ? null : account.id)}
                  >
                    {editing === account.id ? <X /> : <Pencil />}
                  </Button>
                  <DeleteAccountButton
                    id={account.id}
                    system={account.system}
                    revalidate={revalidate}
                  />
                </div>
              </div>

              {editing === account.id ? (
                <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
                  <AccountForm
                    account={account}
                    projectId={projectId}
                    customerId={customerId}
                    revalidate={revalidate}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="rounded-lg border border-[var(--color-coastal-300)] bg-[var(--surface-2)] p-3">
          <AccountForm
            projectId={projectId}
            customerId={customerId}
            revalidate={revalidate}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : accounts.length > 0 ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAdding(true)}>
          <Plus />
          Add an account
        </Button>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-[var(--text-faint)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate",
          value ? "text-[var(--text)]" : "text-[var(--text-faint)]",
          mono && value && "font-mono text-[11px]",
        )}
      >
        {value ?? "not recorded"}
      </dd>
    </div>
  );
}

function AccountForm({
  account,
  projectId,
  customerId,
  revalidate,
  onDone,
}: {
  account?: ProjectAccount;
  projectId?: string;
  customerId?: string;
  revalidate: string;
  onDone: () => void;
}) {
  const uid = useId();
  const f = (k: string) => `${uid}-${k}`;

  return (
    <ActionForm
      action={saveAccount.bind(null, account?.id ?? null)}
      className="flex flex-col gap-5"
      onSuccess={onDone}
    >
      <input type="hidden" name="projectId" value={projectId ?? account?.projectId ?? ""} />
      <input type="hidden" name="customerId" value={customerId ?? account?.customerId ?? ""} />
      <input type="hidden" name="revalidate" value={revalidate} />

      <FormSection>
        <FormRow>
          <TextField
            name="system"
            label="System"
            required
            id={f("system")}
            defaultValue={account?.system}
            placeholder="Microsoft 365 — Global Admin"
          />
          <TextField
            name="loginUrl"
            label="Login URL"
            id={f("loginUrl")}
            defaultValue={account?.loginUrl ?? ""}
            placeholder="admin.microsoft.com"
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="username"
            label="Username"
            id={f("username")}
            defaultValue={account?.username ?? ""}
            placeholder="admin@client.onmicrosoft.com"
          />
          <TextField
            name="mfaMethod"
            label="MFA method"
            id={f("mfaMethod")}
            defaultValue={account?.mfaMethod ?? ""}
            placeholder="Authenticator app"
          />
          <TextField
            name="ownedBy"
            label="Owned by"
            id={f("ownedBy")}
            defaultValue={account?.ownedBy ?? ""}
            placeholder="The client"
          />
        </FormRow>
        <FormRow>
          <TextField
            name="vaultRecord"
            label="Vault record"
            id={f("vaultRecord")}
            defaultValue={account?.vaultRecord ?? ""}
            hint="Where the password actually lives."
            placeholder="Keeper › Clients › Maple Street Kitchens › M365 GA"
          />
          <TextField
            name="recoveryCodesLocation"
            label="Recovery codes"
            id={f("recoveryCodesLocation")}
            defaultValue={account?.recoveryCodesLocation ?? ""}
            placeholder="Same Keeper record, attachment"
          />
        </FormRow>
        <FormRow cols={3}>
          <TextField
            name="renewalDate"
            label="Renews on"
            type="date"
            id={f("renewalDate")}
            defaultValue={account?.renewalDate ?? ""}
          />
          <TextField
            name="costAud"
            label="Cost (AUD)"
            type="number"
            step="0.01"
            min="0"
            id={f("costAud")}
            defaultValue={account?.costAud ?? ""}
          />
          <TextField
            name="purpose"
            label="What it does"
            id={f("purpose")}
            defaultValue={account?.purpose ?? ""}
            placeholder="Tenant administration"
          />
        </FormRow>
        <TextAreaField
          name="notes"
          label="Notes"
          id={f("notes")}
          rows={2}
          defaultValue={account?.notes ?? ""}
        />
      </FormSection>

      <div className="flex items-center gap-2">
        <SubmitButton size="sm">{account ? "Save" : "Add account"}</SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

function DeleteAccountButton({
  id,
  system,
  revalidate,
}: {
  id: string;
  system: string;
  revalidate: string;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => start(() => void deleteAccount(id, revalidate))}
        >
          Remove
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${system} from the register`}
      onClick={() => setConfirming(true)}
    >
      <Trash2 />
    </Button>
  );
}
