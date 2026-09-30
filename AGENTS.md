# Ousioscope

Ousioscope (from Greek ousia, "being, substance"): compares religious traditions' semantic networks (what each says
things ARE), each in its own words and cited to its own sources. Traditions: Catholic, LDS, Reformed (Westminster),
Jehovah's Witnesses, Sunni Islam, Shia Islam. View one tradition (Single) or two side by side (Compare).
Current scope: 8 subjects (God the Father, Jesus Christ, Holy Spirit, God as a whole, the created world, Adam, Eve,
Mary), each tradition's own outline of teaching, and 11 debate propositions with cited stances.

## Stack
- Vite + React + TypeScript + Cytoscape.js (+ cytoscape-fcose layout), zod schema, YAML data

## Commands
- `npm run validate`: schema + integrity + citation + verb-lint + category-name checks on `data/` (runs before dev/build)
- `npm run check:terms`: fetches each category's term source page and confirms the quoted name is there (online)
- `npm run dev`: validate, then start Vite
- `npm run typecheck`: `tsc --noEmit`
- `npx tsx --test scripts/research/verify.test.ts`: quote-matching and rendered HTTP-error regression tests (offline)
- `npm run build`: validate + typecheck + production build
- `npm run fetch:scripture`: fetch the exact text of every newly cited verse into `data/scripture/<store>.yaml`
  (NABRE from bible.usccb.org via puppeteer-core + local Chrome; KJV/Restoration from churchofjesuschrist.org).
  Incremental: only missing verses are fetched. Run it after adding citations, before `validate`.
- `npm run fetch:original`: regenerate `data/scripture/original.yaml` from `original-curation.yaml`
  (SBLGNT/MorphGNT, WLC/OSHB, Scrivener TR, Nova Vulgata, Dodson/Strong's glosses).
- Install deps with `npm install --before=<date 7+ days ago>` to avoid brand-new releases.

## Git
- Remote `origin` is `git@github.com:ieroergo/ousioscope.git` (push over SSH; `gh` is signed in to github.com as
  ieroergo for `--pr`).
- Commit as `Chris Kudelka <ckudelka@gmail.com>` via `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars. Don't change git
  config.
- Research results land on local `research/*` branches and are merged locally. Push only when asked.

## Layout
- `data/referents.yaml`: cross-tradition referent registry (canonical name + aliases by tradition/language); every
  referent is a "Subject" in the Topic picker.
- `data/topics.yaml`: shared topic registry (doctrine, salvation, life & worship, debate propositions).
- `data/crosswalks.yaml`: curated category crosswalks between traditions (optional overlay).
- `data/traditions/<id>/metamodel.yaml`: tradition info (tiers, scripture stores, `hermeneutic`, `allowedDomains`),
  its own outline `topics`, debate `stances`, category tree, relationship types, axioms.
- `data/traditions/<id>/model.yaml`: individuals (nodes, each with a referent) and edges.
- `data/scripture/<store>.yaml`: fetched verse text per translation; `original.yaml` / `original-curation.yaml`:
  Greek/Hebrew notes.
- `src/schema.ts` (zod), `src/ontology.ts` (loading, validation, claim refs), `src/topics.ts` (topic coverage,
  spotlight ids), `src/crosswalk.ts`, `src/scripture.ts`; `scripts/validate.ts` (CLI).
- UI: `src/App.tsx` (shell, toolbar, panes, focus logic), `src/GraphPane.tsx` (Cytoscape, layout, spotlight/pulse),
  `src/graph.ts` (elements, neighborhoods), `src/Details.tsx` + `src/ScripturePanel.tsx` (detail panel),
  `src/CrosswalkOverlay.tsx`, `src/validator/` (claim validator).
- `scripts/research/` + `.agents/skills/ousioscope-research/`: agentic research workflow.
- New traditions are picked up automatically from `data/traditions/*/`.

## App UI
- Top bar: Topic picker (Subjects, Doctrine, Salvation, Life & worship, Points of debate), then one grouped icon
  toolbar, each icon with a hover definition: Focus (Isolate / In context), Layout (Single / Compare), View
  (Model / Metamodel), Categories as (Boxes / Nodes / Color; Model only), Crosswalk (Compare only).
- Each canvas header: tradition picker (⇄ swaps sides), Degrees slider when a subject is focused (1–5 degrees,
  then Max, capped at how far that graph reaches), Auto-layout button, and a settings gear (minimum authority tier).
- Detail panel (right, collapsible, resizable): one tab per tradition; claims show category path, topics, referent,
  scripture (reference column; original-language notes collapsed), and authority with tier. Hovering a listed
  claim pulses it in the graph. A breadcrumb returns to the focused topic.
- Shareable URL params: `left`, `right`, `mode=single`, `view=metamodel`, `group=nodes|color`, `xw=1`,
  `topic=<id>`, `fm=context`.

## Modeling decisions
- Each tradition has its own metamodel: its own category tree AND its own relationship types.
- Categories come from each tradition's own sources and vocabulary.
- Every category records where its NAME comes from in `term`:
  - `kind: own`: the tradition's own word. `quote` is verbatim text containing the label's term (the label minus
    parentheticals and a leading "The"/"A"; plurals allowed), from a cited page (`url`) or from the tradition's own
    translation of a verse (`ref`). Prefer the source's exact wording for the label (e.g. "Person in the Trinity",
    not "Divine Person", for Westminster).
  - `kind: editorial`: a structural heading the sources don't use as a name, with a `note` explaining it.
  - `npm run validate` checks that the quote contains the term and matches the verse. `npm run check:terms` checks
    that URL quotes are on the live page.
- No fixed depth cap on category trees; go as deep as each tradition's sources require.
- Decomposition discipline (EA-like, not EA notation):
  - Elements are nouns with a definition and one parent category.
  - Relationship names are single, atomic verbs. Never embed a noun or category in the verb
    (bad: `bornInFlesh`, `hasNature`). Validator should flag relationship names containing a category name.
  - Prefer the tradition's own precise verb (e.g. Catholic: Divine Person `is` Divine Nature (CCC 253);
    Son `assumes` Human Nature (CCC 461)). Use `hasPart` only for true composition.
  - Keep is-a (taxonomy), has-part (composition), and tradition relationships as separate axes.
  - Doctrinal events that are doctrines in their own right (Incarnation, Fall, Atonement) are elements;
    small qualifiers are attributes.
- TBox/ABox split:
  - Model nodes are INDIVIDUALS only, and every node must have a registered referent (one node per referent
    per tradition). Do not create named particulars like "Christ's human nature" or "Jesus's body".
  - Edges point to an individual (`target`) or to a kind (`targetKind` + `quantifier`):
    `some` = an unnamed member (existential, default), `all` = every member, `kind` = the universal itself.
  - `asTo: <Category>` qualifies the respect in which an edge holds (Chalcedon "as to his divinity/humanity";
    LDS "in the flesh"). Use it instead of inventing part-nodes.
  - Facts true of every member of a kind go in metamodel `axioms` (class-level), e.g. HumanNature hasPart some SpiritualSoul.
  - Facts about one individual's particular (e.g. Christ's risen body) go in that individual's attributes.
- Cross-tradition bridges are by REFERENT (curated registry: id, canonical name, aliases scoped by tradition and
  by language) and by shared topics/debates. Tradition models never reference each other. Category correspondences
  live only in the separate, optional crosswalk layer (see Crosswalks).
- Exclude teachings a tradition has rejected; include only current teaching.

## Citations
- Required on every node AND every edge; the build fails if missing.
- Two fields: `scripture` and `authority`.
- Scripture first: Old/New Testament preferred; tradition-specific scripture (deuterocanon, Book of Mormon,
  D&C, Pearl of Great Price) after.
- Use the proof texts the tradition's authority itself cites; never add our own proof-texts.
- If no Bible verse is cited by the authority, record `bible: none-cited` explicitly.
- Each tradition declares its preferred scripture stores in `tradition.scripture`. The validator fails if any
  cited verse has no text in that store. Current stores:
  - Catholic `nabre` (USCCB) · LDS `lds` (KJV + Restoration) · Reformed `esv` (Crossway, via Bible Gateway)
  - Jehovah's Witnesses `nwt` (wol.jw.org) · Sunni `quran-sahih` · Shia `quran-qarai` (Tanzil, with Arabic)
  - `kjv` for Bible parallels in traditions whose scripture is not the Bible.
- OT/NT is the common baseline: cite Bible verses wherever the tradition's own authorities or study aids do
  (e.g. the LDS Topical Guide, CCC cross-references, Westminster proof texts). Use `none-cited` only when none exist.
- `bibleRole: parallel` (Islam): the Bible is not that tradition's scripture. Bible verses are parallels to its own
  scripture (shown after the Qur'an and labeled as parallels), never proof texts.
- Qur'an refs use `Quran <surah>:<ayah>`.
- Westminster proof texts marked "X with Y" become `together` groups.
- Refs use one normalized English form (e.g. `John 1:14`, `1 Cor 15:35-50`, `D&C 93:29`) shared by all stores.
- A passage may be `{ ref, highlight }`; `highlight` must be an exact phrase from that tradition's text. Add one for
  long ranges so the relevant words show immediately.
- Use `{ together: [...refs], note }` when passages support a claim only jointly (e.g. prophecy + fulfillment);
  the note must say which authority reads them together.
- Greek/Hebrew: curate in `data/scripture/original-curation.yaml` only where a claim depends on the wording
  (`why` must cite where each tradition makes the argument), then `npm run fetch:original`. Never hand-write
  glosses, morphology, or original text.
- Authority tiers (highest first; ids in each metamodel):
  - Catholic: dogma > definitive doctrine > ordinary magisterium > common theological opinion
  - LDS: standard works > official declaration/proclamation > church-published > general authority teaching
  - Reformed: confessional (Westminster Standards) > denominational publication > Reformed theologian
  - Jehovah's Witnesses: Watch Tower publication > reference work quoted by Watch Tower
  - Sunni: Qur'an > sahih hadith > classical tafsir
  - Shia: Qur'an > hadith graded sahih (al-Kafi) > other hadith > scholarly creed
- Allowed sources are per tradition (`tradition.allowedDomains`), used by the validator and the research agents:
  - Catholic: vatican.va, usccb.org, newadvent.org
  - LDS: churchofjesuschrist.org
  - Reformed: opc.org, thewestminsterstandard.org, pcaac.org, esv.org
  - JW: jw.org, wol.jw.org
  - Sunni: quran.com, sunnah.com, tanzil.net
  - Shia: thaqalayn.net, al-islam.org, tanzil.net, quran.com
- Long-running fetches: always run in the background and poll; never block on them.

## Topics (the top-bar "Topic" focus)
- `data/topics.yaml`: shared registry of neutral topics, kinds `doctrine | salvation | life | debate`. Debates are
  neutral propositions (e.g. "The Son is a created being"). Referents are automatically "Subjects".
- Each metamodel has `topics:`, the tradition's OWN outline: CCC sections, Articles of Faith, WCF chapters, jw.org
  basic beliefs, the six articles of faith (Qur'an 4:136), and the five usul al-din. Items are in the tradition's
  words, cite its own `source`, and map to registry topics. `inOutline: false` marks topics the model covers but
  the headline outline does not list.
- Data is organized by topic. Every relationship type declares `topics` (required), and edges inherit them.
  Edges, attributes, and categories may add more `topics`. Tag a single edge instead of its verb when only that
  edge belongs (e.g. LDS begets: only Father → Jesus is Godhead/Christ).
- `stances:` holds the tradition's cited stance on each debate proposition (affirms | rejects | condemns |
  reframes | none). Anything other than `none` needs citations, and stances can be validated like claims.
- Each stance lists `claims:`, the modeled claims that express it: `"<node or edge id>"`, `"<node id>#<Attribute>"`,
  `"axiom:<id>"`, or `"category:<id>"`. The validator checks that each one resolves. A debate in focus shows exactly
  these claims.
- Focus modes: Isolate (default) shows only the focus's claims, or an empty pane with a note. In context shows the
  whole model with the rest dimmed.
- Don't invent outline items. Take them from the tradition's own published outline, and show unmodeled items as gaps.

## Research workflow (`scripts/research/`, skill `.agents/skills/ousioscope-research`)
- `npm run research -- --topic <referent or registry id> [--traditions all|a,b] [--dry-run] [--pr] [--concurrency N]
  [--from-run <id>] [--resume <id>]`
- The result is committed on a LOCAL branch `research/<topic>-<stamp>` (one per topic), to be merged locally with
  `git merge --no-ff <branch>`. Pushing and opening a PR happen only with `--pr`.
- Roles are headless `agy -p --json-schema` turns in empty, new-project workspaces: blind researcher (web; no
  project data) → code quote verification → reconciler (maps findings onto the model) → critic (interior
  critique + internal dissent, web) → code quote verification → judge (structured ops) → text-level apply →
  `fetch:scripture` → validate, with up to 2 judge repairs → commit on the local branch.
- Only machine-verified quotes (fetched page contains the quote; allowlisted domain) can be written into the data.
  Others are stripped. Scripture refs are normalized to the data's book abbreviations.
- Artifacts are saved in `research/runs/<run-id>/` (git-ignored). `--from-run` re-applies a reviewed dry run
  without calling agents. `--resume <run-id>` continues an interrupted run, reusing saved stages.
- Run parallel topics as dry runs (git-safe), then apply them one at a time with `--from-run`. Branches built
  from the same `main` can conflict with each other; to combine several, check out a combined branch and apply the
  saved runs on top of it in sequence (`--from-run`), fast-forwarding each result.
- Set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` (ckudelka@gmail.com for this repo) when running it.
- New traditions: `npm run research:new -- --id <id> --name "<name>" --scope "<stream>" --store <scripture store>
  [--bible-label <label>] [--dry-run] [--resume <run-id>]` (`scripts/research/new-tradition.ts`). Same protocol: blind
  researcher (proposes tiers, allowed sites, rule of interpretation, outline, categories, relationships, subjects,
  stances) → quote verification → critic → judge writes `metamodel.yaml` + `model.yaml` + referent aliases → live
  quote re-check against the judge's allowed domains → `fetch:scripture` → validate (up to 3 repairs) → local branch
  `research/new-<id>-<stamp>`. Run it as `--dry-run` first, then `--resume <run-id>` without `--dry-run` to apply.
- Scripture stores live in `scripts/fetch-scripture.ts` (`STORES`); `jps1917` is the JPS 1917 Tanakh (public domain)
  with the Masoretic Hebrew, via the Sefaria API. `tradition.bibleLabel` renames the Bible label (e.g. "Tanakh").
- Model policy: every role uses the single pinned model `gemini-3.8-flash-high` (`MODEL` in
  `scripts/research/index.ts`). Never switch models mid-run or across runs. If the quota runs out, stop and
  `--resume` after the reset.
- A tradition takes roughly 15–20 minutes and about 1M tokens with gemini-3.8-flash-high. Always run in the
  background and poll.

## Claim validator (`src/validator/`)
- "Validate this claim" on every node, attribute, edge, axiom, and category runs an interior critique of that one
  claim within its own tradition: fidelity, citation check, scripture support (per the tradition's own
  `hermeneutic`). No cross-tradition evaluation yet.
- Bring your own Gemini key (localStorage only, sent only to Google). One Interactions API call with `url_context` +
  `google_search` + a JSON response schema (Gemini 3 models). Results are session-only; nothing is saved.
- Sources are limited to `tradition.allowedDomains` (plus the claim's own cited URLs); anything else is removed
  after the call and reported. Quotes are marked "retrieved" only if the model reported fetching that page.
- The verdict must carry direct quotes with source links.
- Without a key: "Research in Google AI Mode" opens `google.com/search?udm=50&q=<compact prompt>`.
- Every tradition metamodel needs `hermeneutic` (cited like any claim) and `allowedDomains`.

## Crosswalks (`data/crosswalks.yaml`)
- Tradition models never reference each other; crosswalks are a separate, optional layer ("⟷ Crosswalk" toggle).
- Derived crosswalks are computed, never authored: if a referent is in category X in one tradition and Y in the
  other, X–Y is linked with the shared referents as evidence.
- Curated crosswalks: `a`/`b` as `tradition:Category`, `match` (close | broader | narrower | related | none; a
  relative to b; for none, `b` is a tradition id), `note` (what they share), `differsOn` (where they part ways;
  write it for every non-close match), and `basis`:
  - `tradition` / `scholarly`: needs `sources`.
  - `editorial`: no extra sources; it rests on each side's own cited definition, which the app shows alongside.
- Only state a `differsOn` claim that each side's own cited category definition or model supports.
