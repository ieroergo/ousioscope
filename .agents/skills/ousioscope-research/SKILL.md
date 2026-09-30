---
name: ousioscope-research
description: Researches a subject or point of debate for one or more religious traditions in the Ousioscope project and proposes cited data changes as a pull request. Use when asked to research, fill gaps in, audit the completeness of, or add data for a tradition's view on a topic (e.g. "what do Jehovah's Witnesses teach about Mary as Mother of God", "is the Catholic Trinity data complete").
---

# Ousioscope research workflow

Proposes new or corrected data for a topic through independent roles, then commits it on a local feature branch
(one per topic) for review and a local merge. Every quote written into the data is machine-checked against the
live source page.

## Run it

```bash
npm run research -- --topic <id> [--traditions all|catholic,lds,reformed,jw,sunni,shia] [--dry-run] [--pr]
                    [--concurrency 3] [--from-run <run-id>] [--resume <run-id>]
```

- `<id>` is a subject (a referent id from `data/referents.yaml`, e.g. `ref.mary`) or a registry topic from
  `data/topics.yaml` (e.g. `debate.theotokos`, `topic.godhead`).
- `--dry-run` runs every role and writes the report, but changes no files. Start with this.
- Without `--dry-run`, `data/` must be clean. The run creates local branch `research/<topic>-<stamp>`, applies the
  judge's ops, fetches any newly cited scripture, validates (asking the judge to repair up to twice), commits, and
  switches back to your branch. It prints how to review (`git diff main...<branch>`), merge
  (`git merge --no-ff <branch>`), or discard (`git branch -D <branch>`).
- `--from-run <run-id>` re-applies a saved (e.g. dry) run without calling the agents again.
- `--resume <run-id>` continues an interrupted run (e.g. after an Antigravity quota error): stages already saved
  in that run folder are reused and only missing stages run.
- **One model only:** every role uses `gemini-3.8-flash-high` (the `MODEL` constant in `scripts/research/index.ts`)
  for consistent provenance. There is no per-run model switch. If the quota runs out, the run stops; resume it
  after the reset on the same model.
- Parallel runs: run them as `--dry-run` (they don't touch git), then apply each one in turn with `--from-run`.
  A tradition takes about 1M tokens.
- Combining several results: branches built from the same `main` can conflict. Check out one combined branch and
  apply the saved runs on top of it in sequence with `--from-run` (each result branches from and fast-forwards onto
  the combined branch).
- `--pr` (opt-in) also pushes the branch and opens a GitHub PR with `gh`, or prints a compare URL if `gh` isn't
  signed in to github.com.
- Set `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` to control the commit identity.
- Artifacts (every prompt, role output, quote check, log, and `report.md`) go to `research/runs/<run-id>/`
  (git-ignored).

## Roles (each is a separate headless `agy` turn in an empty, new-project workspace)

1. **Blind researcher** (web): sees the topic, the tradition's authority tiers, its own rule of interpretation, and
   its allowed domains, but none of the project's claims or metamodel. Returns atomic findings with verbatim quotes.
2. **Quote verification** (code, not a model): fetches each cited page (headless Chrome fallback) and checks the
   quote; off-allowlist sources are rejected.
3. **Reconciler** (no tools): maps each finding onto the existing metamodel and model: already_modeled / refines /
   conflicts / new / out_of_scope.
4. **Critic** (web): interior critique (fidelity, citation, scripture per the tradition's own hermeneutic) and
   internal dissent (schools, earlier vs. current teaching, gradings). Its quotes are verified too.
5. **Judge** (no tools): accepts or rejects each finding and emits structured ops (`add_node`, `add_attribute`,
   `add_edge`, `replace_*`, `add_category`, `add_relationship`, `add_axiom`, `add_outline_topic`, `set_stance`,
   `add_referent`, `add_registry_topic`) plus PR notes and recorded dissent.
6. **Apply** (code): small text edits to the YAML; any authority quote not among the verified quotes is stripped.

## When reviewing a research branch

- Read `research/runs/<run-id>/report.md`: the findings table (verified quotes, critic verdict, judge decision) and
  "Dissent and open objections".
- `git checkout <branch> && npm run dev`, then focus the topic to see the change in the graph.
- Unmodeled or rejected findings are listed in the report.
