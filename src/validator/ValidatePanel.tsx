import { useEffect, useState } from "react";
import type { OriginalEntry, RegistryTopic, ScriptureStore, Tradition } from "../schema";
import { buildClaim, claimKey, type AtomicClaim, type ClaimTarget } from "./claim";
import { aiModeUrl, type Dimension, type Evidence, type Finding, type Rating, type ValidationResult } from "./gemini";
import { MODELS, useValidator } from "./state";

const RATING_LABEL: Record<Rating, string> = {
  supported: "Supported",
  partly_supported: "Partly supported",
  not_supported: "Not supported",
  misattributed: "Misattributed",
  unclear: "Unclear",
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

const DIMENSIONS = [
  ["fidelity", "Fidelity", "Does the tradition teach this, at this authority level?"],
  ["citation", "Citation check", "Do the cited sources say this, in context?"],
  ["scripture", "Scripture support", "Read by the tradition's own rule of interpretation"],
] as const;

interface Props {
  t: Tradition;
  target: ClaimTarget;
  stores: Record<string, ScriptureStore>;
  original: Map<string, OriginalEntry>;
  topics?: RegistryTopic[];
  compact?: boolean;
}

/** "Validate this claim" button plus its inline result card. */
export function ValidateClaim({ t, target, stores, original, topics, compact }: Props) {
  const v = useValidator();
  const key = claimKey(t.meta.tradition.id, target);
  const state = v.runs[key];
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state) setOpen(true);
  }, [state]);
  const claim = open || state ? buildClaim(t, target, stores, original, topics) : undefined;

  const start = () => {
    setOpen(true);
    const c = buildClaim(t, target, stores, original, topics);
    if (c && v.apiKey) v.run(c);
  };

  return (
    <div className={`validate ${compact ? "compact" : ""}`}>
      {!open && (
        <button className="validate-btn" onClick={start} title="Check this claim against the tradition's own sources">
          <span aria-hidden>✦</span> Validate this claim
        </button>
      )}
      {open && claim && <ValidationCard claim={claim} onClose={() => setOpen(false)} onRun={() => v.run(claim)} />}
    </div>
  );
}

function ValidationCard({ claim, onClose, onRun }: { claim: AtomicClaim; onClose: () => void; onRun: () => void }) {
  const v = useValidator();
  const state = v.runs[claim.key];
  const [settings, setSettings] = useState(!v.apiKey);
  return (
    <div className="vcard">
      <div className="vcard-head">
        <strong>Claim check</strong>
        <span className="muted small">Interior critique · {claim.tradition.name} sources only</span>
        <button className="vcard-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <p className="vclaim">
        <span className="vclaim-trad">{claim.tradition.name}</span> {claim.statement}
      </p>

      {settings || !v.apiKey ? (
        <KeySettings onDone={() => setSettings(false)} claim={claim} />
      ) : !state ? (
        <div className="vactions">
          <button className="vrun" onClick={onRun}>
            Run check with {v.model}
          </button>
          <AiModeLink claim={claim} />
          <button className="link small" onClick={() => setSettings(true)}>
            key &amp; model
          </button>
        </div>
      ) : state.status === "running" ? (
        <Running startedAt={state.startedAt} onCancel={() => v.cancel(claim.key)} domains={claim.allowedDomains} />
      ) : state.status === "error" ? (
        <div className="verror">
          <p>{state.error}</p>
          <div className="vactions">
            <button className="vrun" onClick={onRun}>
              Try again
            </button>
            <AiModeLink claim={claim} />
            <button className="link small" onClick={() => setSettings(true)}>
              key &amp; model
            </button>
          </div>
        </div>
      ) : (
        <Result result={state.result} claim={claim} onRun={onRun} />
      )}
    </div>
  );
}

function AiModeLink({ claim }: { claim: AtomicClaim }) {
  return (
    <a className="vaimode" href={aiModeUrl(claim)} target="_blank" rel="noreferrer" title="Opens Google AI Mode in a new tab with this claim's research prompt">
      Research in Google AI Mode ↗
    </a>
  );
}

function KeySettings({ onDone, claim }: { onDone: () => void; claim: AtomicClaim }) {
  const v = useValidator();
  const [key, setKey] = useState(v.apiKey);
  const [model, setModel] = useState(v.model);
  return (
    <div className="vsettings">
      <p className="small muted">
        Use your own Gemini API key (from Google AI Studio). It is stored only in this browser and sent only to Google.
        Without a key, you can still research the claim in Google AI Mode.
      </p>
      <label>
        Gemini API key
        <input type="password" value={key} placeholder="AIza…" autoComplete="off" onChange={(e) => setKey(e.target.value)} />
      </label>
      <label>
        Model
        <input list="gemini-models" value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id="gemini-models">
          {MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="vactions">
        <button
          className="vrun"
          disabled={!model.trim()}
          onClick={() => {
            v.setSettings(key, model.trim());
            if (key.trim()) onDone();
          }}
        >
          {key.trim() ? "Save" : "Save (no key)"}
        </button>
        {v.apiKey && (
          <button className="link small" onClick={() => (v.setSettings("", model.trim()), setKey(""))}>
            forget key
          </button>
        )}
        <AiModeLink claim={claim} />
      </div>
    </div>
  );
}

function Running({ startedAt, onCancel, domains }: { startedAt: number; onCancel: () => void; domains: string[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="vrunning">
      <span className="vspinner" aria-hidden />
      <div>
        <div>Reading the cited sources and searching {domains.join(", ")}…</div>
        <div className="muted small">{Math.round((now - startedAt) / 1000)} s · usually 10–60 s</div>
      </div>
      <button className="link small" onClick={onCancel}>
        cancel
      </button>
    </div>
  );
}

function Quote({ e }: { e: Evidence }) {
  return (
    <figure className="vquote">
      <blockquote>“{e.quote}”</blockquote>
      <figcaption>
        <a href={e.url} target="_blank" rel="noreferrer">
          {e.source_title || e.url}
        </a>{" "}
        {e.retrieved ? (
          <span className="vok" title="The model retrieved this page while researching">
            ✓ retrieved
          </span>
        ) : (
          <span className="vwarn" title="The model did not report retrieving this page. Open the link to confirm the quote.">
            ⚠ not confirmed retrieved
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function DimensionView({ label, hint, d }: { label: string; hint: string; d: Dimension }) {
  return (
    <details className="vdim" open={d.rating !== "supported"}>
      <summary>
        <span className={`vrating r-${d.rating}`}>{RATING_LABEL[d.rating]}</span> <strong>{label}</strong>{" "}
        <span className="muted small">
          {hint} · {d.confidence} confidence
        </span>
      </summary>
      <p>{d.summary}</p>
      {d.findings.map((f: Finding, i) => (
        <div key={i} className={`vfinding s-${f.stance}`}>
          <div>
            <span className="vstance">{f.stance}</span> {f.point}
          </div>
          <Quote e={f} />
        </div>
      ))}
      {!d.findings.length && <p className="muted small">No quotable passage was found for this dimension.</p>}
    </details>
  );
}

function Result({ result, claim, onRun }: { result: ValidationResult; claim: AtomicClaim; onRun: () => void }) {
  const { evaluation: ev } = result;
  return (
    <div className="vresult">
      <div className={`vverdict r-${ev.verdict.rating}`}>
        <div className="vverdict-head">
          <span className={`vrating r-${ev.verdict.rating}`}>{RATING_LABEL[ev.verdict.rating]}</span>
          <strong>Verdict</strong>
        </div>
        <p>{ev.verdict.summary}</p>
        {ev.verdict.evidence.map((e, i) => (
          <Quote key={i} e={e} />
        ))}
        {!ev.verdict.evidence.length && (
          <p className="vwarn small">No direct quotation from an allowed source backs this verdict. Treat it as unverified.</p>
        )}
      </div>
      {DIMENSIONS.map(([k, label, hint]) => (
        <DimensionView key={k} label={label} hint={hint} d={ev[k]} />
      ))}
      {result.removed.length > 0 && (
        <p className="vwarn small">
          {result.removed.length} source{result.removed.length > 1 ? "s" : ""} outside {claim.tradition.name}'s allowed sites
          {result.removed.length > 1 ? " were" : " was"} removed ({[...new Set(result.removed.map((r) => hostOf(r.url)))].join(", ")}).
          The model's reasoning may still reflect them.
        </p>
      )}
      <div className="vfoot">
        <span className="muted small">
          AI-generated by {result.model}, {new Date(result.at).toLocaleTimeString()}. Open the links to confirm each quote.
        </span>
        <div className="vactions">
          <button className="link small" onClick={onRun}>
            re-run
          </button>
          <AiModeLink claim={claim} />
        </div>
      </div>
    </div>
  );
}
