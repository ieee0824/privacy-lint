/**
 * Fetches linked documents without credentials (DESIGN.md §42.6).
 * Cookies are never sent and the referrer is stripped; the URL has no query or fragment.
 */
import { parseHttpUrl } from "../privacy/url-sanitizer";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;

export async function fetchDocumentHtml(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.search || parsed.hash) return null;
  try {
    const res = await fetchImpl(parsed.href, {
      method: "GET",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      cache: "no-cache",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,text/plain;q=0.8" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
    return await readLimited(res);
  } catch {
    return null;
  }
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, all.length - offset);
    all.set(part, offset);
    offset += part.length;
    if (offset >= all.length) break;
  }
  return new TextDecoder(charsetOf(res.headers.get("content-type"), all)).decode(all);
}

/** Header charset first, then <meta charset> (common for Shift_JIS / EUC-JP sites). */
export function charsetOf(contentType: string | null, head: Uint8Array): string {
  const sniffed = new TextDecoder("latin1").decode(head.subarray(0, 4096));
  const match =
    /charset=["']?([\w-]+)/i.exec(contentType ?? "") ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniffed);
  const label = match?.[1]?.toLowerCase() ?? "utf-8";
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return "utf-8";
  }
}
