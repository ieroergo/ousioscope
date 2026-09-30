import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MODEL } from "./model";

export interface Job {
  id: string;
  tradition: string;
  topic?: string;
  kind: "topic" | "new";
  sourceRun?: string;
  questions?: string[];
  asked?: string[];
  phase: "research" | "apply" | "review" | "merge" | "done" | "blocked";
  pass: number;
  revision: number;
  repairs: number;
  failures: number;
  run?: string;
  worktree?: string;
  base?: string;
  branch?: string;
  feedback?: string;
  issue?: string;
  gaps?: string[];
}
export interface Review { ready: boolean; issues: string[]; needs_research: boolean; gap_questions: string[]; commit: string; model: string }

const ALL = ["catholic", "lds", "reformed", "jw", "sunni", "shia"];
const SUBJECTS = ["jesus", "godhead", "holy-spirit", "mary", "adam", "father", "heavens-earth", "eve"];
const SCOPE = "Orthodox Rabbinic Judaism, distinguishing recognized authorities and schools. Use accessible primary texts, genuine source-backed authority tiers and outline headings, and source wording for category names. Ground affirmative divine incorporeality separately from Raavad's objections to classifying corporealist believers. Verify the identity and context of Yeshu passages and current Orthodox treatment of Jesus. Do not infer explicit rejection of Christian propositions from source silence or general fatherhood, messianic or resurrection teaching. A passage about Moses or Noah's descendants does not establish an individual relationship involving Adam. Record inaccessible sources as verification gaps and seek faithful accessible primary-text editions.";

export function initialJobs(): Job[] {
  const jobs: Job[] = [];
  const add = (topic: string, tradition: string, sourceRun?: string) => jobs.push({ id: `${topic}-${tradition}`, topic: `ref.${topic}`, tradition, kind: "topic", sourceRun, phase: "research", pass: 1, revision: 0, repairs: 0, failures: 0 });
  for (const tid of ["jw", "lds", "reformed"]) add("godhead", tid, "sweep-godhead");
  jobs.push({ id: "judaism-bootstrap", tradition: "judaism", kind: "new", phase: "research", pass: 1, revision: 0, repairs: 0, failures: 0 });
  for (const tid of ["catholic", "sunni", "shia"]) add("godhead", tid, "sweep-godhead");
  for (const tid of ["jw", "reformed"]) add("jesus", tid, "sweep-jesus");
  for (const [topic, traditions] of [["holy-spirit", ["catholic", "reformed"]], ["mary", ["catholic", "jw"]], ...["adam", "father", "heavens-earth", "eve"].map((topic) => [topic, ALL])] as [string, string[]][]) {
    for (const tid of traditions) add(topic, tid, `sweep-${topic}`);
  }
  for (const topic of SUBJECTS) add(topic, "judaism");
  return jobs;
}

export function newQuestions(asked: string[], questions: string[]): string[] {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = new Set(asked.map(key));
  return questions.filter((question) => {
    const normalized = key(question);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function quotaWait(output: string): number | undefined {
  if (!/quota reached/i.test(output)) return;
  const waits = [...output.matchAll(/Resets in ((?:\d+h)?(?:\d+m)?(?:\d+s)?)/g)].map((m) => {
    const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(m[1]);
    return parts ? [3600, 60, 1].reduce((sum, unit, i) => sum + unit * Number(parts[i + 1] ?? 0), 0) : 0;
  }).filter((n) => n > 0);
  return (waits.length ? Math.max(...waits) : 600) + 120;
}

export function canMerge(mainBranch: string, status: string, mainHead: string, base: string, review: Review, candidate: string): boolean {
  return mainBranch === "main" && !status.trim() && mainHead === base && review.ready && !review.issues.length && review.commit === candidate && review.model === MODEL;
}

const root = join(import.meta.dirname, "../..");
const home = join(root, "research/runs/progressive");
const env = { ...process.env, GIT_AUTHOR_NAME: "Chris Kudelka", GIT_AUTHOR_EMAIL: "ckudelka@gmail.com", GIT_COMMITTER_NAME: "Chris Kudelka", GIT_COMMITTER_EMAIL: "ckudelka@gmail.com" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
let stopping = false;
const log = (message: string) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  writeFileSync(join(home, "progress.log"), line, { flag: "a" });
};
const sleep = async (seconds: number) => {
  const until = Date.now() + seconds * 1000;
  while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(30_000, until - Date.now())));
};
async function command(cwd: string, args: string[], job: Job) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn("npm", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      writeFileSync(join(home, `${job.id}-p${job.pass}-${job.phase}-${Date.now()}.log`), output);
      resolve({ code: code ?? 1, output });
    });
  });
}
function workspace(job: Job) {
  job.base = git(root, "rev-parse", "main");
  job.worktree = mkdtempSync(join(tmpdir(), "ousio-progress-"));
  git(root, "worktree", "add", "-b", `research/work-${job.id}-p${job.pass}-${Date.now()}`, job.worktree, "main");
  symlinkSync(join(root, "node_modules"), join(job.worktree, "node_modules"), "dir");
  mkdirSync(join(job.worktree, "research"), { recursive: true });
  symlinkSync(join(root, "research/runs"), join(job.worktree, "research/runs"), "dir");
  job.run = `progressive-${job.id}-p${job.pass}-r${job.revision}`;
  const dir = join(root, "research/runs", job.run);
  mkdirSync(dir, { recursive: true });
  if (job.sourceRun && job.kind === "topic") {
    const filename = `${job.tradition}.1-research.yaml`;
    const source = join(root, "research/runs", job.sourceRun, filename);
    if (existsSync(source) && !existsSync(join(dir, filename))) copyFileSync(source, join(dir, filename));
  }
  log(`${job.id}: worktree ${job.worktree}, base ${job.base}; all previous branches and artifacts retained.`);
}
function judgeFeedback(job: Job, issues: string[]) {
  const dir = join(root, "research/runs", job.run!);
  job.feedback = join(dir, `feedback-${Date.now()}.json`);
  writeFileSync(job.feedback, JSON.stringify(issues, null, 2));
  const prefix = job.kind === "new" ? "" : `${job.tradition}.`;
  for (const extension of ["yaml", "prompt.md"]) {
    const file = join(dir, `${prefix}6-judge.${extension}`);
    if (existsSync(file)) renameSync(file, `${file}.before-review-${Date.now()}`);
  }
  job.phase = "research";
  job.worktree = undefined;
  job.branch = undefined;
  job.repairs++;
}
const argsFor = (job: Job, apply: boolean) => {
  const args = job.kind === "new"
    ? ["run", "research:new", "--", "--id", "judaism", "--name", "Orthodox (Rabbinic) Judaism", "--scope", [SCOPE, ...(job.questions ?? [])].join("\n"), "--store", "jps1917", "--bible-label", "Tanakh", "--resume", job.run!]
    : ["run", "research", "--", "--topic", job.topic!, "--traditions", job.tradition, "--concurrency", "1", apply ? "--from-run" : "--resume", job.run!, ...(job.questions?.length ? ["--scope", job.questions.join("\n")] : [])];
  if (apply) args.push("--preserve-on-error", "--branch", job.branch!);
  else args.push("--dry-run");
  if (job.feedback && !apply) args.push("--feedback", job.feedback);
  return args;
};

async function main() {
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify(initialJobs(), null, 2));
    return;
  }
  mkdirSync(home, { recursive: true });
  const lock = join(home, "runner.lock");
  if (existsSync(lock)) {
    const owner = Number(readFileSync(lock, "utf8"));
    if (!Number.isInteger(owner) || owner <= 0) throw new Error("Runner lock has no valid owner; leaving it untouched.");
    try { process.kill(owner, 0); throw new Error(`Progressive runner PID ${owner} is already alive`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
    renameSync(lock, `${lock}.stale-${Date.now()}`);
  }
  writeFileSync(lock, String(process.pid), { flag: "wx" });
  const stateFile = join(home, "state.json");
  const state: { pid?: number; nextRetry?: number; jobs: Job[] } = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { jobs: initialJobs() };
  if (state.pid) {
    try { process.kill(state.pid, 0); throw new Error(`Progressive runner PID ${state.pid} is already alive`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
  }
  state.pid = process.pid;
  const save = () => {
    const file = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(file, JSON.stringify(state, null, 2));
    renameSync(file, stateFile);
  };
  save();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; });
  log(`Progressive runner started: ${MODEL} only; isolated worktrees; reviewed fast-forward local merges; never push.`);
  try {
    while (!stopping) {
      if (state.nextRetry && state.nextRetry > Date.now()) {
        log(`Quota reset retry at ${new Date(state.nextRetry).toISOString()}.`);
        await sleep((state.nextRetry - Date.now()) / 1000);
        continue;
      }
      state.nextRetry = undefined;
      const job = state.jobs.find((j) => j.phase !== "done" && j.phase !== "blocked");
      if (!job) { log(`Queue exhausted; ${state.jobs.filter((j) => j.phase === "blocked").length} blocked jobs remain explicitly recorded in state.json.`); break; }
      if (job.kind === "topic" && job.tradition === "judaism" && !existsSync(join(root, "data/traditions/judaism/metamodel.yaml"))) {
        job.phase = "blocked";
        job.issue = "Judaism bootstrap has not passed review/merge; subject follow-ups remain blocked, not skipped.";
        log(`${job.id}: ${job.issue}`);
        save();
        continue;
      }
      try {
        if (job.base && job.base !== git(root, "rev-parse", "main") && job.phase !== "merge") {
          job.sourceRun = job.run;
          job.revision++;
          job.worktree = undefined;
          job.phase = "research";
          job.feedback = undefined;
        }
        if (!job.worktree) { workspace(job); save(); }
        log(`${job.id}: ${job.phase}, pass ${job.pass}, revision ${job.revision}.`);
        if (job.phase === "merge") {
          const review: Review = JSON.parse(readFileSync(join(root, "research/runs", job.run!, "final-review.json"), "utf8"));
          const candidate = git(root, "rev-parse", job.branch!);
          if (git(root, "rev-parse", "main") !== job.base) {
            if (git(root, "merge-base", "main", candidate) === candidate) { job.phase = "done"; save(); continue; }
            job.sourceRun = job.run;
            job.revision++;
            job.worktree = undefined;
            job.feedback = undefined;
            job.phase = "research";
            log(`${job.id}: main advanced; re-reconcile and review against the new base rather than overwrite it.`);
            save();
            continue;
          }
          if (!canMerge(git(root, "branch", "--show-current"), git(root, "status", "--porcelain"), git(root, "rev-parse", "main"), job.base!, review, candidate)) {
            log(`${job.id}: merge deferred; main must be checked out and clean, and the review must match the exact candidate.`);
            await sleep(60);
            continue;
          }
          git(root, "merge", "--ff-only", job.branch!);
          job.phase = "done";
          job.gaps = review.gap_questions;
          for (const ancestor of state.jobs.filter((j) => job.id.startsWith(`${j.id}-gaps`))) ancestor.gaps = review.gap_questions;
          log(`${job.id}: MERGED ${candidate.slice(0, 8)} into local main; ${review.gap_questions.length} remaining research questions.`);
          const questions = newQuestions(job.asked ?? [], review.gap_questions);
          if (questions.length && job.kind === "topic") {
            state.jobs.push({ id: `${job.id}-gaps`, kind: "topic", tradition: job.tradition, topic: job.topic, questions, asked: [...(job.asked ?? []), ...questions], phase: "research", pass: job.pass + 1, revision: 0, repairs: 0, failures: 0 });
          } else if (review.gap_questions.length && job.kind === "topic") {
            log(`${job.id}: remaining questions were already attempted; retained as unresolved rather than endlessly repeating research.`);
          }
          if (job.kind === "new") for (const blocked of state.jobs.filter((j) => j.tradition === "judaism" && j.kind === "topic" && j.phase === "blocked")) { blocked.phase = "research"; blocked.issue = undefined; }
          save();
          continue;
        }
        let result: { code: number; output: string };
        if (job.phase === "review") {
          git(job.worktree!, "checkout", job.branch!);
          result = await command(job.worktree!, ["exec", "--", "tsx", "scripts/research/review-run.ts", "--root", job.worktree!, "--run", job.run!, "--tradition", job.tradition, "--base", job.base!, "--questions", JSON.stringify(job.questions ?? []), ...(job.kind === "new" ? ["--new"] : [])], job);
        } else {
          if (job.phase === "apply") job.branch = `research/apply-${job.id}-p${job.pass}-${Date.now()}`;
          save();
          result = await command(job.worktree!, argsFor(job, job.phase === "apply"), job);
        }
        const wait = quotaWait(result.output);
        if (wait) {
          state.nextRetry = Date.now() + wait * 1000;
          log(`${job.id}: Gemini quota exhausted; saved stages retained.`);
          save();
          continue;
        }
        if (result.code !== 0 || /^FAILED\s/m.test(result.output)) {
          const errorsFile = join(root, "research/runs", job.run!, "apply-errors.json");
          if (job.phase === "apply" && existsSync(errorsFile) && job.repairs < 3) {
            judgeFeedback(job, JSON.parse(readFileSync(errorsFile, "utf8")));
            log(`${job.id}: failed apply preserved; judge repair queued on a fresh clean worktree.`);
            save();
            continue;
          }
          throw new Error(result.output.slice(-1800));
        }
        if (job.phase === "research") job.phase = "apply";
        else if (job.phase === "apply") {
          if (/No changes proposed|Ops produced no file changes/.test(result.output)) {
            job.branch = git(job.worktree!, "branch", "--show-current");
            job.phase = "review";
            log(`${job.id}: no file changes; review remaining gaps before marking complete.`);
          }
          else if (/Committed on local branch/.test(result.output)) job.phase = "review";
          else throw new Error("Apply did not report a commit or an explicit no-op");
        } else {
          const review: Review = JSON.parse(readFileSync(join(root, "research/runs", job.run!, "final-review.json"), "utf8"));
          if (!review.ready) {
            if (job.repairs >= 3) throw new Error(`Still not ready after corrections: ${review.issues.join(" | ")}`);
            if (review.needs_research) {
              job.revision++;
              job.questions = review.gap_questions;
              job.sourceRun = undefined;
              job.worktree = undefined;
              job.feedback = undefined;
              job.phase = "research";
              job.repairs++;
            } else judgeFeedback(job, review.issues);
            log(`${job.id}: citation-fit review withheld merge; ${review.needs_research ? "fresh blind research" : "judge correction"} queued.`);
          } else {
            const build = await command(job.worktree!, ["run", "build"], job);
            if (build.code !== 0) throw new Error(`Build failed: ${build.output.slice(-1200)}`);
            job.phase = "merge";
          }
        }
        job.failures = 0;
        job.issue = undefined;
        save();
      } catch (e) {
        if (job.phase === "apply") job.worktree = undefined;
        job.issue = (e as Error).message;
        job.failures++;
        if (job.failures >= 3) { job.phase = "blocked"; log(`${job.id}: BLOCKED after three non-quota failures: ${job.issue}`); }
        else { log(`${job.id}: retryable failure ${job.failures}: ${job.issue}`); state.nextRetry = Date.now() + 300_000; }
        save();
      }
    }
  } finally {
    state.pid = undefined;
    save();
    if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock);
    log("Runner stopped; all jobs, branches, worktrees, and research artifacts remain resumable.");
  }
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) main().catch((e) => { console.error(e); process.exitCode = 1; });
