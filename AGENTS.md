# Ousioscope

Ousioscope (from Greek ousia, "being, substance"): side-by-side comparison of religious traditions' semantic networks. Traditions: Catholic, LDS, Reformed
(Westminster), Jehovah's Witnesses, Sunni Islam, Shia Islam. Pick any two in the header; the URL
(`?left=&right=`) is shareable.
First-version scope: Nature/being, Godhead/Trinity, Human origin/destiny.

## Stack
- Vite + React + TypeScript + Cytoscape.js (+ cytoscape-fcose layout), zod schema, YAML data

## Commands
- `npm run validate`: schema + integrity + citation + verb-lint checks on `data/` (runs before dev/build)
- `npm run dev`: validate, then start Vite
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: validate + typecheck + production build
- `npm run fetch:scripture`: fetch the exact text of every newly cited verse into `data/scripture/<store>.yaml`
  (NABRE from bible.usccb.org via puppeteer-core + local Chrome; KJV/Restoration from churchofjesuschrist.org).
  Incremental: only missing verses are fetched. Run it after adding citations, before `validate`.
- `npm run fetch:original`: regenerate `data/scripture/original.yaml` from `original-curation.yaml`
  (SBLGNT/MorphGNT, WLC/OSHB, Scrivener TR, Nova Vulgata, Dodson/Strong's glosses).
- Install deps with `npm install --before=<date 7+ days ago>` to avoid brand-new releases.

## Layout
- `data/referents.yaml`: cross-tradition referent registry (canonical name + aliases by tradition/language)
- `data/traditions/<id>/metamodel.yaml`: tradition info, authority tiers, category tree, relationship types
- `data/traditions/<id>/model.yaml`: nodes (typed by category, optional referent) and edges
- `src/schema.ts` (zod), `src/ontology.ts` (loading, validation, verse/tier helpers), `scripts/validate.ts` (CLI)
- `src/App.tsx`, `src/GraphPane.tsx`, `src/Details.tsx`, `src/graph.ts`, `src/selection.ts`: UI
- New traditions are picked up automatically from `data/traditions/*/`.

## Modeling decisions
- Each tradition has its own metamodel: its own category tree AND its own relationship types.
- Categories come from each tradition's own sources and vocabulary.
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
- Cross-tradition bridges are by REFERENT only (curated registry: id, canonical name, aliases scoped by
  tradition and by language). No concept-match field; the viewer compares metamodels themselves.
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
- Authority tiers:
  - Catholic: dogma > definitive doctrine > ordinary magisterium > common theological opinion
  - LDS: standard works > official declaration/proclamation > church-published > general authority teaching
- Allowed sources: vatican.va, churchofjesuschrist.org, New Advent, Denzinger, Encyclopedia of Mormonism,
  opc.org / thewestminsterstandard.org (Westminster Standards with proof texts), jw.org / wol.jw.org,
  quran.com (Ibn Kathir tafsir), tanzil.net (Qur'an), thaqalayn.net (al-Kafi with gradings).
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
- `npm run research -- --topic <referent or registry id> [--traditions all|a,b] [--dry-run] [--pr] [--from-run <id>]`
- The result is committed on a LOCAL branch `research/<topic>-<stamp>` (one per topic), to be merged locally with
  `git merge --no-ff <branch>`. Pushing and opening a PR happen only with `--pr`.
- Roles are headless `agy -p --json-schema` turns in empty, new-project workspaces: blind researcher (web; no
  project data) → code quote verification → reconciler (maps findings onto the model) → critic (interior
  critique + internal dissent, web) → code quote verification → judge (structured ops) → text-level apply →
  `fetch:scripture` → validate, with up to 2 judge repairs → commit on the local branch.
- Only machine-verified quotes (fetched page contains the quote; allowlisted domain) can be written into the data.
  Others are stripped. Scripture refs are normalized to the data's book abbreviations.
- Artifacts are saved in `research/runs/<run-id>/` (git-ignored). `--from-run` re-applies a reviewed dry run
  without calling agents.
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
