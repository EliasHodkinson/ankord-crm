import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { StatusBadge, XERO_SYNC } from "@/components/ui/status";
import { listItems } from "@/lib/data/items";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { formatPrice } from "@/lib/sales/money";
import { SyncAllItems } from "./sync-all";

export const metadata: Metadata = { title: "Items" };
export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { user } = await requireUser();
  const filters = await searchParams;
  const rows = await listItems(filters);
  const canWrite = canWriteSales(user.role);

  return (
    <>
      <PageHeader
        title="Items"
        crumbs={[{ label: "Sales" }, { label: "Items" }]}
        description="What Ankor'd sells and buys, with the Xero accounts and tax rates each line is coded to. Each item is also saved in Xero."
        actions={
          canWrite ? (
            <>
              <SyncAllItems />
              <ButtonLink href="/sales/items/new" variant="primary">
                <Plus />
                New item
              </ButtonLink>
            </>
          ) : null
        }
      />
      <PageBody className="flex flex-col gap-4">
        <FilterBar
          searchPlaceholder="Search items by code or name…"
          filters={[
            {
              param: "show",
              label: "Show",
              defaultValue: "",
              options: [
                { value: "", label: "All live items" },
                { value: "stock", label: "Physical goods" },
                { value: "services", label: "Services" },
                { value: "archived", label: "Including archived" },
              ],
            },
          ]}
        />
        {rows.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title={filters.q || filters.show ? "Nothing matches that" : "No items yet"}
              description="Add what you sell — print runs, hardware, design time — with its price and Xero accounts. Lines on quotes and invoices start from here."
              action={
                canWrite ? (
                  <ButtonLink href="/sales/items/new" variant="primary">
                    <Plus />
                    New item
                  </ButtonLink>
                ) : undefined
              }
            />
          </div>
        ) : (
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Kind</Th>
                  <Th numeric>Sale price</Th>
                  <Th numeric>Buy price</Th>
                  <Th>Usual supplier</Th>
                  <Th>Xero</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, supplierName }) => (
                  <Tr key={item.id}>
                    <Td className="font-mono text-[12px]">
                      <Link href={`/sales/items/${item.id}`} className="hover:text-[var(--accent)] hover:underline underline-offset-2">
                        {item.code}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/sales/items/${item.id}`} className="font-medium hover:underline underline-offset-2">
                        {item.name}
                      </Link>
                      {item.archivedAt ? <Badge tone="muted" className="ml-2">Archived</Badge> : null}
                    </Td>
                    <Td className="text-[12px] text-[var(--text-muted)]">{item.tracksStock ? "Physical" : "Service"}</Td>
                    <Td numeric>{item.salePrice ? formatPrice(item.salePrice) : <span className="text-[var(--text-faint)]">—</span>}</Td>
                    <Td numeric>
                      {item.purchasePrice ? (
                        formatPrice(item.purchasePrice)
                      ) : item.isPurchased ? (
                        <span className="text-[var(--warn)]">Not set</span>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </Td>
                    <Td className="text-[12px] text-[var(--text-muted)]">{supplierName ?? "—"}</Td>
                    <Td>
                      <StatusBadge map={XERO_SYNC} value={item.xeroSyncState} dot />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>
        )}
      </PageBody>
    </>
  );
}
