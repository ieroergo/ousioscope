import { useState } from "react";
import { passageText } from "./ontology";
import type { OriginalEntry, PassageItem, ScriptureStore } from "./schema";
import { expandRef, findPhrase, isGroup, toPassage, type Passage } from "./scripture";

export interface ScriptureCtx {
  store?: ScriptureStore;
  label: string;
  original: Map<string, OriginalEntry>;
  otherVerses: Set<string>;
  otherName: string;
  onVerse: (verse: string) => void;
}

const LONG = 320;

function Highlighted({ text, phrase }: { text: string; phrase?: string }) {
  const at = phrase ? findPhrase(text, phrase) : undefined;
  if (!at) return <>{text}</>;
  return (
    <>
      {text.slice(0, at[0])}
      <mark>{text.slice(at[0], at[1])}</mark>
      {text.slice(at[1])}
    </>
  );
}

function OriginalPanel({ e }: { e: OriginalEntry }) {
  const [full, setFull] = useState(false);
  const lang = e.lang === "grc" ? "Greek" : "Hebrew";
  const focus = e.words.filter((w, i, all) => w.focus && all.findIndex((x) => x.focus && x.lemma === w.lemma) === i);
  return (
    <div className={`original ${full ? "open" : ""}`}>
      <button className="original-head" onClick={() => setFull(!full)} aria-expanded={full} title={full ? "Hide notes" : "Show notes and interlinear"}>
        <span className="lang-tag">{lang}</span>
        {focus.map((w, i) => (
          <span key={i} className="focus-word" title={`${w.parse}${w.strongs ? ` · ${w.strongs}` : ""}`}>
            <span className={e.lang === "hbo" ? "heb" : "grk"}>{w.form}</span> <em>{w.translit}</em> <span className="gloss">"{w.gloss}"</span>
          </span>
        ))}
        <span className="caret" aria-hidden>
          {full ? "▾" : "▸"}
        </span>
      </button>
      {full && (
        <>
          <p className="why">{e.why}</p>
          <div className={`orig-text ${e.lang === "hbo" ? "heb rtl" : "grk"}`}>{e.text}</div>
          <table className="interlinear">
            <thead>
              <tr>
                <th>Form</th>
                <th>Translit.</th>
                <th>Lemma</th>
                <th>Parsing</th>
                <th>Gloss</th>
              </tr>
            </thead>
            <tbody>
              {e.words.map((w, i) => (
                <tr key={i} className={w.focus ? "focus" : ""}>
                  <td className={e.lang === "hbo" ? "heb" : "grk"}>{w.form}</td>
                  <td>{w.translit}</td>
                  <td>
                    <span className={e.lang === "hbo" ? "heb" : "grk"}>{w.lemma}</span>
                    {w.strongs && <span className="muted"> {w.strongs}</span>}
                  </td>
                  <td>{w.parse}</td>
                  <td>{w.gloss}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {e.source}
            {e.quotes && ` · quotes ${e.quotes}`}
          </p>
          {e.textusReceptus && (
            <p className="small">
              <strong>Textus Receptus</strong> (behind the KJV):{" "}
              {e.textusReceptus.agrees ? "same wording" : <span className="variant">differs</span>}
              {e.textusReceptus.note && ` · ${e.textusReceptus.note}`}
              {!e.textusReceptus.agrees && <span className="grk tr-text"> {e.textusReceptus.text}</span>}
            </p>
          )}
          {e.novaVulgata && (
            <p className="small">
              <strong>Nova Vulgata</strong>:{" "}
              <a href={e.novaVulgata.url} target="_blank" rel="noreferrer">
                <em>{e.novaVulgata.text}</em>
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PassageCard({ p, ctx }: { p: Passage; ctx: ScriptureCtx }) {
  const [open, setOpen] = useState(false);
  const verses = expandRef(p.ref);
  const text = passageText(ctx.store, p.ref);
  const shared = verses.filter((v) => ctx.otherVerses.has(v));
  const originals = verses.map((v) => ctx.original.get(v)).filter((e): e is OriginalEntry => !!e);
  const long = !!text && text.length > LONG;
  const at = text && p.highlight ? findPhrase(text, p.highlight) : undefined;
  let shown = text ?? "";
  if (long && !open) {
    shown = at ? `…${text!.slice(Math.max(0, at[0] - 60), Math.min(text!.length, at[1] + 60))}…` : `${text!.slice(0, LONG)}…`;
  }
  return (
    <div className="passage">
      <button
        className={`vref ${shared.length ? "shared" : ""}`}
        title={shared.length ? `Also cited by ${ctx.otherName}: ${shared.join(", ")}` : "Show every claim citing this verse"}
        onClick={() => ctx.onVerse(shared[0] ?? verses[0])}
      >
        {p.ref}
        {shared.length > 0 && <span className="shared-dot" aria-label={`also cited by ${ctx.otherName}`} />}
      </button>
      <div className="vbody">
      {text ? (
        <span className="verse-text">
          <Highlighted text={shown} phrase={p.highlight} />
          {long && (
            <button className="link small" onClick={() => setOpen(!open)}>
              {open ? " show less" : " full passage"}
            </button>
          )}
        </span>
      ) : (
        <em className="muted"> text not available</em>
      )}
      {ctx.store?.originals && verses.some((v) => ctx.store!.originals![v]) && (
        <div className={`store-original ${ctx.store.originalLang === "ar" ? "arabic rtl" : ctx.store.originalLang === "hbo" ? "heb rtl" : ""}`} lang={ctx.store.originalLang === "hbo" ? "he" : ctx.store.originalLang}>
          {verses.map((v) => ctx.store!.originals![v]).filter(Boolean).join(ctx.store.originalLang === "ar" ? " ۝ " : " ")}
        </div>
      )}
      {originals.map((e) => (
        <OriginalPanel key={e.ref} e={e} />
      ))}
      </div>
    </div>
  );
}

export function ScriptureList({ items, ctx }: { items: PassageItem[]; ctx: ScriptureCtx }) {
  return (
    <div className="scripture">
      {items.map((item, i) =>
        isGroup(item) ? (
          <div key={i} className="together">
            <div className="together-head">Read together</div>
            <p className="together-note">{item.note}</p>
            {item.together.map((p, j) => (
              <PassageCard key={j} p={toPassage(p)} ctx={ctx} />
            ))}
          </div>
        ) : (
          <PassageCard key={i} p={toPassage(item)} ctx={ctx} />
        ),
      )}
    </div>
  );
}
