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
