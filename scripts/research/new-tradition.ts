/**
 * Bootstraps a NEW tradition with the same agent protocol as topic research:
 *   blind research (web) → quote verification → critic (interior critique + internal dissent, web) → quote verification
 *   → judge (writes the tradition's metamodel.yaml + model.yaml) → quote re-check → fetch scripture → validate (with
 *   repair) → commit on a local branch `research/new-<id>-<stamp>`.
 *
 *   npm run research:new -- --id judaism --name "Orthodox (Rabbinic) Judaism" --scope "<what the stream is>"
 *                           --store jps1917 --bible-label Tanakh [--dry-run] [--resume <run-id>]
 *
 * Every role uses the same pinned model as topic research (MODEL). If its quota runs out the run stops; --resume it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { loadDataset } from "../../src/ontology";
import type { Dataset } from "../../src/schema";
import { BOOKS } from "../books";
import { runAgy } from "./agy";
import { CRITIC_SCHEMA, RESEARCH_SCHEMA, type CriticOutput, type ResearchOutput, type Source } from "./schemas";
import { Verifier, type QuoteCheck } from "./verify";

const MODEL = "gemini-3.8-flash-high";
const root = join(import.meta.dirname, "../..");
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ID = opt("id");
const NAME = opt("name");
const SCOPE = opt("scope") ?? "";
const STORE = opt("store");
const BIBLE_LABEL = opt("bible-label") ?? "Bible";
const DRY = argv.includes("--dry-run");
const RESUME = opt("resume");
if (!ID || !NAME || !STORE) {
  console.log(readFileSync(import.meta.filename, "utf8").match(/\/\*\*([\s\S]*?)\*\//)![1].replace(/^ \* ?/gm, ""));
  process.exit(1);
}
const tdir = join(root, "data/traditions", ID);
if (existsSync(tdir) && !RESUME) {
  console.error(`data/traditions/${ID} already exists.`);
  process.exit(1);
}

const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
function loadData(): { dataset?: Dataset; errors: string[] } {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".yaml")) files[relative(root, p)] = readFileSync(p, "utf8");
    }
  };
  walk(join(root, "data"));
  return loadDataset(files);
}
const data = loadData().dataset!;
if (!DRY && git("status", "--porcelain", "--", "data")) {
  console.error("data/ has uncommitted changes. Commit or stash them first (or use --dry-run).");
  process.exit(1);
}

const runId = RESUME ?? `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}-new-${ID}`;
const runDir = join(root, "research/runs", runId);
mkdirSync(runDir, { recursive: true });
const save = (name: string, v: unknown) => writeFileSync(join(runDir, name), typeof v === "string" ? v : stringify(v, { lineWidth: 0 }));
const log = (line: string) => {
  console.log(line);
  writeFileSync(join(runDir, "log.txt"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
};
const saved = <T>(label: string): T | undefined => {
  const f = join(runDir, `${label}.yaml`);
  return RESUME && existsSync(f) ? (parse(readFileSync(f, "utf8")) as T) : undefined;
};
let tokens = 0;
async function agy<T>(label: string, prompt: string, schema: object, tools: boolean): Promise<T> {
  const prior = saved<T>(label);
  if (prior) {
    log(`[${label}] reusing saved output`);
    return prior;
  }
  save(`${label}.prompt.md`, prompt);
  const r = await runAgy<T>({ prompt, schema, model: MODEL, tools, label: `${ID}/${label}`, log, timeout: 1800 });
  tokens += r.tokens ?? 0;
  save(`${label}.yaml`, r.output);
  return r.output;
}

const verifier = new Verifier();
// Before the tradition's allowed domains are decided, any host may be checked; the judge's final allowlist applies at apply time.
const verifyAll = (srcs: Source[]) => Promise.all(srcs.map((s) => verifier.check(s, [new URL(s.url).hostname])));
const status = (checks: QuoteCheck[], s: Source) => checks.find((c) => c.url === s.url && c.quote === s.quote)?.status ?? "unchecked";

// ---------- prompts ----------
const PROJECT = `Ousioscope is a comparative-religion research tool. It represents what each tradition says things ARE (its
ontology), strictly in that tradition's own words, cited to that tradition's own sources, and never judges whether a
teaching is true. Existing traditions: ${data.traditions.map((t) => t.meta.tradition.shortName).join(", ")}.`;
const tanakh = BOOKS.filter((b) => b.wol && b.wol <= 39).map((b) => b.abbr);
const SCOPE_BLOCK = `NEW TRADITION: ${NAME}${SCOPE ? `\nSCOPE: ${SCOPE}` : ""}
SCRIPTURE: the ${BIBLE_LABEL}, quoted from the store "${STORE}". Cite verses as "<Book> <chapter>:<verse>" with these book
abbreviations and the verse numbering of that edition: ${tanakh.join(", ")}.
SUBJECTS the project compares across traditions (model each one this tradition speaks about, in its own terms, and say
plainly when it has no such being or rejects the concept): ${data.referents.map((r) => r.canonical).join("; ")}.
POINTS OF DEBATE (neutral propositions; find this tradition's own stated position on each): ${data.topics
  .filter((t) => t.kind === "debate")
  .map((t) => `"${t.label}"`)
  .join("; ")}.`;

const KINDS = `Each finding's "kind" is exactly one of:
- tier: one level of the tradition's own hierarchy of religious authority (highest first; name the works in it).
- allowed_source: a website that faithfully hosts the tradition's primary texts or speaks for its recognized
  institutions (give the domain in the statement and why it is authoritative for THIS tradition).
- hermeneutic: the tradition's own rule for interpreting its scripture.
- outline_item: one item of the tradition's own published outline of core beliefs, in its own words.
- category: a kind of being the tradition distinguishes, with its own name for it and its definition.
- relationship_type: a relation the tradition asserts between kinds of being (one verb, its domain and range).
- class_rule: something true of every member of a kind.
- individual: what one subject IS in this tradition (or that it has no such being).
- attribute: a fact about one individual.
- relation: a relation between two individuals.
- stance: the tradition's position on one point of debate (affirms | rejects | condemns | reframes | none).`;

const researcherPrompt = `${PROJECT}

You are the BLIND RESEARCHER for a tradition the project does not cover yet. Research from primary sources only.

${SCOPE_BLOCK}

${KINDS}

HOW TO WORK
- Use the tradition's primary texts (e.g. on sefaria.org) and the publications of its recognized institutions. Read the
  pages themselves. Prefer the highest authority.
- One atomic teaching per finding, in the tradition's own vocabulary (with transliterated terms where it uses them).
  Never import another tradition's categories.
- Every finding needs at least one source whose "quote" is copied VERBATIM from the page at that exact URL. Quotes are
  machine-checked against the live page; anything that does not match is discarded.
- List scripture the source itself cites. Don't add your own proof texts.
- Cover: the authority tiers, 2-4 allowed sources, the rule of interpretation, the outline of core beliefs, the kinds of
  being and relations needed for the subjects, each subject, and each point of debate. Aim for 40-70 findings.
- Put anything you looked for but could not source in "gaps".`;

const verifiedFindings = (r: ResearchOutput, checks: QuoteCheck[]) =>
  r.findings.map((f) => ({ ...f, sources: f.sources.map((s) => ({ ...s, verification: status(checks, s) })) }));

const criticPrompt = (r: ResearchOutput, checks: QuoteCheck[]) => `${PROJECT}

You are the CRITIC. A blind researcher proposed the foundations and first findings for a new tradition. Challenge them by
${NAME}'s OWN standards. Do not argue from other traditions.

${SCOPE_BLOCK}

FINDINGS (with machine verification of each quote; only "verified" sources count):
${stringify(verifiedFindings(r, checks))}
RESEARCH GAPS: ${r.gaps.join("; ") || "none"}

FOR EACH FINDING
1. Interior critique: does this tradition teach it, at that authority level? Does the source say it in context? Is the
   scripture read the way its own authorities read it? Are the proposed authority tiers, allowed sources, and outline
   really the tradition's own (not a neighboring stream's)?
2. Internal dissent: real disagreement inside the tradition (e.g. Maimonides vs. other rishonim, rationalist vs.
   kabbalistic readings, earlier vs. later authorities). Record it so the model does not flatten it.
3. Objections: blocking (would put a false or misattributed claim in the model), major, minor.
Also list important teachings the researcher MISSED. Search and read to check. Every source you give needs a VERBATIM
quote from the page at that exact URL; quotes are machine-checked.`;

interface NewJudge {
  decisions: { finding_id: string; decision: "accept" | "accept_modified" | "reject"; reason: string }[];
  metamodel_yaml: string;
  model_yaml: string;
  aliases: { referent: string; names: string[] }[];
  pr_summary: string;
  dissent_notes: string[];
}
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: { finding_id: { type: "string" }, decision: { type: "string", enum: ["accept", "accept_modified", "reject"] }, reason: { type: "string" } },
        required: ["finding_id", "decision", "reason"],
      },
    },
    metamodel_yaml: { type: "string", description: "The complete metamodel.yaml for the new tradition, in the template's format." },
    model_yaml: { type: "string", description: "The complete model.yaml (individuals and edges), in the template's format." },
    aliases: {
      type: "array",
      description: "This tradition's own names for each subject it models (referent id → names).",
      items: { type: "object", properties: { referent: { type: "string" }, names: { type: "array", items: { type: "string" } } }, required: ["referent", "names"] },
    },
    pr_summary: { type: "string", description: "Markdown for the reviewer: what was built and why." },
    dissent_notes: { type: "array", items: { type: "string" } },
  },
  required: ["decisions", "metamodel_yaml", "model_yaml", "aliases", "pr_summary", "dissent_notes"],
};

const template = data.traditions.find((t) => t.meta.tradition.id === "sunni")!;
const tpl = (f: string) => readFileSync(join(root, `data/traditions/${template.meta.tradition.id}/${f}`), "utf8");
const judgePrompt = (r: ResearchOutput, checks: QuoteCheck[], critic: CriticOutput, criticChecks: QuoteCheck[]) => {
  const verified = [...checks, ...criticChecks].filter((c) => c.status === "verified").map((c) => ({ url: c.url, quote: c.quote }));
  return `${PROJECT}

You are the JUDGE. Weigh the blind research and the critique, then write the new tradition's data files.

${SCOPE_BLOCK}

FINDINGS:
${stringify(verifiedFindings(r, checks))}
CRITIQUE:
${stringify(critic)}
VERIFIED QUOTES (the only quotes you may use, anywhere in the files):
${stringify(verified)}

SHARED REGISTRY (use these ids exactly):
referents: ${stringify(data.referents.map((x) => ({ id: x.id, canonical: x.canonical })))}
topics: ${stringify(data.topics.map((x) => ({ id: x.id, kind: x.kind, label: x.label })))}

WHAT TO WRITE
- metamodel_yaml: tradition info with id "${ID}", name "${NAME}", a shortName, scripture { bible: ${STORE}, other: ${STORE} },
  bibleRole: canonical, bibleLabel: ${BIBLE_LABEL}, otherScriptureLabel: ${BIBLE_LABEL}, authority tiers (highest first),
  hermeneutic (summary + citations), allowedDomains (2-5 domains that host its primary texts or speak for its recognized
  institutions; every url you cite must be on one of them); then topics (its OWN outline, each mapped to registry topic ids),
  stances (one per point of debate it addresses, with claims linking the modeled claims that express it), categories,
  relationships, axioms.
- model_yaml: one individual per subject the tradition speaks about (each with its referent id), and edges between them.
- aliases: the tradition's own names for each modeled subject.

RULES
- Accept a finding only if it rests on at least one VERIFIED quote and survives blocking objections; say why otherwise.
- Every authority "quote" must be copied exactly from the verified quotes; omit the field if none fits (unverified quotes
  are stripped automatically).
- Every node and edge, category, relationship type, axiom, stance (except "none"), and the hermeneutic needs citations:
  scripture { bible: [refs] | none-cited } and authority [{ source, ref, tier, url, quote }]. Scripture refs only from the
  book list above.
- Every category needs "term": kind own (a verbatim quote from a verified source that contains the category label's
  main word, with its url, or a scripture ref) or kind editorial (with a note). Name categories in the tradition's own words.
- Nodes are INDIVIDUALS only; every node has a referent from the registry; one node per referent. Relationship names are
  single atomic verbs in camelCase ids with a readable label; never embed a category in a verb. Every relationship type
  declares its domain, range, and topics (ids of this tradition's own outline topics).
- Model only current teaching. Record internal dissent in attribute or edge notes where it is itself a teaching, and in
  dissent_notes otherwise. If the tradition has no such being as a subject (or rejects it), don't invent a node; state it
  in a stance or dissent note.
- The YAML must parse. Quote strings containing ": " or " #" or starting with a quote or bracket.

TEMPLATE (an existing tradition's files; copy this exact structure and field names):
--- metamodel.yaml
${tpl("metamodel.yaml")}
--- model.yaml
${tpl("model.yaml")}`;
};

// ---------- apply ----------
/** Walks parsed YAML; re-checks every authority quote and term quote live against the final allowed domains. */
async function scrub(v: unknown, domains: string[], stripped: string[]): Promise<void> {
  if (Array.isArray(v)) {
    for (const x of v) await scrub(x, domains, stripped);
    return;
  }
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  if (typeof o.url === "string" && typeof o.quote === "string") {
    const c = await verifier.check({ url: o.url, quote: o.quote }, domains);
    if (c.status !== "verified") {
      stripped.push(`${o.url} (${c.status}): ${o.quote.slice(0, 80)}`);
      delete o.quote;
    }
  }
  for (const x of Object.values(o)) await scrub(x, domains, stripped);
}

function addAliases(aliases: NewJudge["aliases"]) {
  const f = join(root, "data/referents.yaml");
  let s = readFileSync(f, "utf8");
  for (const { referent, names } of aliases) {
    const re = new RegExp(`(  - id: ${referent.replace(/\./g, "\\.")}\\n(?:    .*\\n)*?    aliases:\\n)`);
    if (!re.test(s) || !names.length) continue;
    s = s.replace(re, `$1      ${ID}: ${JSON.stringify(names)}\n`);
  }
  writeFileSync(f, s);
}

async function applyJudge(j: NewJudge): Promise<{ errors: string[]; stripped: string[] }> {
  const stripped: string[] = [];
  let meta: Record<string, any>, model: Record<string, any>;
  try {
    meta = parse(j.metamodel_yaml);
    model = parse(j.model_yaml);
  } catch (e) {
    return { errors: [`YAML does not parse: ${(e as Error).message.split("\n")[0]}`], stripped };
  }
  const domains: string[] = meta?.tradition?.allowedDomains ?? [];
  await scrub(meta, domains, stripped);
  await scrub(model, domains, stripped);
  mkdirSync(tdir, { recursive: true });
  const header = `# ${NAME}. Generated by the research workflow (run ${runId}); review before relying on it.\n`;
  writeFileSync(join(tdir, "metamodel.yaml"), header + stringify(meta, { lineWidth: 0 }));
  writeFileSync(join(tdir, "model.yaml"), header + stringify(model, { lineWidth: 0 }));
  addAliases(j.aliases);
  const fetched = spawnSync("npm", ["run", "fetch:scripture"], { cwd: root, encoding: "utf8", timeout: 900_000 });
  const fetchIssues = `${fetched.stdout}\n${fetched.stderr}`.split("\n").filter((l) => /^\s*!|failed chapters/.test(l));
  if (fetchIssues.length) log(`fetch:scripture: ${fetchIssues.slice(0, 8).join(" | ")}`);
  return { errors: loadData().errors.slice(0, 40), stripped };
}

const repairPrompt = (original: string, j: NewJudge, errors: string[]) => `${original}

YOUR PREVIOUS OUTPUT:
${stringify({ metamodel_yaml: j.metamodel_yaml, model_yaml: j.model_yaml, aliases: j.aliases })}

It was written to disk, but the project validator rejected it:
${errors.map((e) => `- ${e}`).join("\n")}

Return the full corrected output (same JSON shape). Fix the errors; do not add unrelated changes.`;

// ---------- run ----------
async function main() {
  log(`Run ${runId}: new tradition ${ID} (${NAME}) · model ${MODEL}`);
  const research = await agy<ResearchOutput>("1-research", researcherPrompt, RESEARCH_SCHEMA, true);
  const checks = saved<QuoteCheck[]>("2-verify") ?? (await verifyAll(research.findings.flatMap((f) => f.sources)));
  save("2-verify.yaml", checks);
  log(`research: ${research.findings.length} findings, ${checks.filter((c) => c.status === "verified").length}/${checks.length} quotes verified`);
  const critic = await agy<CriticOutput>("4-critic", criticPrompt(research, checks), CRITIC_SCHEMA, true);
  const criticSrcs = [
    ...critic.reviews.flatMap((r) => [...r.dissent.flatMap((d) => d.sources), ...r.objections.flatMap((o) => o.sources)]),
    ...critic.missed.flatMap((m) => m.sources),
  ];
  const criticChecks = saved<QuoteCheck[]>("5-verify-critic") ?? (await verifyAll(criticSrcs));
  save("5-verify-critic.yaml", criticChecks);
  const jp = judgePrompt(research, checks, critic, criticChecks);
  let judge = await agy<NewJudge>("6-judge", jp, JUDGE_SCHEMA, false);
  log(`judge: ${judge.decisions.filter((d) => d.decision !== "reject").length} accepted, ${judge.decisions.filter((d) => d.decision === "reject").length} rejected`);

  const reportLines = (extra: string[]) =>
    [
      `## New tradition: ${NAME}`,
      ``,
      `Run \`${runId}\` · model ${MODEL} · blind research → quote verification → critic → judge → quote re-check → validate.`,
      ``,
      judge.pr_summary.trim(),
      ``,
      `Blind research: ${research.findings.length} findings; ${checks.filter((c) => c.status === "verified").length}/${checks.length} quotes verified. Critic sources verified: ${criticChecks.filter((c) => c.status === "verified").length}/${criticChecks.length}.`,
      ``,
      `| Finding | Kind | Critic | Judge |`,
      `|---|---|---|---|`,
      ...research.findings.map((f) => {
        const d = judge.decisions.find((x) => x.finding_id === f.id);
        return `| ${f.id}: ${f.statement.replace(/\|/g, "/").slice(0, 120)} | ${f.kind} | ${critic.reviews.find((x) => x.finding_id === f.id)?.verdict ?? "–"} | ${d ? `${d.decision}: ${d.reason.replace(/\|/g, "/").slice(0, 140)}` : "–"} |`;
      }),
      ...(judge.dissent_notes.length ? [``, `**Dissent and open objections**`, ...judge.dissent_notes.map((d) => `- ${d}`)] : []),
      ...(research.gaps.length ? [``, `Research gaps: ${research.gaps.join("; ")}`] : []),
      ...extra,
      ``,
      `Tokens: ${tokens.toLocaleString()}`,
    ].join("\n");

  if (DRY) {
    save("report.md", reportLines([]));
    log(`Dry run: nothing written. Report: ${relative(root, join(runDir, "report.md"))}`);
    return;
  }
  const original = git("rev-parse", "--abbrev-ref", "HEAD");
  const branch = `research/new-${ID}-${runId.slice(0, 14)}`;
  git("checkout", "-b", branch);
  try {
    let result = await applyJudge(judge);
    for (let attempt = 1; result.errors.length && attempt <= 3; attempt++) {
      log(`Validation failed (${result.errors.length}): ${result.errors.slice(0, 5).join(" | ")}`);
      git("checkout", "--", "data");
      spawnSync("git", ["clean", "-fdq", "--", `data/traditions/${ID}`], { cwd: root });
      judge = await agy<NewJudge>(`7-repair${attempt}`, repairPrompt(jp, judge, result.errors), JUDGE_SCHEMA, false);
      result = await applyJudge(judge);
    }
    if (result.errors.length) throw new Error(`still invalid after repairs: ${result.errors.slice(0, 5).join(" | ")}`);
    save("report.md", reportLines(result.stripped.length ? [``, `Unverifiable quotes stripped (${result.stripped.length}):`, ...result.stripped.map((s) => `- ${s}`)] : []));
    git("add", "data");
    save("commit.txt", `Research: new tradition ${NAME}\n\nAutomated bootstrap run ${runId}: blind research, critic, judge; quotes machine-verified.\n`);
    git("commit", "-q", "-F", join(runDir, "commit.txt"));
    log(`Committed on local branch ${branch}. Report: ${relative(root, join(runDir, "report.md"))}`);
    log(`Review: git checkout ${branch} && npm run dev · Merge: git merge --no-ff ${branch}`);
  } catch (e) {
    log(`Aborting: ${(e as Error).message}. Reverting the branch.`);
    git("checkout", "--", "data");
    spawnSync("git", ["clean", "-fdq", "--", `data/traditions/${ID}`], { cwd: root });
    process.exitCode = 1;
  } finally {
    git("checkout", "-q", original);
    if (process.exitCode) spawnSync("git", ["branch", "-D", branch], { cwd: root });
  }
}

main()
  .catch((e) => {
    log(`FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => verifier.close().then(() => process.exit()));
