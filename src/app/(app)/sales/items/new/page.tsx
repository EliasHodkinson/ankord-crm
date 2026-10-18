import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { requireStaffPage } from "@/lib/access";
import { ItemForm } from "../item-form";
import { itemFormOptions } from "../item-data";

export const metadata: Metadata = { title: "New item" };
export const dynamic = "force-dynamic";

export default async function NewItemPage() {
  await requireStaffPage();
  const options = await itemFormOptions();
  return (
    <>
      <PageHeader
        title="New item"
        crumbs={[{ label: "Sales" }, { label: "Items", href: "/sales/items" }, { label: "New" }]}
        description="Saving also creates it in Xero as an untracked item, with these accounts and tax rates."
      />
      <PageBody className="max-w-[60rem]">
        <Card>
          <CardBody>
            <ItemForm item={null} {...options} />
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
