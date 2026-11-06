import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../src/server.js';

test('health check returns 200', () => {
  const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  handler({ method: 'GET', url: '/healthz' }, response);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
});
