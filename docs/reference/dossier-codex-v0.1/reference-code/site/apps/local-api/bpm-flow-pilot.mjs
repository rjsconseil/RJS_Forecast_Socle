/** Lecture consolidée du propriétaire : aucune écriture, chaque budget une seule fois. */
import { userBudgets } from './bpm-user-budgets.mjs';
import { pendingFlows } from './bpm-flows.mjs';
import { realizedFlows, nextPeriod, periodStart, patrimoineStanding } from './budget-patrimoine.mjs';

function windowFlows(budget, id, start, end, closures) {
  const actual = realizedFlows(budget, id, start, end);
  const pending = pendingFlows(budget, id, start, end).pending.filter(row =>
    !closures.some(c => c.budgetProjectId === id && row.occurrenceDate >= c.start && row.occurrenceDate < c.end));
  const sum = kind => pending.filter(r => r.kind === kind).reduce((s,r) => s+r.amountCents,0);
  return {incomeCents:actual.incomeCents,expenseCents:actual.expenseCents,
    expectedIncomeCents:actual.incomeCents+sum('income'),expectedExpenseCents:actual.expenseCents+sum('expense')};
}
export function ownerFlowPilot(project, {budget, core, bpm, patrimoine, ledger, links, start, end, today}) {
  const projects = userBudgets(project,{budget,core,bpm}).map(b => {
    const link = links.find(l => l.budgetProjectId === b.id && l.enabled === 'true' && l.patrimoineProjectId === project.patrimoineProjectId);
    return {id:b.id,title:b.title,standard:b.id===project.budgetProjectId,linked:!!link,
      nextClosing:link ? nextPeriod(ledger.closures.filter(c=>c.linkId===link.id).map(c=>c.end).sort().at(-1)||link.startDate,link.periodicity) : null,
      ...windowFlows(budget,b.id,start,end,ledger.closures)};
  });
  const sum = key => projects.reduce((s,p)=>s+p[key],0);
  const standing = patrimoineStanding(patrimoine,ledger,project.patrimoineProjectId,today);
  const stock = standing.totalCents;
  const periodWealth = periodWealthSummary(project,{projects,ledger,standing,start,end});
  // Projeter uniquement les clôtures encore ouvertes qui seront atteintes à cette date.
  // Le stock courant contient déjà toutes les clôtures enregistrées, y compris d'autres budgets.
  let nextContributionCents=0, closingCount=0;
  for (const p of projects.filter(p=>p.linked)) {
    const link=links.find(l=>l.budgetProjectId===p.id && l.enabled==='true');
    let from=ledger.closures.filter(c=>c.linkId===link.id).map(c=>c.end).sort().at(-1) || link.startDate;
    for(let i=0;i<10000;i++) {
      const to=nextPeriod(from,link.periodicity);
      if(to>end) break;
      if(!ledger.closures.some(c=>c.budgetProjectId===p.id && c.start<to && c.end>from)) {
        const f=windowFlows(budget,p.id,from,to,ledger.closures);
        nextContributionCents+=f.expectedIncomeCents-f.expectedExpenseCents;
        closingCount++;
      }
      from=to;
    }
  }
  const lifecycle=patrimoine.projects.find(p=>p.id===project.patrimoineProjectId)?.lifecycle;
  const targetCents=lifecycle?.overruns?.at(-1)?.targetCents ?? lifecycle?.targetCents ?? null;
  return {start,end,projects,incomeCents:sum('incomeCents'),expenseCents:sum('expenseCents'),
    expectedIncomeCents:sum('expectedIncomeCents'),expectedExpenseCents:sum('expectedExpenseCents'),
    netCents:sum('incomeCents')-sum('expenseCents'),expectedNetCents:sum('expectedIncomeCents')-sum('expectedExpenseCents'),
    stockCents:stock,periodWealth,targetCents,phase:lifecycle?.phase ?? 'accumulation',closingCount,
    nextContributionCents: end>today ? nextContributionCents : null,
    projectedStockCents: end>today && stock!==null ? stock+nextContributionCents : null};
}
/** Stock de lecture : actifs connus + versements explicites + historique clos + période affichée.
 * Les clôtures de la période sont remplacées par son résultat complet, jamais ajoutées deux fois.
 */
export function periodWealthSummary(project,{projects,ledger,standing,start,end}) {
  const closures=ledger.closures.filter(c=>c.patrimoineProjectId===project.patrimoineProjectId);
  const historicalFlowCents=closures.filter(c=>c.end<=start).reduce((sum,c)=>sum+c.netCents,0);
  const cadence=['weekly','monthly','yearly'].find(c=>nextPeriod(start,c)===end)??'monthly';
  const before=new Date(start+'T12:00:00Z');before.setUTCDate(before.getUTCDate()-1);
  const previousStart=periodStart(before.toISOString().slice(0,10),cadence);
  const previousClosureCents=closures.filter(c=>c.end>previousStart&&c.end<=start).reduce((sum,c)=>sum+c.netCents,0);
  const currentClosureCents=projects.filter(p=>p.linked||closures.some(c=>c.budgetProjectId===p.id&&c.start<end&&c.end>start))
    .reduce((sum,p)=>sum+p.expectedIncomeCents-p.expectedExpenseCents,0);
  const cumulativeFlowCents=historicalFlowCents+currentClosureCents;
  return {historicalFlowCents,previousClosureCents,currentClosureCents,cumulativeFlowCents,
    totalCents:standing.totalCents===null?null:standing.totalCents-standing.budgetFlowCents+cumulativeFlowCents};
}
export function flowEditorProjects(project,{budget,core,bpm}) {
  return userBudgets(project,{budget,core,bpm}).map(b=>({id:b.id,title:b.title,standard:b.id===project.budgetProjectId,
    tasks:core.tasks.filter(t=>t.projectId===b.coreProjectId).map(t=>({id:t.id,title:t.title})),
    operations:budget.operations.filter(o=>o.budgetProjectId===b.id).map(o=>({
      id:o.id,title:o.title,kind:o.kind==='income'?'income':'expense',amountCents:o.amountCents,date:o.firstDate,
      endDate:o.endDate??'',cadence:o.cadence,centerName:budget.centers.find(c=>c.id===o.centerId)?.name??'',
      incomeType:o.incomeType??'',note:o.description??'',coreTaskId:o.coreTaskId??'',decision:o.decision??'approved',
      settledCount:(o.settlements??[]).length,updatedAt:o.updatedAt,
    })).sort((a,b)=>a.title.localeCompare(b.title,'fr'))}));
}
