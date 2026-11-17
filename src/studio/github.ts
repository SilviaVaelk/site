// Tiny GitHub client used by the studio in the browser.
// Reads the current files from the repo and saves changes as one commit,
// which triggers the normal deploy.

import { parseDocument, parse } from 'yaml';

export const REPO = 'SilviaVaelk/site';
export const BRANCH = 'main';
const API = 'https://api.github.com';

export class GitHub {
  constructor(private token: string) {}

  private async req(path: string, init: RequestInit & { raw?: boolean } = {}) {
    const res = await fetch(API + path, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const msg = await res.json().then((j) => j.message).catch(() => res.statusText);
      throw new Error(`GitHub ${res.status}: ${msg}`);
    }
    return init.raw ? res.text() : res.json();
  }

  /** True if the token can push to the repo. */
  async canPush() {
    const repo = await this.req(`/repos/${REPO}`);
    return !!repo.permissions?.push;
  }

  readText(path: string): Promise<string> {
    return this.req(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { raw: true });
  }

  /** Write several files in a single commit on main. */
  async commit(files: { path: string; content: string }[], message: string) {
    const ref = await this.req(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const parent = await this.req(`/repos/${REPO}/git/commits/${ref.object.sha}`);
    const tree = await this.req(`/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      }),
    });
    const commit = await this.req(`/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent.sha] }),
    });
    await this.req(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
    return commit.sha as string;
  }
}

// ---------- Project files (front matter between --- lines)

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function readFrontMatter(text: string): any {
  const m = text.match(FRONT);
  return m ? parse(m[1]) ?? {} : {};
}

const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

export function writeMarble(text: string, marble: any) {
  const m = text.match(FRONT);
  if (!m) throw new Error('Project file has no front matter');
  const doc = parseDocument(m[1]);
  doc.set(
    'marble',
    doc.createNode({
      show: !!marble.show,
      size: round(marble.size),
      color: marble.color,
      light: marble.light,
      texture: marble.texture || null,
      inner: marble.inner || null,
      material: Object.fromEntries(Object.entries(marble.material ?? {}).map(([k, v]) => [k, round(v)])),
    }),
  );
  const front = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  return `---\n${front}\n---\n${text.slice(m[0].length)}`;
}

export function writeEnvironment(env: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(env).map(([k, v]) => [k, round(v)])), null, 2) + '\n';
}
