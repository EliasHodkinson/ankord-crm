/**
 * A small, correct CSV reader. Handles quoted fields, embedded commas,
 * doubled quotes, CRLF and a UTF-8 byte-order mark — the four things that
 * break naive `split(",")` on real exports from Excel and every other CRM.
 */

export type CsvTable = { headers: string[]; rows: string[][] };

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));

  const [headers = [], ...body] = cleaned;
  return { headers, rows: body };
}

/**
 * Guesses which column is which, so a file exported from another CRM usually
 * lands correctly and only needs checking rather than mapping by hand.
 */
export function guessMapping(
  headers: string[],
  fields: { key: string; aliases: string[] }[],
): Record<string, number | null> {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalised = headers.map(normalise);
  const taken = new Set<number>();
  const mapping: Record<string, number | null> = {};

  for (const field of fields) {
    const candidates = [field.key, ...field.aliases].map(normalise);
    let index = normalised.findIndex((h, i) => !taken.has(i) && candidates.includes(h));
    if (index === -1) {
      index = normalised.findIndex(
        (h, i) => !taken.has(i) && candidates.some((c) => h.includes(c) || c.includes(h)),
      );
    }
    mapping[field.key] = index === -1 ? null : index;
    if (index !== -1) taken.add(index);
  }

  return mapping;
}

/** Normalises a name for duplicate matching: case, punctuation and suffixes. */
export function comparableName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|llc|plc|co|company|group|holdings)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
