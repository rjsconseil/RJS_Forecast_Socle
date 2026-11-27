// Base commune des données des applications autonomes : natures et tables AA_, catalogue commun en lecture seule,
// liens contrôlés vers le noyau, cloisonnement par user, instanciation idempotente (docs/ARCHITECTURE.md §20.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { createApplicationsModule } from '../src/modules/applications/index.mjs';
import { tableOf } from '../src/socle/data/engines/tables.mjs';
import { key, makeUser } from './helpers.mjs';

const ESSAI = {
  application: 'essai', section: 'projets', libelle: 'Application d’essai',
  regles: 'essaiRefRegles',
  collections: {
    essaiRefLivrables: { nature: 'essaiRefLivrable', prefixe: 'aaerl', catalogue: true, champs: { code: { type: 'texte' }, nom: { type: 'texte' } } },
    essaiRefRegles: { nature: 'essaiRefRegle', prefixe: 'aaerr', catalogue: true, champs: { code: { type: 'texte' }, declencheur: { type: 'texte' }, cible: { type: 'texte' }, refCode: { type: 'texte' }, multiplicite: { type: 'texte' }, valeurs: { type: 'json' } } },
    essaiDossiers: { nature: 'essaiDossier', prefixe: 'aaedo', unique: ['projectId'], liens: { projectId: { nature: 'coreProject', obligatoire: true } }, champs: { etat: { type: 'choix', valeurs: ['ouvert', 'clos'] } } },
    essaiLivrables: { nature: 'essaiLivrable', prefixe: 'aaeli', liens: { projectId: { nature: 'coreProject', obligatoire: true } }, champs: { etapeId: { type: 'texte' }, statut: { type: 'choix', valeurs: ['a-faire', 'approuve'] } } },
  },
  catalogue: {
    version: 'essai-1',
    lignes: {
      essaiRefLivrables: [{ code: 'cas', nom: 'Cas d’affaire' }, { code: 'plan-etape', nom: 'Plan d’étape' }],
      essaiRefRegles: [
        { code: 'r1', declencheur: 'creation-dossier', cible: 'essaiLivrables', refCode: 'cas', multiplicite: 'projet', valeurs: { statut: 'a-faire' } },
        { code: 'r2', declencheur: 'ouverture-etape', cible: 'essaiLivrables', refCode: 'plan-etape', multiplicite: 'etape', valeurs: { statut: 'a-faire' } },
      ],
    },
  },
};

async function socleEssai() {
  const dir = await mkdtemp(join(tmpdir(), 'socle-aa-'));
  const modules = [...SOCLE_MODULES.filter((m) => m.id !== 'applications'), createApplicationsModule([ESSAI])];
  return createSocle({ dataFile: join(dir, 'store.json'), modules });
}

test('applications autonomes : tables AA_ + préfixe de la section, catalogue commun en lecture seule', async () => {
  const socle = await socleEssai();
  try {
    assert.equal(tableOf('essaiDossiers'), 'AA_MP_essai_dossiers');
    const aa = socle.modules.applications;
    const { ctx } = await makeUser(socle);
    assert.deepEqual(aa.list(ctx, 'essai', 'essaiRefLivrables').items.map((r) => r.code), ['cas', 'plan-etape']);
    assert.equal(aa.list(ctx, 'essai', 'essaiRefLivrables').items[0].catalogue, 'essai-1');
    await assert.rejects(aa.create(ctx, 'essai', 'essaiRefLivrables', { requestKey: key(), code: 'x' }), /se lit seulement/);
    assert.equal(aa.describe()[0].collections.length, 4);
  } finally { await socle.close(); }
});

test('applications autonomes : liens contrôlés vers le noyau, unicité, révision et cloisonnement par user', async () => {
  const socle = await socleEssai();
  try {
    const aa = socle.modules.applications;
    const { ctx } = await makeUser(socle);
    const { ctx: autre } = await makeUser(socle, { label: 'U2' });
    const project = (await socle.modules.core.createCoreProject(ctx, { requestKey: key('p'), title: 'Projet A' })).project;
    await assert.rejects(aa.create(ctx, 'essai', 'essaiDossiers', { requestKey: key() }), /obligatoire/);
    await assert.rejects(aa.create(ctx, 'essai', 'essaiDossiers', { requestKey: key(), projectId: 'prj_inconnu' }), /n'existe pas/);
    await assert.rejects(aa.create(autre, 'essai', 'essaiDossiers', { requestKey: key(), projectId: project.id }), /n'existe pas|users différents/);
    const { item } = await aa.create(ctx, 'essai', 'essaiDossiers', { requestKey: key(), projectId: project.id, etat: 'ouvert', inconnu: 'ignoré' });
    assert.match(item.id, /^aaedo_/);
    assert.equal(item.application, 'essai');
    assert.equal(item.inconnu, undefined);
    await assert.rejects(aa.create(ctx, 'essai', 'essaiDossiers', { requestKey: key(), projectId: project.id }), /déjà un/);
    await assert.rejects(aa.update(ctx, 'essai', 'essaiDossiers', item.id, { etat: 'perdu', expectedRevision: 1 }), /doit valoir/);
    const updated = (await aa.update(ctx, 'essai', 'essaiDossiers', item.id, { etat: 'clos', expectedRevision: 1 })).item;
    assert.equal(updated.revision, 2);
    assert.equal(aa.list(autre, 'essai', 'essaiDossiers').items.length, 0);
  } finally { await socle.close(); }
});

test('applications autonomes : instanciation par règles du catalogue, sans doublon, par projet ou par étape', async () => {
  const socle = await socleEssai();
  try {
    const aa = socle.modules.applications;
    const { ctx } = await makeUser(socle);
    const project = (await socle.modules.core.createCoreProject(ctx, { requestKey: key('p'), title: 'Projet B' })).project;
    const first = await aa.provision(ctx, 'essai', { declencheur: 'creation-dossier', projectId: project.id });
    assert.equal(first.created.length, 1);
    assert.equal((await aa.provision(ctx, 'essai', { declencheur: 'creation-dossier', projectId: project.id })).created.length, 0);
    await assert.rejects(aa.provision(ctx, 'essai', { declencheur: 'ouverture-etape', projectId: project.id }), /etapeId obligatoire/);
    await aa.provision(ctx, 'essai', { declencheur: 'ouverture-etape', projectId: project.id, etapeId: 'etape-1' });
    await aa.provision(ctx, 'essai', { declencheur: 'ouverture-etape', projectId: project.id, etapeId: 'etape-2' });
    const rows = aa.list(ctx, 'essai', 'essaiLivrables', { projectId: project.id }).items;
    assert.deepEqual(rows.map((r) => `${r.refCode}:${r.etapeId ?? '-'}:${r.statut}`).sort(), ['cas:-:a-faire', 'plan-etape:etape-1:a-faire', 'plan-etape:etape-2:a-faire']);
    assert.ok(rows.every((r) => r.catalogue === 'essai-1'));
  } finally { await socle.close(); }
});

test('applications autonomes : une déclaration invalide est refusée au démarrage', () => {
  assert.throws(() => createApplicationsModule([{ ...ESSAI, section: 'inconnue' }]), /section inconnue/);
  assert.throws(() => createApplicationsModule([{ application: 'x', section: 'projets', collections: { tasks: { nature: 'xTask', prefixe: 'aaxt' } } }]), /appartient déjà au socle/);
  assert.throws(() => createApplicationsModule([{ application: 'x', section: 'projets', collections: { xRows: { nature: 'xRow', prefixe: 'bad' } } }]), /préfixe/);
  assert.throws(() => createApplicationsModule([{ application: 'x', section: 'projets', collections: { journal: { nature: 'xJournal', prefixe: 'aaxj' } } }]), /réservé/);
});
