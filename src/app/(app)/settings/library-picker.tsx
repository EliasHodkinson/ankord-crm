"use client";

import { useId, useState, useTransition } from "react";
import { AlertTriangle, Check, Library, Loader2, Search } from "lucide-react";
import { ActionForm, SaveIndicator, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CheckboxField } from "@/components/app/form-kit";
import { saveLibrary } from "@/lib/actions/settings";
import { DEFAULT_CLIENT_FOLDER_TEXT } from "@/lib/folder-template";
import type { Settings } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type Site = { id: string; displayName?: string; name?: string; webUrl: string };
type Drive = { id: string; name: string; webUrl: string };

/**
 * Choose the SharePoint site and document library that client folders are
 * created in. Read live from Graph, so it only ever offers real libraries.
 */
export function LibraryPicker({
  settings,
  initialDrives,
}: {
  settings: Settings | null;
  /** Libraries for the already-connected site, fetched on the server. */
  initialDrives: Drive[];
}) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [drives, setDrives] = useState<Drive[]>(initialDrives);
  const [siteId, setSiteId] = useState(settings?.spSiteId ?? "");
  const [siteUrl, setSiteUrl] = useState(settings?.spSiteUrl ?? "");
  const [driveId, setDriveId] = useState(settings?.spDriveId ?? "");
  const [loading, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * A pasted address resolves to exactly one site; anything else is a search.
   * Pasting is the reliable route — site search misses sites you have not
   * opened recently.
   */
  function findSites(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    const looksLikeUrl = /sharepoint\.com/i.test(trimmed) || trimmed.includes("/sites/");
    const query = looksLikeUrl
      ? `url=${encodeURIComponent(trimmed)}`
      : `q=${encodeURIComponent(trimmed)}`;

    start(async () => {
      try {
        const res = await fetch(`/api/sharepoint?${query}`);
        const data = (await res.json()) as { sites?: Site[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not reach SharePoint.");
        setError(null);
        setSites(data.sites ?? []);
        // A pasted address has one answer — select it rather than making them click.
        if (looksLikeUrl && data.sites?.length === 1) chooseSite(data.sites[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach SharePoint.");
      }
    });
  }

  function chooseSite(site: Site) {
    setSiteId(site.id);
    setSiteUrl(site.webUrl);
    setDriveId("");
    setDrives([]);
    start(async () => {
      try {
        const res = await fetch(`/api/sharepoint?site=${encodeURIComponent(site.id)}`);
        const data = (await res.json()) as { drives?: Drive[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not list the libraries.");
        setError(null);
        setDrives(data.drives ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not list the libraries.");
      }
    });
  }

  return (
    <ActionForm action={saveLibrary} className="flex flex-col gap-4">
      <input type="hidden" name="spSiteId" value={siteId} />
      <input type="hidden" name="spSiteUrl" value={siteUrl} />
      <input type="hidden" name="spDriveId" value={driveId} />

      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Find a SharePoint site"
          htmlFor={`${uid}-search`}
          hint="Search by name, or paste the site address from your browser."
          className="min-w-56 flex-1"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              id={`${uid}-search`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  findSites(query);
                }
              }}
              placeholder="The Ankorage — or https://….sharepoint.com/sites/…"
              className="pl-8"
            />
          </div>
        </Field>
        <button
          type="button"
          onClick={() => findSites(query)}
          disabled={loading}
          className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {sites.length > 0 ? (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--border)] p-1 scrollbar-slim">
          {sites.map((site) => (
            <li key={site.id}>
              <button
                type="button"
                onClick={() => chooseSite(site)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  siteId === site.id
                    ? "bg-[var(--color-sunrise-50)] dark:bg-[var(--color-sunrise-900)]/30"
                    : "hover:bg-[var(--surface-2)]",
                )}
              >
                <Library className="size-4 shrink-0 text-[var(--color-coastal-500)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--text)]">
                    {site.displayName ?? site.name ?? "Site"}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-faint)]">
                    {site.webUrl}
                  </span>
                </span>
                {siteId === site.id ? (
                  <Check className="size-4 shrink-0 text-[var(--accent)]" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Document library"
          htmlFor={`${uid}-drive`}
          hint={siteId ? undefined : "Pick a site first."}
        >
          <Select
            id={`${uid}-drive`}
            value={driveId}
            onChange={(e) => setDriveId(e.target.value)}
            disabled={drives.length === 0}
          >
            <option value="">
              {drives.length === 0 ? "No libraries loaded" : "Choose a library…"}
            </option>
            {drives.map((drive) => (
              <option key={drive.id} value={drive.id}>
                {drive.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Client folder"
          htmlFor={`${uid}-root`}
          hint="Customer and project folders are created inside this. Leave blank to use the library root."
        >
          <Input
            id={`${uid}-root`}
            name="spRootFolder"
            defaultValue={settings?.spRootFolder ?? "The Gangway"}
            placeholder="The Gangway"
          />
        </Field>
      </div>

      <Field
        label="Lead folder"
        htmlFor={`${uid}-leadroot`}
        hint="Where prospect folders go, kept apart from clients. Leave blank to switch lead folders off."
      >
        <Input
          id={`${uid}-leadroot`}
          name="spLeadFolder"
          defaultValue={settings?.spLeadFolder ?? "Leads"}
          placeholder="Leads"
        />
      </Field>

      <CheckboxField
        id={`${uid}-auto`}
        name="spAutoProvision"
        label="Create folders automatically"
        hint="Make the SharePoint folder as soon as a customer or project is created, rather than on request."
        defaultChecked={settings?.spAutoProvision ?? true}
      />

      <Field
        label="Client folder structure"
        htmlFor={`${uid}-template`}
        hint="One folder per line, created inside each new customer folder. Leave blank for a bare folder. Project folders are not given a structure."
      >
        <Textarea
          id={`${uid}-template`}
          name="spFolderTemplate"
          rows={5}
          spellCheck={false}
          defaultValue={settings?.spFolderTemplate ?? DEFAULT_CLIENT_FOLDER_TEXT}
          placeholder={DEFAULT_CLIENT_FOLDER_TEXT}
        />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton disabled={!siteId || !driveId}>Save library</SubmitButton>
        <SaveIndicator />
        {settings?.spSiteUrl ? (
          <a
            href={settings.spSiteUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-[12px] font-medium text-[var(--color-coastal-600)] hover:underline underline-offset-2"
          >
            Open current site
          </a>
        ) : null}
      </div>
    </ActionForm>
  );
}
