import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPublisherChrome, nwtBody } from "./scripture-html";

void test("bounds the last NWT verse before site navigation even without footnotes", () => {
  const html = '<article>Navigation</article><article><span id="v40-3-17-1">Verse text.</span></article><footer>English Publications (1950-2026)</footer>';
  assert.equal(nwtBody(html), '<span id="v40-3-17-1">Verse text.</span>');
});

void test("bounds NWT verses before the footnote group", () => {
  assert.equal(nwtBody('<span id="v40-3-17-1">Verse.</span><div class="groupFootnote">Note</div></article>'), '<span id="v40-3-17-1">Verse.</span>');
});

void test("rejects missing markers or an unbounded NWT page", () => {
  assert.throws(() => nwtBody("Access denied"), /no verse markers/);
  assert.throws(() => nwtBody('<span id="v40-3-17-1">Verse.'), /no scripture boundary/);
});

void test("identifies contaminated cached verse text for refetching", () => {
  assert.equal(hasPublisherChrome("Verse. English Publications (1950-2026) Log In"), true);
  assert.equal(hasPublisherChrome("Verse only."), false);
});
