// Prefix internal links with the site's base path (e.g. "/site" while the
// preview lives at silviavaelk.github.io/site, "" once on silviavaelk.com).
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const url = (path = '/') => {
  if (/^(https?:)?\/\//.test(path)) return path;
  return base + (path.startsWith('/') ? path : `/${path}`);
};

// Media can be a full URL or a path inside /public (e.g. "/media/murdja/1.jpg").
export const mediaUrl = (src: string) => url(src);
