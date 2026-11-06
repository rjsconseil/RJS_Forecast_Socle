// Jeu persistant et non destructif : API démarrée, aucun reset, aucun autre user modifié.
// npm run seed:plafonds — une nouvelle exécution conserve le jeu existant.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.J1_API_URL ?? `http://localhost:${process.env.J1_API_PORT ?? 3410}`;
const label = 'TEST PLAFONDS · Dépassements';
const key = () => `seed-plafonds-${randomUUID()}`;
async function call(method, path, body, userId) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(result.error)}`);
  return result;
}

const users = await call('GET', '/api/users');
const existing = users.find(u => u.label === label);
const existingReview = existing ? await call('GET', '/api/bpm/caps-review', null, existing.id) : null;
if (existingReview && (Object.keys(existingReview.charges).length || existingReview.categories.length || Object.keys(existingReview.lifeBudget.capsCents).length)) {
  console.log(`Le jeu « ${label} » existe déjà (${existing.id}). Ses données et vos modifications sont conservées.`);
} else {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const today = `${month}-${pad(now.getDate())}`;
  const last = `${month}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;
  const past = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const recurrenceStart = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-01`;
  const u = existing ? { userId: existing.id } : await call('POST', '/api/users', { requestKey: key(), label, userType: 'individuel', anchorDay: 1, cycleStartDate: recurrenceStart, openingStock: 2000, objective: 5000 });
  const id = u.userId;
  const caps = await call('GET', '/api/bpm/spending-caps', null, id);
  await call('PUT', '/api/bpm/caps', { requestKey: key(), expectedRevision: caps.lifeBudget.revision, caps: { 'std:alimentation': 400, 'std:loisirs': 200, 'std:transport': 150, 'std:sante': 120, 'std:logement': 900 } }, id);
  const categories = {};
  for (const [name, center, cap] of [
    ['Courses du quotidien', 'alimentation', 250], ['Restaurants', 'alimentation', 150],
    ['Cinéma', 'loisirs', 40], ['Abonnements', 'loisirs', 16],
    ['Carburant', 'transport', 200], ['Pharmacie', 'sante', 80], ['Cadeaux', 'divers', 50],
  ]) {
    const r = await call('POST', '/api/bpm/categories', { requestKey: key(), label: name, costCenterRef: `std:${center}`, cap }, id);
    categories[name] = r.category.id;
  }
  const op = (name, amount, center, category, planned = false, direction = 'charge') => call('POST', '/api/bpm/operations', {
    requestKey: key(), label: name, direction, amount, date: planned ? last : today,
    status: planned ? 'planned' : 'realized', costCenterRef: `std:${center}`,
    categoryId: category ? categories[category] : null, note: 'Donnée de démonstration persistante — revue des plafonds.',
  }, id);
  await op('Revenu mensuel de démonstration', 1450, 'salaires', null, false, 'income');
  await op('Courses — supermarché', 180, 'alimentation', 'Courses du quotidien');
  await op('Courses — marché et produits frais', 90, 'alimentation', 'Courses du quotidien');
  await op('Restaurants — repas du mois', 110, 'alimentation', 'Restaurants');
  await op('Courses complémentaires prévues', 50, 'alimentation', null, true);
  await op('Cinéma — sorties du mois', 60, 'loisirs', 'Cinéma');
  await op('Carburant — premier plein', 90, 'transport', 'Carburant');
  await op('Carburant — prochain plein', 80, 'transport', 'Carburant', true);
  await op('Pharmacie — achats prévus', 45, 'sante', 'Pharmacie', true);
  await op('Cadeau d’anniversaire', 65, 'divers', 'Cadeaux');
  for (const [name, amount, center, category] of [['Abonnement vidéo mensuel', 15, 'loisirs', 'Abonnements'], ['Loyer mensuel', 700, 'logement', null]]) {
    await call('POST', '/api/budget/recurrences', { requestKey: key(), direction: 'charge', label: name, amount, cadence: 'monthly', firstDate: recurrenceStart, costCenterRef: `std:${center}`, categoryId: category ? categories[category] : null }, id);
  }
  const review = await call('GET', `/api/bpm/caps-review?period=${month}`, null, id);
  const center = name => review.centers.find(c => c.ref === `std:${name}`);
  const cat = name => review.categories.find(c => c.label === name);
  assert.equal(center('alimentation').engagedCents, 43000);
  assert.equal(center('alimentation').marginCents, -3000);
  assert.equal(cat('Courses du quotidien').marginCents, -2000);
  assert.equal(center('loisirs').over, false);
  assert.equal(cat('Cinéma').marginCents, -2000);
  assert.equal(center('transport').marginCents, -2000);
  assert.equal(cat('Carburant').over, false);
  assert.equal(center('divers').capCents, null);
  assert.equal(cat('Cadeaux').marginCents, -1500);
  assert.equal(review.totals.overCount, 5);
  assert.equal(review.totals.toCompensateCents, 6500);
  assert.equal(review.totals.headroomCents, 40000);
  assert.equal(review.totals.expectedCents, -3500);
  console.log(JSON.stringify({ userId: id, label, period: month, charges: Object.keys(review.charges).length, categories: review.categories.length, ...review.totals }, null, 2));
  console.log('Cas validés et conservés. Ouvrez /plafonds avec cet utilisateur.');
}
