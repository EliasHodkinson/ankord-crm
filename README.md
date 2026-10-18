# Ankor'd CRM

The internal CRM for Ankor'd — leads, customers and the people inside them,
delivery projects, and the conversations that go with them. Authentication,
files and email all run through the Ankor'd Microsoft 365 tenant.

- **Auth** — Microsoft Entra ID, single tenant, delegated permissions
- **Files** — SharePoint, browsed and uploaded from inside the CRM
- **Email** — messages linked from Outlook, shared with the team
- **Data** — Neon Postgres via Drizzle
- **Runs on** — Next.js 16 (App Router), React 19, Tailwind v4, Vercel

## What it does

| | |
|---|---|
| **Pipeline board** | Leads as a drag-and-drop board with per-column totals, or a list — the choice lives in the URL |
| **Going cold** | Anything untouched past its threshold is flagged on the card, in the list and on the dashboard. Thresholds are per-record-type and configurable |
| **Follow-ups** | A task queue grouped into overdue / today / this week, addable from any record, with a count on the navigation rail |
| **Saved views** | Any filtered list can be named and kept, privately or shared with the team |
| **⌘K** | Search records, jump anywhere, create anything, switch theme. `?` lists every shortcut |
| **Reports** | Pipeline by stage, won by month, conversation volume, delivery health, and who has gone quiet |
| **Import** | CSV in, with automatic column matching and duplicate detection against what you already have |
| **Bulk actions** | Select rows to reassign, re-stage or tag in one go |
| **Runbook projects** | Numbered phases and steps with owners, warnings, checklists, key contacts and an account register |
| **Microsoft Planner** | Each project can be kept in two-way sync with a Planner plan — create a plan from a project, a project from a plan, or link the two |
| **Sales** | Quotes → sales orders → invoices, with partial quantities. Quotes and invoices are created in Xero as drafts and take Xero's number; they are sent from Xero. Sales orders stay here and show, per line, what still needs ordering |
| **Items** | What Ankor'd sells and buys, with the Xero accounts and tax rates each line is coded to. Saved in Xero as untracked items |

---

## 1. Entra ID app registration

In the [Microsoft Entra admin centre](https://entra.microsoft.com) →
**Applications** → **App registrations** → **New registration**:

| Field | Value |
|---|---|
| Name | `Ankor'd CRM` |
| Supported account types | **Accounts in this organizational directory only (single tenant)** |
| Redirect URI | **Web** → `https://<your-domain>/api/auth/callback` |

Add a redirect URI for every origin the app runs on. For local development
that is `http://localhost:3000/api/auth/callback`.

### Client secret

**Certificates & secrets** → **New client secret**. Copy the **Value**, not the
Secret ID — the value is only shown once. Note the expiry; it will need
rotating.

### API permissions

**API permissions** → **Add a permission** → **Microsoft Graph** →
**Delegated permissions**, then **Grant admin consent**:

| Permission | Why |
|---|---|
| `openid`, `profile`, `email`, `offline_access` | Sign-in and staying signed in |
| `User.Read` | The signed-in person's name, title and photo |
| `User.ReadBasic.All` | Showing colleagues in owner and assignee pickers |
| `Mail.Read` | Reading the signed-in person's mailbox to link messages |
| `Sites.ReadWrite.All` | Reading and writing the client files in SharePoint, and sharing a client folder with a restricted person |
| `User.Invite.All` | **Admins only, asked for on demand** — inviting a VA or contractor as a B2B guest. See [People and access](#7-people-and-access) |
| `Tasks.ReadWrite` | Mirroring follow-ups into Microsoft To Do, and reading and writing Planner plans, buckets and tasks |
| `Mail.Read.Shared` | **Asked for on demand** — linking email from a shared mailbox the person can already open in Outlook |
| `GroupMember.Read.All` | Naming the Microsoft 365 groups a person belongs to, so they can choose where a Planner plan lives |

Everything is **delegated**, so the CRM only ever sees what the signed-in
person can already see. There is no application permission and no service
account. `Mail.Send` is deliberately not requested — the CRM never sends mail.

> **Adding a permission to an existing deployment:** grant admin consent for it
> *before* deploying the code that requests it. The CRM asks for every scope
> each time it renews a session's token, so an unconsented scope makes that
> renewal fail and signs everyone out until consent is granted. After consent,
> people pick the new permission up the next time they sign in.

`User.Invite.All` and `Mail.Read.Shared` are not part of an ordinary sign-in.
Each is requested only when someone first needs it — **Allow inviting guests**
in Settings → People and access, **Allow shared mailboxes** on Link email — so
nobody is prompted for what they will not use, and sign-in keeps working before
they have been consented. Grant admin consent for both along with the others.

### Shared mailboxes

List the shared mailboxes people link email from in **Settings → Shared
mailboxes** (Graph cannot list the mailboxes a person can open, so they are
named once). Link email then offers a mailbox picker. Listing a mailbox grants
nothing: Exchange decides, person by person, who can read it — the VA reads
Kee's and Annemaree's mailboxes because their account has that access in
Exchange, not because of the CRM. Where the email is filed is still limited to
the business partners that person can see.

> Want tighter file scoping? `Sites.Selected` restricts app access to named
> sites, but it is application-only. Delegated `Sites.ReadWrite.All` keeps
> access bounded by each person's own SharePoint permissions instead.

### What to copy out

From the app registration **Overview** page and the secret you just created:

- **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`
- **Application (client) ID** → `AZURE_AD_CLIENT_ID`
- **Client secret value** → `AZURE_AD_CLIENT_SECRET`

---

## 2. Environment

Copy `.env.example` to `.env.local` and fill it in.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) |
| `AZURE_AD_TENANT_ID` | Directory (tenant) ID |
| `AZURE_AD_CLIENT_ID` | Application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | The secret **value** |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64 — `openssl rand -base64 32` |
| `APP_URL` | This deployment's origin, no trailing slash |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | Optional. The Xero app; unset switches Xero off |
| `CRON_SECRET` | Optional. Guards `/api/cron/xero-sync`, which Vercel Cron calls every five minutes. Unset, the route refuses everyone |

`APP_ENCRYPTION_KEY` encrypts the Microsoft refresh tokens held per session.
Changing it signs everybody out; losing it is not recoverable, so keep a copy
in the vault.

Visiting the app before these are set shows a setup page listing what is still
missing, with the exact redirect URI to paste into Entra.

---

## 3. Database

```bash
npm install
npm run db:migrate      # apply ./drizzle to DATABASE_URL
```

After changing `src/lib/db/schema.ts`:

```bash
npm run db:generate     # write a new migration
npm run db:migrate      # apply it
```

Optional demo content for looking around:

```bash
npm run db:seed             # Maple Street Kitchens, a few leads, a full runbook project
npm run db:seed -- --clean  # remove it again
```

---

## 4. Running it

```bash
npm run dev
```

Then sign in at <http://localhost:3000> with an Ankor'd account. The first
person to sign in becomes an admin. After that, anyone who signs in without an
Entra app role, and without having been added in **Settings → People and
access**, starts Restricted and sees nothing until an admin sets their role.

Working on the UI before the app registration exists:

```bash
npm run dev:session -- you@ankord.com.au "Your Name"
```

That prints a cookie to paste into the browser console. It creates a real
session row with no Microsoft tokens, so email and SharePoint correctly report
that they need a genuine sign-in. It refuses to run in production.

---

## 5. SharePoint

An admin connects the document library once, in **Settings → SharePoint file
storage**: search for the site, pick the library, and name the folder client
work lives under (`The Gangway` by default; blank puts them at the library root).

After that, each customer and project gets a folder created on demand at
`<root>/<Customer>/<Project>`. Files are never copied into the CRM — the
database only stores the drive and item ids needed to find the folder again.

---

## 6. Microsoft Planner

A project's runbook can be kept in step with a Planner plan, in both
directions. An admin picks the Microsoft 365 group new plans go in, in
**Settings → Microsoft Planner**; that page also lists every linked project
and whether its last sync failed. From there, on any project page:

- **Create a plan from this project** — a plan named after the project, in the
  chosen group, with a bucket per phase and a task per step.
- **Link an existing plan** — phases and buckets with the same name are paired,
  as are steps and tasks with the same title; everything else is copied across
  both ways. Where a pair differs, the plan's version is kept.
- **New project → Or start from a Microsoft Planner plan** — the plan's buckets
  become phases and its tasks become steps.

| The Gangway | Planner | |
|---|---|---|
| Project name | Plan title | |
| Phase (`01` + `Discovery`) | Bucket (`01 · Discovery`) | Bucket order is Planner's; phases follow it |
| Step | Task | |
| Step title | Task title | |
| Phase the step is in | Task's bucket | Moving a task between buckets moves the step |
| Assigned to | First assignee who also uses The Gangway | Other assignees are left alone in Planner |
| Due | Due date | Read as the Australian date it falls on |
| To do / In progress / Done | Not started / In progress / Completed | Blocked reads as in progress, N/A as completed; neither is overwritten while Planner agrees |
| Description | Notes | |
| Checklist | Checklist | Up to 20 items, Planner's limit; order is left to each side |
| Links | Attachments → links | Each task also gets an "Open in The Gangway" link back to its step |

Tags, owner labels, warnings, working notes and "waiting on" stay in The
Gangway; Planner's priority, start date and labels stay in Planner.

**How it syncs.** Planner offers no change notifications, and its delta query
is beta-only, so the CRM polls: an open, linked project checks Planner when it
opens and every minute while it is visible, and any edit to its runbook is
pushed to Planner the moment it saves. Each sync compares both sides with the
values they last agreed on (stored per bucket and task, with Planner's etags),
so running it twice changes nothing the second time. A field changed on one
side takes that side; a field changed on both sides between syncs keeps
Planner's value. A deletion follows through to the other side unless the item
was edited there in the meantime, in which case the edit wins and the item is
recreated.

Every sync runs with the signed-in person's own delegated token, so nobody can
reach a plan through the CRM that Planner would not show them. A plan in a
group someone is not in will fail for them, and the project page says so.
Unlinking stops the sync and deletes nothing on either side.

---

## 6a. Sales and Xero

Design: [`docs/sales-erp-spec.md`](docs/sales-erp-spec.md). Phase A is built:
items, quotes, sales orders and invoices. Purchasing (phase B) and reserve
invoices, deliveries and payments (phase C) follow.

**Xero owns the numbers and the sending.** Saving a quote or invoice creates it
in Xero as a DRAFT and copies Xero's number back (QU-…, INV-…). Send it from
Xero. Sales orders are The Gangway's own (SO-…, numbered in Settings → Sales &
Xero); Xero sees them in the Reference of what is drawn from them and in
history notes on the quote. Nothing about Xero being down, slow or
disconnected stops a document saving or opening — it waits as "Draft · not in
Xero yet" with Retry, and the cron picks it up.

**Scopes.** Connecting Xero asks for `offline_access`, `accounting.contacts`,
`accounting.invoices`, `accounting.settings.read`, `accounting.payments.read`
and `accounting.reports.aged.read` (granular scopes, `src/lib/xero/config.ts`).
A connection made before these shows **Reconnect Xero** in Settings, and
pushes wait until it is done.

**After connecting:** Settings → Sales & Xero → **Read accounts**, then choose
the default sales and purchase accounts and tax rates. Items can override them.

**Sync.** `vercel.json` schedules `/api/cron/xero-sync` every five minutes: it
refreshes the account pickers daily, pulls status and payments for linked
documents, and pushes anything waiting, serially and within Xero's rate limit.
Vercel's Hobby plan only runs crons daily; on it, use **Sync now** in Settings
or Refresh on a document.

**Testing.** Use the Xero demo company, never the live organisation. A Neon
branch made from production carries production's Xero tokens, and Xero refresh
tokens are single-use: one refresh from the branch breaks production's
connection. Delete the `xero_connection` row on any test branch before running
the app against it, then connect the demo company there.

```bash
npm test    # totals, copy-to, line states and the Xero payload mapping
```

---

## 7. Deploying to Vercel

1. Import the repository into Vercel.
2. Add all six environment variables to the project.
3. Set `APP_URL` to the production URL.
4. Add `https://<production-domain>/api/auth/callback` to the Entra app
   registration's redirect URIs.
5. Run `npm run db:migrate` against the production `DATABASE_URL` (locally, or
   as a Vercel build step).

Preview deployments get their URL from `VERCEL_URL` automatically, but each
preview origin still needs its redirect URI registered before sign-in works
there — it is usually simpler to test against the production URL.

---

## 7. People and access

Everyone who signs in is one of four roles:

| Role | Sees |
|---|---|
| **Admin** | Everything, including Settings and People and access |
| **Staff** (`member`) | Every record — create and edit |
| **Viewer** | Every record |
| **Restricted** | Only the business partners granted to them, and what hangs off each one: its people, projects, communications, follow-ups, account register and SharePoint folder. No leads, reports, import, Xero, settings, or other partners — not in lists, search, the dashboard or the activity feed |

Admins manage this in **Settings → People and access**: add a person, set their
role, tick the business partners a restricted person may see, and suspend
someone (which signs them out everywhere and takes back the folder access the
CRM gave them). Enforcement is on the server, in `src/lib/access.ts` — every
read, action, search and file route goes through it.

### Bringing in a VA

**If they already have an account in the tenant** — Ankor'd's VA works from
`va@ankord.com.au`, a licensed member account with access to the shared
mailboxes they handle — add that address in People and access, choose
Restricted and tick their partners. The CRM finds the account and invites
nobody. If they sign in first, they land Restricted with nothing granted; tick
their partners then.

If the VA is signed in with a licensed account, check what that account
already reaches in SharePoint itself. If it is in the client site's Members or
Visitors group, or the library is shared with "Everyone except external users",
it can open every client folder in SharePoint whatever the CRM grants. The CRM
only adds and removes direct permissions on the granted folders; it does not
take away access given through the site.

**If they have no account in the tenant**, they come in as an **Entra B2B
guest**. Type their own email, leave **Invite as
a guest** ticked, choose Restricted and their partners. The CRM invites them
through Graph; Microsoft emails them (or untick that and send the link shown).
They sign in with their own email and a one-time code or their own Microsoft
account — no licence, no Ankor'd mailbox, and no password the CRM ever sees.
The app stays single-tenant: a guest is a user in the Ankor'd directory.

Anyone who signs in without having been added here, and without an Entra app
role, starts **Restricted with nothing granted** — member or guest. Having an
account in the tenant is not a reason to see the book.

What a guest cannot use: **Link email** and **To Do sync** need a mailbox and
To Do in the Ankor'd tenant, which a guest does not have. A licensed member
account like `va@` has both, and can link from the shared mailboxes it already
opens in Outlook.

### What the inviting admin needs

- **To invite guests** — `User.Invite.All` consented on the app registration,
  and a directory role that allows inviting: Guest Inviter, User Administrator,
  or the tenant's *External collaboration settings* letting members invite.
- **To share folders** — Full Control (Site Owner) on the SharePoint site that
  holds client work, or at least Manage Permissions on the client folders.
  The CRM shares as you; if SharePoint says no, the failure is shown against the
  person with a **Try again** once it is fixed.
- **SharePoint external sharing** for that site set to at least *Existing
  guests*, or guests cannot be given a folder at all.

### How folder sharing works

Granting a partner gives the person direct access to that partner's folder
(`driveItem` invite, no email). SharePoint breaks inheritance on the folder as
part of it — the parent's permissions are copied on first, so staff keep their
access — and the project folders inside inherit the grant. Every permission the
CRM adds is recorded in `sharepoint_grants`. Revoking removes exactly those and
nothing else: if the person already had access before the CRM touched the
folder, it is recorded as such and left in place on revoke.

If a partner has no folder yet, the grant is applied when the folder is
created. If the CRM's change fails, the row stays visible in Settings until it
succeeds.

### Entra app roles

If app roles are assigned in Entra, they still set Admin, Staff and Viewer at
sign-in. A restriction made in the CRM is sticky — an Entra claim never widens
it — and restricting someone is always allowed here, even when Entra assigned
their role. `CRM.Restricted` is also recognised as an app role.

---

## Layout

```
src/
  app/
    (app)/          the signed-in application
    api/            auth callbacks, Graph-backed endpoints
    signin/         sign-in page
    setup/          shown while environment variables are missing
  components/
    brand/          the Ankor'd marks, drawn in currentColor
    ui/             buttons, cards, fields, tables, badges
    app/            navigation, timeline, runbook, files, account register
      documents/    the one list, detail and editor every sales document uses
  lib/
    auth/           Entra OIDC, sessions, token encryption
    db/             Drizzle schema and client
    graph/          Microsoft Graph — mail, SharePoint, To Do and Planner
    planner/        the Planner mapping and two-way sync
    sales/          document types, totals, copy-to, fulfilment (client-safe)
    xero/           Xero auth, client, payload mapping, push engine and pull
    actions/        server actions (writes)
    data/           server queries (reads)
    templates/      project runbook templates
scripts/            migrate, seed, dev session
drizzle/            generated SQL migrations
```

`PRODUCT.md` records what the CRM is for. `DESIGN.md` records how the Ankor'd
brand becomes an interface.

## A note on the account register

The account register — on both customers and projects — has no password field
anywhere in the schema, by design. It records the system, the login URL, the
username, the MFA method, who owns the account, and **which vault record holds
the credential**. That way the register can be exported and handed to a client
without handing over the keys.
