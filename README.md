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
| **Runbook projects** | Numbered phases and steps with owners, warnings, key contacts and an account register |

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

Everything is **delegated**, so the CRM only ever sees what the signed-in
person can already see. There is no application permission and no service
account. `Mail.Send` is deliberately not requested — the CRM never sends mail.

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

## 6. Deploying to Vercel

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
    graph/          Microsoft Graph — mail and SharePoint
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
