import { AxeResult, AxeViolation } from '../scan/axeRunner.js';
import { writeText } from '../utils/io.js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderViolation(violation: AxeViolation, pageUrl: string, includeImages: boolean): string {
  const nodesHtml = violation.nodes.map((n, idx) => {
    const htmlSnippet = escapeHtml(n.html);
    const targetSel = n.target.map(escapeHtml).join(', ');
    const failure = n.failureSummary ? `<div class="failure">${escapeHtml(n.failureSummary)}</div>` : '';
    const screenshot = includeImages && (n as any).screenshot ? `<a class="screenshot" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml((n as any).screenshot)}" alt="Screenshot of failing element"/></a>` : '';
    return `<li class="node">
      <div class="node-header"><span class="badge">Node ${idx + 1}</span> <code class="selector">${targetSel}</code></div>
      ${screenshot}
      <pre class="snippet">${htmlSnippet}</pre>
      ${failure}
    </li>`;
  }).join('');

  return `<details class="violation" open>
    <summary>
      <span class="id">${escapeHtml(violation.id)}</span>
      ${violation.impact ? `<span class="impact impact--${escapeHtml(violation.impact)}">${escapeHtml(violation.impact)}</span>` : ''}
      <span class="desc">${escapeHtml(violation.description)}</span>
      <a class="help" href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noreferrer">More info</a>
    </summary>
    <ul class="nodes">${nodesHtml || '<li class="node">No example nodes provided.</li>'}</ul>
  </details>`;
}

function renderPage(result: AxeResult, includeImages: boolean): string {
  if (result.error) {
    return `<details class="page error" open>
      <summary><a class="url" href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a> — <span class="count">Error</span></summary>
      <div class="error-block">${escapeHtml(result.error)}</div>
    </details>`;
  }

  const body = result.violations.map((v) => renderViolation(v, result.url, includeImages)).join('');
  return `<details class="page" open>
    <summary>
      <a class="url" href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a>
      <span class="count">${result.violations.length} violation(s)</span>
      <span class="duration">${result.durationMs} ms</span>
    </summary>
    <div class="violations">${body || '<div class="no-violations">No violations 🎉</div>'}</div>
  </details>`;
}

export async function writeHtmlReport(
  results: AxeResult[],
  outFile = 'reports/index.html',
  opts?: { includeImages?: boolean; agency?: { name: string; url?: string } }
) {
  const totalPages = results.length;
  const pagesWithIssues = results.filter((r) => (r.violations?.length ?? 0) > 0).length;
  const totalViolations = results.reduce((acc, r) => acc + (r.violations?.length ?? 0), 0);
  const generatedAt = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  const includeImages = opts?.includeImages !== false;

  // Determine base URL (common origin) across results
  const origins = Array.from(
    new Set(
      results
        .map((r) => {
          try {
            return new URL(r.url).origin;
          } catch {
            return undefined;
          }
        })
        .filter((v): v is string => Boolean(v))
    )
  );
  const baseUrlHtml = origins.length === 1
    ? `<div class="meta"><a class="url" href="${escapeHtml(origins[0])}" target="_blank" rel="noopener noreferrer">${escapeHtml(origins[0])}</a></div>`
    : origins.length > 1
      ? `<div class="meta">multiple (${origins.length})</div>`
      : '';

  const resultsToRender = results.filter((r) => (r.violations?.length ?? 0) > 0 || r.error);
  const pagesHtml = resultsToRender.map((r) => renderPage(r, includeImages)).join('\n');

  const agency = opts?.agency;
  const agencyFooter = agency && agency.name
    ? (agency.url
        ? `<a href="${escapeHtml(agency.url)}" target="_blank" rel="noopener noreferrer" class="url">${escapeHtml(agency.name)}</a>. `
        : `${escapeHtml(agency.name)}. `)
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Accessibility Report</title>
  <style>
    :root { --bg:#0b1020; --panel:#121a33; --muted:#9fb3c8; --text:#e6eef7; --accent:#5bb0ff; --danger:#ff6b6b; --warn:#ffd166; --minor:#9fb3c8; --ok:#2bd67b; }
    html,body { margin:0; padding:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    .meta { color: var(--muted); margin-bottom: 16px; }
    .summary { display:flex; gap:12px; flex-wrap: wrap; margin: 12px 0 20px; }
    .card { background: var(--panel); padding: 10px 12px; border-radius: 10px; }
    .card strong { font-size: 16px; }
    details.page { background: var(--panel); border-radius: 12px; margin-bottom: 12px; }
    details.page > summary { cursor: pointer; padding: 10px 12px; list-style: none; }
    details.page > summary::-webkit-details-marker { display:none; }
    details > summary::before { content: '▸'; display:inline-block; width: 1em; color: var(--muted); }
    details[open] > summary::before { content: '▾'; }
    .url { color: var(--accent); }
    .count { margin-left: 8px; color: var(--warn); }
    .duration { margin-left: 8px; color: var(--muted); }
    .violations { padding: 0 12px 12px; }
    details.violation { margin: 8px 0; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; }
    details.violation > summary { padding: 8px 10px; list-style: none; cursor: pointer; }
    details.violation > summary::-webkit-details-marker { display:none; }
    .id { font-weight: 600; }
    .impact { margin-left: 8px; padding: 2px 6px; border-radius: 999px; font-size: 12px; background: rgba(255,255,255,0.08); }
    .impact--critical,.impact--serious { background: rgba(255, 107, 107, 0.15); color: var(--danger); }
    .impact--moderate { background: rgba(255, 209, 102, 0.15); color: var(--warn); }
    .impact--minor { background: rgba(159, 179, 200, 0.15); color: var(--minor); }
    .desc { margin-left: 10px; color: var(--muted); }
    .help { margin-left: 10px; color: var(--accent); text-decoration: none; }
    .nodes { margin: 0; padding: 0 10px 10px 20px; }
    .node { list-style: disc; margin-top: 8px; }
    .node-header { margin: 4px 0; }
    .badge { display: inline-block; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 8px; font-size: 12px; color: var(--muted); }
    .selector { margin-left: 8px; color: var(--text); }
    .snippet { background: #0a0f1d; color: #d6e2f1; padding: 10px; border-radius: 8px; overflow:auto; }
    .screenshot { margin: 6px 0; display:inline-block; }
    .screenshot img { display:block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); }
    .failure { margin-top: 6px; color: var(--danger); white-space: pre-wrap; }
    .no-violations { color: var(--ok); }
    details.page.error .count, .error-block { color: var(--danger); }
    .error-block { padding: 0 12px 12px; }
    footer { margin-top: 18px; color: var(--muted); }
  </style>
  </head>
  <body>
    <div class="container">
      <h1>Accessibility Report</h1>
      ${baseUrlHtml}
      <div class="meta">Generated at ${escapeHtml(generatedAt)}</div>
      <div class="summary">
        <div class="card"><div>Total pages</div><strong>${totalPages}</strong></div>
        <div class="card"><div>Pages with issues</div><strong>${pagesWithIssues}</strong></div>
        <div class="card"><div>Total violations</div><strong>${totalViolations}</strong></div>
      </div>
      ${pagesHtml}
      ${agencyFooter.length > 0 ? `<footer>By ${agencyFooter}</footer>` : '<footer>Report generated with <a class="url" href="https://github.com/shven/accessibility-checker">accessibility checker</a></footer>'}
    </div>
  </body>
</html>`;

  await writeText(outFile, html);
}


