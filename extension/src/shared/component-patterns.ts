/**
 * Version detection from structural metadata only (DESIGN.md §44):
 * resource URLs, <meta name="generator">, and Server / X-Powered-By response headers.
 *
 * Output is limited to a fixed component ID and a numeric version. The URL or header
 * the value came from is never returned, stored, or sent.
 */
import type { ComponentId, ComponentObservation } from "./schema";

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

export function isVersion(v: string): boolean {
  return VERSION.test(v);
}

/** npm package / cdnjs library names → component. */
const PACKAGE_IDS: Record<string, ComponentId> = {
  jquery: "jquery",
  bootstrap: "bootstrap",
  "twitter-bootstrap": "bootstrap",
  angular: "angularjs",
  angularjs: "angularjs",
  "angular.js": "angularjs",
  vue: "vue",
};

interface UrlRule {
  id: ComponentId;
  pattern: RegExp;
}

// File-name conventions: jquery-1.8.3.min.js, jquery.1.8.3.js, bootstrap-3.3.7.min.css, angular-1.5.8.js
const FILE_RULES: UrlRule[] = [
  { id: "jquery", pattern: /\/jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.slim)?(?:\.min)?\.js$/i },
  { id: "bootstrap", pattern: /\/bootstrap[.-](\d+\.\d+(?:\.\d+)?)(?:\.bundle)?(?:\.min)?\.(?:js|css)$/i },
  { id: "angularjs", pattern: /\/angular[.-](1\.\d+(?:\.\d+)?)(?:\.min)?\.js$/i },
  { id: "vue", pattern: /\/vue[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js$/i },
];

// CDN conventions: /npm/pkg@1.2.3/, unpkg.com/pkg@1.2.3/, /ajax/libs/pkg/1.2.3/, /jquery/1.8.3/jquery.min.js
const CDN_PACKAGE = /(?:\/npm\/|unpkg\.com\/)((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+(?:\.\d+)?)/i;
const CDN_LIBS = /\/ajax\/libs\/([\w.-]+)\/(\d+\.\d+(?:\.\d+)?)\//i;
const CDN_DIR = /\/(jquery|bootstrap|angular(?:js)?|vue)\/(\d+\.\d+(?:\.\d+)?)\//i;

// WordPress core assets carry the core version in ?ver= (e.g. /wp-includes/js/wp-embed.min.js?ver=4.9.8).
const WP_CORE_ASSET = /\/wp-includes\/[^?#]*\?(?:[^#]*&)?ver=(\d+\.\d+(?:\.\d+)?)(?:[&#]|$)/i;

export function componentFromUrl(url: string): ComponentObservation | null {
  let path: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    path = u.hostname + u.pathname;
    const wp = WP_CORE_ASSET.exec(u.pathname + u.search);
    if (wp?.[1]) return { id: "wordpress", version: wp[1] };
  } catch {
    return null;
  }
  for (const pattern of [CDN_PACKAGE, CDN_LIBS, CDN_DIR]) {
    const m = pattern.exec(path);
    const id = m?.[1] ? PACKAGE_IDS[m[1].toLowerCase()] : undefined;
    if (id && m?.[2]) return { id, version: m[2] };
  }
  for (const rule of FILE_RULES) {
    const m = rule.pattern.exec(path);
    if (m?.[1]) return { id: rule.id, version: m[1] };
  }
  return null;
}

/** e.g. "WordPress 5.2.4", "Drupal 7 (https://www.drupal.org)". */
export function componentFromGenerator(content: string): ComponentObservation | null {
  const wp = /^WordPress\s+(\d+\.\d+(?:\.\d+)?)/i.exec(content.trim());
  if (wp?.[1]) return { id: "wordpress", version: wp[1] };
  const drupal = /^Drupal\s+(\d+(?:\.\d+){0,2})/i.exec(content.trim());
  if (drupal?.[1]) return { id: "drupal", version: drupal[1] };
  return null;
}

/** e.g. Server: "Apache/2.2.15 (CentOS)", "Microsoft-IIS/7.5"; X-Powered-By: "PHP/5.6.40". */
export function componentsFromHeaders(server: string | null, poweredBy: string | null): ComponentObservation[] {
  const out: ComponentObservation[] = [];
  const text = `${server ?? ""} ${poweredBy ?? ""}`;
  const apache = /\bApache\/(\d+\.\d+(?:\.\d+)?)/i.exec(text);
  if (apache?.[1]) out.push({ id: "apache", version: apache[1] });
  const iis = /\bMicrosoft-IIS\/(\d+(?:\.\d+)?)/i.exec(text);
  if (iis?.[1]) out.push({ id: "iis", version: iis[1] });
  const php = /\bPHP\/(\d+\.\d+(?:\.\d+)?)/i.exec(text);
  if (php?.[1]) out.push({ id: "php", version: php[1] });
  return out;
}

export function dedupeComponents(components: ComponentObservation[], limit: number): ComponentObservation[] {
  const seen = new Set<string>();
  const out: ComponentObservation[] = [];
  for (const c of components) {
    const key = `${c.id}@${c.version}`;
    if (seen.has(key) || !isVersion(c.version)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
