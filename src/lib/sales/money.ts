/**
 * Decimal arithmetic for money and quantities, without floats.
 *
 * Postgres hands numerics back as strings and that is how they travel through
 * the app. Anything that does sums turns them into scaled integers (BigInt)
 * first: quantities, prices, discounts and tax rates carry four places, money
 * carries two. Client-safe — the editor's totals preview uses the same code as
 * the server, so a figure can never differ by a cent between the two.
 */

export const SCALE4 = BigInt(10_000);

/** "12.5" → 125000n at four places. Anything unparseable is 0. */
export function toScaled(value: string | number | null | undefined, places = 4): bigint {
  if (value === null || value === undefined || value === "") return BigInt(0);
  const text = typeof value === "number" ? value.toFixed(places + 2) : value.trim();
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return BigInt(0);
  const [, sign, whole = "", fraction = ""] = match;
  // Extra places are rounded half away from zero, like everything else here.
  const padded = (fraction + "0".repeat(places + 1)).slice(0, places + 1);
  let scaled = BigInt((whole || "0") + padded.slice(0, places));
  if (Number(padded[places]) >= 5) scaled += BigInt(1);
  return sign === "-" ? -scaled : scaled;
}

/** 125000n at four places → "12.5000". */
export function fromScaled(value: bigint, places = 4): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places);
  return `${negative ? "-" : ""}${whole}${places ? `.${fraction}` : ""}`;
}

/** Integer division rounding half away from zero — Xero's rounding. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const zero = BigInt(0);
  if (denominator === zero) return zero;
  const negative = numerator < zero !== denominator < zero;
  const n = numerator < zero ? -numerator : numerator;
  const d = denominator < zero ? -denominator : denominator;
  const q = (n * BigInt(2) + d) / (d * BigInt(2));
  return negative ? -q : q;
}

/** Cents → "1234.56". */
export const centsToString = (cents: bigint) => fromScaled(cents, 2);

/** "1234.56" → cents. */
export const toCents = (value: string | number | null | undefined) => toScaled(value, 2);

/** A numeric string as a number, for display and comparisons that need no exactness. */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Quantities without trailing zeros: "500.0000" → "500", "2.5000" → "2.5". */
export function formatQty(value: string | number | null | undefined): string {
  const text = fromScaled(toScaled(value, 4), 4);
  return text.replace(/\.?0+$/, "") || "0";
}

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,650.00" — sales documents always show cents. */
export function formatMoney(value: string | number | null | undefined): string {
  return AUD.format(num(value));
}

/** Prices can carry four places; show at least two and at most four. */
export function formatPrice(value: string | number | null | undefined): string {
  const n = num(value);
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}
