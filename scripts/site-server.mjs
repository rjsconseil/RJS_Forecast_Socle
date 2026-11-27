import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import preview from '../web/src/app/navigation/navigation-preview-csp.json' with { type: 'json' };

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../web/dist/web/browser');
const apiPort = Number(process.env.J1_API_PORT ?? 3410);
const port = Number(process.env.SOCLE_SITE_PORT ?? 4300);
// Le poste seul par défaut ; derrière un proxy d'hébergement (TLS), l'adresse d'écoute se fixe avec SOCLE_SITE_HOST.
const host = process.env.SOCLE_SITE_HOST || '127.0.0.1';

/**
 * En-têtes de sécurité des pages du site. Les scripts et feuilles viennent du site seul ; les appels à l'API aussi.
 * Aucun script en ligne n'est accepté (`script-src` sans `'unsafe-inline'`) : le build n'en ajoute pas (feuilles
 * critiques non intégrées, angular.json), et le seul script en ligne, celui de l'aperçu de la navigation (cadre
 * `srcdoc` isolé, qui hérite de cette CSP), est autorisé par son empreinte SHA-256 (navigation-preview-csp.json).
 * Balises `<style>` : seules celles qui portent le nonce de la page (`style-src-elem`). Angular le lit sur
 * `<app-root ngCspNonce>`, que le serveur remplit à chaque envoi de index.html, et le pose sur les feuilles de ses
 * composants ; l'aperçu de la navigation le recopie. Les attributs `style` restent permis (`style-src-attr`) : Angular
 * écrit ainsi les styles statiques des gabarits, et un attribut ne peut ni charger ni exfiltrer de ressource
 * (`img-src`, `font-src` et `connect-src` restent fermés aux autres sites).
 * Les scripts d'un autre site, les cadres d'un autre site et l'envoi de données ailleurs sont refusés.
 */
export const siteHeaders = (nonce) => ({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'", `script-src 'self' '${preview.script}'`,
    nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'",
    nonce ? `style-src-elem 'self' 'nonce-${nonce}'` : "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'", "img-src 'self' data:",
    "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
});
/** En-têtes des réponses autres que la page : aucune balise `<style>` en ligne n'y est attendue. */
export const SITE_HEADERS = siteHeaders(null);
const NONCE_MARK = 'RJS_CSP_NONCE';
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
    // HTTPS au proxy : le navigateur ne doit plus jamais revenir en HTTP sur ce nom (HSTS, un an).
    const hsts = req.headers['x-forwarded-proto'] === 'https' ? { 'strict-transport-security': 'max-age=31536000' } : {};
    if (file === join(dist, 'index.html')) {
      // Un nonce neuf à chaque envoi de la page : il n'est jamais mis en cache ni réutilisé.
      const nonce = randomBytes(16).toString('base64');
      const page = Buffer.from((await readFile(file, 'utf8')).replaceAll(NONCE_MARK, nonce));
      res.writeHead(200, { 'content-type': types['.html'], 'content-length': page.length, 'cache-control': 'no-store', ...siteHeaders(nonce), ...hsts });
      res.end(req.method === 'HEAD' ? undefined : page);
      return;
    }
    const details = await stat(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'content-length': details.size,
      'cache-control': /-[A-Z0-9]{8}\./.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SITE_HEADERS,
      ...hsts,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
});
server.listen(port, host, () => console.log(`Site de production : http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
