import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { makeSocle, camille, key } from './helpers.mjs';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';

const fails = (code) => (error) => error.code === code;

test('architecture : BPM écrit seulement ses objets de composition et de coordination', async () => {
  const directory = new URL('../src/modules/bpm/', import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.mjs')) continue;
    const source = await readFile(new URL(file, directory), 'utf8');
    for (const match of source.matchAll(/\bom\.create\(tx,\s*'([^']+)'/g)) {
      assert.ok(
        ['bpmComposition', 'cycleLink', 'closure'].includes(match[1]),
        `${file}: création hors domaine ${match[1]}`,
      );
    }
    for (const match of source.matchAll(/\bom\.update\(tx,\s*(\w+)/g)) {
      assert.ok(
        ['comp', 'cycle'].includes(match[1]),
        `${file}: écriture directe hors composition ${match[1]}`,
      );
    }
  }
  for (const name of ['core', 'budget', 'patrimoine']) {
    for (const file of await readdir(
      new URL(`../src/modules/${name}/`, import.meta.url),
    )) {
      if (!file.endsWith('.mjs')) continue;
      const source = await readFile(
        new URL(`../src/modules/${name}/${file}`, import.meta.url),
        'utf8',
      );
      assert.doesNotMatch(
        source,
        /from\s+['"][^'"]*\/bpm\//,
        `${name}/${file}: dépendance ascendante`,
      );
      assert.doesNotMatch(
        source,
        /socle\.modules\.bpm\b/,
        `${name}/${file}: appel ascendant`,
      );
    }
  }
  const patrimoine = SOCLE_MODULES.find((m) => m.id === 'patrimoine');
  assert.ok(patrimoine.kinds.lifeGoal.references.coreProjectId.required);
  assert.ok(patrimoine.kinds.lifeGoal.references.patrimoineId.required);
  assert.equal(
    SOCLE_MODULES.find((m) => m.id === 'bpm').kinds.lifeGoal,
    undefined,
  );
});

test('objectifs : les middlewares stockent leurs réglages et les projets partagent la composition BPM', async () => {
  const { socle } = await makeSocle();
  try {
    const { ctx, bundle } = await camille(socle);
    const bpm = socle.modules.bpm;
    const composition = bpm.compositionOf(socle.state, ctx.userId);
    await bpm.updateVision(ctx, {
      expectedRevision: composition.revision,
      savingsTarget: 120,
      annualReturnPct: 3,
      contribution: 80,
    });
    assert.equal(
      socle.state.budgets[composition.budgetId].objectives.savingsTargetCents,
      12000,
    );
    assert.equal(
      socle.state.patrimoines[composition.patrimoineId].projectionSettings
        .contributionCents,
      8000,
    );
    assert.equal(socle.state.bpmCompositions[composition.id].vision, undefined);
    const { goal } = await bpm.createGoal(ctx, {
      requestKey: key(),
      label: 'Projet futur',
      type: 'achat',
      date: '2028-01-01',
      targetToday: 1500,
    });
    assert.equal(goal.coreProjectId, composition.coreProjectId);
    assert.equal(goal.patrimoineId, composition.patrimoineId);
    const branch = await bpm.createLifeProject(ctx, {
      requestKey: key(),
      name: 'Voyage',
      tasks: [{ title: 'Réserver' }],
    });
    const enrichment = socle.modules.core.contextOf(
      socle.state,
      branch.coreProjectId,
    ).enrichment;
    assert.equal(enrichment.bpmCompositionId, composition.id);
    assert.equal(enrichment.patrimoineId, composition.patrimoineId);
    assert.equal(enrichment.lifeProjectId, composition.coreProjectId);
    assert.notEqual(branch.coreProjectId, composition.coreProjectId);
    assert.equal(
      Object.values(socle.state.patrimoines).filter(
        (p) => p.userId === ctx.userId,
      ).length,
      1,
    );
  } finally {
    await socle.close();
  }
});

test('assistant BPM : plafonds invalides et modification de récurrence hors budget refusés atomiquement', async () => {
  const { socle } = await makeSocle();
  try {
    const { ctx } = await camille(socle);
    const bpm = socle.modules.bpm;
    const branch = await bpm.createLifeProject(ctx, {
      requestKey: key(),
      name: 'Voyage',
      tasks: [{ title: 'Réserver' }],
    });
    const { recurrence } = await socle.modules.budget.createRecurrence(ctx, {
      requestKey: key(),
      budgetId: branch.budgetId,
      direction: 'charge',
      label: 'Hôtel',
      amount: 100,
      cadence: 'monthly',
      firstDate: '2026-11-01',
      costCenterRef: 'std:divers',
    });
    const before = JSON.stringify(socle.state);
    await assert.rejects(
      bpm.setupProject(ctx, {
        requestKey: key(),
        mode: 'principal',
        project: { name: 'Ne doit pas changer' },
        caps: { 'std:inconnu': 10 },
      }),
      fails('REFERENCE_NOT_FOUND'),
    );
    assert.equal(JSON.stringify(socle.state), before);
    await assert.rejects(
      bpm.setupProject(ctx, {
        requestKey: key(),
        mode: 'principal',
        entries: [{ recurrenceId: recurrence.id, amount: 200 }],
      }),
      fails('INCOMPATIBLE_REFERENCE'),
    );
    assert.equal(JSON.stringify(socle.state), before);
    const lifeRec = await socle.modules.budget.createRecurrence(ctx, {
      requestKey: key(),
      direction: 'charge',
      label: 'Courses',
      amount: 100,
      cadence: 'monthly',
      firstDate: '2026-11-01',
      costCenterRef: 'std:alimentation',
    });
    await assert.rejects(
      bpm.setupProject(ctx, {
        requestKey: key(),
        mode: 'principal',
        entries: [
          { recurrenceId: lifeRec.recurrence.id, endDate: '2026-10-01' },
        ],
      }),
      fails('VALIDATION'),
    );
    assert.equal(socle.state.recurrences[lifeRec.recurrence.id].endDate, null);
  } finally {
    await socle.close();
  }
});

test('migration 0.5 → 0.6 : mêmes objectifs, mêmes projections, références explicites et reprise idempotente', async () => {
  const { socle, dataFile, reload } = await makeSocle();
  const { ctx } = await camille(socle);
  const bpm = socle.modules.bpm;
  const comp = bpm.compositionOf(socle.state, ctx.userId);
  await bpm.updateVision(ctx, {
    expectedRevision: comp.revision,
    annualReturnPct: 2,
    inflationPct: 1,
    contribution: 50,
    savingsTarget: 100,
  });
  const { goal } = await bpm.createGoal(ctx, {
    requestKey: key(),
    label: 'Réserve',
    type: 'securite',
    date: '2027-05-01',
    targetToday: 3000,
  });
  const before = bpm.reads.projection(ctx);
  const vision = bpm.setupProfile(ctx).principal.vision;
  const state = structuredClone(socle.state);
  await socle.close();
  state.schemaVersion = 'socle-store/0.5';
  state.bpmCompositions[comp.id].vision = vision;
  delete state.budgets[comp.budgetId].objectives;
  delete state.patrimoines[comp.patrimoineId].projectionSettings;
  delete state.lifeGoals[goal.id].coreProjectId;
  delete state.lifeGoals[goal.id].patrimoineId;
  await writeFile(dataFile, JSON.stringify(state));
  const upgraded = await createSocle({ dataFile, modules: SOCLE_MODULES });
  const after = upgraded.modules.bpm.reads.projection(ctx);
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual(after.goals, before.goals);
  assert.deepEqual(
    upgraded.modules.bpm.setupProfile(ctx).principal.vision,
    vision,
  );
  assert.equal(
    upgraded.state.lifeGoals[goal.id].coreProjectId,
    comp.coreProjectId,
  );
  assert.equal(
    upgraded.state.lifeGoals[goal.id].patrimoineId,
    comp.patrimoineId,
  );
  assert.equal(upgraded.state.bpmCompositions[comp.id].vision, undefined);
  const migrated = JSON.stringify(upgraded.state);
  await upgraded.close();
  const reopened = await createSocle({ dataFile, modules: SOCLE_MODULES });
  try {
    assert.equal(JSON.stringify(reopened.state), migrated);
  } finally {
    await reopened.close();
  }
});

test('Budget et Patrimoine fonctionnent sans charger le module BPM', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'middleware-autonomie-'));
  const socle = await createSocle({
    dataFile: join(dir, 'store.json'),
    modules: SOCLE_MODULES.filter((m) => m.id !== 'bpm'),
  });
  try {
    const user = await socle.modules.users.createUser({
      requestKey: key(),
      label: 'Sans application',
      userType: 'individuel',
    });
    const ctx = { userId: user.userId };
    await socle.om.command('prepareMiddleware', ctx, {}, (tx) => {
      const root = socle.modules.core.buildProject(tx, { title: 'Racine' });
      const budget = socle.modules.budget.buildLifeBudget(tx, {
        coreProjectId: root.id,
      });
      socle.modules.patrimoine.buildPatrimoine(tx, {
        coreProjectId: root.id,
        principalBudgetId: budget.id,
        openingStock: 1000,
      });
      return {};
    });
    const made = await socle.modules.patrimoine.createGoal(ctx, {
      requestKey: key(),
      label: 'Achat',
      type: 'achat',
      date: '2027-01-01',
      targetToday: 500,
    });
    const result = socle.modules.patrimoine.project({
      startCents: 100000,
      startYear: 2026,
      horizonYears: 2,
      ratePct: 0,
      inflationPct: 0,
      contributionCents: 0,
      perYear: 12,
      goals: [made.goal],
    });
    assert.equal(result.goals[0].status, 'funded');
    assert.equal(socle.modules.bpm, undefined);
    assert.equal(socle.modules.patrimoine.goals(ctx).length, 1);
  } finally {
    await socle.close();
  }
});
