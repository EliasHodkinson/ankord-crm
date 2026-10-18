import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "Wendy Alder" → "DF"; falls back to a single letter. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? AUD.format(n) : "—";
}

/**
 * Ankor'd works in Sydney time. The server runs in UTC, so anything that turns
 * an instant into a wall-clock date or time — or a typed wall-clock time back
 * into an instant — has to name the zone rather than trust the process.
 */
export const APP_TIME_ZONE = "Australia/Sydney";

const wallParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wallClock(d: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of wallParts.formatToParts(d)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** How far Sydney is ahead of UTC at a given instant, in ms. */
function zoneOffset(ms: number): number {
  const p = wallClock(new Date(ms));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A `datetime-local` value ("2026-10-18T17:00", no zone) read as Sydney time.
 * Anything carrying its own zone is parsed as given; anything else is null.
 */
export function fromWallTime(value: string): Date | null {
  const m = WALL_TIME.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let at = guess - zoneOffset(guess);
  // Across a daylight-saving change the offset at the answer can differ.
  const second = guess - zoneOffset(at);
  if (second !== at) at = second;
  return new Date(at);
}

/** An instant as a `datetime-local` value in Sydney time. */
export function toWallTime(value: Date = new Date()): string {
  const p = wallClock(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDate(
  value: Date | string | null | undefined,
  style: "short" | "long" | "day" = "short",
): string {
  if (!value) return "—";
  // A bare date is a calendar day, not an instant: midday UTC falls on that
  // same day in Sydney.
  const d = typeof value === "string" ? new Date(`${value}${value.length === 10 ? "T12:00:00Z" : ""}`) : value;
  if (Number.isNaN(d.getTime())) return "—";
  if (style === "day") {
    return d.toLocaleDateString("en-AU", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short" });
  }
  if (style === "long") {
    return d.toLocaleDateString("en-AU", {
      timeZone: APP_TIME_ZONE,
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return d.toLocaleDateString("en-AU", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)} · ${d.toLocaleTimeString("en-AU", {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** "3 days ago", "in 2 weeks", "just now". */
export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";

  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  if (abs < 45_000) return "just now";
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

/**
 * Days until the next occurrence of a month/day, ignoring the stored year —
 * used for birthdays and anniversaries.
 */
export function daysUntilAnniversary(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

export function bytes(size: number | null | undefined): string {
  if (!size && size !== 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Deterministic hue for avatar tints, so a person keeps the same colour. */
export function tintIndex(seed: string, buckets = 6): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % buckets;
}

export function truncate(value: string | null | undefined, max = 140): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Whole days from today to a date, negative once it has passed. */
export function daysUntil(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/**
 * How far away a dated fact is — anniversaries roll to their next occurrence,
 * one-off dates count down and then go negative.
 */
export function daysAway(
  value: string | Date | null | undefined,
  recurring: boolean,
): number | null {
  return recurring ? daysUntilAnniversary(value) : daysUntil(value);
}

/** "Morning" / "Afternoon" / "Evening" for the current local time. */
export function timeOfDayGreeting(): string {
  const hour = wallClock(new Date()).hour;
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/** Midnight on the first of the month, `back` months ago. */
export function monthsBack(back: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - back);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A point in time `days` ago. */
export function daysBack(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Today as an ISO date string, and the same offset by `days`. */
export function isoDate(offsetDays = 0): string {
  return toWallTime(new Date(Date.now() + offsetDays * 86_400_000)).slice(0, 10);
}

/** Today's date written out in full, Australian style. */
export function todayLongDate(): string {
  return new Date().toLocaleDateString("en-AU", {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
