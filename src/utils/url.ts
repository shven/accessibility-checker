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

const HTML_EXTENSIONS = new Set([
  '',
  '.html',
  '.htm',
  '.xhtml',
  '.php',
  '.php5',
  '.asp',
  '.aspx',
  '.jsp',
  '.cfm',
]);

const NON_HTML_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
  '.avif',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.mp3',
  '.wav',
  '.flac',
  '.zip',
  '.rar',
  '.7z',
  '.gz',
  '.tgz',
  '.tar',
  '.bz2',
  '.json',
  '.xml',
  '.rss',
  '.atom',
  '.csv',
  '.txt',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.ics',
  '.ps',
  '.eps',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.avi',
  '.ts',
  '.mpeg',
  '.mpg',
  '.flv',
  '.m4v',
  '.apk',
  '.dmg',
  '.exe',
  '.bin',
  '.iso',
  '.scss',
  '.less',
  '.css',
]);

function getExtension(pathname: string): string {
  if (!pathname || pathname.endsWith('/')) return '';
  const clean = pathname.split('/').pop() ?? '';
  const index = clean.lastIndexOf('.');
  if (index === -1) return '';
  return clean.slice(index).toLowerCase();
}

export function isLikelyHtmlPage(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const ext = getExtension(url.pathname.toLowerCase());
  if (HTML_EXTENSIONS.has(ext)) return true;
  if (NON_HTML_EXTENSIONS.has(ext)) return false;
  // Default to true for unknown extensions since many dynamic routes omit .html
  return true;
}

export function toAbsoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}


