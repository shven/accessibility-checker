import { AxeResult } from '../scan/axeRunner.js';
import { writeJson } from '../utils/io.js';

export async function writeDeveloperReport(results: AxeResult[], outFile = 'reports/report.json') {
  const summary = results.map((r) => ({ url: r.url, violations: r.violations.length }));
  // eslint-disable-next-line no-console
  console.table(summary);
  await writeJson(outFile, { generatedAt: new Date().toISOString(), results });
}


