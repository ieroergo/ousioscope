export function nwtBody(html: string): string {
  const start = html.search(/<span id="v\d+-\d+-\d+-\d+"/);
  if (start < 0) throw new Error("NWT: no verse markers");
  const body = html.slice(start);
  const end = body.search(/<div\s+class="groupFootnote\b|<\/article>/);
  if (end < 0) throw new Error("NWT: no scripture boundary");
  return body.slice(0, end);
}

export const hasPublisherChrome = (text: string) => /English Publications \(\d{4}[-–]\d{4}\)|Terms of Use Privacy Policy/.test(text);
