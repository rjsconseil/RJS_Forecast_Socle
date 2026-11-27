// Mesure de charge du noyau partitionné (aucune donnée réelle touchée : base temporaire).
//   node api/scripts/bench-noyau.mjs [users=200] [opsParUser=200]
//   Sur PostgreSQL (base de test VIDE, elle reçoit les users de la mesure) :
//   SOCLE_DATA_ENGINE=sgbd SOCLE_PG_URL=postgres://… node api/scripts/bench-noyau.mjs 20 20
// Mesure : écritures en série sur une grosse partition, écritures en parallèle sur plusieurs partitions, lecture d'une
// page (registre) dans la partition d'un user, mémoire et partitions en cache.
import { performance } from 'node:perf_hooks';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key, makeSocle } from '../test/helpers.mjs';

const USERS = Number(process.argv[2] ?? 200);
const OPS = Number(process.argv[3] ?? 200);
const ms = (t) => `${t.toFixed(1)} ms`;
const op = (socle, ctx, i, day = '2026-11-02') => socle.modules.budget.createOperation(ctx, {
  requestKey: key('bench'), direction: i % 7 === 0 ? 'income' : 'charge', label: `Opération ${i}`, amount: 10 + (i % 90), date: day,
  status: i % 3 ? 'realized' : 'planned', costCenterRef: i % 7 === 0 ? 'std:salaires' : 'std:alimentation',
});

const { socle, dataFile } = await makeSocle();
console.log(`Moteur : ${socle.store.engine.constructor.id}`);
const users = [];
let t = performance.now();
for (let u = 0; u < USERS; u += 1) users.push((await camille(socle, { label: `User ${u}` })).ctx);
console.log(`${USERS} users créés : ${ms(performance.now() - t)}`);
t = performance.now();
const batch = 50;
for (let i = 0; i < users.length; i += batch) {
  await Promise.all(users.slice(i, i + batch).map(async (ctx) => { for (let k = 0; k < OPS; k += 1) await op(socle, ctx, k); }));
}
const total = USERS * OPS;
const elapsed = performance.now() - t;
console.log(`${total} écritures (${batch} users en parallèle) : ${ms(elapsed)} → ${Math.round((total / elapsed) * 1000)} écritures/s`);
await socle.close();

// Une instance neuve, cache borné : chaque requête ne charge que la partition de son user.
const server = await createSocle({ dataFile, modules: SOCLE_MODULES, partitionCache: 100 });
const heavy = users[0];
for (let k = 0; k < 2000; k += 1) await op(server, heavy, k, '2026-11-0' + (1 + (k % 3)));
t = performance.now();
for (let k = 0; k < 50; k += 1) await op(server, heavy, k);
console.log(`Écriture sur une partition de ${OPS + 2050} opérations : ${ms((performance.now() - t) / 50)} par écriture`);
t = performance.now();
const reads = 200;
for (let k = 0; k < reads; k += 1) {
  const ctx = users[k % users.length];
  await server.store.within(ctx.userId, () => server.modules.bpm.reads.register(ctx, { period: '2026-11' }));
}
console.log(`Lecture du registre (${reads} requêtes, ${Math.min(users.length, reads)} users différents, cache de 100) : ${ms((performance.now() - t) / reads)} par requête`);
const mem = process.memoryUsage();
console.log(`Mémoire : ${Math.round(mem.heapUsed / 1e6)} Mo de tas · partitions en cache : ${server.store.parts.size} · chargements : ${server.store.stats.loads} · évictions : ${server.store.stats.evictions}`);
await server.close();
