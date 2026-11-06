import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const template = await readFile('public/config.js.template', 'utf8');
await writeFile('dist/config.js', template.replace('__API_BASE_URL__', process.env.API_BASE_URL ?? '/api'));
