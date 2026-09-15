# The Gangway in Microsoft Teams

Two separate things live here: the **tab**, which puts the CRM inside Teams, and
the **notifications**, which are a Power Automate flow you build in Teams itself.

---

## 1. The tab

### Build the package

```bash
cd teams && zip -j gangway-teams.zip manifest.json color.png outline.png
```

The three files must sit at the **root** of the zip — that is what `-j` does.
A zip containing a folder is rejected with a generic error.

### Upload it

Teams → **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom
app**, and pick `gangway-teams.zip`.

If that option is missing, custom app upload is switched off for the tenant:
Teams admin centre → **Teams apps** → **Setup policies** → **Upload custom
apps** → On.

The app appears in the left rail as **The Gangway**, with tabs for the
dashboard, leads, customers and follow-ups.

### What makes this work, and what breaks it

Two things in the app itself are load-bearing. Both are easy to undo by
accident:

- **`next.config.ts` sends `frame-ancestors`** permitting the Teams hosts, and
  deliberately does **not** send `X-Frame-Options`. That header has no origin
  list, so adding it blocks the tab outright.
- **The session cookie is `SameSite=None; Secure` in production**
  (`src/lib/auth/session.ts`). Inside a tab the app is framed, which makes the
  cookie third-party — under `SameSite=Lax` it is not sent and everyone looks
  permanently signed out.

**A blank tab, or a tab that insists you are signed out, is almost always one of
those two.**

### Signing in from the tab

Sign in at [gangway.ankord.com.au](https://gangway.ankord.com.au) in a normal
browser tab first. The tab then picks up the existing session.

Signing in *from inside* the tab does not work: Microsoft's own login page
refuses to be framed, so the redirect lands on a blank frame. Fixing that
properly means Teams SSO through the Teams JS SDK, which is worth doing only if
the one-time sign-in becomes annoying.

---

## 2. Notifications

The CRM posts Adaptive Cards to a **Power Automate Workflows** webhook. Office
365 connectors were disabled across Teams in May 2026, so the old "Incoming
Webhook" connector is not an option.

### Create the flow

In Teams, on the channel you want the cards in: **⋯ → Workflows → "Post to a
channel when a webhook request is received"**. Copy the URL it gives you and set
it as `TEAMS_WEBHOOK_URL` in the Vercel project.

With no URL set, notifications are silently off — nothing errors.

### Make it handle direct messages too

The CRM sends one payload shape for everything. Direct messages carry a `to`
field holding the assignee's address; channel posts send `to: null`.

In the flow, add a **Condition** on `triggerBody()?['to']`:

| Branch | Action |
|---|---|
| `to` is empty | **Post card in a chat or channel** → *Post as* **Flow bot**, *Post in* **Channel** |
| `to` has a value | **Post card in a chat or channel** → *Post as* **Flow bot**, *Post in* **Chat with Flow bot**, *Recipient* = the `to` value |

Pass `triggerBody()?['attachments'][0]?['content']` as the Adaptive Card in both
branches.

> Direct messages arrive from **Flow bot**, not from The Gangway. Rebranding the
> sender needs a registered Teams bot with an Azure Bot resource; the card
> carries the name and a link instead.

### What gets sent

| Event | Where |
|---|---|
| A lead reaches **Proposal** | Channel |
| A project is set to **Off Track** | Channel |
| A follow-up is assigned to someone else | Direct message to that person |

Every card carries a deep link back to the exact record.

A follow-up **blocked for more than 48 hours** is not here: it needs a scheduled
job rather than an event, so it belongs with a cron route.
