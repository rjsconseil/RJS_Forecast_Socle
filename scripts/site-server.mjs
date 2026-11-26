import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../web/dist/web/browser');
const apiPort = Number(process.env.J1_API_PORT ?? 3410);
const port = Number(process.env.SOCLE_SITE_PORT ?? 4300);
// Le poste seul par défaut ; derrière un proxy d'hébergement (TLS), l'adresse d'écoute se fixe avec SOCLE_SITE_HOST.
const host = process.env.SOCLE_SITE_HOST || '127.0.0.1';

/**
 * En-têtes de sécurité des pages du site. Les scripts et feuilles viennent du site seul ; les appels à l'API aussi.
 * `'unsafe-inline'` reste nécessaire : Angular injecte les styles de ses composants, le build ajoute un petit script
 * de chargement des feuilles, et l'aperçu de la navigation (cadre isolé, `sandbox` sans `allow-same-origin`) porte son
 * propre script. Les scripts d'un autre site, les cadres d'un autre site et l'envoi de données ailleurs sont refusés.
 */
export const SITE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
};
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

// Même origine pour le site construit et son API : les liens directs et les formulaires fonctionnent.
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    // L'API voit l'adresse réelle du client (limitation des essais de connexion) et le protocole d'origine.
    const forwarded = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
    const headers = { ...req.headers, 'x-forwarded-for': forwarded, 'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'http' };
    const proxy = request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers }, upstream => {
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
    if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403, SITE_HEADERS); res.end(); return; }
    if (!await stat(file).then(s => s.isFile(), () => false)) {
      if (extname(path)) { res.writeHead(404); res.end(); return; }
      file = join(dist, 'index.html');
    }
    const details = await stat(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'content-length': details.size,
      'cache-control': /-[A-Z0-9]{8}\./.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SITE_HEADERS,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
});
server.listen(port, host, () => console.log(`Site de production : http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
