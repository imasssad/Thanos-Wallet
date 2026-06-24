import type { MetadataRoute } from 'next';

/** /robots.txt — allow crawling and point search engines at the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://thanos.fi/sitemap.xml',
    host: 'https://thanos.fi',
  };
}
