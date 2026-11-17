// The marble studio only exists while running `npm run dev` on your computer.
// It is never part of the published site.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENV_FILE = path.join(ROOT, 'src/marbles/environment.json');
const PROJECTS = path.join(ROOT, 'src/content/projects');

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

async function saveMarble(id, marble) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Bad project id: ${id}`);
  const file = path.join(PROJECTS, id, 'index.md');
  const text = await fs.readFile(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`${id}/index.md has no front matter`);

  const doc = parseDocument(match[1]);
  const clean = {
    show: !!marble.show,
    size: round(marble.size),
    color: marble.color,
    light: marble.light,
    texture: marble.texture || null,
    inner: marble.inner || null,
    material: Object.fromEntries(Object.entries(marble.material ?? {}).map(([k, v]) => [k, round(v)])),
  };
  doc.set('marble', doc.createNode(clean));
  const front = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  await fs.writeFile(file, `---\n${front}\n---\n${text.slice(match[0].length)}`);
  return path.relative(ROOT, file);
}

async function saveEnvironment(env) {
  const clean = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, round(v)]));
  await fs.writeFile(ENV_FILE, JSON.stringify(clean, null, 2) + '\n');
  return path.relative(ROOT, ENV_FILE);
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

export default function marbleStudio() {
  return {
    name: 'marble-studio',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/studio', entrypoint: './src/studio/Studio.astro' });
      },
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'POST' || !req.url?.includes('/__studio/save')) return next();
          try {
            const body = JSON.parse(await readBody(req));
            const saved = [];
            if (body.environment) saved.push(await saveEnvironment(body.environment));
            for (const { id, marble } of body.marbles ?? []) saved.push(await saveMarble(id, marble));
            logger.info(`Saved ${saved.join(', ')}`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, saved }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
          }
        });
      },
    },
  };
}
