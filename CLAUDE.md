@AGENTS.md

# Ankor'd CRM — working notes

Read `README.md` for setup, `PRODUCT.md` for what this is, and `DESIGN.md`
before touching anything visual.

## Shape of the code

- **Reads** live in `src/lib/data/*` (plain server modules).
  **Writes** live in `src/lib/actions/*` (`"use server"`).
  Never export a non-async or read-only helper from a `"use server"` file —
  every export there becomes a public endpoint.
- Pages are server components and `force-dynamic`; interactivity is pushed down
  into small client components.
- Colours, spacing and type come from the tokens in `globals.css`. Do not
  introduce a hex value in a component.
- Enum wording and badge colour live in `src/components/ui/status.tsx`. Add new
  states there, not inline.

## Rules that are not obvious

- The account register (`project_accounts`) deliberately has **no password
  column**. It records where a credential lives, never the credential.
- Microsoft tokens are encrypted with `APP_ENCRYPTION_KEY` and stored per
  session, so deleting a session revokes Graph access with it.
- Graph is always called with the signed-in person's delegated token. There is
  no service account, and `Mail.Send` is not requested.
- Forms use `ActionForm`, which retains typed values across a failed submit —
  React 19 otherwise resets uncontrolled inputs once an action resolves. New
  fields should go through `form-kit.tsx` so they inherit that.
- Overlays must escape the app header: it uses `backdrop-filter`, which makes it
  a containing block for `position: fixed`. Portal to `document.body`.
- A `"use server"` file may only export **async functions**. Constants and types
  shared with the client live elsewhere — `lib/import-fields.ts`, `lib/tasks.ts`,
  `lib/staleness.ts` exist for exactly that reason. TypeScript will not catch it;
  it fails at runtime in the browser.
- Optional form fields go through the `optional*` helpers in `actions/shared.ts`,
  which treat an **absent** field as null, not just an empty one. A field behind
  a toggle is not in the FormData at all.
- "Activity" means a conversation, not an edit. `touchRecords()` sets
  `lastActivityAt`, and that is what going-cold is measured against.
- Charts use the `--chart-*` tokens. The dark ramp is a chosen set of steps, not
  a flip of the light one — see DESIGN.md.

## Checks

```bash
npx tsc --noEmit && npx eslint . && npm run build
```
