import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('runtime config template exposes the API placeholder', async () => {
  const template = await readFile('public/config.js.template', 'utf8');
  assert.match(template, /__API_BASE_URL__/);
});
