"use client";

import { useEffect } from "react";
import { rememberVisit } from "./command-palette";

/**
 * Records that a record page was opened, so ⌘K can offer it back under
 * "Recent". Kept in the browser — where you have been is nobody else's
 * business, and it does not need a round trip.
 */
export function TrackVisit({
  href,
  label,
  kind,
}: {
  href: string;
  label: string;
  kind: "customer" | "contact" | "lead" | "project";
}) {
  useEffect(() => {
    rememberVisit({ href, label, kind });
  }, [href, label, kind]);

  return null;
}
