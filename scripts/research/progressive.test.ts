import assert from "node:assert/strict";
import { test } from "node:test";
import { canMerge, initialJobs, newQuestions, quotaWait, type Review } from "./progressive";
import { MODEL } from "./model";

void test("queues remaining subjects, both skipped Jesus refinements, and Judaism correction/coverage", () => {
  const jobs = initialJobs();
  assert.equal(jobs.length, 45);
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length);
  assert.equal(jobs.filter((j) => j.topic === "ref.jesus").length, 3);
  assert.ok(jobs.some((j) => j.id === "jesus-jw"));
  assert.ok(jobs.some((j) => j.id === "jesus-reformed"));
  assert.equal(jobs.filter((j) => j.tradition === "judaism" && j.kind === "topic").length, 8);
  assert.equal(jobs.filter((j) => j.kind === "new").length, 1);
  assert.equal(jobs[0].sourceRun, "sweep-godhead");
});

void test("queues new gap questions without endlessly repeating failed questions", () => {
  assert.deepEqual(newQuestions(["Does Adam have a body?"], ["does Adam have a body", "How is Adam created?", "How is Adam created?", ""]), ["How is Adam created?"]);
});

void test("waits for the longest quota reset without treating other failures as quota", () => {
  assert.equal(quotaWait("quota reached. Resets in 2h3m4s. Resets in 5m."), 7504);
  assert.equal(quotaWait("Individual quota reached."), 720);
  assert.equal(quotaWait("quota reached. Resets in 1m30s."), 210);
  assert.equal(quotaWait("Validation failed"), undefined);
});

void test("merges only a clean main and the exact approved candidate on its reviewed base/model", () => {
  const review: Review = { ready: true, issues: [], needs_research: false, gap_questions: [], commit: "candidate", model: MODEL };
  assert.equal(canMerge("main", "", "base", "base", review, "candidate"), true);
  assert.equal(canMerge("feature", "", "base", "base", review, "candidate"), false);
  assert.equal(canMerge("main", " M data/file.yaml", "base", "base", review, "candidate"), false);
  assert.equal(canMerge("main", "", "advanced", "base", review, "candidate"), false);
  assert.equal(canMerge("main", "", "base", "base", review, "different"), false);
  assert.equal(canMerge("main", "", "base", "base", { ...review, ready: false }, "candidate"), false);
  assert.equal(canMerge("main", "", "base", "base", { ...review, issues: ["Citation mismatch"] }, "candidate"), false);
  assert.equal(canMerge("main", "", "base", "base", { ...review, model: "different-model" }, "candidate"), false);
});
