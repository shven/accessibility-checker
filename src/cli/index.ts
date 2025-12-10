#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../config.js';
import { discoverSitemaps } from '../sitemap/discover.js';
import { parseSitemapUrls } from '../sitemap/fetchSitemap.js';
import { crawlSite } from '../crawler/crawl.js';
import { writeJson, readJson } from '../utils/io.js';
import { normalizeUrl } from '../utils/url.js';
import { runAxeForUrls } from '../scan/axeRunner.js';
import { writeDeveloperReport } from '../reporters/developerReporter.js';
import { writeHtmlReport } from '../reporters/htmlReporter.js';
import http from 'http';
import path from 'path';
import { promises as fsp } from 'fs';
import { exec } from 'child_process';

type CliArgs = {
  base?: string;
  sitemap?: string;
  input?: string;
  concurrency?: number;
  maxPages?: number;
  maxDepth?: number;
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  respectRobots?: boolean;
  timeoutMs?: number;
  maxIssues?: number; // 0 for full scan
  serve?: boolean;
  port?: number;
  open?: boolean;
  agency?: AgencyInfo;
};

async function discover(base: string, args: CliArgs) {
  // eslint-disable-next-line no-console
  console.log('Discovering sitemaps...');
  const sitemaps = await discoverSitemaps(base, args.sitemap);
  // eslint-disable-next-line no-console
  console.log(`Sitemaps: ${sitemaps.join(', ') || '(none found)'}`);
  const sitemapUrls = new Set<string>();
  for (const sm of sitemaps) {
    const urls = await parseSitemapUrls(sm, base);
    urls.forEach((u) => sitemapUrls.add(normalizeUrl(u)));
  }

  // eslint-disable-next-line no-console
  console.log('Crawling site for additional internal links...');
  const crawled = await crawlSite({
    baseUrl: base,
    maxPages: args.maxPages ?? defaultConfig.maxPages,
    maxDepth: args.maxDepth ?? defaultConfig.maxDepth,
    concurrency: args.concurrency ?? defaultConfig.concurrency,
    headless: args.headless ?? defaultConfig.headless,
    browser: (args.browser ?? defaultConfig.browser) as any,
    timeoutMs: args.timeoutMs ?? defaultConfig.timeoutMs,
    respectRobots: args.respectRobots ?? defaultConfig.respectRobots,
  });

  const combined = Array.from(new Set<string>([...sitemapUrls, ...crawled]));
  const urlsPath = await getUrlsPathForBase(base);
  await writeJson(urlsPath, combined);
  // eslint-disable-next-line no-console
  console.log(`Discovered ${combined.length} URL(s). Written to ${path.relative(process.cwd(), urlsPath)}`);
}

async function scan(input: string, args: CliArgs) {
  const urls = await readJson<string[]>(input);
  // Determine base from args or persisted last, then use its hostname for per-domain settings
  const effectiveBase = args.base ?? (await getLastBase());
  const hostnameForState = effectiveBase ? new URL(effectiveBase).hostname : undefined;
  const maxIssues = await ensureMaxIssues(args.maxIssues, hostnameForState);
  const agency = await ensureAgency();
  // Determine reports directory from base hostname ahead of the scan to store assets like screenshots
  const baseForHostnamePre = effectiveBase ?? 'https://example.com';
  const hostnamePre = new URL(baseForHostnamePre).hostname;
  const reportsDirPre = path.join('reports', hostnamePre);
  const screenshotsDir = path.join(reportsDirPre, 'screenshots');

  const results = await runAxeForUrls({
    urls,
    headless: args.headless ?? defaultConfig.headless,
    browser: (args.browser ?? defaultConfig.browser) as any,
    timeoutMs: args.timeoutMs ?? defaultConfig.timeoutMs,
    maxIssues,
    screenshotsDir,
  } as any);
  // eslint-disable-next-line no-console
  console.log('Writing reports...');
  // Determine reports directory from base hostname
  const baseForHostname = effectiveBase ?? 'https://example.com';
  const hostname = new URL(baseForHostname).hostname;
  const reportsDir = path.join('reports', hostname);
  const jsonPath = path.join(reportsDir, 'report.json');
  const htmlPath = path.join(reportsDir, 'index.html');
  const htmlNoImgPath = path.join(reportsDir, 'report.html');
  await writeDeveloperReport(results, jsonPath);
  await writeHtmlReport(results, htmlPath, { includeImages: true, agency });
  await writeHtmlReport(results, htmlNoImgPath, { includeImages: false, agency });
  // eslint-disable-next-line no-console
  console.log(`Reports written to ${jsonPath}, ${htmlPath} and ${htmlNoImgPath}`);

  if (args.serve) {
    const port = args.port ?? 4321;
    await serveReports({ port, openBrowser: true, defaultFile: `${hostname}/index.html` });
  } else if (args.open !== false) {
    // Try to open the generated HTML report directly in the default browser
    try {
      const reportPath = path.resolve(htmlPath);
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${opener} ${reportPath}`);
    } catch {
      // ignore open errors
    }
  }
}

async function runAll(args: CliArgs) {
  const previousBase = await getLastBase();
  const base = await ensureBase(args.base);
  const agency = await ensureAgency();
  const hostname = new URL(base).hostname;
  const maxIssues = await ensureMaxIssues(args.maxIssues, hostname);
  const urlsPath = await getUrlsPathForBase(base);

  let shouldDiscover = true;
  // Migrate a legacy root-level urls.json if present for the same base
  if (previousBase && previousBase === base) {
    if (await fileExists('urls.json') && !(await fileExists(urlsPath))) {
      try {
        await fs.rename('urls.json', urlsPath);
      } catch {}
    }
  }

  if (previousBase && previousBase === base && await fileExists(urlsPath)) {
    shouldDiscover = await askYesNo('Rediscover URLs before scanning? (y/N): ', false);
  }

  if (shouldDiscover) {
    await discover(base, args);
  }

  await scan(urlsPath, { ...args, maxIssues, base });
}

function ensureProtocol(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

async function ensureBase(provided?: string): Promise<string> {
  const configDir = path.resolve('config');
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch {}
  const LAST_URL_FILE = path.join(configDir, '.a11y-scan-last-base');

  // If provided via CLI, validate and persist as last used
  if (provided) {
    // Validate
    const u = new URL(ensureProtocol(provided));
    const origin = `${u.protocol}//${u.host}`;
    await fs.writeFile(LAST_URL_FILE, origin, 'utf8');
    // Also persist per-domain state directory for convenience
    const dir = path.join(configDir, u.hostname);
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
    await fs.writeFile(path.join(dir, '.a11y-scan-last-base'), origin, 'utf8');
    return origin;
  }

  // Determine default from last used or fallback
  let defaultValue = 'https://example.com';
  try {
    const last = (await fs.readFile(LAST_URL_FILE, 'utf8')).trim();
    if (last) {
      // Validate last
      const u = new URL(last);
      defaultValue = `${u.protocol}//${u.host}`;
    }
  } catch {
    // ignore missing/invalid last file
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Enter the base URL to scan (default: ${defaultValue}): `);
    const trimmed = (answer.trim() || defaultValue);
    // Validate and normalize to origin
    const u = new URL(ensureProtocol(trimmed));
    const origin = `${u.protocol}//${u.host}`;
    await fs.writeFile(LAST_URL_FILE, origin, 'utf8');
    // Mirror per-domain last base
    const dir = path.join(configDir, u.hostname);
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
    await fs.writeFile(path.join(dir, '.a11y-scan-last-base'), origin, 'utf8');
    return origin;
  } finally {
    rl.close();
  }
}

async function ensureMaxIssues(provided?: number, hostname?: string): Promise<number> {
  const DEFAULT_MAX = 20;
  const configDir = path.resolve('config');
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch {}
  const LAST_MAX_FILE = hostname
    ? path.join(configDir, hostname, '.a11y-scan-last-maxissues')
    : path.join(configDir, '.a11y-scan-last-maxissues');

  // If provided via CLI, validate and persist as last used
  if (typeof provided === 'number' && !Number.isNaN(provided)) {
    if (provided < 0) throw new Error('maxIssues must be a non-negative number');
    await fs.writeFile(LAST_MAX_FILE, String(Math.floor(provided)), 'utf8');
    return Math.floor(provided);
  }

  // Determine default from last used or fallback
  let defaultValue = DEFAULT_MAX;
  try {
    const last = (await fs.readFile(LAST_MAX_FILE, 'utf8')).trim();
    const parsed = Number(last);
    if (Number.isFinite(parsed) && parsed >= 0) {
      defaultValue = Math.floor(parsed);
    }
  } catch {
    // ignore missing/invalid last file
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Enter max issues before stopping (0 for full scan, default: ${defaultValue}): `);
    const value = answer.trim() === '' ? defaultValue : Number(answer.trim());
    if (!Number.isFinite(value) || value < 0) throw new Error('maxIssues must be a non-negative number');
    const finalValue = Math.floor(value);
    await fs.writeFile(LAST_MAX_FILE, String(finalValue), 'utf8');
    return finalValue;
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command('discover [base]', 'Auto-discover URLs from sitemap and crawl', (y) =>
      y
        .positional('base', { type: 'string', describe: 'Base URL to scan (positional)' })
        .option('base', { type: 'string' })
        .option('sitemap', { type: 'string' })
        .option('concurrency', { type: 'number' })
        .option('maxPages', { type: 'number' })
        .option('maxDepth', { type: 'number' })
        .option('respectRobots', { type: 'boolean' })
        .option('headless', { type: 'boolean' })
        .option('browser', { type: 'string', choices: ['chromium', 'firefox', 'webkit'] as const })
        .option('timeoutMs', { type: 'number' })
    , async (args) => {
      const base = await ensureBase((args as any).base as string | undefined);
      await discover(base, args as any);
    })
    .command('run [base]', 'Discover then scan', (y) =>
      y
        .positional('base', { type: 'string', describe: 'Base URL to scan (positional)' })
        .option('base', { type: 'string' })
        .option('sitemap', { type: 'string' })
        .option('concurrency', { type: 'number' })
        .option('maxPages', { type: 'number' })
        .option('maxDepth', { type: 'number' })
        .option('respectRobots', { type: 'boolean' })
        .option('headless', { type: 'boolean' })
        .option('browser', { type: 'string', choices: ['chromium', 'firefox', 'webkit'] as const })
        .option('timeoutMs', { type: 'number' })
        .option('maxIssues', { type: 'number', default: undefined })
        .option('serve', { type: 'boolean', default: false })
        .option('port', { type: 'number', default: 4321 })
        .option('open', { type: 'boolean', default: true })
    , async (args) => {
      await runAll(args as any);
    })
    .command('serve-report', 'Serve the reports directory locally', (y) =>
      y.option('port', { type: 'number', default: 4321 })
        .option('file', { type: 'string', default: 'index.html' })
        .option('noOpen', { type: 'boolean', default: false })
    , async (args) => {
      await serveReports({ port: args.port as number, defaultFile: args.file as string, openBrowser: !(args as any).noOpen });
    })
    .demandCommand(1)
    .help()
    .parse();

  return argv;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

async function serveReports(opts: { port: number; defaultFile: string; openBrowser: boolean }): Promise<void> {
  const reportsDir = path.resolve('reports');
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = (req.url || '/').split('?')[0];
      const filePath = path.join(reportsDir, urlPath === '/' ? opts.defaultFile : urlPath.replace(/^\//, ''));
      const stat = await fsp.stat(filePath).catch(async () => await fsp.stat(path.join(reportsDir, opts.defaultFile)));
      const finalPath = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
      const data = await fsp.readFile(finalPath);
      res.writeHead(200, { 'Content-Type': contentTypeFor(finalPath) });
      res.end(data);
    } catch (e: any) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, () => resolve()));
  const url = `http://localhost:${opts.port}/`;
  // eslint-disable-next-line no-console
  console.log(`Serving reports from ${reportsDir} at ${url}`);
  if (opts.openBrowser) {
    try {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${opener} ${url}`);
    } catch {
      // ignore open errors
    }
  }
}

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function getLastBase(): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(path.resolve('config'), '.a11y-scan-last-base'), 'utf8');
    const trimmed = content.trim();
    if (!trimmed) return undefined;
    // Validate URL format, normalize to origin
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

async function getUrlsPathForBase(base: string): Promise<string> {
  const hostname = new URL(base).hostname;
  const dir = path.join(path.resolve('config'), hostname);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
  return path.join(dir, 'urls.json');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function askYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultYes ? 'Y/n' : 'y/N';
    const answer = await rl.question(`${prompt.replace(/\s*\(.*\):\s*$/, '')} (${suffix}): `);
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') return true;
    if (normalized === 'n' || normalized === 'no') return false;
    return defaultYes;
  } finally {
    rl.close();
  }
}

type AgencyInfo = { name: string; url?: string } | undefined;

async function ensureAgency(): Promise<AgencyInfo> {
  const configDir = path.resolve('config');
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch {}
  const AGENCY_FILE = path.join(configDir, '.a11y-scan-agency.json');

  // If settings file already exists, do not prompt again; return parsed info or undefined
  if (await fileExists(AGENCY_FILE)) {
    try {
      const raw = await fs.readFile(AGENCY_FILE, 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; url?: string };
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim() !== '') {
        return {
          name: parsed.name.trim(),
          url: typeof parsed.url === 'string' && parsed.url.trim() !== '' ? parsed.url.trim() : undefined,
        };
      }
    } catch {}
    return undefined;
  }

  // Settings file missing: ask once and create it
  const rl = createInterface({ input, output });
  try {
    const name = (await rl.question('Enter your agency name to include in reports (optional): ')).trim();
    const url = (await rl.question('Enter your agency URL (optional): ')).trim();
    const info: AgencyInfo = name ? { name, url: url || undefined } : undefined;
    try {
      await fs.writeFile(AGENCY_FILE, JSON.stringify(info ?? {}, null, 2), 'utf8');
    } catch {}
    return info;
  } finally {
    rl.close();
  }
}


