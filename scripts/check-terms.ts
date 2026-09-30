/**
 * Online check of category names: every category marked as the tradition's own term must quote a source page
 * that really contains the quote (and so the term). Scripture-based terms are checked offline by `validate`.
 * Prints warnings; exits non-zero only with --strict.
 *
 *   npm run check:terms [-- --strict]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadDataset } from "../src/ontology";
import { Verifier } from "./research/verify";

const root = join(import.meta.dirname, "..");
const files: Record<string, string> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".yaml")) files[relative(root, p)] = readFileSync(p, "utf8");
  }
};
walk(join(root, "data"));
const { dataset, errors } = loadDataset(files);
if (!dataset || errors.length) {
  console.error("Data does not validate; run npm run validate first.");
  process.exit(1);
}

const verifier = new Verifier();
const warnings: string[] = [];
let own = 0;
let editorial = 0;
for (const { meta } of dataset.traditions) {
  for (const c of meta.categories) {
    if (c.term.kind === "editorial") {
      editorial++;
      continue;
    }
    own++;
    if (!c.term.url) continue;
    const r = await verifier.check({ url: c.term.url, quote: c.term.quote! }, meta.tradition.allowedDomains);
    if (r.status !== "verified") warnings.push(`[${meta.tradition.id}] ${c.id} "${c.label}": ${r.status}${r.detail ? ` (${r.detail})` : ""} at ${c.term.url}`);
  }
}
await verifier.close();
for (const w of warnings) console.warn(`  ! ${w}`);
console.log(`${own} own terms (${warnings.length} not confirmed on their page), ${editorial} editorial labels`);
process.exit(warnings.length && process.argv.includes("--strict") ? 1 : 0);
