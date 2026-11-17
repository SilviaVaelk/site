// Downloads every image still hosted on Squarespace into public/media/<project>/
// and rewrites the project files to point at the local copies.
// Run once before cancelling Squarespace:  npm run pull-media
//
// Safe to run again: files already downloaded are skipped.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROJECTS = path.join(ROOT, 'src/content/projects');
const REMOTE = /https:\/\/images\.squarespace-cdn\.com\/[^"'\s)]+/g;

const fileName = (url) => {
  const last = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\+/g, ' ');
  return last.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
};

let downloaded = 0;
for (const slug of await fs.readdir(PROJECTS)) {
  const file = path.join(PROJECTS, slug, 'index.md');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    continue;
  }
  const urls = [...new Set(text.match(REMOTE) ?? [])];
  if (!urls.length) continue;

  const dir = path.join(ROOT, 'public/media', slug);
  await fs.mkdir(dir, { recursive: true });
  const used = new Set();

  for (const url of urls) {
    let name = fileName(url);
    // Avoid clashes like several "image-asset.jpeg"
    for (let i = 2; used.has(name); i++) name = name.replace(/(-\d+)?(\.\w+)$/, `-${i}$2`);
    used.add(name);
    const target = path.join(dir, name);

    try {
      await fs.access(target);
    } catch {
      // ?format=2500w asks Squarespace for a web-sized copy instead of the raw upload
      const res = await fetch(`${url}?format=2500w`);
      if (!res.ok) {
        console.warn(`  ✗ ${slug}: ${res.status} ${url}`);
        continue;
      }
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
      downloaded++;
      console.log(`  ✓ ${slug}/${name}`);
    }
    text = text.split(url).join(`/media/${slug}/${name}`);
  }
  await fs.writeFile(file, text);
}
console.log(`\nDone. ${downloaded} new file(s) downloaded.`);
