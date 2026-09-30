import assert from "node:assert/strict";
import { test } from "node:test";
import { Verifier, quoteInText } from "./verify";

void test("matches normalized typography and ellipses in order", () => {
  assert.equal(quoteInText("\"The Creator … sustains all things\"", "“The Créator creates and sustains   all things”"), true);
  assert.equal(quoteInText("sustains all things ... The Creator", "The Creator creates and sustains all things"), false);
});

void test("rejects empty quotes and preserves short fragments", () => {
  for (const quote of ["", " ", "...", "…", '""']) assert.equal(quoteInText(quote, "Any source text"), false, quote);
  assert.equal(quoteInText("a", "xyz"), false);
  assert.equal(quoteInText("is ... a", "xyz"), false);
  assert.equal(quoteInText("is ... a", "is indeed a"), true);
});

void test("does not reuse characters between quote fragments", () => {
  assert.equal(quoteInText("abc ... cde", "abcde"), false);
  assert.equal(quoteInText("abc ... cde", "abc cde"), true);
});

void test("reports rendered HTTP failures as unreachable and closes the page", async () => {
  for (const status of [403, 404, 429, 503]) {
    let closed = false;
    let evaluated = false;
    const verifier = new Verifier();
    Object.assign(verifier, {
      staticText: async () => { throw new Error(`HTTP ${status}`); },
      browser: Promise.resolve({
        newPage: async () => ({
          setUserAgent: async () => {},
          goto: async () => ({ ok: () => false, status: () => status }),
          evaluate: async () => { evaluated = true; return "Just a moment..."; },
          close: async () => { closed = true; },
        }),
      }),
    });
    const result = await verifier.check({ url: "https://example.org/source", quote: "The Creator" }, ["example.org"]);
    assert.equal(result.status, "unreachable");
    assert.equal(result.detail, `HTTP ${status}`);
    assert.equal(closed, true);
    assert.equal(evaluated, false);
  }
});

void test("rejects sources outside the allowlist without fetching", async () => {
  const verifier = new Verifier();
  Object.assign(verifier, { staticText: async () => assert.fail("must not fetch an off-allowlist source") });
  const result = await verifier.check({ url: "https://untrusted.example/source", quote: "The Creator" }, ["example.org"]);
  assert.equal(result.status, "off_allowlist");
});
