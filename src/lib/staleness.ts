import { daysUntil } from "@/lib/utils";

/**
 * "Activity-based selling", the idea Pipedrive is built on: what you control
 * is whether you did something, not whether it closed. A record that has sat
 * untouched past its threshold is going cold and says so.
 */

export type Heat = "fresh" | "cooling" | "cold";

export type StaleThresholds = {
  lead: number;
  customer: number;
  project: number;
};

export const DEFAULT_THRESHOLDS: StaleThresholds = {
  lead: 7,
  customer: 90,
  project: 14,
};

/** Whole days since the last real contact, or null if there has never been one. */
export function daysSince(value: Date | string | null | undefined): number | null {
  const days = daysUntil(value);
  return days === null ? null : Math.max(0, -days);
}

/**
 * Cooling starts at the threshold; cold is half again beyond it. A record with
 * no contact at all is judged from when it was created.
 */
export function heatOf(
  lastActivityAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  thresholdDays: number,
): { heat: Heat; days: number | null } {
  const days = daysSince(lastActivityAt ?? createdAt);
  if (days === null) return { heat: "fresh", days: null };
  if (days >= Math.round(thresholdDays * 1.5)) return { heat: "cold", days };
  if (days >= thresholdDays) return { heat: "cooling", days };
  return { heat: "fresh", days };
}

export const HEAT_LABEL: Record<Heat, string> = {
  fresh: "Recently touched",
  cooling: "Going quiet",
  cold: "Gone cold",
};

/** Wording for a heat badge, e.g. "Quiet 9 days". */
export function heatSummary(heat: Heat, days: number | null): string {
  if (heat === "fresh" || days === null) return "";
  return days === 1 ? "Quiet 1 day" : `Quiet ${days} days`;
}
