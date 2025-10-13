export function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  // Sort search params for determinism
  const entries = Array.from(url.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  url.search = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
  return url.toString();
}

export function isHttp(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export function isSameHost(a: string | URL, b: string | URL): boolean {
  const ua = a instanceof URL ? a : new URL(a);
  const ub = b instanceof URL ? b : new URL(b);
  // Treat localhost variants as equivalent and ignore port differences to avoid
  // over-filtering when developing locally. Many local setups differ by port.
  const aHost = ua.hostname;
  const bHost = ub.hostname;
  const aIsLocal = aHost === 'localhost' || aHost === '127.0.0.1';
  const bIsLocal = bHost === 'localhost' || bHost === '127.0.0.1';

  if (aIsLocal && bIsLocal) {
    // Accept http/https and any port for localhost equivalence
    return true;
  }

  return ua.host === ub.host && ua.protocol === ub.protocol;
}

export function toAbsoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}


