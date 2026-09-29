import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadDataset } from "../src/ontology";

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
if (errors.length) {
  console.error(`Ontology validation failed (${errors.length} error${errors.length > 1 ? "s" : ""}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const t of dataset!.traditions)
  console.log(
    `✓ ${t.meta.tradition.name}: ${t.meta.categories.length} categories, ${t.meta.relationships.length} relationship types, ${t.meta.axioms.length} axioms, ${t.model.nodes.length} individuals, ${t.model.edges.length} edges`,
  );
console.log(`✓ ${dataset!.referents.length} referents`);
