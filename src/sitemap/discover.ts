import { parseRobots } from '../utils/robots.js';

export async function discoverSitemaps(baseUrl: string, explicit?: string): Promise<string[]> {
  const defaults = [new URL('/sitemap.xml', baseUrl).toString()];
  const robots = await parseRobots(baseUrl);
  const found = new Set<string>([...defaults, ...robots.sitemaps]);
  if (explicit) found.add(explicit);
  return Array.from(found);
}


