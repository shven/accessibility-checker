## Accessibility Checker

Command-line tool to discover URLs from a site's sitemap and crawl, then run automated accessibility checks using axe-core via Playwright. Generates a browsable HTML report.

### Requirements
- Node.js 18+
- pnpm (recommended) or npm
- Playwright browsers installed:
  - Install once: `pnpm dlx playwright install` (or `npx playwright install`)

### Install
```bash
pnpm install
```

### Build
```bash
pnpm build
```

### Quick start
Run the full flow: discover URLs, scan with axe, and open the HTML report.
```bash
pnpm check
```
You'll be prompted for:
- Base URL to scan (normalized to origin, e.g. `https://example.com`)
- Max issues before stopping (0 for full scan)

State is persisted per domain to support running multiple scans concurrently:
- Last base: `config/<hostname>/.a11y-scan-last-base` and mirrored at `config/.a11y-scan-last-base` for convenience
- Last max issues: `config/<hostname>/.a11y-scan-last-maxissues`

Artifacts are written to:
- Discovered URLs: `config/<hostname>/urls.json`
- Reports: `reports/<hostname>/index.html` and `report.json`