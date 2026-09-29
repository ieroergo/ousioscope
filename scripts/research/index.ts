/**
 * Research-and-propose workflow for one topic, run per tradition:
 *   blind research → quote verification → reconcile with the model → critic (interior critique + internal dissent)
 *   → quote verification → judge (structured ops) → apply → fetch scripture → validate (with repair) → local branch.
 *
 * The result is committed on a local branch `research/<topic>-<stamp>` for review and a local merge.
 *
 *   npm run research -- --topic debate.theotokos [--traditions jw,catholic|all] [--dry-run] [--pr]
 *                       [--model gemini-3.8-flash-high] [--judge-model gemini-3.1-pro-high] [--concurrency 3]
 *                       [--from-run <run-id>]   (reuse a saved run's agent outputs, e.g. to apply a reviewed dry run)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { loadDataset } from "../../src/ontology";
import type { Dataset, Tradition } from "../../src/schema";
import { runAgy } from "./agy";
import { applyOps, type ApplyReport } from "./apply";
import { criticPrompt, judgePrompt, reconcilePrompt, repairPrompt, researcherPrompt, type Focus } from "./prompts";
import {
  CRITIC_SCHEMA,
  JUDGE_SCHEMA,
  RECONCILE_SCHEMA,
  RESEARCH_SCHEMA,
  type CriticOutput,
  type JudgeOutput,
  type ReconcileOutput,
  type ResearchOutput,
  type Source,
} from "./schemas";
import { Verifier, type QuoteCheck } from "./verify";

const root = join(import.meta.dirname, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
if (flag("help") || !opt("topic")) {
  console.log(readFileSync(import.meta.filename, "utf8").match(/\/\*\*([\s\S]*?)\*\//)![1].replace(/^ \* ?/gm, ""));
  process.exit(opt("topic") ? 0 : 1);
}
const MODEL = opt("model", "gemini-3.8-flash-high")!;
const JUDGE_MODEL = opt("judge-model", MODEL)!;
const DRY = flag("dry-run");
/** Opt-in: also push the branch and open a GitHub PR. */
const PR = flag("pr");
const CONCURRENCY = Number(opt("concurrency", "3"));
const FROM_RUN = opt("from-run");

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function loadData(): Dataset {
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
  if (!dataset || errors.length) throw Object.assign(new Error("validation failed"), { errors });
  return dataset;
}

const data = loadData();
const topicId = opt("topic")!;
const reg = data.topics.find((t) => t.id === topicId);
const ref = data.referents.find((r) => r.id === topicId);
if (!reg && !ref) {
  console.error(`Unknown topic "${topicId}". Use a referent id (e.g. ref.mary) or a registry id (e.g. debate.theotokos).`);
  process.exit(1);
}
const focus: Focus = reg ? { id: reg.id, kind: reg.kind, label: reg.label, known: reg.known } : { id: ref!.id, kind: "subject", label: ref!.canonical };
const tsel = opt("traditions", "all")!;
const traditions = data.traditions.filter((t) => tsel === "all" || tsel.split(",").includes(t.meta.tradition.id));
if (!traditions.length) {
  console.error(`No traditions match "${tsel}". Known: ${data.traditions.map((t) => t.meta.tradition.id).join(", ")}`);
  process.exit(1);
}

const runId = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}-${topicId.replace(/[^\w-]+/g, "-")}`;
const runDir = join(root, "research/runs", FROM_RUN ?? runId);
mkdirSync(runDir, { recursive: true });
const save = (name: string, v: unknown) => writeFileSync(join(runDir, name), typeof v === "string" ? v : stringify(v, { lineWidth: 0 }));
const log = (line: string) => {
  console.log(line);
  writeFileSync(join(runDir, "log.txt"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
};

// The run only edits and commits data/, so only data/ has to be clean.
if (!DRY && git("status", "--porcelain", "--", "data")) {
  console.error("data/ has uncommitted changes. Commit or stash them first (or use --dry-run).");
  process.exit(1);
}

const verifier = new Verifier();

interface TraditionRun {
  t: Tradition;
  research: ResearchOutput;
  checks: QuoteCheck[];
  rec: ReconcileOutput;
  critic: CriticOutput;
  criticChecks: QuoteCheck[];
  judgePrompt: string;
  judge: JudgeOutput;
  tokens: number;
  apply?: ApplyReport;
}

const verifyAll = (srcs: Source[], domains: string[]) => Promise.all(srcs.map((s) => verifier.check(s, domains)));
const criticSources = (c: CriticOutput) => [
  ...c.reviews.flatMap((r) => [...r.dissent.flatMap((d) => d.sources), ...r.objections.flatMap((o) => o.sources)]),
  ...c.missed.flatMap((m) => m.sources),
];

/** Reloads a saved run's role outputs (no agents are called). */
function loadTradition(t: Tradition): TraditionRun {
  const tid = t.meta.tradition.id;
  const read = <T>(name: string) => parse(readFileSync(join(runDir, `${tid}.${name}`), "utf8")) as T;
  const repairs = readdirSync(runDir).filter((f) => f.startsWith(`${tid}.7-repair`)).sort();
  return {
    t,
    research: read("1-research.yaml"),
    checks: read("2-verify.yaml"),
    rec: read("3-reconcile.yaml"),
    critic: read("4-critic.yaml"),
    criticChecks: read("5-verify-critic.yaml"),
    judgePrompt: readFileSync(join(runDir, `${tid}.6-judge.prompt.md`), "utf8"),
    judge: read(repairs.at(-1)?.slice(tid.length + 1) ?? "6-judge.yaml"),
    tokens: 0,
  };
}

async function runTradition(t: Tradition): Promise<TraditionRun> {
  if (FROM_RUN) return loadTradition(t);
  const tid = t.meta.tradition.id;
  const domains = t.meta.tradition.allowedDomains;
  let tokens = 0;
  const agy = async <T>(label: string, prompt: string, schema: object, tools: boolean, model = MODEL) => {
    save(`${tid}.${label}.prompt.md`, prompt);
    const r = await runAgy<T>({ prompt, schema, model, tools, label: `${tid}/${label}`, log });
    tokens += r.tokens ?? 0;
    save(`${tid}.${label}.yaml`, r.output);
    return r.output;
  };

  const research = await agy<ResearchOutput>("1-research", researcherPrompt(focus, t, data.referents), RESEARCH_SCHEMA, true);
  const checks = await verifyAll(research.findings.flatMap((f) => f.sources), domains);
  save(`${tid}.2-verify.yaml`, checks);
  log(`[${tid}] research: ${research.findings.length} findings, ${checks.filter((c) => c.status === "verified").length}/${checks.length} quotes verified`);

  const rec = await agy<ReconcileOutput>("3-reconcile", reconcilePrompt(focus, t, research, checks, data.topics, data.referents), RECONCILE_SCHEMA, false);
  const critic = await agy<CriticOutput>("4-critic", criticPrompt(focus, t, research, checks, rec, data.referents), CRITIC_SCHEMA, true);
  const criticChecks = await verifyAll(criticSources(critic), domains);
  save(`${tid}.5-verify-critic.yaml`, criticChecks);

  const jp = judgePrompt(focus, t, research, checks, rec, critic, criticChecks, data.referents);
  const judge = await agy<JudgeOutput>("6-judge", jp, JUDGE_SCHEMA, false, JUDGE_MODEL);
  log(`[${tid}] judge: ${judge.decisions.filter((d) => d.decision !== "reject").length} accepted, ${judge.decisions.filter((d) => d.decision === "reject").length} rejected, ${judge.ops.length} ops`);
  return { t, research, checks, rec, critic, criticChecks, judgePrompt: jp, judge, tokens };
}

async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      for (let k; (k = i++) < xs.length; ) out[k] = await fn(xs[k]).catch((e: Error) => e);
    }),
  );
  return out;
}

function verifiedQuotes(r: TraditionRun) {
  return [...r.checks, ...r.criticChecks].filter((c) => c.status === "verified").map(({ url, quote }) => ({ url, quote }));
}

function report(runs: TraditionRun[], failures: string[], branch?: string): string {
  const lines = [
    `## Research: ${focus.label}`,
    ``,
    `Topic \`${focus.id}\` (${focus.kind}) · traditions: ${runs.map((r) => r.t.meta.tradition.shortName).join(", ") || "none"} · models: ${MODEL}${JUDGE_MODEL !== MODEL ? ` / judge ${JUDGE_MODEL}` : ""} · run \`${runId}\``,
    ``,
    `Pipeline: blind research → quote verification → reconcile → critic (interior critique + internal dissent) → judge → apply → validate. Every quote written into the data was machine-checked against the live page.`,
  ];
  for (const r of runs) {
    const v = r.checks.filter((c) => c.status === "verified").length;
    lines.push(
      ``,
      `### ${r.t.meta.tradition.name}`,
      ``,
      r.judge.pr_summary.trim(),
      ``,
      `<details><summary>Findings, verification, and decisions</summary>`,
      ``,
      `Blind research: ${r.research.findings.length} findings; ${v}/${r.checks.length} quotes verified.${r.research.stance ? ` Researcher stance: **${r.research.stance.position}**.` : ""}`,
      ``,
      `| Finding | Verified quotes | Critic | Judge |`,
      `|---|---|---|---|`,
      ...r.research.findings.map((f) => {
        const q = f.sources.filter((s) => r.checks.find((c) => c.url === s.url && c.quote === s.quote)?.status === "verified").length;
        const cv = r.critic.reviews.find((x) => x.finding_id === f.id)?.verdict ?? "–";
        const d = r.judge.decisions.find((x) => x.finding_id === f.id);
        return `| ${f.id}: ${f.statement.replace(/\|/g, "/").slice(0, 140)} | ${q}/${f.sources.length} | ${cv} | ${d ? `${d.decision}: ${d.reason.replace(/\|/g, "/").slice(0, 160)}` : "–"} |`;
      }),
      ``,
      r.apply ? `Applied: ${r.apply.applied.join("; ") || "nothing"}` : "",
      r.apply?.skipped.length ? `Skipped: ${r.apply.skipped.map((s) => `${s.op} (${s.reason})`).join("; ")}` : "",
      r.apply?.strippedQuotes.length ? `Unverifiable quotes stripped: ${r.apply.strippedQuotes.length}` : "",
      r.research.gaps.length ? `\nResearch gaps: ${r.research.gaps.join("; ")}` : "",
      `</details>`,
    );
    if (r.judge.dissent_notes.length) lines.push(``, `**Dissent and open objections**`, ...r.judge.dissent_notes.map((d) => `- ${d}`));
  }
  if (failures.length) lines.push(``, `### Failures`, ...failures.map((f) => `- ${f}`));
  lines.push(``, `Tokens: ${runs.reduce((a, r) => a + r.tokens, 0).toLocaleString()}${branch ? ` · branch \`${branch}\`` : ""}`);
  return lines.filter((l) => l !== undefined).join("\n");
}

function validate(): string[] {
  try {
    loadData();
    return [];
  } catch (e) {
    return ((e as { errors?: string[] }).errors ?? [String(e)]).slice(0, 40);
  }
}

async function main() {
  log(`Run ${runId}: ${focus.label} × ${traditions.map((t) => t.meta.tradition.id).join(", ")}`);
  const results = await pool(traditions, CONCURRENCY, runTradition);
  const runs = results.filter((r): r is TraditionRun => !(r instanceof Error));
  const failures = results.flatMap((r, i) => (r instanceof Error ? [`${traditions[i].meta.tradition.id}: ${r.message}`] : []));
  failures.forEach((f) => log(`FAILED ${f}`));
  const withOps = runs.filter((r) => r.judge.ops.length);

  if (DRY || !withOps.length) {
    save("report.md", report(runs, failures));
    log(DRY ? `Dry run: nothing applied. Report: ${relative(root, join(runDir, "report.md"))}` : "No changes proposed.");
    return;
  }

  const original = git("rev-parse", "--abbrev-ref", "HEAD");
  const branch = `research/${topicId.replace(/[^\w.-]+/g, "-")}-${runId.slice(0, 12)}`;
  git("checkout", "-b", branch);
  try {
    let errors: string[] = [];
    for (let attempt = 0; attempt <= 2; attempt++) {
      for (const r of withOps) {
        r.apply = await applyOps(root, r.t.meta.tradition.id, r.judge.ops, verifiedQuotes(r), verifier, r.t.meta.tradition.allowedDomains);
        log(`[${r.t.meta.tradition.id}] applied ${r.apply.applied.length}, skipped ${r.apply.skipped.length}, stripped ${r.apply.strippedQuotes.length} quotes`);
      }
      const fetched = spawnSync("npm", ["run", "fetch:scripture"], { cwd: root, encoding: "utf8", timeout: 600_000 });
      const fetchIssues = `${fetched.stdout}\n${fetched.stderr}`.split("\n").filter((l) => /\bfail|error|!\s/i.test(l));
      if (fetchIssues.length) log(`fetch:scripture: ${fetchIssues.slice(0, 5).join(" | ")}`);
      errors = [
        ...validate(),
        // Ops the applier could not parse are errors the judge must fix too.
        ...withOps.flatMap((r) =>
          (r.apply?.skipped ?? []).filter((s) => s.reason.startsWith("unparseable")).map((s) => `[${r.t.meta.tradition.id}] ${s.op}: ${s.reason.split("\n")[0]}`),
        ),
      ];
      if (!errors.length) break;
      log(`Validation failed (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
      if (attempt === 2) break;
      git("checkout", "--", "data");
      for (const r of withOps) {
        const mine = errors.filter((e) => e.includes(`[${r.t.meta.tradition.id}]`) || e.includes(`/${r.t.meta.tradition.id}/`));
        const shared = errors.filter((e) => !/\[\w+\]|traditions\//.test(e));
        if (!mine.length && !shared.length) continue;
        r.judge = (
          await runAgy<JudgeOutput>({
            prompt: repairPrompt(r.judgePrompt, r.judge.ops, [...mine, ...shared]),
            schema: JUDGE_SCHEMA,
            model: JUDGE_MODEL,
            label: `${r.t.meta.tradition.id}/repair${attempt + 1}`,
            log,
          })
        ).output;
        save(`${r.t.meta.tradition.id}.7-repair${attempt + 1}.yaml`, r.judge);
      }
    }
    if (errors.length) throw new Error(`validation still failing: ${errors.slice(0, 8).join(" | ")}`);
    if (!git("status", "--porcelain", "--", "data")) {
      log("Ops produced no file changes.");
      git("checkout", original);
      git("branch", "-D", branch);
      save("report.md", report(runs, failures));
      return;
    }
    const body = report(runs, failures, branch);
    save("report.md", body);
    const title = `Research: ${focus.label} (${withOps.map((r) => r.t.meta.tradition.shortName).join(", ")})`;
    git("add", "data");
    writeFileSync(join(runDir, "commit.txt"), `${title}\n\nAutomated research run ${runId}: blind research, critic, judge; quotes machine-verified.\n`);
    git("commit", "-q", "-F", join(runDir, "commit.txt"));
    if (!PR) {
      log(`Committed on local branch ${branch}. Report: ${relative(root, join(runDir, "report.md"))}`);
      log(`Review:  git diff ${original}...${branch}   (or: git checkout ${branch} && npm run dev)`);
      log(`Merge:   git merge --no-ff ${branch}`);
      log(`Discard: git branch -D ${branch}`);
    } else {
      git("push", "-q", "-u", "origin", branch);
      const gh = spawnSync("gh", ["pr", "create", "--base", original, "--head", branch, "--title", title, "--body-file", join(runDir, "report.md")], {
        cwd: root,
        encoding: "utf8",
      });
      if (gh.status === 0) log(`PR: ${gh.stdout.trim()}`);
      else {
        const m = git("remote", "get-url", "origin").match(/github\.com[:/](.+?)(\.git)?$/);
        log(`Pushed ${branch}. gh could not open the PR (${(gh.stderr || "").trim().split("\n")[0]}).`);
        if (m) log(`Open it here: https://github.com/${m[1]}/compare/${original}...${branch}?expand=1 (body: ${relative(root, join(runDir, "report.md"))})`);
      }
    }
  } catch (e) {
    log(`Aborting: ${(e as Error).message}. Reverting the branch.`);
    git("checkout", "--", "data");
    git("checkout", original);
    git("branch", "-D", branch);
    save("report.md", report(runs, [...failures, (e as Error).message]));
    process.exitCode = 1;
    return;
  }
  git("checkout", original);
}

main()
  .catch((e) => {
    log(`FATAL ${(e as Error).stack ?? e}`);
    process.exitCode = 1;
  })
  .finally(() => verifier.close());
