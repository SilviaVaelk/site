import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Every project lives in src/content/projects/<slug>/index.md.
// The folder name becomes the URL: /work/<slug>.

const material = z
  .object({
    transmission: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    thickness: z.number().min(0).optional(),
    roughness: z.number().min(0).max(1).optional(),
    clearcoat: z.number().min(0).optional(),
    clearcoatRoughness: z.number().min(0).max(1).optional(),
  })
  .default({});

const marble = z.object({
  show: z.boolean().default(true),
  size: z.number().min(0.2).max(2).default(1),
  color: z.string().default('#ffffff'),
  light: z.string().default('#ff66cc'),
  // File name in public/marbles/textures, or null for none
  texture: z.string().nullable().default(null),
  // File name in public/marbles/models, or null for an empty marble
  inner: z.string().nullable().default(null),
  material,
});

const media = z.object({
  src: z.string(),
  alt: z.string().default(''),
  caption: z.string().optional(),
});

const projects = defineCollection({
  loader: glob({
    pattern: '*/index.md',
    base: './src/content/projects',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    title: z.string(),
    year: z.number().optional(),
    // Lower numbers come first on the Work page
    order: z.number().default(100),
    summary: z.string().default(''),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    media: z.array(media).default([]),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    draft: z.boolean().default(false),
    marble: marble.optional(),
  }),
});

export const collections = { projects };
