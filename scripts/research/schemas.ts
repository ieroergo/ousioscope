/** JSON schemas enforced on each agent role's output (via `agy --json-schema`). */

const str = { type: "string" };
const source = {
  type: "object",
  properties: {
    title: { type: "string", description: "Document title, with section/paragraph number (e.g. 'CCC 495')." },
    ref: str,
    url: { type: "string", description: "Exact URL of the page the quote was copied from." },
    quote: { type: "string", description: "Verbatim text copied from that page. Use '...' for omissions. Never paraphrase." },
  },
  required: ["title", "url", "quote"],
};
const sources = { type: "array", items: source };
const STANCES = ["affirms", "rejects", "condemns", "reframes", "none"];

export interface Source {
  title: string;
  ref?: string;
  url: string;
  quote: string;
}

export interface Finding {
  id: string;
  statement: string;
  kind: string;
  authority: string;
  sources: Source[];
  scripture: { ref: string; use: string }[];
  confidence: "high" | "medium" | "low";
}
export interface ResearchOutput {
  summary: string;
  findings: Finding[];
  stance?: { position: string; summary: string; finding_ids: string[] };
  gaps: string[];
}
export const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    summary: str,
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "F1, F2, ..." },
          statement: { type: "string", description: "One atomic teaching, in the tradition's own vocabulary." },
          kind: {
            type: "string",
            description: "What the teaching is about: identity/nature, relation between two beings, attribute, class-level rule, term definition, or stance.",
          },
          authority: { type: "string", description: "Which of the tradition's authority tiers the best source belongs to." },
          sources,
          scripture: {
            type: "array",
            items: {
              type: "object",
              properties: { ref: { type: "string", description: "e.g. 'Luke 1:43' or 'Quran 19:20'" }, use: str },
              required: ["ref", "use"],
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["id", "statement", "kind", "authority", "sources", "scripture", "confidence"],
      },
    },
    stance: {
      type: "object",
      description: "Only for debate propositions: the tradition's own position.",
      properties: { position: { type: "string", enum: STANCES }, summary: str, finding_ids: { type: "array", items: str } },
      required: ["position", "summary", "finding_ids"],
    },
    gaps: { type: "array", items: str, description: "What you looked for but could not source." },
  },
  required: ["summary", "findings", "gaps"],
};

export interface ReconcileOutput {
  items: {
    finding_id: string;
    status: "already_modeled" | "new" | "refines" | "conflicts" | "out_of_scope";
    existing_ids: string[];
    proposal: string;
  }[];
  metamodel_needs: { kind: "category" | "relationship"; id: string; label: string; definition: string; why: string }[];
}
export const RECONCILE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_id: str,
          status: { type: "string", enum: ["already_modeled", "new", "refines", "conflicts", "out_of_scope"] },
          existing_ids: { type: "array", items: str, description: "Ids of existing nodes, edges, attributes (node#Name), stances, categories." },
          proposal: { type: "string", description: "The concrete model change, in the model's own terms (ids, categories, relationship types)." },
        },
        required: ["finding_id", "status", "existing_ids", "proposal"],
      },
    },
    metamodel_needs: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["category", "relationship"] }, id: str, label: str, definition: str, why: str },
        required: ["kind", "id", "label", "definition", "why"],
      },
    },
  },
  required: ["items", "metamodel_needs"],
};

export interface CriticOutput {
  reviews: {
    finding_id: string;
    verdict: "sound" | "needs_qualification" | "unsupported" | "misattributed";
    interior: string;
    dissent: { position: string; held_by: string; sources: Source[] }[];
    objections: { severity: "blocking" | "major" | "minor"; point: string; sources: Source[] }[];
  }[];
  missed: { statement: string; sources: Source[] }[];
}
export const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_id: str,
          verdict: { type: "string", enum: ["sound", "needs_qualification", "unsupported", "misattributed"] },
          interior: { type: "string", description: "Fidelity, citation, and scripture-use assessment by the tradition's own standards." },
          dissent: {
            type: "array",
            items: {
              type: "object",
              properties: { position: str, held_by: { type: "string", description: "School, era, or authority within the tradition." }, sources },
              required: ["position", "held_by", "sources"],
            },
          },
          objections: {
            type: "array",
            items: {
              type: "object",
              properties: { severity: { type: "string", enum: ["blocking", "major", "minor"] }, point: str, sources },
              required: ["severity", "point", "sources"],
            },
          },
        },
        required: ["finding_id", "verdict", "interior", "dissent", "objections"],
      },
    },
    missed: {
      type: "array",
      items: { type: "object", properties: { statement: str, sources }, required: ["statement", "sources"] },
    },
  },
  required: ["reviews", "missed"],
};

export const OPS = [
  "add_referent",
  "add_node",
  "replace_node",
  "add_attribute",
  "replace_attribute",
  "replace_category",
  "add_edge",
  "replace_edge",
  "add_category",
  "add_relationship",
  "add_axiom",
  "add_outline_topic",
  "set_stance",
  "add_registry_topic",
] as const;
export type OpName = (typeof OPS)[number];

export interface JudgeOutput {
  decisions: { finding_id: string; decision: "accept" | "accept_modified" | "reject"; reason: string }[];
  ops: { op: OpName; target?: string; yaml: string; finding_ids: string[] }[];
  pr_summary: string;
  dissent_notes: string[];
}
export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: { finding_id: str, decision: { type: "string", enum: ["accept", "accept_modified", "reject"] }, reason: str },
        required: ["finding_id", "decision", "reason"],
      },
    },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...OPS] },
          target: { type: "string", description: "add_attribute/replace_attribute: the node id (replacement matches the existing attribute name). set_stance: the debate id. Otherwise omit." },
          yaml: { type: "string", description: "One element in the project's YAML format (see FORMAT GUIDE), as a mapping (no leading '- ')." },
          finding_ids: { type: "array", items: str },
        },
        required: ["op", "yaml", "finding_ids"],
      },
    },
    pr_summary: { type: "string", description: "Markdown: what changed and why, for the reviewer." },
    dissent_notes: { type: "array", items: str, description: "Unresolved critic objections and internal dissent, for the PR body." },
  },
  required: ["decisions", "ops", "pr_summary", "dissent_notes"],
};
