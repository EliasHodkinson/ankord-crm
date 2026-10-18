import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { documentStatus, FULFILMENT, StatusBadge } from "@/components/ui/status";
import type { Document } from "@/lib/db/schema";
import { docHref, documentTitle, typeLabel } from "@/lib/sales/doc-types";
import { formatMoney, num } from "@/lib/sales/money";
import { formatDate, isoDate } from "@/lib/utils";

/**
 * Sales documents against one record: a business partner's "Sales" section,
 * or a project's "Commercials" card. Live work first — open orders and
 * unpaid invoices — then the recent rest.
 */
export function DocumentSummary({
  id,
  title,
  documents,
  newHref,
  canWrite,
  emptyText,
}: {
  id?: string;
  title: string;
  documents: Document[];
  /** Query string appended to the "new" links, e.g. "partner=…". */
  newHref: string;
  canWrite: boolean;
  emptyText: string;
}) {
  const today = isoDate();
  const live = documents.filter((d) => d.status !== "cancelled");
  const unpaid = live.filter((d) => d.type === "invoice" && d.status === "open" && num(d.amountDue) > 0);
  const owed = unpaid.reduce((sum, d) => sum + num(d.amountDue), 0);
  const openOrders = live.filter((d) => d.type === "sales_order" && d.status === "open");

  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader
        title={title}
        meta={
          documents.length === 0
            ? "No quotes, orders or invoices yet"
            : [
                openOrders.length ? `${openOrders.length} open ${openOrders.length === 1 ? "order" : "orders"}` : null,
                unpaid.length ? `${formatMoney(owed)} unpaid` : null,
              ]
                .filter(Boolean)
                .join(" · ") || `${documents.length} on record`
        }
        action={
          canWrite ? (
            <span className="flex gap-1">
              <ButtonLink href={`/sales/quotes/new?${newHref}`} variant="ghost" size="sm">
                <Plus />
                Quote
              </ButtonLink>
              <ButtonLink href={`/sales/invoices/new?${newHref}`} variant="ghost" size="sm">
                <Plus />
                Invoice
              </ButtonLink>
            </span>
          ) : null
        }
      />
      {documents.length === 0 ? (
        <EmptyState compact title="Nothing commercial yet" description={emptyText} />
      ) : (
        <ul className="divide-y divide-[var(--border-soft)]">
          {documents.slice(0, 12).map((d) => {
            const status = documentStatus({ ...d, today });
            return (
              <li key={d.id}>
                <Link href={docHref(d)} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text)]">{documentTitle(d)}</span>
                      <span className="text-[11px] text-[var(--text-faint)]">{typeLabel(d.type, d.isReserve)}</span>
                    </span>
                    <span className="block text-[12px] text-[var(--text-muted)]">
                      {formatDate(d.docDate)}
                      {d.reference ? ` · ${d.reference}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {d.type === "sales_order" && d.fulfilment && d.status === "open" ? (
                      <StatusBadge map={FULFILMENT} value={d.fulfilment} />
                    ) : null}
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span className="tabular w-24 text-right text-[13px]">{formatMoney(d.total)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
