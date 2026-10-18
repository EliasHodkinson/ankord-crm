/**
 * End-to-end check of the MCP server against a running dev server and a TEST
 * database: discovery, client registration, the authorization redirect, the
 * token endpoint (PKCE, refresh rotation, code reuse, revocation), and — the
 * point of it — that a restricted person cannot reach another business
 * partner through MCP, while staff can, and that MCP writes are logged.
 *
 *   npm run dev -- -p 3110            # with .env.local on a Neon test branch
 *   npx tsx scripts/mcp-check.ts      # MCP_CHECK_URL defaults to APP_URL
 *
 * The Microsoft sign-in itself can't be scripted, so the approved sessions
 * are made directly in the database — exactly what /oauth/consent makes. It
 * creates its own fixtures (named "MCP check …") and removes them after.
 * Refuses to run against production.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { createHash, createHmac, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "pg";
import { SignJWT } from "jose";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const BASE = (process.env.MCP_CHECK_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PRODUCTION_HOSTS = ["ep-sparkling-lake-a7k2ar29"];

if (!DATABASE_URL || PRODUCTION_HOSTS.some((h) => DATABASE_URL.includes(h))) {
  console.error("Refusing: DATABASE_URL is missing or is production. Point .env.local at a Neon test branch.");
  process.exit(1);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  console.error(`Refusing: ${BASE} is not a local dev server.`);
  process.exit(1);
}

const db = new Client({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false } });
const b64 = (buf: Buffer) => buf.toString("base64url");
const sha256 = (v: string) => createHash("sha256").update(v).digest("base64url");
const tag = `MCP check ${Date.now()}`;
let failures = 0;

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`  ✔ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✘ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query(sql, params);
  return rows[0] as T;
}

/* ── MCP over HTTP ───────────────────────────────────────────────── */

let rpcId = 0;
async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await response.text();
  const json = text.startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "null");
  return { status: response.status, headers: response.headers, json };
}

async function call(token: string, tool: string, args: Record<string, unknown> = {}) {
  const { status, json } = await rpc(token, "tools/call", { name: tool, arguments: args });
  assert.equal(status, 200, `HTTP ${status}: ${JSON.stringify(json)}`);
  if (json.error) throw new Error(`JSON-RPC error: ${JSON.stringify(json.error)}`);
  const text = json.result.content?.[0]?.text ?? "";
  return { isError: Boolean(json.result.isError), text };
}

async function denied(token: string, tool: string, args: Record<string, unknown>) {
  const result = await call(token, tool, args);
  assert.ok(result.isError, `${tool} should have been refused, got: ${result.text.slice(0, 200)}`);
  return result.text;
}

/* ── tokens the way the server mints them ───────────────────────── */

function accessKey() {
  const raw = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  return new Uint8Array(createHmac("sha256", raw).update("gangway-mcp-access-token").digest());
}

async function token(form: Record<string, string>) {
  const response = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return { status: response.status, json: (await response.json()) as Record<string, string> };
}

/** What approving on /oauth/consent leaves behind: an approved session and a code. */
async function connect(userId: string, clientRow: string, clientId: string, redirectUri: string) {
  const session = await one<{ id: string }>(
    `insert into sessions (user_id, kind, oauth_client_id, expires_at) values ($1, 'mcp', $2, now() + interval '1 day') returning id`,
    [userId, clientRow],
  );
  const verifier = b64(randomBytes(40));
  const code = b64(randomBytes(32));
  await db.query(
    `insert into oauth_codes (code_hash, oauth_client_id, session_id, redirect_uri, code_challenge, resource, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '2 minutes')`,
    [sha256(code), clientRow, session.id, redirectUri, sha256(verifier), `${BASE}/mcp`],
  );
  return { sessionId: session.id, code, verifier, clientId, redirectUri };
}

/* ── the run ─────────────────────────────────────────────────────── */

async function main() {
  await db.connect();
  console.log(`MCP check against ${BASE}`);

  // Fixtures: two partners, a project and step on each, a restricted person
  // granted only the first, and a staff member.
  const allowed = await one<{ id: string }>(`insert into customers (name) values ($1) returning id`, [`${tag} Allowed Pty Ltd`]);
  const other = await one<{ id: string }>(`insert into customers (name) values ($1) returning id`, [`${tag} Other Pty Ltd`]);
  const project = async (customerId: string, name: string) => {
    const p = await one<{ id: string }>(`insert into projects (customer_id, name) values ($1, $2) returning id`, [customerId, name]);
    const phase = await one<{ id: string }>(`insert into project_phases (project_id, num, label) values ($1, '01', 'Discovery') returning id`, [p.id]);
    const step = await one<{ id: string }>(
      `insert into project_steps (project_id, phase_id, title) values ($1, $2, 'Kick-off call') returning id`,
      [p.id, phase.id],
    );
    return { id: p.id, phaseId: phase.id, stepId: step.id };
  };
  const allowedProject = await project(allowed.id, `${tag} Allowed project`);
  const otherProject = await project(other.id, `${tag} Other project`);
  const lead = await one<{ id: string }>(`insert into leads (company_name) values ($1) returning id`, [`${tag} Lead`]);
  const user = async (role: string, label: string) =>
    one<{ id: string }>(
      `insert into users (azure_oid, tenant_id, email, name, role) values ($1, 'test', $2, $3, $4) returning id`,
      [`dev-mcp-${label}-${Date.now()}`, `mcp-${label}-${Date.now()}@example.test`, `${tag} ${label}`, role],
    );
  const restricted = await user("restricted", "va");
  const staff = await user("member", "staff");
  await db.query(`insert into customer_grants (user_id, customer_id) values ($1, $2)`, [restricted.id, allowed.id]);

  try {
    console.log("\nDiscovery");
    await check("authorization server metadata", async () => {
      const meta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
      assert.equal(meta.issuer, BASE);
      assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
      assert.equal(meta.client_id_metadata_document_supported, true);
      assert.equal(meta.authorization_response_iss_parameter_supported, true);
    });
    await check("protected resource metadata, at the root and the path", async () => {
      for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
        const meta = await (await fetch(`${BASE}${path}`)).json();
        assert.equal(meta.resource, `${BASE}/mcp`);
        assert.deepEqual(meta.authorization_servers, [BASE]);
      }
    });
    await check("no token → 401 naming the resource metadata", async () => {
      const { status, headers } = await rpc(null, "tools/list");
      assert.equal(status, 401);
      assert.match(headers.get("www-authenticate") ?? "", /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    });

    console.log("\nClient registration and authorization");
    const redirectUri = "http://127.0.0.1:43123/callback";
    let clientId = "";
    await check("dynamic registration of a public client", async () => {
      const response = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: `${tag} client`, redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
      });
      assert.equal(response.status, 201);
      clientId = (await response.json()).client_id;
      assert.match(clientId, /^gw_/);
    });
    await check("registration refuses a non-loopback http redirect", async () => {
      const response = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "bad", redirect_uris: ["http://evil.example/cb"] }),
      });
      assert.equal(response.status, 400);
    });
    const clientRow = (await one<{ id: string }>(`select id from oauth_clients where client_id = $1`, [clientId])).id;
    const authorize = (params: Record<string, string>) =>
      fetch(`${BASE}/oauth/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
    const goodAuth = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://127.0.0.1:59999/callback",
      code_challenge: sha256("x".repeat(43)),
      code_challenge_method: "S256",
      state: "s1",
      resource: `${BASE}/mcp`,
    };
    await check("authorize sends the person to Microsoft sign-in, with the request in a cookie", async () => {
      const response = await authorize(goodAuth);
      assert.equal(response.status, 307);
      assert.match(response.headers.get("location") ?? "", /\/api\/auth\/signin\?purpose=mcp/);
      assert.match(response.headers.get("set-cookie") ?? "", /ankord_mcp_request=/);
    });
    await check("authorize never redirects to an unregistered address", async () => {
      const response = await authorize({ ...goodAuth, redirect_uri: "https://evil.example/cb" });
      assert.match(response.headers.get("location") ?? "", /\/oauth\/consent\?error=/);
    });
    await check("authorize refuses a request without PKCE, back to the client", async () => {
      const response = await authorize({ ...goodAuth, code_challenge_method: "plain" });
      const location = new URL(response.headers.get("location") ?? "");
      assert.equal(location.searchParams.get("error"), "invalid_request");
      assert.equal(location.searchParams.get("iss"), BASE);
    });
    await check("authorize refuses a token for another resource", async () => {
      const response = await authorize({ ...goodAuth, resource: "https://graph.microsoft.com" });
      assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("error"), "invalid_target");
    });

    console.log("\nToken endpoint");
    const va = await connect(restricted.id, clientRow, clientId, redirectUri);
    const sf = await connect(staff.id, clientRow, clientId, redirectUri);
    let vaTokens: Record<string, string> = {};
    let staffTokens: Record<string, string> = {};
    await check("a wrong PKCE verifier is refused", async () => {
      const spare = await connect(staff.id, clientRow, clientId, redirectUri);
      const { status, json } = await token({
        grant_type: "authorization_code", code: spare.code, redirect_uri: redirectUri, client_id: clientId,
        code_verifier: b64(randomBytes(40)),
      });
      assert.equal(status, 400);
      assert.equal(json.error, "invalid_grant");
    });
    await check("code + verifier → access and refresh tokens", async () => {
      for (const [who, c] of [["va", va], ["staff", sf]] as const) {
        const { status, json } = await token({
          grant_type: "authorization_code", code: c.code, redirect_uri: redirectUri, client_id: clientId,
          code_verifier: c.verifier, resource: `${BASE}/mcp`,
        });
        assert.equal(status, 200, JSON.stringify(json));
        assert.equal(json.token_type, "Bearer");
        if (who === "va") vaTokens = json;
        else staffTokens = json;
      }
    });
    await check("a code used twice is refused, and ends that connection", async () => {
      const again = await connect(staff.id, clientRow, clientId, redirectUri);
      const form = { grant_type: "authorization_code", code: again.code, redirect_uri: redirectUri, client_id: clientId, code_verifier: again.verifier };
      const first = await token(form);
      assert.equal(first.status, 200);
      const second = await token(form);
      assert.equal(second.status, 400);
      const { status } = await rpc(first.json.access_token, "tools/list");
      assert.equal(status, 401, "the connection the code made should be gone");
    });
    await check("refresh rotates: the new token works, the old one doesn't", async () => {
      const fresh = await token({ grant_type: "refresh_token", refresh_token: staffTokens.refresh_token, client_id: clientId });
      assert.equal(fresh.status, 200);
      const stale = await token({ grant_type: "refresh_token", refresh_token: staffTokens.refresh_token, client_id: clientId });
      assert.equal(stale.status, 400);
      staffTokens = fresh.json;
    });
    await check("a refresh token from another client is refused", async () => {
      const { status } = await token({ grant_type: "refresh_token", refresh_token: staffTokens.refresh_token, client_id: "gw_someone_else" });
      assert.equal(status, 400);
    });
    await check("an access token for another audience is refused", async () => {
      const forged = await new SignJWT({ sid: sf.sessionId, client_id: clientId, scope: "gangway" })
        .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
        .setIssuer(BASE)
        .setAudience("https://graph.microsoft.com")
        .setSubject(staff.id)
        .setExpirationTime("5m")
        .sign(accessKey());
      assert.equal((await rpc(forged, "tools/list")).status, 401);
    });
    await check("a token naming someone else's session is refused", async () => {
      const forged = await new SignJWT({ sid: sf.sessionId, client_id: clientId, scope: "gangway" })
        .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
        .setIssuer(BASE)
        .setAudience(`${BASE}/mcp`)
        .setSubject(restricted.id)
        .setExpirationTime("5m")
        .sign(accessKey());
      assert.equal((await rpc(forged, "tools/list")).status, 401);
    });

    const vaToken = vaTokens.access_token;
    const staffToken = staffTokens.access_token;

    console.log("\nA restricted person, through MCP");
    await check("tools are listed", async () => {
      const { json } = await rpc(vaToken, "tools/list");
      const names = json.result.tools.map((t: { name: string }) => t.name);
      for (const name of ["search", "get_business_partner", "log_communication", "update_step", "create_quote"]) {
        assert.ok(names.includes(name), `missing ${name}`);
      }
    });
    await check("whoami is the restricted person", async () => {
      const me = JSON.parse((await call(vaToken, "whoami")).text);
      assert.equal(me.id, restricted.id);
      assert.equal(me.role, "restricted");
      assert.equal(me.grantedBusinessPartners, 1);
    });
    await check("reads their granted partner", async () => {
      const result = await call(vaToken, "get_business_partner", { id: allowed.id });
      assert.ok(!result.isError, result.text);
      assert.equal(JSON.parse(result.text).id, allowed.id);
    });
    await check("cannot read another partner", async () => {
      assert.match(await denied(vaToken, "get_business_partner", { id: other.id }), /Not found, or you don't have access/);
    });
    await check("search finds only their partner", async () => {
      const hits = JSON.parse((await call(vaToken, "search", { query: tag })).text) as { id: string; kind: string }[];
      const ids = hits.map((h) => h.id);
      assert.ok(ids.includes(allowed.id));
      assert.ok(!ids.includes(other.id), "other partner leaked into search");
      assert.ok(!ids.includes(otherProject.id), "other project leaked into search");
      assert.ok(!hits.some((h) => h.kind === "lead"), "a lead leaked into search");
    });
    await check("lists show only their partner", async () => {
      const partners = JSON.parse((await call(vaToken, "list_business_partners", { query: tag })).text) as { id: string }[];
      assert.deepEqual(partners.map((p) => p.id), [allowed.id]);
      const projects = JSON.parse((await call(vaToken, "list_projects", { query: tag })).text) as { id: string }[];
      assert.deepEqual(projects.map((p) => p.id), [allowedProject.id]);
    });
    await check("cannot read another partner's project", async () => {
      await denied(vaToken, "get_project", { id: otherProject.id });
    });
    await check("cannot see leads", async () => {
      await denied(vaToken, "list_leads", {});
      await denied(vaToken, "get_lead", { id: lead.id });
    });
    await check("cannot log against another partner", async () => {
      await denied(vaToken, "log_communication", { type: "call", body: "test", businessPartnerId: other.id });
      const n = await one<{ n: number }>(`select count(*)::int as n from communications where customer_id = $1`, [other.id]);
      assert.equal(n.n, 0);
    });
    await check("cannot file a task against another partner's project", async () => {
      await denied(vaToken, "create_task", { title: "sneaky", projectId: otherProject.id });
    });
    await check("cannot change another partner's runbook step", async () => {
      await denied(vaToken, "update_step", { stepId: otherProject.stepId, status: "done" });
      const step = await one<{ status: string }>(`select status from project_steps where id = $1`, [otherProject.stepId]);
      assert.equal(step.status, "todo");
    });
    await check("cannot write sales documents", async () => {
      await denied(vaToken, "create_quote", { businessPartnerId: allowed.id, lines: [{ description: "x", unitPrice: 1 }] });
    });
    await check("logs a call on their own partner, as them, marked via MCP", async () => {
      const result = await call(vaToken, "log_communication", {
        type: "call", body: `${tag}: spoke about go-live`, businessPartnerId: allowed.id, occurredAt: "2026-10-18T09:30",
      });
      assert.ok(!result.isError, result.text);
      const comm = await one<{ occurred_at: Date; logged_by_id: string }>(
        `select occurred_at, logged_by_id from communications where customer_id = $1`, [allowed.id],
      );
      assert.equal(comm.logged_by_id, restricted.id);
      assert.equal(comm.occurred_at.toISOString(), "2026-10-17T22:30:00.000Z", "09:30 Sydney (AEDT) is 22:30 UTC the day before");
      const entry = await one<{ actor_id: string; meta: Record<string, string> }>(
        `select actor_id, meta from activity where customer_id = $1 and entity_type = 'communication'`, [allowed.id],
      );
      assert.equal(entry.actor_id, restricted.id);
      assert.equal(entry.meta.via, "mcp");
    });

    console.log("\nStaff, through MCP");
    await check("reads any partner", async () => {
      const result = await call(staffToken, "get_business_partner", { id: other.id });
      assert.ok(!result.isError, result.text);
    });
    await check("updates a step, with an activity entry marked via MCP", async () => {
      const result = await call(staffToken, "update_step", {
        stepId: otherProject.stepId, status: "blocked", blockedOn: "Waiting on the client's DNS",
      });
      assert.ok(!result.isError, result.text);
      const step = await one<{ status: string; blocked_on: string }>(`select status, blocked_on from project_steps where id = $1`, [otherProject.stepId]);
      assert.equal(step.status, "blocked");
      assert.equal(step.blocked_on, "Waiting on the client's DNS");
      const entry = await one<{ verb: string; actor_id: string; meta: Record<string, string> }>(
        `select verb, actor_id, meta from activity where entity_id = $1 order by created_at desc limit 1`, [otherProject.stepId],
      );
      assert.equal(entry.verb, "mcp_update_step");
      assert.equal(entry.actor_id, staff.id);
      assert.equal(entry.meta.via, "mcp");
    });
    await check("clears the blocker", async () => {
      assert.ok(!(await call(staffToken, "clear_step_blocker", { stepId: otherProject.stepId })).isError);
      const step = await one<{ status: string; blocked_on: string | null }>(`select status, blocked_on from project_steps where id = $1`, [otherProject.stepId]);
      assert.equal(step.status, "in_progress");
      assert.equal(step.blocked_on, null);
    });
    await check("creates and completes a task", async () => {
      assert.ok(!(await call(staffToken, "create_task", { title: `${tag} chase invoice`, businessPartnerId: other.id, dueDate: "2026-10-20" })).isError);
      const task = await one<{ id: string }>(`select id from tasks where customer_id = $1`, [other.id]);
      const done = await call(staffToken, "update_task", { id: task.id, done: true });
      assert.ok(!done.isError, done.text);
      assert.equal((await one<{ status: string }>(`select status from tasks where id = $1`, [task.id])).status, "done");
    });
    await check("moves a lead's stage", async () => {
      assert.ok(!(await call(staffToken, "set_lead_stage", { leadId: lead.id, stage: "qualified" })).isError);
      assert.equal((await one<{ stage: string }>(`select stage from leads where id = $1`, [lead.id])).stage, "qualified");
    });
    await check("a bad input is refused by the schema, not written", async () => {
      const { json } = await rpc(staffToken, "tools/call", { name: "set_lead_stage", arguments: { leadId: lead.id, stage: "sold" } });
      assert.ok(json.error || json.result?.isError, "an unknown stage should not be accepted");
    });

    console.log("\nEnding a connection");
    await check("revoking the refresh token ends access at once", async () => {
      const response = await fetch(`${BASE}/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: vaTokens.refresh_token, client_id: clientId }),
      });
      assert.equal(response.status, 200);
      assert.equal((await rpc(vaToken, "tools/list")).status, 401);
    });
    await check("suspending a person ends their connection", async () => {
      await db.query(`update users set is_active = false where id = $1`, [staff.id]);
      assert.equal((await rpc(staffToken, "tools/list")).status, 401);
    });
  } finally {
    await db.query(`delete from activity where customer_id in ($1, $2) or lead_id = $3 or actor_id in ($4, $5)`, [allowed.id, other.id, lead.id, restricted.id, staff.id]);
    await db.query(`delete from customers where id in ($1, $2)`, [allowed.id, other.id]);
    await db.query(`delete from leads where id = $1`, [lead.id]);
    await db.query(`delete from users where id in ($1, $2)`, [restricted.id, staff.id]);
    await db.query(`delete from oauth_clients where name like $1`, [`${tag}%`]);
    await db.end();
  }

  console.log(failures ? `\n${failures} failed.` : "\nAll passed.");
  process.exit(failures ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
