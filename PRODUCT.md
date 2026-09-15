# Ankor'd CRM — product truth

## What it is
The internal CRM for Ankor'd Pty Ltd, a veteran-owned regional growth partner in
Australia that integrates websites, CRMs, marketing tooling and AI for small to
mid-sized businesses. The CRM is where the team tracks who they are talking to,
who they work for, what they are building for them, and everything that has been
said along the way.

## Who uses it
Ankor'd staff only. Everyone signs in with their Ankor'd Microsoft 365 account —
there are no local passwords and no external accounts. A handful of people, on
desktop, all day, alongside Outlook and SharePoint. Not a customer-facing product.

## What it must do
1. **Leads** — a pipeline of opportunities from first contact to won or lost,
   each with an owner and a next action, convertible into a customer.
2. **Customers and their people** — companies with contacts, and against each
   contact the human detail that makes a relationship real: coffee order,
   birthday, dietary needs, upcoming events, things worth remembering.
3. **Projects** — the delivery work, modelled on Ankor'd's own runbooks:
   numbered phases, steps with owners and warnings, a key-contacts list, and an
   account register that records where credentials live without ever holding one.
4. **Files** — stored in the company SharePoint, browsed and uploaded from inside
   the CRM. The CRM never becomes a second copy of the document library.
5. **Communications** — emails linked directly from Microsoft 365 against a
   customer, project or lead, visible to the whole team once linked.

## Non-negotiables
- Authentication is Microsoft Entra ID, single-tenant, delegated permissions.
  A person can only see in the CRM what they can already see in M365.
- File storage is SharePoint. Email is Microsoft 365. The CRM holds pointers.
- The account register never stores a password, only where the password lives.
- Deployed on Vercel; data in Neon Postgres.

## The usage scene
Office and home-office desks, daytime, good light, wide monitors. People arrive
with a specific question — "what did we promise them", "who is Wendy", "what is
blocking the Kitchens job" — and want it answered in seconds, not browsed.
