import { chromium, firefox, webkit, Browser, BrowserContext } from 'playwright';
import pLimit from 'p-limit';
import { isSameHost, isLikelyHtmlPage, normalizeUrl, toAbsoluteUrl } from '../utils/url.js';
import { parseRobots } from '../utils/robots.js';
import { STEALTH_CONTEXT_OPTIONS } from '../utils/constants.js';

type CrawlOptions = {
  baseUrl: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  headless: boolean;
  browser: 'chromium' | 'firefox' | 'webkit';
  timeoutMs: number;
  respectRobots: boolean;
};



const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function crawlSite(opts: CrawlOptions): Promise<string[]> {
  const startUrl = normalizeUrl(opts.baseUrl);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const limiter = pLimit(opts.concurrency);
  const robots = await parseRobots(startUrl);
  // eslint-disable-next-line no-console
  console.log(`Starting crawl at ${startUrl} (maxPages=${opts.maxPages}, maxDepth=${opts.maxDepth}, concurrency=${opts.concurrency})`);

  const browser = await launch(opts);
  try {
    while (queue.length && visited.size < opts.maxPages) {
      const batch = queue.splice(0, opts.concurrency);
      await Promise.all(batch.map(({ url, depth }) => limiter(() => crawlPage(browser, url, depth))));
      // Throttle between batches to reduce server load
      await sleep(1000);
      // eslint-disable-next-line no-console
      console.log(`Visited: ${visited.size} | Queue: ${queue.length}`);
    }
  } finally {
    await browser.close();
  }
  return Array.from(visited);

  async function crawlPage(browser: Browser, url: string, depth: number) {
    if (visited.has(url)) return;
    if (!isLikelyHtmlPage(url)) return;
    if (opts.respectRobots && !robots.allows(url)) return;
    if (visited.size >= opts.maxPages) return;
    visited.add(url);
    if (depth >= opts.maxDepth) return;

    const context = await browser.newContext(STEALTH_CONTEXT_OPTIONS);
    const page = await context.newPage();
    try {
      // Hide webdriver property to avoid bot detection
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      await page.goto(url, { timeout: opts.timeoutMs, waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-console
      console.log(`Crawled: ${url}`);
      const anchors = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''));
      const candidates = anchors
        .map((href) => toAbsoluteUrl(url, href))
        .filter((u): u is string => !!u)
        .map((u) => normalizeUrl(u))
        .filter((u) => isSameHost(url, u))
        .filter((u) => isLikelyHtmlPage(u));
      // eslint-disable-next-line no-console
      console.log(`Found ${candidates.length} link(s) on ${url}`);
      for (const next of candidates) {
        if (!visited.has(next)) queue.push({ url: next, depth: depth + 1 });
      }
    } catch {
      // ignore page-level errors
    } finally {
      await context.close();
    }
  }
}

async function launch(opts: CrawlOptions): Promise<Browser> {
  const common = { headless: opts.headless, timeout: opts.timeoutMs } as const;
  if (opts.browser === 'firefox') return await firefox.launch(common);
  if (opts.browser === 'webkit') return await webkit.launch(common);
  return await chromium.launch(common);
}


