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
| `Sites.ReadWrite.All` | Reading and writing the client files in SharePoint |
| `Tasks.ReadWrite` | Mirroring follow-ups into Microsoft To Do, and reading and writing Planner plans, buckets and tasks |
| `GroupMember.Read.All` | Naming the Microsoft 365 groups a person belongs to, so they can choose where a Planner plan lives |

Everything is **delegated**, so the CRM only ever sees what the signed-in
person can already see. There is no application permission and no service
account. `Mail.Send` is deliberately not requested — the CRM never sends mail.

> **Adding a permission to an existing deployment:** grant admin consent for it
> *before* deploying the code that requests it. The CRM asks for every scope
> each time it renews a session's token, so an unconsented scope makes that
> renewal fail and signs everyone out until consent is granted. After consent,
> people pick the new permission up the next time they sign in.

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
person to sign in becomes an admin; everyone after that starts as a member and
can be promoted in **Settings**.

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
  lib/
    auth/           Entra OIDC, sessions, token encryption
    db/             Drizzle schema and client
    graph/          Microsoft Graph — mail, SharePoint, To Do and Planner
    planner/        the Planner mapping and two-way sync
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
