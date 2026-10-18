import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { IMPORT_ITEM_PLAN, IMPORT_MATCH, StatusBadge } from "@/components/ui/status";
import { canWriteSales, requireUser } from "@/lib/auth/session";
import { requireStaffPage } from "@/lib/access";
import { readXeroConnection } from "@/lib/xero/auth";
import { xeroContactUrl } from "@/lib/xero/links";
import { loadContactReview, loadDocumentPreview, loadItemReview } from "@/lib/data/xero-import";
import { parseScope, parseSource } from "@/lib/xero/import/scope";
import { formatPrice } from "@/lib/sales/money";
import { ContactDecision, ImportItemsButton, LinkStrongButton } from "./import-controls";
import { DocumentImport } from "./document-import";
import { ImportTabs } from "./tabs";

const TABS = ["contacts", "items", "documents"];

export const metadata: Metadata = { title: "Import from Xero" };
export const dynamic = "force-dynamic";

type Search = {
  tab?: string;
  show?: string;
  q?: string;
  source?: string;
  mode?: string;
  from?: string;
  to?: string;
  numbers?: string;
};

/**
 * Import from Xero (spec Q11): contacts → business partners, then items,
 * then quotes and invoices. Every tab reads Xero live and shows what would
 * happen before anything does; nothing here ever writes to Xero.
 */
export default async function ImportFromXeroPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireStaffPage();
  const [{ user }, params, connection] = await Promise.all([
    requireUser(),
    searchParams,
    readXeroConnection().catch(() => null),
  ]);
  const canWrite = canWriteSales(user.role);
  const tab = TABS.includes(params.tab ?? "") ? params.tab! : "contacts";

  return (
    <>
      <PageHeader
        title="Import from Xero"
        crumbs={[{ label: "Sales" }, { label: "Import from Xero" }]}
        description="Bring what is already in Xero into The Gangway and carry on from there. Match contacts to business partners first; their quotes and invoices follow. Importing only reads Xero — nothing is created or changed there."
      />
      <PageBody className="flex flex-col gap-4">
        {!connection ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <EmptyState
              title="Connect Xero first"
              description="The import reads contacts, items, quotes and invoices from Xero. An admin can connect it in Settings."
              action={<ButtonLink href="/settings#sales">Open settings</ButtonLink>}
            />
          </div>
        ) : (
          <>
            <ImportTabs />
            {tab === "contacts" ? <ContactsTab params={params} canWrite={canWrite} /> : null}
            {tab === "items" ? <ItemsTab canWrite={canWrite} /> : null}
            {tab === "documents" ? <DocumentsTab params={params} canWrite={canWrite} /> : null}
          </>
        )}
      </PageBody>
    </>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
      Could not read Xero: {message}
    </p>
  );
}

async function ContactsTab({ params, canWrite }: { params: Search; canWrite: boolean }) {
  const loaded = await loadContactReview(params);
  if (!loaded.ok) return <Problem message={loaded.message} />;
  const { rows, counts, freePartners } = loaded.data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--text-muted)]">
          {counts.total} active contacts in Xero · {counts.linked} linked · {counts.decide} to decide
          {counts.skipped ? ` · ${counts.skipped} skipped` : ""}
        </p>
        {canWrite ? <LinkStrongButton count={counts.strong} /> : null}
      </div>
      <FilterBar
        searchPlaceholder="Search Xero contacts by name or email…"
        filters={[
          {
            param: "show",
            label: "Show",
            defaultValue: "decide",
            options: [
              { value: "decide", label: "To decide" },
              { value: "linked", label: "Linked" },
              { value: "skipped", label: "Skipped" },
              { value: "all", label: "All contacts" },
            ],
          },
        ]}
      />
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            compact
            title={params.q || (params.show && params.show !== "decide") ? "Nothing matches that" : "Every contact is decided"}
            description="Each Xero contact is linked to a business partner or skipped. Move on to items, then quotes and invoices."
            action={<ButtonLink href="/sales/import?tab=items">Items</ButtonLink>}
          />
        </div>
      ) : (
        <TableShell>
          <Table>
            <thead>
              <tr>
                <Th>Xero contact</Th>
                <Th>Suggested match</Th>
                <Th className="w-[26rem]">Decision</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ contact, suggestion, skipped }) => (
                <Tr key={contact.contactId}>
                  <Td className="align-top">
                    <a
                      href={xeroContactUrl(contact.contactId) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {contact.name}
                    </a>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                      {contact.isCustomer ? <Badge tone="neutral">Customer</Badge> : null}
                      {contact.isSupplier ? <Badge tone="neutral">Supplier</Badge> : null}
                      {contact.taxNumber ? <span className="tabular">ABN {contact.taxNumber}</span> : null}
                      {contact.email ? <span className="[overflow-wrap:anywhere]">{contact.email}</span> : null}
                    </span>
                  </Td>
                  <Td className="align-top">
                    {suggestion ? (
                      <span className="flex flex-col items-start gap-1">
                        <Link href={`/customers/${suggestion.partnerId}`} className="hover:underline underline-offset-2">
                          {suggestion.partnerName}
                        </Link>
                        <StatusBadge map={IMPORT_MATCH} value={suggestion.reason} />
                      </span>
                    ) : (
                      <span className="text-[12px] text-[var(--text-faint)]">No match here</span>
                    )}
                  </Td>
                  <Td className="align-top">
                    {suggestion?.reason === "linked" ? (
                      <span className="text-[12px] text-[var(--text-muted)]">Linked. Its documents can be imported.</span>
                    ) : canWrite ? (
                      <ContactDecision
                        contactId={contact.contactId}
                        contactName={contact.name}
                        suggestion={suggestion}
                        partners={freePartners}
                        skipped={skipped}
                      />
                    ) : (
                      <span className="text-[12px] text-[var(--text-faint)]">View only</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableShell>
      )}
    </>
  );
}

async function ItemsTab({ canWrite }: { canWrite: boolean }) {
  const loaded = await loadItemReview();
  if (!loaded.ok) return <Problem message={loaded.message} />;
  const rows = loaded.data;
  const pending = rows.filter((r) => r.plan === "create" || r.plan === "update").length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-[13px] leading-5 text-[var(--text-muted)]">
          {rows.length} items in Xero. Prices, accounts and tax rates come from Xero; whether an item is physical stock,
          its unit and usual supplier stay as set here. Running it again updates rather than duplicates.
        </p>
        {canWrite ? <ImportItemsButton count={pending} /> : null}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState compact title="Xero has no items" description="Lines on Xero documents still import, as free-text lines." />
        </div>
      ) : (
        <TableShell>
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th numeric>Sale price</Th>
                <Th numeric>Buy price</Th>
                <Th>Accounts</Th>
                <Th>Import</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.xeroItemId}>
                  <Td className="font-mono text-[12px]">
                    {row.existing ? (
                      <Link href={`/sales/items/${row.existing.id}`} className="hover:text-[var(--accent)] hover:underline underline-offset-2">
                        {row.fields.code}
                      </Link>
                    ) : (
                      row.fields.code
                    )}
                  </Td>
                  <Td className="font-medium">{row.fields.name}</Td>
                  <Td numeric>{row.fields.salePrice ? formatPrice(row.fields.salePrice) : "—"}</Td>
                  <Td numeric>{row.fields.purchasePrice ? formatPrice(row.fields.purchasePrice) : "—"}</Td>
                  <Td className="text-[12px] text-[var(--text-muted)]">
                    {[
                      row.fields.isSold ? `Sales ${row.fields.salesAccountCode ?? "default"}` : null,
                      row.fields.isPurchased ? `Purchases ${row.fields.purchaseAccountCode ?? "default"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Td>
                  <Td>
                    <span className="flex flex-col items-start gap-1">
                      <StatusBadge map={IMPORT_ITEM_PLAN} value={row.plan} />
                      {row.note ? <span className="max-w-[36ch] text-[12px] leading-4 text-[var(--text-muted)]">{row.note}</span> : null}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableShell>
      )}
    </>
  );
}

async function DocumentsTab({ params, canWrite }: { params: Search; canWrite: boolean }) {
  const source = parseSource(params.source);
  const scope = parseScope(params);
  const loaded = await loadDocumentPreview(source, scope);
  return (
    <DocumentImport
      source={source}
      scope={scope}
      rows={loaded.ok ? loaded.data : []}
      problem={loaded.ok ? null : loaded.message}
      canWrite={canWrite}
    />
  );
}
