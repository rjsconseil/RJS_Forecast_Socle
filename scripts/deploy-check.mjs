// Contrôle avant mise en ligne (docs/DEPLOIEMENT.md) : rien n'est publié ni modifié.
//   node scripts/deploy-check.mjs                    réglages de l'API lus dans l'environnement de ce processus
//   node scripts/deploy-check.mjs https://hôte.fr    en plus, en-têtes et refus attendus du site déjà en ligne
// Sortie 0 si tout est conforme, 1 sinon (une ligne par écart).
const env = process.env;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

check(env.SOCLE_AUTH === 'required', 'SOCLE_AUTH doit valoir « required » (connexion obligatoire).');
check(env.SOCLE_DATA_ENGINE === 'sgbd', 'SOCLE_DATA_ENGINE doit valoir « sgbd » (PostgreSQL).');
check(/^postgres(ql)?:\/\//.test(env.SOCLE_PG_URL ?? ''), 'SOCLE_PG_URL doit donner l’adresse PostgreSQL (postgres://…).');
check((env.SOCLE_AUTH_SECRET ?? '').length >= 32, 'SOCLE_AUTH_SECRET doit compter 32 caractères au moins (openssl rand -base64 32).');
check(env.SOCLE_COOKIE_SECURE === '1', 'SOCLE_COOKIE_SECURE doit valoir 1 (cookie de session en HTTPS seulement).');
check(!!env.SOCLE_ALLOWED_HOSTS, 'SOCLE_ALLOWED_HOSTS doit nommer l’hôte public (contre le « DNS rebinding »).');
check(!env.J1_ENABLE_RECETTE_RESET, 'J1_ENABLE_RECETTE_RESET doit être absent : la remise à zéro de recette n’existe pas en ligne.');
check(!env.SOCLE_HOST || env.SOCLE_HOST !== '0.0.0.0' || env.SOCLE_TRUST_PROXY === '1',
  'SOCLE_HOST=0.0.0.0 expose l’API : gardez-la derrière le proxy (SOCLE_TRUST_PROXY=1 si le proxy est ailleurs).');

const url = process.argv[2];
if (url) {
  const base = url.replace(/\/$/, '');
  check(base.startsWith('https://'), 'L’adresse publique doit être en HTTPS.');
  try {
    const page = await fetch(base + '/');
    const csp = page.headers.get('content-security-policy') ?? '';
    check(/frame-ancestors 'none'/.test(csp), 'La page n’envoie pas la CSP de site-server.mjs.');
    check(/style-src-elem 'self' 'nonce-/.test(csp) && !/(script|style)-src(-elem)? [^;]*'unsafe-inline'/.test(csp),
      'La CSP accepte des scripts ou des balises <style> en ligne sans nonce.');
    check(!!page.headers.get('strict-transport-security'), 'HSTS absent (X-Forwarded-Proto: https doit arriver au site).');
    check(page.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options: DENY absent.');
    check((await fetch(base + '/api/health')).status === 200, '/api/health ne rend pas 200.');
    check((await fetch(base + '/api/bpm/summary')).status === 401, '/api/bpm/summary doit exiger la connexion (401).');
    const foreign = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { origin: 'https://autre.exemple' } });
    check(foreign.status === 403, 'Une écriture venue d’un autre site doit être refusée (403).');
    check((await fetch(base + '/api/_recette/reset', { method: 'POST' })).status !== 200, 'La remise à zéro de recette répond en ligne.');
  } catch (error) {
    problems.push(`Site injoignable : ${error.message}`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} point(s) à corriger avant l’ouverture :\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(url ? `✓ Réglages et site conformes : ${url}` : '✓ Réglages de l’API conformes (ajoutez l’adresse publique pour contrôler le site).');
