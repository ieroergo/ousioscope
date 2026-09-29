import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AtomicClaim } from "./claim";
import { validateClaim, type ValidationResult } from "./gemini";

export const MODELS = ["gemini-3.8-flash", "gemini-3.1-pro-preview"];
const KEY = "ousioscope.gemini.key";
const MODEL = "ousioscope.gemini.model";

export type RunState =
  | { status: "running"; startedAt: number }
  | { status: "done"; result: ValidationResult }
  | { status: "error"; error: string };

interface Validator {
  apiKey: string;
  model: string;
  setSettings: (apiKey: string, model: string) => void;
  runs: Record<string, RunState>;
  run: (claim: AtomicClaim) => void;
  cancel: (key: string) => void;
}

const Ctx = createContext<Validator | null>(null);

/**
 * Session-only validator state. The API key lives in this browser's localStorage and is sent only to Google.
 * Results are kept in memory for the session and are never saved.
 */
export function ValidatorProvider({ children }: { children: ReactNode }) {
  const [apiKey, setKey] = useState(() => localStorage.getItem(KEY) ?? "");
  const [model, setModel] = useState(() => localStorage.getItem(MODEL) ?? MODELS[0]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const controllers = useRef(new Map<string, AbortController>());

  const setSettings = useCallback((k: string, m: string) => {
    const key = k.trim();
    key ? localStorage.setItem(KEY, key) : localStorage.removeItem(KEY);
    localStorage.setItem(MODEL, m);
    setKey(key);
    setModel(m);
  }, []);

  const run = useCallback(
    (claim: AtomicClaim) => {
      if (!apiKey) return;
      controllers.current.get(claim.key)?.abort();
      const ac = new AbortController();
      controllers.current.set(claim.key, ac);
      const timeout = setTimeout(() => ac.abort("timeout"), 180_000);
      setRuns((r) => ({ ...r, [claim.key]: { status: "running", startedAt: Date.now() } }));
      validateClaim(claim, apiKey, model, ac.signal)
        .then((result) => setRuns((r) => ({ ...r, [claim.key]: { status: "done", result } })))
        .catch((e: unknown) => {
          const aborted = ac.signal.aborted;
          const error = aborted ? (ac.signal.reason === "timeout" ? "Timed out after 3 minutes." : "Cancelled.") : String((e as Error)?.message ?? e);
          setRuns((r) => ({ ...r, [claim.key]: { status: "error", error } }));
        })
        .finally(() => {
          clearTimeout(timeout);
          if (controllers.current.get(claim.key) === ac) controllers.current.delete(claim.key);
        });
    },
    [apiKey, model],
  );

  const cancel = useCallback((key: string) => controllers.current.get(key)?.abort(), []);

  const value = useMemo(() => ({ apiKey, model, setSettings, runs, run, cancel }), [apiKey, model, setSettings, runs, run, cancel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useValidator() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useValidator must be used inside ValidatorProvider");
  return v;
}
