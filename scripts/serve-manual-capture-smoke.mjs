import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const fixture = path.resolve('examples/manual-recording/product-capture-smoke.html');
const server = createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/product-capture-smoke.html') {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  createReadStream(fixture).pipe(response);
});

server.listen(4173, '127.0.0.1', () => {
  console.log('Manual capture smoke fixture: http://127.0.0.1:4173/product-capture-smoke.html');
});
