import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../web/dist/web/browser');
const apiPort = Number(process.env.J1_API_PORT ?? 3410);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

// Même origine pour le site construit et son API : les liens directs et les formulaires fonctionnent.
createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': types['.json'] });
      res.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE', message: 'Le service local ne répond pas. Réessayez dans un instant.' } }));
    });
    req.on('aborted', () => proxy.destroy());
    req.pipe(proxy);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(dist, '.' + path);
    if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
    if (!await stat(file).then(s => s.isFile(), () => false)) {
      if (extname(path)) { res.writeHead(404); res.end(); return; }
      file = join(dist, 'index.html');
    }
    const details = await stat(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'content-length': details.size,
      'cache-control': /-[A-Z0-9]{8}\./.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
}).listen(4300, '127.0.0.1', () => console.log('Site de production : http://localhost:4300'));
