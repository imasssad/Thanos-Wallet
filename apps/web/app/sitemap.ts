import type { MetadataRoute } from 'next';

/**
 * /sitemap.xml — the public, crawlable routes. The wallet itself (/app and its
 * sub-routes) is application state behind a key, not indexable content, so we
 * surface the landing, the developer docs, and the app download.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://thanos.fi';
  const lastModified = new Date(); // evaluated at build time

  return [
    { url: `${base}/`,         lastModified, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${base}/app`,      lastModified, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${base}/docs`,     lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/download`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
