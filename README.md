# silviavaelk.com

Portfolio site built with [Astro](https://astro.build), published to GitHub Pages.

## Adding a project

1. Make a folder: `src/content/projects/<slug>/` (the slug becomes the URL, `/work/<slug>`).
2. Add `index.md` with this at the top, then write about the project underneath:

```yaml
---
title: "Project name"
year: 2026
order: 10            # lower = earlier on the Work page
summary: "One line shown on the Work page and in the marble panel."
tags: ["branding"]
cover: "/media/<slug>/cover.jpg"
links:
  - label: "Live demo"
    url: "https://…"
marble:
  show: true         # false = no marble on the home page
  size: 0.8          # 0.2 – 2
  color: "#ffb3d9"
  light: "#ff66cc"   # glow inside the marble
  texture: null      # a file from public/marbles/textures, or null
  inner: "inner-model-3.glb"   # a file from public/marbles/models, or null
  material:
    transmission: 0.9  # 0 = solid, 1 = glass
    opacity: 0.85
    thickness: 2
    roughness: 0.15
    clearcoat: 1.5
    clearcoatRoughness: 0.05
layout: grid        # 3×3 square tiles (default), or "masonry" to keep image shapes
media:
  - src: "/media/<slug>/01.jpg"
    alt: "What's in the image"
    caption: "Optional caption"
---
```

3. Put the images in `public/media/<slug>/`. Videos (`.mp4`, `.webm`) work in `media` too.

Pushing to `main` publishes the site automatically (see the Actions tab).

## Marble assets

- Inner models: `public/marbles/models/*.glb`
- Textures: `public/marbles/textures/*`
- Normal map (surface detail): `public/marbles/marble-normal.jpg`
- Reflections come from a neutral studio environment generated in code (`src/marbles/scene.js`)

## Marble studio

A private page for tweaking the marbles, lighting and physics with sliders, right in the browser:
**https://silviavaelk.github.io/site/studio** (later: silviavaelk.com/studio).

It isn't linked anywhere, is hidden from search engines, and only opens with a GitHub token that can write to this repo.

**One-time setup: create a token**
1. github.com → your profile picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → `site`.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. Generate, copy, and paste it into the studio. It stays in that browser until you click **Lock studio**.

**Using it**
- **Environment & light**: reflections (soft studio, gradient, none, or any `.hdr` uploaded to `public/marbles/env/`), strength, rotation, tone mapping, exposure, lights, glow, background.
- **Camera & physics**: zoom, gravity, bounce.
- **Marble**: pick a project (or click a marble) and adjust its look.
- **Publish** saves everything you changed as one commit; the live site updates about a minute later.

## Running it on your computer

Needs Node.js (LTS) from nodejs.org.

```sh
npm install      # once
npm run dev      # preview at http://localhost:4321/site
```

## Moving images off Squarespace

Project images currently point at Squarespace's servers. Before cancelling Squarespace, run:

```sh
npm run pull-media
```

It downloads every image into `public/media/<slug>/` and updates the project files. Commit and push afterwards.

## Switching to silviavaelk.com

When the domain points here, the site no longer lives under `/site`. In `astro.config.mjs`, change
`base` to `'/'` and `site` to `'https://www.silviavaelk.com'`, and add a `public/CNAME` file containing `www.silviavaelk.com`.
