import type { AtomicClaim } from "./claim";

/** Interior-critique evaluation of one claim, as returned by the model and then filtered by the app. */
export type Rating = "supported" | "partly_supported" | "not_supported" | "misattributed" | "unclear";
export type Stance = "confirms" | "qualifies" | "contradicts";

export interface Evidence {
  quote: string;
  source_title: string;
  url: string;
  /** Set by the app: the model actually retrieved this page (URL context or search grounding). */
  retrieved?: boolean;
}
export interface Finding extends Evidence {
  point: string;
  stance: Stance;
}
export interface Dimension {
  rating: Rating;
  confidence: "high" | "medium" | "low";
  summary: string;
  findings: Finding[];
}
export interface Evaluation {
  verdict: { rating: Rating; summary: string; evidence: Evidence[] };
  fidelity: Dimension;
  citation: Dimension;
  scripture: Dimension;
}
export interface ValidationResult {
  evaluation: Evaluation;
  /** Sources the model cited that fell outside the tradition's allowlist, and were removed. */
  removed: { url: string; title: string }[];
  /** Pages the model retrieved while researching. */
  retrieved: string[];
  model: string;
  at: string;
}

const RATINGS: Rating[] = ["supported", "partly_supported", "not_supported", "misattributed", "unclear"];

const evidenceSchema = {
  type: "object",
  properties: {
    quote: { type: "string", description: "Verbatim quotation from the retrieved source. Never paraphrase." },
    source_title: { type: "string", description: "Title of the document, with section or paragraph number (e.g. 'CCC 253')." },
    url: { type: "string", description: "URL of the page the quote was taken from." },
  },
  required: ["quote", "source_title", "url"],
};
const dimensionSchema = (what: string) => ({
  type: "object",
  description: what,
  properties: {
    rating: { type: "string", enum: RATINGS },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string", description: "Two to four sentences." },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string", description: "One specific observation." },
          stance: { type: "string", enum: ["confirms", "qualifies", "contradicts"] },
          ...evidenceSchema.properties,
        },
        required: ["point", "stance", "quote", "source_title", "url"],
      },
    },
  },
  required: ["rating", "confidence", "summary", "findings"],
});

export const EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "object",
      properties: {
        rating: { type: "string", enum: RATINGS },
        summary: { type: "string", description: "Two to four sentences stating the overall conclusion." },
        evidence: {
          type: "array",
          description: "The decisive direct quotations behind the verdict (at least one, ideally two to four).",
          items: evidenceSchema,
        },
      },
      required: ["rating", "summary", "evidence"],
    },
    fidelity: dimensionSchema("Does this tradition actually teach the claim, and at the stated level of authority?"),
    citation: dimensionSchema("Does each cited authority actually say what the claim attributes to it, in context?"),
    scripture: dimensionSchema(
      "Do the tradition's own authorities read the cited scripture this way, following the tradition's own rule of interpretation?",
    ),
  },
  required: ["verdict", "fidelity", "citation", "scripture"],
};

function claimBlock(c: AtomicClaim) {
  const auth = c.authorities
    .map((a) => `- ${a.source}${a.ref ? `, ${a.ref}` : ""} [${a.tier}]${a.url ? ` <${a.url}>` : ""}${a.quote ? `\n  Quoted as: "${a.quote}"` : ""}`)
    .join("\n");
  const scr = c.scripture
    .map((p) => `- ${p.ref} (${p.translation})${p.text ? `: "${p.text}"` : ""}${p.original ? `\n  Original: ${p.original}` : ""}`)
    .join("\n");
  return [
    `TRADITION: ${c.tradition.name}`,
    `CLAIM (as attributed to ${c.tradition.name}): ${c.statement}`,
    c.context && `CONTEXT: ${c.context}`,
    `CITED AUTHORITIES:\n${auth || "- (none)"}`,
    `CITED SCRIPTURE:\n${scr || "- (none cited)"}`,
    c.bibleRole === "parallel" && "NOTE: The Bible is not this tradition's scripture. Bible verses here are only parallels; evaluate scripture support against this tradition's own scripture.",
    `THIS TRADITION'S OWN RULE OF INTERPRETATION: ${c.hermeneutic}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Full instructions for the in-app (grounded, structured) evaluation. */
export function buildPrompt(c: AtomicClaim) {
  const sites = c.allowedDomains.map((d) => `site:${d}`).join(" OR ");
  return `You are auditing one claim in a comparative-religion knowledge base. This is an INTERIOR critique: judge the
claim only by ${c.tradition.name}'s own standards, authorities, and rule of interpretation. Do not judge whether the
doctrine is true, and do not use outside critics.

${claimBlock(c)}

TASKS
1. Fidelity: does ${c.tradition.name} actually teach this claim? Is the stated authority level right (e.g. dogma vs
   common teaching)? Note if the claim overstates, understates, or mixes in another tradition's vocabulary.
2. Citation check: open each cited authority URL and check that it says what the claim attributes to it, in context.
3. Scripture support: do this tradition's own authorities read the cited passages this way, following the rule of
   interpretation above? Note any tension with the passage's wording in the tradition's own translation or the original.

SOURCES
- Read the cited URLs first.
- When searching, restrict every query to the tradition's own sites: ${sites}
- Use only pages on these domains: ${c.allowedDomains.join(", ")}. Anything else will be discarded.

RULES
- Every quote must be copied verbatim from a page you actually retrieved, with that page's exact URL. Never
  paraphrase inside "quote". If you cannot find a supporting or contradicting passage, say so in the summary and
  lower the confidence. Do not invent sources.
- The verdict must include the decisive direct quotations with their sources.
- Ratings: supported | partly_supported | not_supported | misattributed (the teaching exists but not in the cited
  source, or belongs to another tradition) | unclear.
Return JSON matching the schema.`;
}

/** Compact prompt for Google AI Mode (URL length is limited, so authorities are listed without quotes). */
export function buildAiModePrompt(c: AtomicClaim) {
  const auth = c.authorities.map((a) => `${a.source}${a.ref ? ` ${a.ref}` : ""}`).join("; ");
  const scr = c.scripture.map((p) => p.ref).join("; ");
  const sites = c.allowedDomains.map((d) => `site:${d}`).join(" OR ");
  const text = `Interior critique of a ${c.tradition.name} claim, judged only by its own authorities and rule of interpretation (not whether it is true). Claim: ${c.statement} Cited: ${auth || "none"}. Scripture: ${scr || "none"}. Its rule of interpretation: ${c.hermeneutic} Check: (1) fidelity: does it teach this, at that authority level? (2) citation: do the cited sources say this? (3) scripture: do its authorities read these verses this way? Use only ${sites}. Give a verdict (supported / partly supported / not supported / misattributed / unclear) with direct verbatim quotes and links.`;
  return text.length > 1800 ? `${text.slice(0, 1797)}...` : text;
}

export const aiModeUrl = (c: AtomicClaim) =>
  `https://www.google.com/search?udm=50&hl=en&q=${encodeURIComponent(buildAiModePrompt(c))}`;

const host = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const norm = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u;
  }
};
const allowed = (u: string, domains: string[]) => {
  const h = host(u);
  return !!h && domains.some((d) => h === d || h.endsWith(`.${d}`));
};

/** Every URL string anywhere in the retrieval steps and citation annotations of the response. */
function retrievedUrls(resp: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, inRetrieval: boolean) => {
    if (Array.isArray(v)) return v.forEach((x) => visit(x, inRetrieval));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type : "";
    const retrieval = inRetrieval || /url_context_result|google_search_result|url_citation/.test(type);
    const failed = typeof o.status === "string" && /unsafe|error|fail/i.test(o.status);
    for (const [k, val] of Object.entries(o)) {
      if (retrieval && !failed && typeof val === "string" && /^https?:\/\//.test(val) && /url|uri/i.test(k)) out.add(val);
      else visit(val, retrieval);
    }
  };
  visit(resp, false);
  return [...out];
}

function outputText(resp: Record<string, unknown>): string {
  if (typeof resp.output_text === "string") return resp.output_text;
  const steps = (resp.steps ?? resp.outputs ?? []) as { type?: string; content?: { type?: string; text?: string }[]; text?: string }[];
  const texts = steps
    .filter((s) => s.type === "model_output" || s.type === "text")
    .flatMap((s) => (s.content ?? [s]).filter((b) => typeof b.text === "string").map((b) => b.text!));
  return texts.at(-1) ?? "";
}

export async function validateClaim(c: AtomicClaim, apiKey: string, model: string, signal?: AbortSignal): Promise<ValidationResult> {
  const citedUrls = c.authorities.flatMap((a) => (a.url ? [a.url] : [])).slice(0, 20);
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input: buildPrompt(c),
      tools: [{ type: "url_context" }, { type: "google_search" }],
      response_format: { type: "text", mime_type: "application/json", schema: EVALUATION_SCHEMA },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Errors come back as { error } or [{ error }].
    const err = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string } } | undefined;
    throw new Error(`Gemini API ${res.status}: ${err?.error?.message || res.statusText || "request failed"}`);
  }
  const raw = outputText(body as Record<string, unknown>);
  let evaluation: Evaluation;
  try {
    evaluation = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The model did not return a valid evaluation. Try again or switch model.");
  }
  // The claim's own cited URLs come from the project data, so they are always acceptable sources.
  const domains = [...c.allowedDomains];
  const retrieved = retrievedUrls(body);
  const seen = new Set(retrieved.map(norm));
  const removed: ValidationResult["removed"] = [];
  const keep = <T extends Evidence>(items: T[] = []) =>
    items
      .filter((e) => {
        const ok = allowed(e.url, domains) || citedUrls.some((u) => norm(u) === norm(e.url));
        if (!ok) removed.push({ url: e.url, title: e.source_title });
        return ok;
      })
      .map((e) => ({ ...e, retrieved: seen.has(norm(e.url)) }));
  evaluation.verdict.evidence = keep(evaluation.verdict.evidence);
  for (const d of ["fidelity", "citation", "scripture"] as const) evaluation[d].findings = keep(evaluation[d].findings);
  return { evaluation, removed, retrieved, model, at: new Date().toISOString() };
}
