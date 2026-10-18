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
| `Sites.ReadWrite.All` | Reading and writing the client files in SharePoint, and sharing a client folder with a restricted person |
| `Tasks.ReadWrite` | Mirroring follow-ups into the signed-in person's Microsoft To Do |
| `User.Invite.All` | **Admins only, asked for on demand** — inviting a VA or contractor as a B2B guest. See [People and access](#7-people-and-access) |

Everything is **delegated**, so the CRM only ever sees what the signed-in
person can already see. There is no application permission and no service
account. `Mail.Send` is deliberately not requested — the CRM never sends mail.

`User.Invite.All` is not part of an ordinary sign-in. It is requested only when
an admin clicks **Allow inviting guests** in Settings → People and access, so
nobody else is prompted for it and sign-in keeps working before it has been
consented. Grant admin consent for it along with the others.

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
nobody. Do this **before** they first sign in: a member who signs in without a
row here becomes Staff and sees everything.

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

A guest who signs in without having been added here starts **Restricted with
nothing granted**. Being a guest in the tenant — for a Teams channel, a shared
file — is not a reason to see the book.

What a guest cannot use: **Link email** and **To Do sync** need a mailbox and
To Do in the Ankor'd tenant, which a guest does not have.

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
