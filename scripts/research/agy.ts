import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AgyOptions {
  prompt: string;
  schema: object;
  model: string;
  /** Seconds before agy gives up on the turn. */
  timeout?: number;
  /** Research and critique need the web; reconcile and judge work only from the prompt. */
  tools?: boolean;
  label: string;
  log: (line: string) => void;
}

export interface AgyResult<T> {
  output: T;
  conversationId?: string;
  seconds?: number;
  tokens?: number;
}

/**
 * Runs one headless agy turn in a fresh, empty workspace (so blind roles cannot read the repo) as a new
 * project (so earlier conversations don't leak in), and returns its schema-validated structured output.
 */
export async function runAgy<T>(o: AgyOptions): Promise<AgyResult<T>> {
  const cwd = mkdtempSync(join(tmpdir(), `ousio-${o.label.replace(/[^\w.-]+/g, "_")}-`));
  const schemaFile = join(cwd, "schema.json");
  writeFileSync(schemaFile, JSON.stringify(o.schema));
  const args = [
    "-p",
    o.tools
      ? o.prompt
      : `${o.prompt}\n\nWork only from the material above. Do not browse, search, or run commands.`,
    "--output-format",
    "json",
    "--json-schema",
    schemaFile,
    "--model",
    o.model,
    "--print-timeout",
    `${o.timeout ?? 900}s`,
    "--new-project",
    "--sandbox",
    "--dangerously-skip-permissions",
  ];
  o.log(`[${o.label}] agy ${o.model}${o.tools ? " (web)" : ""}…`);
  const started = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("agy", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`agy exited ${code}: ${(err || out).slice(-800)}`)),
    );
  });
  const json = JSON.parse(stdout.slice(stdout.indexOf("{")));
  if (json.status !== "SUCCESS" || !json.structured_output)
    throw new Error(`[${o.label}] agy returned ${json.status ?? "no status"}: ${String(json.response ?? "").slice(0, 500)}`);
  o.log(`[${o.label}] done in ${Math.round((Date.now() - started) / 1000)} s`);
  return {
    output: json.structured_output as T,
    conversationId: json.conversation_id,
    seconds: json.duration_seconds,
    tokens: json.usage?.total_tokens,
  };
}
