import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, TODAY } from './helpers.mjs';
import { fundingFigures, taskFunding, projectFundingSource, projectAccountingDate } from '../src/modules/budget/api.mjs';
import { projectVariables } from '../src/modules/budget/project-analysis.mjs';

const taskFigures = (hours, paidCents = 0, share = 10000) => {
  const state = { tasks: { t: { plannedHours: 10, spentHours: hours, status: 'doing' } } };
  const fig = { shares: { t: share }, byTask: { t: { paidCents, engagedCents: paidCents } } };
  return taskFunding(state, fig, 't');
};

test('reste de tâche : seul le temps compte, les achats restent une information à part', () => {
  assert.deepEqual([taskFigures(4).remainingCents, taskFigures(4).cashRemainingCents], [6000,10000]);
  const purchased = taskFigures(4, 6000);
  assert.deepEqual([purchased.timeConsumptionPercent, purchased.purchaseEquivalentHours, purchased.remainingCents, purchased.cashRemainingCents], [40,6,6000,4000]);
  assert.equal(taskFigures(12, 6000).remainingCents, -2000);
  const over = taskFigures(2, 12500);
  assert.deepEqual([over.timeRemainingPct, over.remainingCents, over.over, over.cashRemainingCents], [80,8000,true,-2500]);
  const late = taskFigures(12.5);
  assert.deepEqual([late.timeRemainingPct, late.remainingCents, late.over], [-25,-2500,true]);
});

test('source et date comptables : le flux prime, données historiques lisibles sans migration', () => {
  assert.equal(projectFundingSource({ fundingSource: 'cycle' }, { fundingSource: 'patrimoine' }), 'cycle');
  assert.equal(projectFundingSource({}, { fundingSource: 'patrimoine' }), 'patrimoine');
  assert.equal(projectAccountingDate({ realizedDate:'2026-10-30', accountingDate:'2026-11-03' }), '2026-11-03');
  assert.equal(projectAccountingDate({ realizedDate:'2026-10-30' }), '2026-10-30');
});

test('prélèvements cumulés du patrimoine : immédiats sans cycle, revenus déduits et date de lecture respectée', () => {
  const resolve = projectVariables.find(v => v.name === 'projets.prelevementsCumules').resolve;
  const b = { id:'b', role:'standard', parentBudgetId:'life', allocationCents:100000, allocationDate:'2026-10-01', fundingSource:'cycle' };
  const op = (id, direction, amount, date, source='patrimoine') => ({ id, budgetId:'b', direction, realizedAmountCents:amount, realizedDate:date, accountingDate:date, status:'realized', fundingSource:source });
  const state = {budgets:{b},operations:{
    old:op('old','charge',20000,'2026-10-10'),
    charge:op('charge','charge',30000,'2026-11-03'),
    income:op('income','income',5000,'2026-11-03'),
    cycle:op('cycle','charge',90000,'2026-11-03','cycle'),
    future:op('future','charge',10000,'2026-12-01'),
  }};
  const ctx={state,budgetId:'life'};
  assert.equal(resolve(ctx).value,450,'la validation du jour affecte immédiatement le patrimoine sans période');
  assert.equal(resolve({...ctx,period:{end:'2026-10-31'}}).value,200,'une lecture historique garde sa borne de date');
  assert.deepEqual(resolve(ctx).sources.map(s=>s.id),['old','charge','income']);
});

test('réservations : enveloppe, parts et autorisations ne produisent ni flux, ni charge, ni prélèvement', async () => {
  const { socle:s } = await makeSocle();
  const { ctx } = await camille(s);
  const p = await s.modules.bpm.projects.createProject(ctx,{requestKey:key(),title:'Cuisine',amount:100, fundingSource:'patrimoine'});
  const t = await s.modules.bpm.projects.createTask(ctx,{requestKey:key(),title:'Pose',projectId:p.coreProjectId,plannedHours:10});
  const before=Object.keys(s.state.operations).length;
  await s.modules.bpm.projects.setTaskShare(ctx,p.budgetId,t.task.id,{amount:150,authorizeOverrun:true,expectedRevision:s.state.budgets[p.budgetId].revision});
  const fig=fundingFigures(s.state,s.state.budgets[p.budgetId]);
  assert.deepEqual([fig.ceilingCents,fig.sharesCents,fig.paidCents],[15000,15000,0]);
  assert.equal(Object.keys(s.state.operations).length,before);
  const value=k=>s.modules.bpm.figure(ctx,k).value;
  assert.deepEqual([value('bpm.charges'),value('bpm.chargesProjets'),value('bpm.prelevementsProjets')],[0,0,0]);
  await at('2026-11-30',()=>s.modules.bpm.projects.billOverruns(ctx,{}));
  assert.equal(Object.keys(s.state.operations).length,before,'la consolidation administrative ne facture aucun flux');
  assert.deepEqual([value('bpm.charges'),value('bpm.chargesProjets'),value('bpm.prelevementsProjets')],[0,0,0]);
  assert.equal(process.env.SOCLE_TODAY,TODAY);
});
