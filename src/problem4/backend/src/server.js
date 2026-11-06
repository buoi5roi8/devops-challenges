import http from 'node:http';
import { pathToFileURL } from 'node:url';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

export function handler(request, response) {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(handler).listen(port, () => console.log(`listening on ${port}`));
}
