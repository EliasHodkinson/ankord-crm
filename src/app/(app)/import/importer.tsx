"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { guessMapping, parseCsv } from "@/lib/csv";
import { commitImport, previewImport } from "@/lib/actions/import";
import {
  IMPORT_FIELDS,
  type ImportKind,
  type ImportPreviewRow,
} from "@/lib/import-fields";
import { cn } from "@/lib/utils";

type Step = "choose" | "map" | "review" | "done";

/**
 * Three steps: drop the file, check the columns landed in the right place,
 * then look at what would be created — with anything that looks like an
 * existing record flagged and skipped by default.
 */
export function Importer() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [kind, setKind] = useState<ImportKind>("customers");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const fields = IMPORT_FIELDS[kind];

  function readFile(file: File) {
    setError(null);
    setFileName(file.name);
    file
      .text()
      .then((text) => {
        const table = parseCsv(text);
        if (table.headers.length === 0 || table.rows.length === 0) {
          setError("That file has no rows in it.");
          return;
        }
        setHeaders(table.headers);
        setRows(table.rows);
        setMapping(
          guessMapping(
            table.headers,
            fields.map((f) => ({ key: f.key, aliases: f.aliases })),
          ),
        );
        setStep("map");
      })
      .catch(() => setError("That file could not be read."));
  }

  function mappedRows(): Record<string, string>[] {
    return rows.map((row) => {
      const values: Record<string, string> = {};
      for (const field of fields) {
        const index = mapping[field.key];
        if (index !== null && index !== undefined) values[field.key] = row[index] ?? "";
      }
      return values;
    });
  }

  function goToReview() {
    const required = fields.filter((f) => f.required);
    const missing = required.find((f) => mapping[f.key] === null);
    if (missing) {
      setError(`Choose which column holds the ${missing.label.toLowerCase()}.`);
      return;
    }
    setError(null);
    start(async () => {
      const result = await previewImport(kind, mappedRows());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPreview(result.rows);
      // Anything that looks like an existing record is off by default.
      setSkipped(new Set(result.rows.filter((r) => r.duplicateOf).map((r) => r.index)));
      setStep("review");
    });
  }

  function commit() {
    const keep = preview.filter((r) => !skipped.has(r.index)).map((r) => r.values);
    if (keep.length === 0) {
      setError("Every row is set to be skipped.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await commitImport(kind, keep);
      if (!result.ok) {
        setError(result.message ?? "That didn't work.");
        return;
      }
      setCreated(result.created ?? keep.length);
      setStep("done");
      router.refresh();
    });
  }

  const nameKey = kind === "customers" ? "name" : "companyName";
  const duplicates = preview.filter((r) => r.duplicateOf).length;
  const keeping = preview.length - skipped.size;

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2.5 text-[13px] text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {step === "choose" ? (
        <div className="flex flex-col gap-4">
          <label className="flex max-w-xs flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">
              What are you bringing in?
            </span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
              <option value="customers">Customers</option>
              <option value="leads">Leads</option>
            </Select>
          </label>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) readFile(file);
            }}
            className="flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)] px-6 py-12 text-center transition-colors hover:border-[var(--color-coastal-300)]"
          >
            <FileUp className="size-6 text-[var(--text-faint)]" />
            <div>
              <p className="text-[14px] font-medium text-[var(--text)]">
                Drop a CSV here
              </p>
              <p className="mt-1 max-w-[46ch] text-[13px] leading-6 text-[var(--text-muted)]">
                An export from a spreadsheet or another CRM is fine — the columns are
                matched up automatically and you get to check them before anything is
                saved.
              </p>
            </div>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Choose a file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}

      {step === "map" ? (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text)]">{fileName}</span> ·{" "}
            {rows.length} {rows.length === 1 ? "row" : "rows"}. Check each column landed
            in the right place.
          </p>

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {fields.map((field) => {
              const index = mapping[field.key];
              const required = "required" in field && field.required;
              return (
                <li key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-[var(--text-muted)]">
                    {field.label}
                    {required ? <span className="ml-0.5 text-[var(--accent)]">*</span> : null}
                  </span>
                  <Select
                    value={index === null || index === undefined ? "" : String(index)}
                    aria-invalid={required && index === null ? true : undefined}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field.key]: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">Don&rsquo;t import</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                  {index !== null && index !== undefined && rows[0]?.[index] ? (
                    <span className="truncate text-[11px] text-[var(--text-faint)]">
                      e.g. {rows[0][index]}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="primary" disabled={pending} onClick={goToReview}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Check for duplicates
            </Button>
            <Button variant="ghost" onClick={() => setStep("choose")}>
              <ArrowLeft />
              Start again
            </Button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[13px] text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text)]">{keeping}</span> of{" "}
              {preview.length} will be created
            </p>
            {duplicates > 0 ? (
              <p className="inline-flex items-center gap-1.5 text-[13px] text-[var(--warn)]">
                <TriangleAlert className="size-3.5" />
                {duplicates} look like {duplicates === 1 ? "a record" : "records"} you
                already have — skipped unless you tick them
              </p>
            ) : null}
          </div>

          <div className="max-h-[26rem] overflow-auto rounded-[10px] border border-[var(--border)] scrollbar-slim">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                    Import
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                    Name
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                    Email
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--text-muted)] uppercase">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr
                    key={row.index}
                    className={cn(
                      "border-b border-[var(--border-soft)]",
                      skipped.has(row.index) && "opacity-50",
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!skipped.has(row.index)}
                        aria-label={`Import ${row.values[nameKey] || `row ${row.index + 1}`}`}
                        onChange={(e) =>
                          setSkipped((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.delete(row.index);
                            else next.add(row.index);
                            return next;
                          })
                        }
                        className="size-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-3 py-2 text-[13px] font-medium text-[var(--text)]">
                      {row.values[nameKey] || (
                        <span className="text-[var(--danger)]">No name — will be skipped</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
                      {row.values.email || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.duplicateOf ? (
                        <Badge tone="warn">
                          Matches {row.duplicateOf.name} by {row.duplicateOf.reason}
                        </Badge>
                      ) : (
                        <span className="text-[12px] text-[var(--text-faint)]">New</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="primary" disabled={pending || keeping === 0} onClick={commit}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Import {keeping} {keeping === 1 ? "record" : "records"}
            </Button>
            <Button variant="ghost" onClick={() => setStep("map")}>
              <ArrowLeft />
              Back to columns
            </Button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="flex flex-col items-start gap-4 rounded-[10px] border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-6">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text)]">
            <CheckCircle2 className="size-5 text-[var(--ok)]" />
            {created} {created === 1 ? "record" : "records"} imported
          </p>
          <p className="max-w-[60ch] text-[13px] leading-6 text-[var(--text-muted)]">
            They are in the CRM now, owned by you. Give each one an owner and a next
            action and they will start showing up on the board and in your follow-ups.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => router.push(`/${kind}`)}>
              Open {kind === "customers" ? "customers" : "leads"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStep("choose");
                setHeaders([]);
                setRows([]);
                setPreview([]);
                setSkipped(new Set());
                setFileName("");
              }}
            >
              Import another file
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
