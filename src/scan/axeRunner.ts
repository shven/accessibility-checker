import { chromium, firefox, webkit, Browser } from 'playwright';
import { injectAxe } from 'axe-playwright';
import path from 'path';
import { promises as fs } from 'fs';

export type AxeViolation = {
  id: string;
  impact?: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{ html: string; target: string[]; failureSummary?: string; screenshot?: string }>;
};

export type AxeResult = {
  url: string;
  violations: AxeViolation[];
  error?: string;
  durationMs: number;
};

type RunOptions = {
  urls: string[];
  headless: boolean;
  browser: 'chromium' | 'firefox' | 'webkit';
  timeoutMs: number;
  maxIssues: number; // 0 for full scan
  screenshotsDir?: string;
};

export async function runAxeForUrls(opts: RunOptions): Promise<AxeResult[]> {
  const start = Date.now();
  const browser = await launch(opts);
  const results: AxeResult[] = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  const icon = { search: '🔎', ok: '✅', fail: '❌', error: '⛔' } as const;
  const color = {
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  } as const;
  try {
    let totalViolations = 0;
    for (const url of opts.urls) {
      const t0 = Date.now();
      try {
        // eslint-disable-next-line no-console
        console.log(`${icon.search} ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await injectAxe(page);
        // Use axe-playwright checkA11y which returns void but throws on violations by default.
        // We'll run axe via evaluate to collect raw violations instead.
        const result = await page.evaluate(async () => {
          // @ts-ignore - axe is injected on the page
          const r = await (window as any).axe.run();
          return r.violations;
        });
        let enhanced = result as AxeViolation[];
        if (opts.screenshotsDir) {
          try {
            await fs.mkdir(opts.screenshotsDir, { recursive: true });
          } catch {}
          const pageSlug = (() => {
            try {
              const u = new URL(url);
              const base = (u.pathname === '/' ? 'home' : u.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')) || 'page';
              return base;
            } catch {
              return 'page';
            }
          })();
          for (let vIdx = 0; vIdx < enhanced.length; vIdx++) {
            const vio = enhanced[vIdx];
            for (let nIdx = 0; nIdx < vio.nodes.length; nIdx++) {
              const node = vio.nodes[nIdx] as any;
              const selector = Array.isArray(node.target) && node.target.length > 0 ? String(node.target[0]) : undefined;
              if (!selector) continue;
              try {
                const loc = page.locator(selector).first();
                const count = await loc.count();
                if (count === 0) continue;
                const safeId = `${vio.id}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                const filename = `${pageSlug}-${safeId}-n${nIdx + 1}.png`;
                const outPath = path.join(opts.screenshotsDir, filename);
                await loc.screenshot({ path: outPath });
                (node as any).screenshot = `screenshots/${filename}`;
              } catch {
                // ignore per-node screenshot failures
              }
            }
          }
        }
        results.push({ url, violations: enhanced, durationMs: Date.now() - t0 });
        // eslint-disable-next-line no-console
        if (result.length === 0) {
          console.log(`${icon.ok} ${url} — ${color.green('0 violation(s)')}`);
        } else {
          console.log(`${icon.fail} ${url} — ${color.red(`${result.length} violation(s)`)}`);
        }
        totalViolations += result.length;
        if (opts.maxIssues > 0 && totalViolations >= opts.maxIssues) {
          // eslint-disable-next-line no-console
          console.log(`Stopping early after reaching ${totalViolations} violation(s) (threshold: ${opts.maxIssues}).`);
          break;
        }
      } catch (err: any) {
        results.push({ url, violations: [], error: String(err?.message || err), durationMs: Date.now() - t0 });
        // eslint-disable-next-line no-console
        console.log(`${icon.error} ${url} — ${color.red(String(err?.message || err))}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return results;
}

async function launch(opts: { headless: boolean; browser: 'chromium' | 'firefox' | 'webkit'; timeoutMs: number }): Promise<Browser> {
  const common = { headless: opts.headless, timeout: opts.timeoutMs } as const;
  if (opts.browser === 'firefox') return await firefox.launch(common);
  if (opts.browser === 'webkit') return await webkit.launch(common);
  return await chromium.launch(common);
}


