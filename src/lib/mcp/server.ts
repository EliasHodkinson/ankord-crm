import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { registerRecordTools } from "./tools/records";
import { registerUpdateTools } from "./tools/updates";
import { registerSalesTools } from "./tools/sales";

const INSTRUCTIONS = `The Gangway is Ankor'd Pty Ltd's internal CRM. You are acting as the person who connected you, with exactly their role and access — nothing more. Everything you change is logged as them, marked as coming through you.

- Business partners are customers, suppliers and media (one record can be several). Contacts are the people at them. Leads are prospects (staff only). Projects are delivery runbooks: numbered phases containing steps.
- Times are Australia/Sydney. Give times as Sydney wall time (YYYY-MM-DDTHH:mm) and dates as YYYY-MM-DD. Times you read back carry their offset.
- Find ids with search or the list_* tools before writing. Never guess an id.
- "Activity" means a conversation: log_communication is what keeps a record from going cold. Editing fields is not activity.
- Sales documents: quotes and invoices belong to Xero (numbers come from Xero, they are sent from Xero). Tools that reach Xero say so — confirm with the person before calling them.
- A "not found or no access" answer is deliberate; don't retry with other ids to work around it.`;

/** A fresh server per request: the endpoint is stateless, so it scales on Vercel as-is. */
export function createGangwayServer(): McpServer {
  const server = new McpServer(
    { name: "the-gangway", title: "The Gangway", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerRecordTools(server);
  registerUpdateTools(server);
  registerSalesTools(server);
  return server;
}
