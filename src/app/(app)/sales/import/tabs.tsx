"use client";

import { FileText, Tags, Users } from "lucide-react";
import { ViewToggle } from "@/components/app/view-toggle";

/** The three steps, in the order they depend on each other. */
export function ImportTabs() {
  return (
    <ViewToggle
      views={[
        { value: "contacts", label: "1 · Contacts", icon: Users },
        { value: "items", label: "2 · Items", icon: Tags },
        { value: "documents", label: "3 · Quotes & invoices", icon: FileText },
      ]}
      param="tab"
      defaultView="contacts"
      label="Step"
      clears={["show", "q", "source", "mode", "from", "to", "numbers"]}
    />
  );
}
