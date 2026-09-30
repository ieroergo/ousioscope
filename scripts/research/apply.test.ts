import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { applyOps } from "./apply";
import type { JudgeOutput } from "./schemas";
import { Verifier } from "./verify";

async function fixture(fn: (root: string, verifier: Verifier) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "ousio-apply-test-"));
  mkdirSync(join(root, "data/traditions/example"), { recursive: true });
  writeFileSync(join(root, "data/traditions/example/model.yaml"), "nodes:\n  - id: person\n    label: Person\n    attributes:\n      - name: Nature\n        value: Before\n      - name: Other\n        value: Keep\nedges: []\n");
  writeFileSync(join(root, "data/traditions/example/metamodel.yaml"), "categories:\n  - id: Kind\n    label: Before\nrelationships: []\n");
  writeFileSync(join(root, "data/referents.yaml"), "referents: []\n");
  writeFileSync(join(root, "data/topics.yaml"), "topics: []\n");
  const verifier = new Verifier();
  Object.assign(verifier, { check: async () => ({ status: "verified" }) });
  try { await fn(root, verifier); } finally { rmSync(root, { recursive: true, force: true }); }
}

void test("replaces one attribute without overwriting its node or sibling attributes", async () => fixture(async (root, verifier) => {
  const ops = [{ op: "replace_attribute", target: "person", yaml: "name: Nature\nvalue: After", finding_ids: ["F1"] }] as unknown as JudgeOutput["ops"];
  const result = await applyOps(root, "example", ops, [], verifier, ["example.org"]);
  assert.equal(result.applied.length, 1);
  const model = parse(readFileSync(join(root, "data/traditions/example/model.yaml"), "utf8"));
  assert.equal(model.nodes[0].label, "Person");
  assert.deepEqual(model.nodes[0].attributes, [{ name: "Nature", value: "After" }, { name: "Other", value: "Keep" }]);
}));

void test("reports a missing replacement attribute instead of silently doing nothing", async () => fixture(async (root, verifier) => {
  const ops = [{ op: "replace_attribute", target: "person", yaml: "name: Missing\nvalue: After", finding_ids: ["F1"] }] as unknown as JudgeOutput["ops"];
  const result = await applyOps(root, "example", ops, [], verifier, ["example.org"]);
  assert.equal(result.applied.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /not found/);
}));

void test("replaces an existing category", async () => fixture(async (root, verifier) => {
  const ops = [{ op: "replace_category", yaml: "id: Kind\nlabel: After", finding_ids: ["F1"] }] as unknown as JudgeOutput["ops"];
  const result = await applyOps(root, "example", ops, [], verifier, ["example.org"]);
  assert.equal(result.applied.length, 1);
  assert.equal(parse(readFileSync(join(root, "data/traditions/example/metamodel.yaml"), "utf8")).categories[0].label, "After");
}));

void test("rechecks cached quotes against the final domain allowlist", async () => fixture(async (root, verifier) => {
  Object.assign(verifier, { check: async () => ({ status: "off_allowlist" }) });
  const url = "https://untrusted.example/source";
  const quote = "A previously verified quote";
  const result = await applyOps(root, "example", [{ op: "add_attribute", target: "person", yaml: `name: Source\nvalue: Value\ncitations:\n  authority:\n    - url: ${url}\n      quote: ${quote}`, finding_ids: ["F1"] }], [{ url, quote }], verifier, ["example.org"]);
  assert.equal(result.strippedQuotes.length, 1);
}));
