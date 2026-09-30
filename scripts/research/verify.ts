import puppeteer, { type Browser } from "puppeteer-core";
import type { Source } from "./schemas";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

export type QuoteStatus = "verified" | "not_found" | "unreachable" | "off_allowlist";
export interface QuoteCheck {
  url: string;
  quote: string;
  status: QuoteStatus;
  detail?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: "—", ndash: "–", hellip: "…" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e.toLowerCase()] ?? m),
  );
const htmlText = (html: string) =>
  decode(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));

/** Case, accent, quote-style, dash, and whitespace insensitive form used for matching. */
export const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u200b-\u200d\u00ad]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ`´′]/g, "'")
    .replace(/[“”«»″]/g, '"')
    .replace(/[‐‑–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** A quote matches if every fragment between ellipses occurs in the page text, in order. */
export function quoteInText(quote: string, text: string): boolean {
  const hay = normalize(text);
  const fragments = quote.split(/\s*(?:\[\.\.\.\]|\.\.\.|…)\s*/).map((f) => normalize(f).replace(/^["']|["']$/g, "").trim()).filter(Boolean);
  if (!fragments.length) return false;
  let at = 0;
  for (const frag of fragments) {
    const i = hay.indexOf(frag, at);
    if (i < 0) return false;
    at = i + frag.length;
  }
  return true;
}

export const allowedHost = (url: string, domains: string[]) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return domains.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

/**
 * Fetches pages and checks quotes against their text. Static fetch first; pages that are JavaScript-rendered or
 * behind a browser check fall back to headless Chrome. Page text is cached per URL.
 */
export class Verifier {
  private pages = new Map<string, Promise<{ text: string; rendered: boolean } | { error: string }>>();
  private browser?: Promise<Browser>;

  private async staticText(url: string) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return htmlText(await res.text());
  }

  /** Rendered pages are fetched one at a time; some sites (e.g. chabad.org) block rapid headless requests. */
  private renderQueue: Promise<unknown> = Promise.resolve();

  private async renderedText(url: string): Promise<string> {
    const run = this.renderQueue.then(() => this.renderOnce(url));
    this.renderQueue = run.catch(() => undefined);
    return run;
  }

  private async renderOnce(url: string): Promise<string> {
    // One profile per process, so parallel research runs don't lock each other's Chrome profile.
    this.browser ??= puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `/tmp/ousio-research-profile-${process.pid}` });
    let text = "";
    // A near-empty page is usually a bot check or rate limit: back off and retry before giving up.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 8000 * attempt));
      const page = await (await this.browser).newPage();
      try {
        await page.setUserAgent(UA);
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
        if (!response?.ok()) throw new Error(response ? `HTTP ${response.status()}` : "No HTTP response");
        await new Promise((r) => setTimeout(r, 1500));
        text = await page.evaluate(() => document.body.innerText);
      } finally {
        await page.close();
      }
      if (text.length > 1000) break;
    }
    return text;
  }

  private page(url: string, rendered: boolean) {
    const key = `${rendered ? "r" : "s"}|${url}`;
    if (!this.pages.has(key))
      this.pages.set(
        key,
        (rendered ? this.renderedText(url) : this.staticText(url)).then(
          (text) => ({ text, rendered }),
          (e: Error) => ({ error: e.message }),
        ),
      );
    return this.pages.get(key)!;
  }

  async check(s: Pick<Source, "url" | "quote">, domains: string[]): Promise<QuoteCheck> {
    const base = { url: s.url, quote: s.quote };
    if (!allowedHost(s.url, domains)) return { ...base, status: "off_allowlist" };
    let fetched = false;
    let lastError = "";
    for (const rendered of [false, true]) {
      const p = await this.page(s.url, rendered);
      if ("error" in p) {
        lastError = p.error;
        continue;
      }
      fetched = true;
      if (quoteInText(s.quote, p.text)) return { ...base, status: "verified", detail: rendered ? "rendered" : "static" };
    }
    return fetched ? { ...base, status: "not_found" } : { ...base, status: "unreachable", detail: lastError };
  }

  async close() {
    if (this.browser) (await this.browser).process()?.kill("SIGKILL");
  }
}
