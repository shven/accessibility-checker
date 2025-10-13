import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { isSameHost, normalizeUrl } from '../utils/url.js';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;
  const asNumber = Number(retryAfter);
  if (!Number.isNaN(asNumber)) return Math.max(0, Math.floor(asNumber * 1000));
  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

async function fetchXml(url: string) {
  const maxAttempts = 4;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 20000,
        headers: {
          // Some sites rate-limit generic clients; a real UA + XML Accept helps
          'User-Agent': 'accessibility-checker/1.0 (+https://github.com) axios',
          'Accept': 'application/xml, text/xml; q=0.9, application/xhtml+xml; q=0.8, */*; q=0.7',
          'Accept-Encoding': 'gzip, compress, deflate, br',
        },
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) {
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        const body = String(res.data ?? '');
        // Guard against HTML error pages returned with 2xx
        const looksXml = /<\s*(\?xml|urlset|sitemapindex)[\s>]/i.test(body);
        const isXmlType = contentType.includes('xml') || contentType.includes('text/plain');
        if (!looksXml && !isXmlType) {
          throw new Error(`Sitemap at ${url} does not look like XML (content-type=${contentType || 'unknown'})`);
        }
        return body;
      }

      // Handle 429/503 with Retry-After if present
      if (res.status === 429 || res.status === 503) {
        const retryAfterMs = parseRetryAfterMs(String(res.headers['retry-after'] || ''));
        const backoffMs = retryAfterMs ?? Math.min(30000, 1000 * Math.pow(2, attempt));
        // eslint-disable-next-line no-console
        console.warn(`Sitemap request ${url} returned ${res.status}. Retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts}).`);
        await sleep(backoffMs);
        continue;
      }

      // 30x redirects should be auto-followed by axios; if not 2xx and not retryable, throw
      throw new Error(`Failed to fetch sitemap ${url}: ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
      // Network or parsing error; backoff and retry
      if (attempt < maxAttempts) {
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, attempt));
        // eslint-disable-next-line no-console
        console.warn(`Error fetching ${url}: ${String((err as Error).message)}. Retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts}).`);
        await sleep(backoffMs);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unknown sitemap fetch error');
}

export async function parseSitemapUrls(sitemapUrl: string, base: string): Promise<string[]> {
  // eslint-disable-next-line no-console
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  let xml: string;
  try {
    xml = await fetchXml(sitemapUrl);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Skipping sitemap ${sitemapUrl}: ${(err as Error).message}`);
    return [];
  }
  let parsed: any;
  try {
    parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Invalid XML at ${sitemapUrl}, skipping: ${(err as Error).message}`);
    return [];
  }
  const urls = new Set<string>();

  const baseUrl = new URL(base);
  const baseIsLocal = baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';

  function rewriteToBaseOriginIfLocal(absoluteUrl: string): string {
    if (!baseIsLocal) return absoluteUrl;
    try {
      const u = new URL(absoluteUrl);
      // Force sitemap URLs to target the same origin as the provided base
      u.protocol = baseUrl.protocol;
      u.host = baseUrl.host; // includes hostname + port
      return u.toString();
    } catch {
      return absoluteUrl;
    }
  }

  if (parsed.urlset && parsed.urlset.url) {
    const items = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
    for (const item of items) {
      const loc = item.loc || item["loc"];
      if (loc) {
        let absolute: string | null = null;
        try {
          // Resolve relative <loc> against base
          absolute = new URL(loc, base).toString();
        } catch {
          // Skip invalid URLs
          absolute = null;
        }
        if (absolute) {
          const rewritten = rewriteToBaseOriginIfLocal(absolute);
          const normalized = normalizeUrl(rewritten);
          if (isSameHost(base, normalized)) urls.add(normalized);
        }
      }
    }
  }

  if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
    const items = Array.isArray(parsed.sitemapindex.sitemap) ? parsed.sitemapindex.sitemap : [parsed.sitemapindex.sitemap];
    for (const sm of items) {
      const loc = sm.loc || sm["loc"];
      if (loc) {
        let sitemapUrlAbs: string | null = null;
        try {
          sitemapUrlAbs = new URL(loc, base).toString();
        } catch {
          sitemapUrlAbs = null;
        }
        const nested = sitemapUrlAbs ? await parseSitemapUrls(rewriteToBaseOriginIfLocal(sitemapUrlAbs), base) : [];
        for (const u of nested) urls.add(u);
      }
    }
  }

  const list = Array.from(urls);
  // eslint-disable-next-line no-console
  console.log(`Parsed ${list.length} URL(s) from sitemap: ${sitemapUrl}`);
  return list;
}


