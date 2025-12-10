import { chromium } from 'playwright';
import { parseStringPromise } from 'xml2js';
import { isLikelyHtmlPage, isSameHost, normalizeUrl } from '../utils/url.js';
import { STEALTH_CONTEXT_OPTIONS } from '../utils/constants.js';

async function fetchXml(url: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(STEALTH_CONTEXT_OPTIONS);
    const page = await context.newPage();

    // Hide webdriver property to avoid bot detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Intercept the response to get raw content before browser processes it
    let rawXml: string | null = null;
    page.on('response', async (response) => {
      const responseUrl = response.url();
      // Match the URL with or without trailing slash, and handle redirects
      if (responseUrl === url || responseUrl === url.replace(/\/$/, '') || responseUrl === url + '/') {
        try {
          const contentType = response.headers()['content-type'] || '';
          // Only capture if it looks like XML
          if (contentType.includes('xml') || contentType.includes('text/plain')) {
            rawXml = await response.text();
          }
        } catch {
          // Response body may not be available
        }
      }
    });

    // Use 'commit' instead of 'networkidle' - much faster, waits only for initial response
    const response = await page.goto(url, { waitUntil: 'commit', timeout: 30000 });

    if (!response) {
      throw new Error(`No response from ${url}`);
    }

    const status = response.status();
    if (status < 200 || status >= 300) {
      throw new Error(`Failed to fetch sitemap ${url}: ${status}`);
    }

    // Wait a moment for the response handler to capture the content
    await page.waitForTimeout(500);

    // Try to get content directly from the response if not captured by handler
    if (!rawXml) {
      try {
        rawXml = await response.text();
      } catch {
        // Response body may have been consumed
      }
    }

    // Use intercepted raw XML if available, otherwise try to extract from page
    let xmlContent: string | null = rawXml;

    if (!xmlContent) {
      // Fallback: try to get the XML from the page's pre tag (browsers often wrap XML in <pre>)
      xmlContent = await page.evaluate(() => {
        const pre = document.querySelector('pre');
        if (pre) return pre.textContent || '';
        // Or get the entire document's text content
        return document.documentElement.textContent || '';
      });
    }

    if (!xmlContent) {
      throw new Error(`Could not extract content from ${url}`);
    }

    // Check if it looks like XML
    const looksXml = /<\s*(\?xml|urlset|sitemapindex)[\s>]/i.test(xmlContent);
    if (!looksXml) {
      throw new Error(`Sitemap at ${url} does not look like XML`);
    }

    await context.close();
    return xmlContent;
  } finally {
    await browser.close();
  }
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
          if (isSameHost(base, normalized) && isLikelyHtmlPage(normalized)) {
            urls.add(normalized);
          }
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


