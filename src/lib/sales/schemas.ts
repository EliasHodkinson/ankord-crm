import { z } from "zod";
import { MAX_LINES } from "./doc-types";
import { toScaled } from "./money";

/**
 * The lines grid travels as JSON in one hidden input. This is its shape, and
 * the line-level rules from spec §4.7. Header fields are validated in the
 * action with the `optional*` helpers.
 */

/** A decimal kept as a string; extra places are rounded later by toScaled. */
const decimal = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/,/g, ""))
    .refine((v) => v === "" || /^-?\d*(\.\d*)?$/.test(v), `${label} must be a number.`)
    .transform((v) => (v === "" || v === "." ? "0" : v));

const nullableId = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.uuid().nullable(),
);
const nullableText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
  z.string().trim().nullable(),
);

export const lineInput = z.object({
  /** Set for a line that already exists; absent for a new one. */
  id: nullableId.optional(),
  rowType: z.enum(["item", "alternative", "text", "subtotal"]),
  itemId: nullableId.optional(),
  description: z.string().max(4000, "Line descriptions stop at 4,000 characters.").default(""),
  note: nullableText.optional(),
  quantity: decimal("Quantity").default("0"),
  unitPrice: decimal("Price").default("0"),
  discountPercent: decimal("Discount").default("0"),
  accountCode: nullableText.optional(),
  taxType: nullableText.optional(),
  baseLineId: nullableId.optional(),
});

export type LineInput = z.infer<typeof lineInput>;

export const linesInput = z
  .array(lineInput)
  .max(MAX_LINES, `A document can have at most ${MAX_LINES} lines.`);

/** Problems with the lines as a whole, worded for the person fixing them. */
export function lineProblems(
  lines: LineInput[],
  opts: { isQuote: boolean; amountsAre: "exclusive" | "inclusive" | "no_tax" },
): string | null {
  const items = lines.filter((l) => l.rowType === "item");
  if (items.length === 0) {
    return opts.isQuote && lines.some((l) => l.rowType === "alternative")
      ? "A quote needs at least one line that is not an alternative."
      : "Add at least one line.";
  }

  let itemAbove = false;
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    if (line.rowType === "text") {
      if (!line.description.trim()) return `Line ${n} is an empty text row. Type something or remove it.`;
      continue;
    }
    if (line.rowType === "subtotal") {
      if (!itemAbove) return `The subtotal on line ${n} has nothing above it to add up.`;
      itemAbove = false;
      continue;
    }
    if (line.rowType === "alternative" && !opts.isQuote) {
      return "Only quotes can have alternative lines.";
    }
    if (line.rowType === "item") itemAbove = true;

    if (!line.itemId && !line.description.trim()) {
      return `Line ${n} needs an item or a description.`;
    }
    if (toScaled(line.quantity) <= BigInt(0)) return `Line ${n} needs a quantity above zero.`;
    if (toScaled(line.unitPrice) < BigInt(0)) return `Line ${n} has a negative price.`;
    const discount = toScaled(line.discountPercent);
    if (discount < BigInt(0) || discount > toScaled(100)) {
      return `The discount on line ${n} must be between 0 and 100%.`;
    }
    if (opts.amountsAre !== "no_tax" && !line.taxType) {
      return `Line ${n} needs a tax rate.`;
    }
  }
  return null;
}
