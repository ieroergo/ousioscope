import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { runAgy } from "./agy";
import { MODEL } from "./model";

const argv = process.argv.slice(2);
const opt = (name: string) => argv[argv.indexOf(`--${name}`) + 1];
const root = opt("root"), run = opt("run"), tid = opt("tradition"), base = opt("base");
if (!["root", "run", "tradition", "base"].every((name) => argv.includes(`--${name}`))) throw new Error("Required: --root --run --tradition --base");
const dir = join(root, "research/runs", run);
const prefix = argv.includes("--new") ? "" : `${tid}.`;
const read = (name: string) => {
  const file = join(dir, `${prefix}${name}.yaml`);
  return existsSync(file) ? parse(readFileSync(file, "utf8")) : undefined;
};
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const shape = z.object({ ready: z.boolean(), issues: z.array(z.string()), needs_research: z.boolean(), gap_questions: z.array(z.string()) });
const schema = {
  type: "object",
  properties: { ready: { type: "boolean" }, issues: { type: "array", items: { type: "string" } }, needs_research: { type: "boolean" }, gap_questions: { type: "array", items: { type: "string" } } },
  required: ["ready", "issues", "needs_research", "gap_questions"],
};
const prompt = `You are the FINAL CITATION-FIT AND COMPLETENESS REVIEWER for Ousioscope. Review only this tradition's own
standards, current teaching, vocabulary, authority tiers and interpretive rules. Do not evaluate religious truth.
The quote checker confirms text retrieval; that does not establish support for a claim.

You may reopen the cited pages and search only the tradition's allowed domains to check context. An inaccessible page
is a retrieval gap, not evidence of false doctrine. If additional primary evidence is needed, request fresh research;
do not invent support or directly write new data.

Check every new or changed claim, category name and stance against its exact source quotes in context. Reject mismatched
subjects, a dissenting passage used as affirmative support, or an explicit rejection inferred only from silence.
Distinguish current authoritative teaching from historical opinion and preserve supported qualifications and dissent.
Check that the diff preserves existing supported claims, references and citations. Class-level inherited axioms can
already fill a relationship gap; never add redundant edges or invent a subject just to connect a diagram.
A tradition may not distinguish the shared subjects in the same way; missing subjects are research questions, not errors.
For a new tradition also check that authority tiers and outline headings have genuine source support and that category
names follow the term provenance rule. Transliteration alone does not establish a source-backed term.

Return ready=true only if there are no blocking or major issues. issues lists those issues, not minor stylistic preferences.
Set needs_research=true if new primary-source research is needed rather than a correction using already verified evidence.
gap_questions lists only concrete, sourceable ontology questions still worth researching, phrased WITHOUT references to
project data or claim ids, suitable for a blind researcher. Do not repeat deliberately rejected or unanswerable questions.

RESEARCH QUESTIONS TO REVISIT (report genuinely unresolved ones as gap_questions):
${argv.includes("--questions") ? opt("questions") : "[]"}

CANDIDATE DATA:
${stringify({ metamodel: parse(readFileSync(join(root, `data/traditions/${tid}/metamodel.yaml`), "utf8")), model: parse(readFileSync(join(root, `data/traditions/${tid}/model.yaml`), "utf8")) })}

DIFF AGAINST CURRENT MAIN:
${git("diff", base, "HEAD", "--", "data")}

BLIND RESEARCH AND MACHINE QUOTE CHECKS:
${stringify({ research: read("1-research"), checks: read("2-verify"), critic: read("4-critic"), criticChecks: read("5-verify-critic"), judge: read("6-judge") })}`;
writeFileSync(join(dir, "final-review.prompt.txt"), prompt);
const result = await runAgy<unknown>({ prompt, schema, model: MODEL, tools: true, label: `${tid}/final-review`, log: console.log });
const review = shape.parse(result.output);
if (review.ready && review.issues.length) throw new Error("Final review marked a candidate ready despite blocking or major issues");
writeFileSync(join(dir, "final-review.json"), JSON.stringify({ ...review, commit, model: MODEL }, null, 2));
console.log(`Final review: ${review.ready ? "ready" : "needs correction"}; ${review.issues.length} issues, ${review.gap_questions.length} follow-up questions.`);
