import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalResource,
  isAllowedRedirectUri,
  isMetadataDocumentUrl,
  parseMetadataDocument,
  pkceChallenge,
  redirectUriMatches,
  resourceAllowed,
  verifyPkce,
  withParams,
} from "./oauth-rules";

test("redirect URIs: https, loopback http and app schemes; nothing that runs or leaks", () => {
  assert.ok(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(isAllowedRedirectUri("http://localhost:33418/callback"));
  assert.ok(isAllowedRedirectUri("http://127.0.0.1:6274/oauth/callback"));
  assert.ok(isAllowedRedirectUri("http://[::1]:8080/cb"));
  assert.ok(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback"));

  assert.ok(!isAllowedRedirectUri("http://evil.example/callback"), "plain http off loopback");
  assert.ok(!isAllowedRedirectUri("javascript:alert(1)"));
  assert.ok(!isAllowedRedirectUri("data:text/html,hi"));
  assert.ok(!isAllowedRedirectUri("file:///etc/passwd"));
  assert.ok(!isAllowedRedirectUri("https://claude.ai/cb#frag"));
  assert.ok(!isAllowedRedirectUri("https://user:pw@claude.ai/cb"));
  assert.ok(!isAllowedRedirectUri("not a url"));
});

test("redirect URI matching is exact, except a loopback port", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/callback"];
  assert.ok(redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback"));
  assert.ok(redirectUriMatches(registered, "http://localhost:51234/callback"), "any loopback port");
  assert.ok(!redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback/x"));
  assert.ok(!redirectUriMatches(registered, "https://claude.ai.evil.example/api/mcp/auth_callback"));
  assert.ok(!redirectUriMatches(registered, "http://localhost:51234/other"), "path still has to match");
  assert.ok(!redirectUriMatches(registered, "http://127.0.0.1:3000/callback"), "host still has to match");
});

test("PKCE S256: the RFC 7636 appendix B example, and refusals", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(pkceChallenge(verifier), challenge);
  assert.ok(verifyPkce(verifier, challenge));
  assert.ok(!verifyPkce(`${verifier}x`, challenge));
  assert.ok(!verifyPkce("too-short", pkceChallenge("too-short")), "verifier under 43 characters");
});

test("resource indicators: this MCP endpoint, its origin, or nothing", () => {
  const mcp = "https://gangway.ankord.com.au/mcp";
  assert.ok(resourceAllowed(undefined, mcp));
  assert.ok(resourceAllowed("https://gangway.ankord.com.au/mcp", mcp));
  assert.ok(resourceAllowed("HTTPS://Gangway.Ankord.com.au/mcp/", mcp), "case and trailing slash");
  assert.ok(resourceAllowed("https://gangway.ankord.com.au", mcp));
  assert.ok(!resourceAllowed("https://graph.microsoft.com", mcp));
  assert.ok(!resourceAllowed("https://gangway.ankord.com.au/other", mcp));
  assert.ok(!resourceAllowed("not a url", mcp));
  assert.equal(canonicalResource("https://a.example:443/mcp/"), "https://a.example/mcp");
});

test("client metadata documents: https URLs with a path, never an address", () => {
  assert.ok(isMetadataDocumentUrl("https://claude.ai/oauth/mcp-oauth-client-metadata"));
  assert.ok(!isMetadataDocumentUrl("https://claude.ai/"));
  assert.ok(!isMetadataDocumentUrl("http://claude.ai/client.json"));
  assert.ok(!isMetadataDocumentUrl("https://169.254.169.254/latest/meta-data"));
  assert.ok(!isMetadataDocumentUrl("https://localhost/client.json"));
  assert.ok(!isMetadataDocumentUrl("gw_abc123"));
});

test("a metadata document must name itself, and register usable redirect URIs", () => {
  const url = "https://client.example/oauth/client.json";
  const good = parseMetadataDocument(url, {
    client_id: url,
    client_name: "Example\nClient",
    redirect_uris: ["https://client.example/cb", "http://evil.example/cb"],
    token_endpoint_auth_method: "none",
  });
  assert.ok(!("error" in good));
  if (!("error" in good)) {
    assert.equal(good.name, "Example Client");
    assert.deepEqual(good.redirectUris, ["https://client.example/cb"]);
  }
  assert.ok("error" in parseMetadataDocument(url, { client_id: "https://other.example/c.json", redirect_uris: ["https://client.example/cb"] }));
  assert.ok("error" in parseMetadataDocument(url, { client_id: url, redirect_uris: [] }));
  assert.ok("error" in parseMetadataDocument(url, { client_id: url, redirect_uris: ["http://evil.example/cb"] }));
  assert.ok("error" in parseMetadataDocument(url, { client_id: url, redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "client_secret_basic" }));
  assert.ok("error" in parseMetadataDocument(url, ["not", "an", "object"]));
});

test("redirect parameters are added without losing the client's own", () => {
  const out = new URL(withParams("https://client.example/cb?keep=1", { code: "abc", state: "x y", iss: undefined }));
  assert.equal(out.searchParams.get("keep"), "1");
  assert.equal(out.searchParams.get("code"), "abc");
  assert.equal(out.searchParams.get("state"), "x y");
  assert.equal(out.searchParams.has("iss"), false);
});
