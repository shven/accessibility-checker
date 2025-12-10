import axios from 'axios';
import robotsParser from 'robots-parser';
import { normalizeUrl } from './url.js';
import { STEALTH_CONTEXT_OPTIONS } from './constants.js';

export async function fetchRobots(baseUrl: string) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  try {
    const res = await axios.get(robotsUrl, {
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        'User-Agent': STEALTH_CONTEXT_OPTIONS.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.status >= 200 && res.status < 300) {
      return { url: robotsUrl, body: res.data as string };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function parseRobots(baseUrl: string) {
  const fetched = await fetchRobots(baseUrl);
  if (!fetched) return { allows: () => true, sitemaps: [] as string[] };
  const parser = robotsParser(fetched.url, fetched.body);
  return {
    allows: (url: string) => parser.isAllowed(url, '*') ?? true,
    sitemaps: (parser.getSitemaps() || []).map((u) => normalizeUrl(u)),
  };
}


