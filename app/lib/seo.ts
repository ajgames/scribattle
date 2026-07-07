/**
 * Shared SEO metadata builder. Every route's `meta` export goes through here
 * so titles, descriptions, canonicals, and social cards stay consistent.
 * Keep SITE_URL in sync with public/robots.txt and public/sitemap.xml.
 */

export const SITE_URL = 'https://scribattle.io';
export const SITE_NAME = 'Scribattle';

export const OG_IMAGE = `${SITE_URL}/home-og-image.jpg`;
const OG_IMAGE_WIDTH = '1536';
const OG_IMAGE_HEIGHT = '1024';

type MetaDescriptor = Record<string, unknown>;

interface PageMetaOptions {
  title: string;
  description?: string;
  /** Canonical path ('/about'). Emits canonical link + og:url; omit for pages without a stable URL. */
  path?: string;
  /** Ephemeral or private pages (game rooms, admin, auth) that search engines should skip. */
  noindex?: boolean;
  /** Attach the site og image — for pages people share links to (home, lobby invites). */
  image?: boolean;
}

export function pageMeta({ title, description, path, noindex, image }: PageMetaOptions): MetaDescriptor[] {
  const tags: MetaDescriptor[] = [{ title }];

  // noindex hides a page from search but not from social scrapers — link
  // unfurls still read the og tags below (that's the point for lobby invites)
  if (noindex) {
    tags.push({ name: 'robots', content: 'noindex, nofollow' });
  }

  if (description) {
    tags.push(
      { name: 'description', content: description },
      { property: 'og:description', content: description },
      { name: 'twitter:description', content: description },
    );
  }

  tags.push(
    { property: 'og:title', content: title },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' },
    { name: 'twitter:title', content: title },
  );

  if (image) {
    tags.push(
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: OG_IMAGE_WIDTH },
      { property: 'og:image:height', content: OG_IMAGE_HEIGHT },
      { name: 'twitter:image', content: OG_IMAGE },
    );
  }

  if (path && !noindex) {
    const url = `${SITE_URL}${path}`;
    tags.push(
      { tagName: 'link', rel: 'canonical', href: url },
      { property: 'og:url', content: url },
    );
  }

  return tags;
}
