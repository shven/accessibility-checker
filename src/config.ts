export type ScannerConfig = {
  baseUrl: string;
  sitemapUrl?: string;
  respectRobots: boolean;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  headless: boolean;
  browser: 'chromium' | 'firefox' | 'webkit';
  timeoutMs: number;
  slowMo?: number;
};

export const defaultConfig: Omit<ScannerConfig, 'baseUrl'> = {
  respectRobots: true,
  maxPages: 500,
  maxDepth: 4,
  concurrency: 5,
  headless: true,
  browser: 'chromium',
  timeoutMs: 20000,
};


