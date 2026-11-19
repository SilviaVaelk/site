import { getCollection } from 'astro:content';

// All published projects, in Work-page order.
export async function getProjects() {
  const all = await getCollection('projects', ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
}

// Projects listed on the Work page: leaves out collections (like Misc.)
// and projects that don't have any images yet.
export async function getWorkProjects() {
  return (await getProjects()).filter((p) => !p.data.children.length && (p.data.cover || p.data.media.length));
}
