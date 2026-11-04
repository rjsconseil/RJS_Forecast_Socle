import { detachBudgetProject, includeBpmProjects } from './bpm-detach.mjs';
import { ownerFlowPilot, flowEditorProjects } from './bpm-flow-pilot.mjs';
import { proposalLists, incomePostName, proposalKey } from './parameter-proposals.mjs';
import {
  isBusiness,
  isOrganization,
  pilotableBusinesses,
  pilotableOrganizations,
} from './entity-business.mjs';
import { userBudgets, budgetCosts } from './bpm-user-budgets.mjs';
import { expenseRegister } from './bpm-expenses.mjs';
import { lifecycleAction } from './patrimoine-lifecycle.mjs';
import { periodStart, nextPeriod, patrimoineStanding as lifecycleStanding } from './budget-patrimoine.mjs';
import { ownsBudget } from './entity-ownership.mjs';
import { entityWealth, entityOf, bindEntity } from './bpm-entities.mjs';
import { assemblyLink, assemblyProblems, ASSEMBLY_PROBLEMS } from './bpm-assembly.mjs';
import { applyAssemblyChanges, assemblyChangesOf } from './bpm-assembly-links.mjs';
import { creationDetails } from './bpm-creation-details.mjs';
/**
 * Routes de Budget/Patrimoine Management : lecture du parcours, création groupée
 * ou assemblage de l'existant, vision d'un projet et indice d'inflation.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fixedSetting } from './configuration-settings.mjs';
import { HttpError, jsonBody, localOrigin, send } from './api-http.mjs';
import { backupPrevious, writeWorkspace } from './space-files.mjs';
import { projectsOf, readWorkspace } from './core-space.mjs';
import { budgetWorkspaceOf, localBudgetToday, readBudget } from './budget-space.mjs';
import {
  bpmDetailOf,
  bpmFlowOf,
  bpmSettlementOf,
  bpmTransferOf,
  flowOperation,
  transferOperations,
  transferAssets,
} from './bpm-flows.mjs';
import { patrimoineWorkspaceOf, readPatrimoine } from './patrimoine-space.mjs';
import { validateBudgetLinks } from './budget-patrimoine.mjs';
import {
  bpmAssemblyOf,
  bpmCandidates,
  bpmCreationOf,
  bpmJourney,
  bpmSnapshot,
  cycleStartOf,
  readBpm,
} from './bpm-space.mjs';
import {
  bpmInflationOf,
  bpmVisionOf,
  effectiveInflation,
  inflationReference,
} from './bpm-vision.mjs';
import { bpmStatement } from './bpm-lens.mjs';
import { bpmProfiles } from './bpm-profiles.mjs';

const shortId = (prefix) =>
  `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
/** L'écriture d'un espace ; remplaçable par les tests pour provoquer un échec. */
export const bpmStorage = { write: writeWorkspace };
export const bpmFileOf = (ctx) =>
  join(dirname(ctx.patrimoineFilePath), 'budget-patrimoine-management.json');

/**
 * Qui gère : le profil actif, seul responsable de ses projets BPM. Sans aucun
 * profil déclaré, l'espace local reste utilisable par une personne seule.
 */
async function managerOf(ctx, request) {
  const users = await ctx.readUsersSpace(ctx.usersFilePath);
  const id = ctx.actorIdOf(request.headers['x-rjs-actor-id']);
  const declared = users.users.some((entry) => entry.active);
  const active = users.users.find((entry) => entry.id === id && entry.active);
  if (declared && !active)
    throw new HttpError(
      403,
      'Choisissez votre profil pour gérer un projet Budget/Patrimoine',
      'forbidden',
    );
  for (const right of ['budget', 'patrimoine'])
    if (!ctx.holdsRight(users, id, right))
      throw new HttpError(403, 'Les droits Budget et Patrimoine sont requis', 'forbidden');
  return { userId: active?.id ?? '', label: active?.label ?? 'Moi' };
}

async function professionalManager(ctx, manager, wanted) {
  const users = await ctx.readUsersSpace(ctx.usersFilePath);
  const actor = users.users.find((u) => u.id === manager.userId && u.active);
  if (!actor) throw new HttpError(403, 'Choisissez un utilisateur actif.', 'forbidden');
  const businesses = pilotableOrganizations(
    actor,
    users.users,
    (await ctx.effectiveNow()).tables['bpm.entreprises'] ?? [],
  );
  const budget = await readBudget(ctx.budgetFilePath);
  const hasActivities =
    !isOrganization(actor) &&
    budget.budgetProjects.some(
      (b) => b.entityId === actor.id && b.financialScope === 'professional',
    );
  const choices = [
    ...businesses.map((b) => ({ id: b.id, label: b.label })),
    ...(hasActivities
      ? [{ id: 'activites', label: 'Activités professionnelles à rattacher' }]
      : []),
  ];
  if (
    hasActivities &&
    (wanted === 'activites' || wanted === actor.id || (!wanted && !businesses.length))
  )
    return {
      userId: actor.id,
      label: actor.label,
      businesses: choices,
      expenseScope: 'professional',
    };
  const business = wanted ? businesses.find((b) => b.id === wanted) : businesses[0];
  if (!business)
    throw new HttpError(
      403,
      'Aucune entreprise ou association autorisée pour cette lecture.',
      'forbidden',
    );
  return {
    userId: business.id,
    label: business.label,
    businesses: choices,
    billingAllowed: pilotableBusinesses(
      actor,
      users.users,
      (await ctx.effectiveNow()).tables['bpm.entreprises'] ?? [],
    ).some((b) => b.id === business.id),
  };
}

async function presentBpm(ctx, bpm, manager = { userId: '' }, readingDate = null) {
  const [users, core, budget, patrimoine, ledger] = await Promise.all([
    ctx.readUsersSpace(ctx.usersFilePath),
    readWorkspace(ctx.filePath),
    readBudget(ctx.budgetFilePath),
    readPatrimoine(ctx.patrimoineFilePath),
    ctx.budgetBridge.read(),
  ]);
  const links = (await ctx.effectiveNow()).tables['budget.patrimoine'] ?? [];
  const reference = inflationReference();
  const ownProjects = bpm.projects.filter(
    (p) => !manager.userId || (p.entityId || p.ownerUserId) === manager.userId,
  );
  const ownBudget = {
    ...budget,
    budgetProjects: budget.budgetProjects.filter((p) => ownsBudget(p, manager.userId, bpm, core)),
  };
  const ownCore = {
    ...core,
    projects: core.projects.filter(
      (p) =>
        !p.id.startsWith('ENT-') &&
        (manager.userId
          ? p.entityId === manager.userId ||
            ownBudget.budgetProjects.some((b) => b.coreProjectId === p.id)
          : !p.entityId),
    ),
  };
  const scopeProject=ownProjects.find(p=>p.defaultForEntity)??ownProjects[0];
  const activeBudgetIds=new Set(scopeProject?userBudgets(manager.expenseScope?{...scopeProject,expenseScope:manager.expenseScope}:scopeProject,{budget,core,bpm}).map(p=>p.id):[]);
  const canonical = entityWealth(manager.userId, patrimoine, bpm);
  const ownWealth = manager.userId
    ? { ...patrimoine, projects: patrimoine.projects.filter((p) => p.id === canonical?.id) }
    : patrimoine;
  return {
    ...bpm,
    today: localBudgetToday(),
    inflation: {
      own: bpm.inflation,
      reference,
      effective: effectiveInflation(bpm.inflation, reference),
    },
    entities: users.users
      .filter((u) => u.active)
      .map((u) => ({
        id: u.id,
        label: u.label,
        entityType: u.entityType ?? null,
        patrimoineProjectId: entityWealth(u.id, patrimoine, bpm)?.id ?? null,
      })),
    candidates: bpmCandidates({
      core: ownCore,
      budget: ownBudget,
      patrimoine: ownWealth,
      bpm,
      links,
    }),
    freeTasks: core.tasks
      .filter((t) => !t.projectId && (manager.userId ? t.entityId === manager.userId : !t.entityId))
      .map((t) => ({ id: t.id, label: t.title })),
    // Les profils de paramétrage livrés : l'assistant et le budget type s'en servent comme valeurs de départ.
    profiles: bpmProfiles(),
    proposals: Object.fromEntries(['income', 'expense'].map((kind) => [kind, proposalLists('budget.' + kind + 'Posts',
      budget.centers.filter((center) => activeBudgetIds.has(center.budgetProjectId) && (center.kind ?? 'expense') === kind).map((center) => center.name))])),
    projects: [...ownProjects]
      .sort((a, b) => Number(b.defaultForEntity) - Number(a.defaultForEntity))
      .map((source) => {
        const project = manager.expenseScope
          ? { ...source, expenseScope: manager.expenseScope }
          : source;
        return {
          ...project,
          flowEditor: flowEditorProjects(project, {budget, core, bpm}),
          managementScope:
            manager.expenseScope === 'professional' ||
            isOrganization(
              users.users.find((u) => u.id === (project.entityId || project.ownerUserId)),
            ) ||
            budget.budgetProjects.find((b) => b.id === project.budgetProjectId)?.financialScope ===
              'professional'
              ? 'professional'
              : 'personal',
          ownerLabel: users.users.find((entry) => entry.id === project.ownerUserId)?.label ?? null,
          coreTitle:
            core.projects.find((entry) => entry.id === project.coreProjectId)?.title ?? null,
          budgetTitle:
            budget.budgetProjects.find((entry) => entry.id === project.budgetProjectId)?.title ??
            null,
          patrimoineTitle:
            patrimoine.projects.find((entry) => entry.id === project.patrimoineProjectId)?.title ??
            null,
          link: links.find((entry) => entry.id === project.linkId) ?? null,
          journey: bpmJourney(project, { budget, patrimoine, closures: ledger.closures }),
          snapshot: (() => {
            const snapshot = bpmSnapshot(
              project,
              links.find((entry) => entry.id === project.linkId) ?? null,
              { budget, patrimoine, ledger, today: localBudgetToday(), readingDate },
            );
            if (!snapshot) return null;
            const flowPilot = (start, end) => ownerFlowPilot(project, {budget,core,bpm,patrimoine,ledger,links,start,end,today:localBudgetToday()});
            const costs = (start, end) =>
              budgetCosts(project, { budget, core, bpm, ledger, start, end });
            const incomeRegister = (start, end) => {
              const data = expenseRegister({budget,core,project,
                statement: bpmStatement({budget,budgetProjectId:project.budgetProjectId,start,end,today:localBudgetToday(),closures:(ledger.closures ?? []).filter(c => c.budgetProjectId === project.budgetProjectId || (!c.budgetProjectId && c.linkId === project.linkId))}),
                closures:ledger.closures ?? [], kind:'income'});
              return {rows:data.rows,operations:data.operations};
            };
            return {
              ...snapshot,
              flowPilot: flowPilot(snapshot.period.start, snapshot.period.end),
              incomeRegister: incomeRegister(snapshot.period.start, snapshot.period.end),
              budgetProjects: costs(snapshot.period.start, snapshot.period.end),
              lenses: Object.fromEntries(
                Object.entries(snapshot.lenses).map(([cadence, view]) => [
                  cadence,
                  { ...view, flowPilot: flowPilot(view.start, view.end), incomeRegister: incomeRegister(view.start, view.end), budgetProjects: costs(view.start, view.end) },
                ]),
              ),
            };
          })(),
        };
      }),
  };
}

/** Une écriture du seul espace BPM, avec sauvegarde de l'état précédent. */
async function writeBpm(ctx, file, previous, next) {
  await backupPrevious(file, previous);
  await bpmStorage.write(file, next);
  await ctx.prune(file, false).catch(() => undefined);
}

const VISION_PATH = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/vision$/;
/** Le groupe Budget d'un poste nommé par l'utilisateur : logement, événement ou vie courante. */
function centerGroupOf(name) {
  const lower = name.toLocaleLowerCase('fr');
  if (/logement|loyer|crédit|charges|maison/.test(lower)) return 'housing';
  if (/vacances|événement|evenement|noël|noel|cadeau|fête|fete/.test(lower)) return 'life-event';
  if (/épargne|epargne|placement|investissement/.test(lower)) return 'investment';
  return 'everyday';
}

const FLOW_PATH = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/(flows|settlements|transfers)$/;
const STATEMENT_PATH = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/statement$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (value) =>
  typeof value === 'string' &&
  ISO_DATE.test(value) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * Un flux ou un pointage du gestionnaire : l'opération rejoint le PBM du projet
 * après validation par Budget et par le garde des périodes clôturées.
 */
async function budgetFlow(
  ctx,
  response,
  { kind, projectId, body, manager, remove = false, detail = false },
) {
  await ctx.enqueue(async () => {
    const [bpm, budget] = await Promise.all([
      readBpm(bpmFileOf(ctx)),
      readBudget(ctx.budgetFilePath),
    ]);
    const project = bpm.projects.find((entry) => entry.id === projectId);
    if (!project) throw new HttpError(404, 'Projet Budget/Patrimoine introuvable', 'not_found');
    if (project.ownerUserId && project.ownerUserId !== manager.userId)
      throw new HttpError(403, 'Seul le gestionnaire du projet peut saisir ses flux', 'forbidden');
    const now = new Date().toISOString();
    if (kind === 'transfers') {
      const patrimoine = await readPatrimoine(ctx.patrimoineFilePath);
      const transfer = bpmTransferOf(
        body,
        patrimoine.assets.filter((asset) => asset.projectId === project.patrimoineProjectId),
        localBudgetToday(),
      );
      const nextPatrimoine = {
        version: 1,
        revision: patrimoine.revision + 1,
        ...patrimoineWorkspaceOf(
          {
            ...patrimoine,
            assets: transferAssets(patrimoine, transfer, now),
            operations: [
              ...patrimoine.operations,
              ...transferOperations(transfer, project.patrimoineProjectId, now),
            ],
          },
          now,
        ),
      };
      try {
        await ctx.budgetBridge.guardPatrimoine(nextPatrimoine);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      await backupPrevious(ctx.patrimoineFilePath, patrimoine);
      await bpmStorage.write(ctx.patrimoineFilePath, nextPatrimoine);
      await ctx.prune(ctx.patrimoineFilePath, false).catch(() => undefined);
      send(response, 201, await presentBpm(ctx, bpm, manager));
      return;
    }
    const core = await readWorkspace(ctx.filePath);
    const targetBudgetId = body?.budgetProjectId || project.budgetProjectId;
    const targetBudget = userBudgets(project, {budget,core,bpm}).find(b=>b.id===targetBudgetId);
    if (!targetBudget) throw new HttpError(403, 'Ce budget ne fait pas partie de votre périmètre personnel.');
    let operations;
    // Un seul flux, ou un lot (mois type, « Tout pointer ») écrit en une seule fois.
    const batch = (list) => {
      if (
        !Array.isArray(list) ||
        !list.length ||
        list.length > Number(fixedSetting('bpm.flux.lotMax'))
      )
        throw new HttpError(400, 'Le lot de flux est vide ou trop long');
      return list;
    };
    let centersList = budget.centers;
    let created = [];
    if (detail && body?.mode !== 'definition') {
      // Préciser une opération : son poste et sa note, sans toucher montants, dates ni règlements.
      const own = () =>
        centersList.filter((entry) => entry.budgetProjectId === targetBudgetId);
      const target = budget.operations.find(
        (entry) =>
          entry.id === body?.operationId && entry.budgetProjectId === targetBudgetId,
      );
      const change = bpmDetailOf(body, target);
      let centerId = change.centerId;
      if (change.centerName) {
        let center = own().find(
          (entry) =>
            proposalKey(entry.name) === proposalKey(change.centerName) && (entry.kind ?? 'expense') === (target.kind === 'income' ? 'income' : 'expense'),
        );
        if (!center) {
          center = {
            id: shortId('CC'),
            budgetProjectId: targetBudgetId,
            name: change.centerName,
            kind: target.kind === 'income' ? 'income' : 'expense',
            description: '',
            group: centerGroupOf(change.centerName),
            limitCents: null,
            createdAt: now,
            updatedAt: now,
          };
          centersList = [...centersList, center];
        }
        centerId = center.id;
      }
      if (centerId && !own().some((entry) => entry.id === centerId))
        throw new HttpError(400, 'Ce poste n’appartient pas au budget du projet');
      operations = budget.operations.map((entry) =>
        entry === target
          ? {
              ...entry,
              ...(centerId !== undefined ? { centerId } : {}),
              ...(change.note !== undefined ? { description: change.note } : {}),
              updatedAt: now,
            }
          : entry,
      );
    } else if (remove) {
      // Annuler un pointage, ou une saisie faite depuis BPM ; le garde refuse toute période clôturée.
      operations = budget.operations;
      if (kind === 'flows') {
        const target = operations.find(
          (entry) =>
            entry.id === body?.operationId && entry.budgetProjectId === targetBudgetId,
        );
        if (!target) throw new HttpError(404, 'Cette saisie est introuvable', 'not_found');
        if (!target.id.startsWith('BPMF-'))
          throw new HttpError(
            400,
            'Cette opération a été créée dans Budget : modifiez-la depuis Budget → Opérations.',
          );
        operations = operations.filter((entry) => entry !== target);
      } else {
        for (const item of body?.items === undefined ? [body] : batch(body.items)) {
          const target = operations.find(
            (entry) =>
              entry.id === item?.operationId && entry.budgetProjectId === targetBudgetId,
          );
          if (
            !target ||
            !(target.settlements ?? []).some(
              (entry) => entry.occurrenceDate === item?.occurrenceDate,
            )
          )
            throw new HttpError(404, 'Ce pointage est introuvable', 'not_found');
          operations = operations.map((entry) =>
            entry === target
              ? {
                  ...entry,
                  settlements: entry.settlements.filter(
                    (settlement) => settlement.occurrenceDate !== item.occurrenceDate,
                  ),
                  updatedAt: now,
                }
              : entry,
          );
        }
      }
    } else if (kind === 'flows') {
      const person = budget.people.find(
        (entry) =>
          entry.budgetProjectId === targetBudgetId && entry.relationship === 'self',
      );
      const flows = body?.flows === undefined ? [body] : batch(body.flows);
      // Un débutant nomme simplement le poste : il est repris s'il existe, créé sinon.
      const own = () =>
        centersList.filter((entry) => entry.budgetProjectId === targetBudgetId);
      const prepared = flows.map((input) => {
        const item = input?.kind === 'income' && !input.centerId && !input.centerName
          ? {...input, centerName: incomePostName(input)} : input;
        if (
          !item ||
          item.centerId ||
          typeof item.centerName !== 'string' ||
          !item.centerName.trim()
        )
          return item;
        const name = item.centerName.trim().slice(0, 120);
        let center = own().find(
          (entry) => proposalKey(entry.name) === proposalKey(name) && (entry.kind ?? 'expense') === item.kind,
        );
        if (!center) {
          // Un poste créé depuis un profil reçoit le plafond proposé par ce profil.
          const limit =
            Number.isSafeInteger(item.centerLimitCents) && item.centerLimitCents >= 0
              ? item.centerLimitCents
              : null;
          center = {
            id: shortId('CC'),
            budgetProjectId: targetBudgetId,
            name,
            kind: item.kind,
            description: '',
            group: centerGroupOf(name),
            limitCents: limit,
            createdAt: now,
            updatedAt: now,
          };
          centersList = [...centersList, center];
        }
        return { ...item, centerId: center.id };
      });
      const centers = new Set(own().map((entry) => entry.id));
      for (const item of prepared) {
        if (item.coreTaskId && !core.tasks.some(t=>t.id===item.coreTaskId && t.projectId===targetBudget.coreProjectId))
          throw new HttpError(400,'La tâche doit appartenir au projet choisi.');
        if (!own().some(c=>c.id===item.centerId && (c.kind??'expense')===item.kind))
          throw new HttpError(400,'Le poste doit correspondre à une entrée ou à une dépense.');
      }
      const added = prepared.map((item) =>
        ({...flowOperation(bpmFlowOf(item, centers, localBudgetToday()), {
          budgetProjectId: targetBudgetId,
          personId: person?.id,
          now,
        }), coreTaskId: item.coreTaskId || null}),
      );
      if (detail) {
        const old = budget.operations.find(o=>o.id===body.operationId && o.budgetProjectId===targetBudgetId);
        if (!old || added.length!==1) throw new HttpError(404,'Flux introuvable.');
        if (body.updatedAt !== old.updatedAt) throw new HttpError(409,'Ce flux a changé : rechargez sa fiche avant de l’enregistrer.');
        const next = added[0];
        if ((old.settlements??[]).length && (old.firstDate!==next.firstDate || old.cadence!==next.cadence || (old.kind!==next.kind && !(old.kind==='investment' && next.kind==='expense'))))
          throw new HttpError(400,'Les dates, le rythme et le sens d’un flux déjà réalisé sont conservés. Créez un nouveau flux pour un autre calendrier.');
        if ((old.settlements??[]).some(s=>next.endDate && s.occurrenceDate>next.endDate))
          throw new HttpError(400,'La fin ne peut pas précéder une échéance déjà réalisée.');
        if (old.cadence==='once' && old.settlements?.length && old.amountCents!==next.amountCents)
          throw new HttpError(400,'Le montant ponctuel déjà réalisé est conservé. Utilisez une régularisation distincte.');
        operations=budget.operations.map(o=>o===old ? {...old,title:next.title,description:next.description,centerId:next.centerId,
          coreTaskId:next.coreTaskId,amountCents:next.amountCents,firstDate:next.firstDate,endDate:next.endDate,cadence:next.cadence,
          kind:old.kind==='investment'?old.kind:next.kind,incomeType:next.incomeType,updatedAt:now} : o);
      } else {
        created = added.map((entry) => entry.id);
        operations = [...budget.operations, ...added];
      }
    } else {
      operations = budget.operations;
      for (const item of body?.items === undefined ? [body] : batch(body.items)) {
        const operation = operations.find(
          (entry) =>
            entry.id === item?.operationId && entry.budgetProjectId === targetBudgetId,
        );
        const settlement = bpmSettlementOf(item, operation, localBudgetToday());
        operations = operations.map((entry) =>
          entry === operation
            ? { ...entry, settlements: [...entry.settlements, settlement], updatedAt: now }
            : entry,
        );
      }
    }
    const nextBudget = await ctx.budgetBridge.recordFlows({
      revision: budget.revision + 1,
      ...budgetWorkspaceOf({ ...budget, centers: centersList, operations }, now),
    });
    try {
      await ctx.budgetBridge.guardBudget(nextBudget);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    if (body?.preview === true) {
      const [patrimoine, ledger, configuration] = await Promise.all([readPatrimoine(ctx.patrimoineFilePath),ctx.budgetBridge.read(),ctx.effectiveNow()]);
      const links=configuration.tables['budget.patrimoine']??[];
      const link=links.find(l=>l.id===project.linkId);
      const today=localBudgetToday();
      const start=periodStart(today,link?.periodicity??'monthly');
      const end=nextPeriod(start,link?.periodicity??'monthly');
      const inputs={core,bpm,patrimoine,ledger,links,start,end,today};
      const targetLink=links.find(l=>l.budgetProjectId===targetBudgetId && l.enabled==='true' && l.patrimoineProjectId===project.patrimoineProjectId);
      const firstDay=body.date>today?body.date:today;
      const targetClose=targetLink?nextPeriod(periodStart(firstDay>targetLink.startDate?firstDay:targetLink.startDate,targetLink.periodicity),targetLink.periodicity):end;
      const projectionDate=targetClose>end?targetClose:end;
      const previewOf=(source)=>{
        const period=ownerFlowPilot(project,{...inputs,budget:source});
        const horizon=projectionDate===end?period:ownerFlowPilot(project,{...inputs,budget:source,end:projectionDate});
        return {...period,projectedStockCents:horizon.projectedStockCents,nextContributionCents:horizon.nextContributionCents,projectionDate};
      };
      send(response,200,{before:previewOf(budget),after:previewOf(nextBudget)});
      return;
    }
    await backupPrevious(ctx.budgetFilePath, budget);
    await bpmStorage.write(ctx.budgetFilePath, nextBudget);
    await ctx.prune(ctx.budgetFilePath, false).catch(() => undefined);
    // Les identifiants créés permettent d'annuler aussitôt une saisie depuis l'interface.
    send(response, remove || detail ? 200 : 201, {
      ...(await presentBpm(ctx, bpm, manager)),
      ...(created.length ? { created } : {}),
    });
  });
}

/** Stock connu après les clôtures de fin de fenêtre, sans valorisation ni versement ultérieur. */
export function statementWealthAtEnd(patrimoine, ledger, projectId, end, today) {
  if (end > today) return undefined;
  const lastDay = new Date(`${end}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return {
    date: end,
    ...lifecycleStanding(
      patrimoine,
      { ...ledger, closures: ledger.closures.filter((closure) => closure.end <= end) },
      projectId,
      lastDay.toISOString().slice(0, 10),
    ),
  };
}

/**
 * Le relevé d'une fenêtre du projet : `start` inclus, `end` exclu, au plus
 * `bpm.releve.joursMax` jours. Lecture seule.
 */
async function statementOf(ctx, projectId, params, manager, withExpenses = false) {
  const start = params.get('start');
  const end = params.get('end');
  if (!isoDate(start) || !isoDate(end) || end <= start)
    throw new HttpError(400, 'Indiquez une période valide : start puis end, au format AAAA-MM-JJ');
  const span = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000;
  if (span > Number(fixedSetting('bpm.releve.joursMax')))
    throw new HttpError(400, 'Le relevé couvre une période trop longue');
  const [bpm, budget, ledger] = await Promise.all([
    readBpm(bpmFileOf(ctx)),
    readBudget(ctx.budgetFilePath),
    ctx.budgetBridge.read(),
  ]);
  let project = bpm.projects.find((entry) => entry.id === projectId);
  if (!project) throw new HttpError(404, 'Projet Budget/Patrimoine introuvable', 'not_found');
  {
    const owner = project.entityId || project.ownerUserId;
    if (withExpenses && params.get('professionnel') === '1') {
      manager = await professionalManager(ctx, manager, owner);
      if (manager.expenseScope) project = { ...project, expenseScope: manager.expenseScope };
    } else {
      const users = await ctx.readUsersSpace(ctx.usersFilePath);
      if (
        isOrganization(users.users.find((u) => u.id === owner)) ||
        budget.budgetProjects.find((b) => b.id === project.budgetProjectId)?.financialScope ===
          'professional'
      )
        throw new HttpError(
          403,
          'Consultez ces dépenses professionnelles dans Mon entreprise.',
          'forbidden',
        );
    }
  }
  if (manager?.userId && (project.entityId || project.ownerUserId) !== manager.userId)
    throw new HttpError(403, 'Ce relevé appartient à un autre utilisateur.', 'forbidden');
  const closures = ledger.closures
    .filter((entry) => entry.budgetProjectId === project.budgetProjectId)
    .sort((a, b) => a.start.localeCompare(b.start));
  const statement = {
    projectId,
    ...bpmStatement({
      budget,
      budgetProjectId: project.budgetProjectId,
      start,
      end,
      closures,
      today: localBudgetToday(),
    }),
  };
  const core = await readWorkspace(ctx.filePath);
  const summaries = budgetCosts(project, { budget, core, bpm, ledger, start, end });
  const budgets = userBudgets(project, { budget, core, bpm });
  if (!withExpenses) {
    const [patrimoine, effective] = await Promise.all([
      readPatrimoine(ctx.patrimoineFilePath),
      ctx.effectiveNow(),
    ]);
    const flowPilot = ownerFlowPilot(project, {
      budget, core, bpm, patrimoine, ledger,
      links: effective.tables['budget.patrimoine'] ?? [],
      start, end, today: statement.today,
    });
    const wealthAtEnd = statementWealthAtEnd(patrimoine, ledger, project.patrimoineProjectId, end, statement.today);
    const flows=kind=>{const result=expenseRegister({budget,core,project,statement,closures:ledger.closures,budgets,kind});return{rows:result.rows,operations:result.operations};};
    return {...statement,flowPilot,...(wealthAtEnd ? {wealthAtEnd} : {}),budgetProjects:summaries,periodFlows:{income:flows('income'),expense:flows('expense')}};
  }
  return expenseRegister({
    budget,
    core,
    project,
    statement,
    closures: ledger.closures,
    budgets,
    summaries,
  });
}

export async function bpmRoutes(ctx, request, response, path) {
  if (path === '/api/bpm/workspace' && request.method === 'GET') {
    let manager = await managerOf(ctx, request);
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const readingDate = params.get('lecture');
    if (readingDate && (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate) || !Number.isFinite(Date.parse(readingDate)) || new Date(readingDate).toISOString().slice(0, 10) !== readingDate))
      throw new HttpError(400, 'Date de lecture invalide.');
    if (params.get('professionnel') === '1')
      manager = await professionalManager(ctx, manager, params.get('entreprise'));
    send(response, 200, {
      ...(await presentBpm(ctx, await readBpm(bpmFileOf(ctx)), manager, readingDate)),
      professionalEntities: manager.businesses ?? [],
      professionalBillingAllowed: manager.billingAllowed === true,
    });
    return true;
  }
  const expenses = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/expenses$/.exec(path);
  const statement = STATEMENT_PATH.exec(path) ?? expenses;
  if (statement && request.method === 'GET') {
    const manager = await managerOf(ctx, request);
    send(
      response,
      200,
      await statementOf(
        ctx,
        statement[1],
        new URL(request.url ?? '/', 'http://localhost').searchParams,
        manager,
        !!expenses,
      ),
    );
    return true;
  }
  const lifecycle = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/patrimoine-lifecycle$/.exec(
    path,
  );
  const detach = /^\/api\/bpm\/projects\/([A-Za-z0-9_-]{1,80})\/budget-projects\/([A-Za-z0-9_-]{1,80})$/.exec(path);
  const vision = VISION_PATH.exec(path);
  const flow = FLOW_PATH.exec(path);
  const writes =
    (detach && request.method === 'DELETE') ||
    (flow && request.method === 'POST') ||
    (flow && request.method === 'DELETE' && flow[2] !== 'transfers') ||
    (flow && request.method === 'PATCH' && flow[2] === 'flows') ||
    (path === '/api/bpm/projects' && request.method === 'POST') ||
    (path === '/api/bpm/assemblies' && request.method === 'POST') ||
    (path === '/api/bpm/assembly' && request.method === 'PATCH') ||
    (lifecycle && request.method === 'POST') ||
    (vision && request.method === 'PUT') ||
    (path === '/api/bpm/inflation' && request.method === 'PUT');
  if (!writes) return false;
  if (!localOrigin(request.headers.origin))
    throw new HttpError(403, 'Origin must be local', 'forbidden_origin');
  const manager = await managerOf(ctx, request);
  const body = await jsonBody(request);
  const bpmFile = bpmFileOf(ctx);
  if(detach) {
    await ctx.enqueue(async()=>{
      const [bpm,budget,core,patrimoine,ledger]=await Promise.all([readBpm(bpmFile),readBudget(ctx.budgetFilePath),readWorkspace(ctx.filePath),readPatrimoine(ctx.patrimoineFilePath),ctx.budgetBridge.read()]);
      if(body.revision!==bpm.revision){send(response,409,{error:'revision_conflict',workspace:await presentBpm(ctx,bpm,manager)});return;}
      const standard=bpm.projects.find(p=>p.id===detach[1]);
      if(!standard)throw new HttpError(404,'Projet standard introuvable.');
      const links=(await ctx.effectiveNow()).tables['budget.patrimoine']??[];
      const next=detachBudgetProject(standard,detach[2],{bpm,budget,core,links,actorId:manager.userId});
      validateBudgetLinks(next.links,budget,patrimoine,ledger,localBudgetToday());
      await backupPrevious(bpmFile,bpm);
      // Arrêter d'abord les clôtures, puis retirer les rattachements ; restauration si écriture refusée.
      try {
        await ctx.storeModuleParameters(before=>({tables:{...before.tables,'budget.patrimoine':next.links}}));
        await bpmStorage.write(bpmFile,next.bpm);
      } catch(error) {
        await bpmStorage.write(bpmFile,bpm);
        await ctx.storeModuleParameters(before=>({tables:{...before.tables,'budget.patrimoine':links}}));
        throw error;
      }
      send(response,200,await presentBpm(ctx,next.bpm,manager));
    });
    return true;
  }
  if (flow) {
    await budgetFlow(ctx, response, {
      kind: flow[2],
      projectId: flow[1],
      body,
      manager,
      remove: request.method === 'DELETE',
      detail: request.method === 'PATCH',
    });
    return true;
  }
  if (lifecycle) {
    await ctx.enqueue(async () => {
      const [bpm, patrimoine, ledger] = await Promise.all([
        readBpm(bpmFile),
        readPatrimoine(ctx.patrimoineFilePath),
        ctx.budgetBridge.read(),
      ]);
      const project = bpm.projects.find((item) => item.id === lifecycle[1]);
      if (!project || project.ownerUserId !== manager.userId)
        throw new HttpError(403, 'Seul le propriétaire peut gérer ce patrimoine.', 'forbidden');
      if (body.patrimoineRevision !== patrimoine.revision) {
        send(response, 409, {
          error: 'revision_conflict',
          message: 'Le patrimoine a changé. Relisez les valeurs actualisées avant de confirmer.',
          workspace: await presentBpm(ctx, bpm, manager),
        });
        return;
      }
      const wealth = patrimoine.projects.find((item) => item.id === project.patrimoineProjectId);
      if (!wealth || wealth.entityId !== project.entityId)
        throw new HttpError(400, 'Patrimoine du propriétaire direct requis.');
      const now = new Date().toISOString();
      const allocations = patrimoine.allocations.filter((item) => item.projectId === wealth.id);
      const totalCents = lifecycleStanding(
        patrimoine,
        ledger,
        wealth.id,
        localBudgetToday(),
      ).totalCents;
      if (
        ['allocate', 'validate-allocations'].includes(body.action) &&
        body.expectedTotalCents !== totalCents
      ) {
        send(response, 409, {
          error: 'revision_conflict',
          message: 'La valeur du patrimoine a changé. Relisez le stock avant de confirmer.',
          workspace: await presentBpm(ctx, bpm, manager),
        });
        return;
      }
      const nextLifecycle = lifecycleAction(wealth.lifecycle, body, {
        totalCents,
        allocations,
        now,
      });
      const plan =
        body.action === 'validate-allocations'
          ? new Map(nextLifecycle.allocationPlan.map((item) => [item.id, item.targetCents]))
          : new Map();
      const next = {
        ...patrimoine,
        revision: patrimoine.revision + 1,
        projects: patrimoine.projects.map((item) =>
          item.id === wealth.id ? { ...item, lifecycle: nextLifecycle, updatedAt: now } : item,
        ),
        allocations: patrimoine.allocations.map((item) =>
          plan.has(item.id) ? { ...item, targetCents: plan.get(item.id), updatedAt: now } : item,
        ),
      };
      await backupPrevious(ctx.patrimoineFilePath, patrimoine);
      await bpmStorage.write(ctx.patrimoineFilePath, next);
      await ctx.prune(ctx.patrimoineFilePath, false).catch(() => undefined);
      send(response, 200, await presentBpm(ctx, bpm, manager));
    });
    return true;
  }
  if (vision) {
    const next = bpmVisionOf(body?.vision);
    await ctx.enqueue(async () => {
      const bpm = await readBpm(bpmFile);
      if (body.revision !== bpm.revision) {
        send(response, 409, {
          error: 'revision_conflict',
          workspace: await presentBpm(ctx, bpm, manager),
        });
        return;
      }
      const project = bpm.projects.find((entry) => entry.id === vision[1]);
      if (!project) throw new HttpError(404, 'Projet Budget/Patrimoine introuvable', 'not_found');
      if (project.ownerUserId && project.ownerUserId !== manager.userId)
        throw new HttpError(
          403,
          'Seul le gestionnaire du projet peut modifier sa vision',
          'forbidden',
        );
      if (next.surplusGoal) {
        const links = (await ctx.effectiveNow()).tables['budget.patrimoine'] ?? [];
        const link = links.find((item) => item.id === project.linkId);
        if (
          !link ||
          (periodStart(next.surplusGoal.startDate, link.periodicity) !==
            next.surplusGoal.startDate &&
            next.surplusGoal.startDate !== link.startDate)
        )
          throw new HttpError(400, 'Le cumul doit commencer au début d’une période budgétaire.');
      }
      const patrimoine = await readPatrimoine(ctx.patrimoineFilePath);
      assertVisionAllocations(next, project.patrimoineProjectId, patrimoine);
      const nextBpm = {
        ...bpm,
        revision: bpm.revision + 1,
        projects: bpm.projects.map((entry) =>
          entry.id === project.id ? { ...entry, vision: next } : entry,
        ),
      };
      await writeBpm(ctx, bpmFile, bpm, nextBpm);
      send(response, 200, await presentBpm(ctx, nextBpm, manager));
    });
    return true;
  }
  if (path === '/api/bpm/inflation') {
    const inflation = bpmInflationOf(body?.inflation);
    await ctx.enqueue(async () => {
      const bpm = await readBpm(bpmFile);
      if (body.revision !== bpm.revision) {
        send(response, 409, {
          error: 'revision_conflict',
          workspace: await presentBpm(ctx, bpm, manager),
        });
        return;
      }
      const nextBpm = { ...bpm, revision: bpm.revision + 1, inflation };
      await writeBpm(ctx, bpmFile, bpm, nextBpm);
      send(response, 200, await presentBpm(ctx, nextBpm, manager));
    });
    return true;
  }
  if (path === '/api/bpm/assembly') {
    await relink(ctx, response, { body, changes: assemblyChangesOf(body), bpmFile, manager });
    return true;
  }
  const today = localBudgetToday();
  if (path === '/api/bpm/assemblies') {
    // L'atelier d'assemblage : plusieurs assemblages du même geste, tous validés avant d'écrire.
    const list = body?.assemblies;
    const max = Number(fixedSetting('bpm.assemblage.lotMax'));
    if (!Array.isArray(list) || !list.length)
      throw new HttpError(400, 'Ajoutez au moins un assemblage');
    if (list.length > max) throw new HttpError(400, `Au plus ${max} assemblages en un geste`);
    const inputs = list.map((entry) => bpmAssemblyOf({ ...entry, mode: 'assemble' }));
    await assemble(ctx, response, { body, inputs, manager, bpmFile, today });
    return true;
  }
  const input = bpmCreationOf(body, today);
  if (input.mode === 'assemble') {
    await assemble(ctx, response, { body, inputs: [input], manager, bpmFile, today });
    return true;
  }
  await ctx.enqueue(async () => {
    const [core, budget, patrimoine, bpm, ledger] = await Promise.all([
      readWorkspace(ctx.filePath),
      readBudget(ctx.budgetFilePath),
      readPatrimoine(ctx.patrimoineFilePath),
      readBpm(bpmFile),
      ctx.budgetBridge.read(),
    ]);
    if (body.revision !== bpm.revision) {
      send(response, 409, {
        error: 'revision_conflict',
        workspace: await presentBpm(ctx, bpm, manager),
      });
      return;
    }
    if (input.vision.goals.some((goal) => goal.allocationId))
      throw new HttpError(
        400,
        'Rattachez les objectifs aux allocations après la création du patrimoine',
      );
    const entityId = entityOf(input, manager, await ctx.readUsersSpace(ctx.usersFilePath));
    const existingWealth = entityWealth(entityId, patrimoine, bpm);
    const now = new Date().toISOString();
    const ids = {
      core: shortId('BPM'),
      wealthCore: existingWealth?.coreProjectId ?? shortId('BPM-P'),
      budget: shortId('PBM'),
      center: shortId('CC'),
      person: shortId('PERS'),
      patrimoine: existingWealth?.id ?? shortId('PPM'),
      allocation: shortId('ALLOC'),
      link: shortId('LIEN'),
    };
    // 1. Tout est construit et validé par les validateurs des modules, sans rien écrire.
    const coreProjects = projectsOf(
      [
        ...core.projects,
        {
          id: ids.core,
          ...(entityId ? { entityId } : {}),
          title: input.title,
          summary: input.summary,
          owner: 'RJS',
          priority: 'medium',
          startDate: input.startDate,
          dueDate: '',
          createdAt: now,
          updatedAt: now,
        },
        ...(!existingWealth
          ? [
              {
                id: ids.wealthCore,
                entityId: entityId || null,
                title: `${input.patrimoineTitle} · ${ids.wealthCore}`,
                summary: 'Cadre dédié au patrimoine unique.',
                owner: 'RJS',
                priority: 'medium',
                startDate: input.startDate,
                dueDate: '',
                createdAt: now,
                updatedAt: now,
              },
            ]
          : []),
      ],
      now,
    ).projects;
    const nextCore = { ...core, revision: core.revision + 1, projects: coreProjects };
    let nextBudget = {
      revision: budget.revision + 1,
      ...budgetWorkspaceOf(
        {
          ...budget,
          budgetProjects: [
            ...budget.budgetProjects,
            {
              id: ids.budget,
              title: input.budgetTitle,
              description: input.summary,
              centerId: ids.center,
              coreProjectId: ids.core,
              entityId: entityId || null,
              plannedBudgetCents: null,
              taskAllocations: [],
              startDate: input.startDate,
              dueDate: '',
              createdAt: now,
              updatedAt: now,
            },
          ],
          centers: [
            ...budget.centers,
            {
              id: ids.center,
              budgetProjectId: ids.budget,
              name: input.centerName,
              description: '',
              group: 'everyday',
              limitCents: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
          // Un seul gestionnaire : il est aussi l'unique bénéficiaire des opérations du PBM.
          people: [
            ...budget.people,
            {
              id: ids.person,
              budgetProjectId: ids.budget,
              name: manager.label,
              relationship: 'self',
              note: 'Gestionnaire unique du projet Budget/Patrimoine.',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        now,
      ),
    };
    let nextPatrimoine = existingWealth
      ? patrimoine
      : {
          version: 1,
          revision: patrimoine.revision + 1,
          ...patrimoineWorkspaceOf(
            {
              ...patrimoine,
              projects: [
                ...patrimoine.projects,
                {
                  id: ids.patrimoine,
                  title: input.patrimoineTitle,
                  coreProjectId: ids.wealthCore,
                  entityId: entityId || null,
                  allocationId: ids.allocation,
                  note: input.summary,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              allocations: [
                ...patrimoine.allocations,
                {
                  id: ids.allocation,
                  projectId: ids.patrimoine,
                  name: input.allocationName,
                  note: '',
                  targetCents: null,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
            now,
          ),
        };
    if (existingWealth)
      nextPatrimoine = {
        ...patrimoine,
        projects: patrimoine.projects.map((p) =>
          p.id === existingWealth.id ? { ...p, entityId } : p,
        ),
      };
    const detailed = creationDetails({
      input,
      ids,
      budget: nextBudget,
      patrimoine: nextPatrimoine,
      now,
      today,
      reuseWealth: !!existingWealth,
    });
    nextBudget = await ctx.budgetBridge.recordFlows(detailed.budget);
    nextPatrimoine = detailed.patrimoine;
    input.vision = detailed.vision;
    const link = {
      id: ids.link,
      budgetProjectId: ids.budget,
      patrimoineProjectId: ids.patrimoine,
      periodicity: input.periodicity,
      startDate: input.startDate,
      enabled: 'true',
    };
    const previousLinks = (await ctx.effectiveNow()).tables['budget.patrimoine'] ?? [];
    validateBudgetLinks([...previousLinks, link], nextBudget, nextPatrimoine, ledger, today);
    const nextBpm = {
      version: 1,
      revision: bpm.revision + 1,
      projects: [
        ...bpm.projects,
        {
          id: shortId('BPMP'),
          title: input.title,
          coreProjectId: ids.core,
          patrimoineCoreProjectId: ids.wealthCore,
          budgetProjectId: ids.budget,
          patrimoineProjectId: ids.patrimoine,
          linkId: ids.link,
          ownerUserId: manager.userId,
          entityId,
          entityType: input.entityType ?? input.profile ?? null,
          createdAt: now,
          profile: input.profile ?? null,
          vision: input.vision,
        },
      ],
      inflation: bpm.inflation,
    };

    nextBpm.projects=includeBpmProjects(nextBpm.projects,nextBpm.projects.filter(p=>!bpm.projects.some(old=>old.id===p.id)));

    // 2. Écriture groupée : en cas d'échec, les espaces déjà écrits reviennent à leur état antérieur.
    const written = [];
    const writeSpace = async (file, previous, next) => {
      await backupPrevious(file, previous);
      await bpmStorage.write(file, next);
      written.push({ file, previous, next });
    };
    let linkStored = false;
    try {
      await writeSpace(ctx.filePath, core, nextCore);
      await writeSpace(ctx.budgetFilePath, budget, nextBudget);
      await writeSpace(ctx.patrimoineFilePath, patrimoine, nextPatrimoine);
      await ctx.storeModuleParameters((before) => ({
        tables: {
          ...before.tables,
          'budget.patrimoine': [...(before.tables['budget.patrimoine'] ?? []), link],
        },
      }));
      linkStored = true;
      await writeSpace(bpmFile, bpm, nextBpm);
    } catch (error) {
      if (linkStored)
        await ctx
          .storeModuleParameters((before) => ({
            tables: {
              ...before.tables,
              'budget.patrimoine': (before.tables['budget.patrimoine'] ?? []).filter(
                (entry) => entry.id !== link.id,
              ),
            },
          }))
          .catch(() => undefined);
      for (const { file, previous, next } of written.reverse())
        await bpmStorage
          .write(file, { ...previous, revision: next.revision + 1 })
          .catch(() => undefined);
      throw error;
    }
    for (const { file } of written) await ctx.prune(file, false).catch(() => undefined);
    await settleLater(ctx);
    send(response, 201, await presentBpm(ctx, nextBpm, manager));
  });
  return true;
}

/**
 * Assembler des PBM et des PPM existants, chacun avec un PBM et un PPM du même
 * projet du noyau : rien n'est écrit dans le noyau, Budget ni Patrimoine. Seules
 * les liaisons du cycle (si elles n'existent pas déjà) et les projets BPM sont
 * enregistrés, tous ensemble ou pas du tout.
 */
async function assemble(ctx, response, { body, inputs, manager, bpmFile, today }) {
  await ctx.enqueue(async () => {
    const [core, budget, patrimoine, bpm, ledger] = await Promise.all([
      readWorkspace(ctx.filePath),
      readBudget(ctx.budgetFilePath),
      readPatrimoine(ctx.patrimoineFilePath),
      readBpm(bpmFile),
      ctx.budgetBridge.read(),
    ]);
    if (body.revision !== bpm.revision) {
      send(response, 409, {
        error: 'revision_conflict',
        workspace: await presentBpm(ctx, bpm, manager),
      });
      return;
    }
    const links = (await ctx.effectiveNow()).tables['budget.patrimoine'] ?? [];
    const originalBudget = structuredClone(budget),
      originalPatrimoine = structuredClone(patrimoine);
    const users = await ctx.readUsersSpace(ctx.usersFilePath);
    const usedBudgets = new Set(),
      createdLinks = [],
      projects = [];
    for (const input of inputs) {
      const entityId = entityOf(input, manager, users);
      const canonical = entityWealth(entityId, patrimoine, bpm);
      if (canonical && input.patrimoineProjectId && input.patrimoineProjectId !== canonical.id)
        throw new HttpError(409, 'Utilisez le patrimoine de référence de cette entité');
      const coreProject = core.projects.find((entry) => entry.id === input.coreProjectId);
      if (!coreProject) throw new HttpError(400, 'Le projet du noyau est introuvable');
      const pbm = budget.budgetProjects.find(
        (entry) => entry.id === input.budgetProjectId && entry.coreProjectId === coreProject.id,
      );
      if (!pbm)
        throw new HttpError(400, 'Le projet budgétaire doit appartenir à ce projet du noyau');
      if (!ownsBudget(pbm, manager.userId, bpm, core))
        throw new HttpError(
          403,
          'Ce budget appartient à une autre identité ou doit être affecté depuis son module source',
        );
      const ppm = patrimoine.projects.find(
        (entry) => entry.id === (canonical?.id ?? input.patrimoineProjectId),
      );
      if (!ppm) throw new HttpError(400, 'Choisissez le patrimoine unique du même utilisateur');
      if (usedBudgets.has(pbm.id))
        throw new HttpError(
          400,
          'Un budget ne peut entrer que dans un seul assemblage',
          'duplicate_source',
        );
      usedBudgets.add(pbm.id);
      bindEntity(entityId, pbm, ppm, patrimoine, bpm);
      assertVisionAllocations(input.vision, ppm.id, patrimoine);
      if (bpm.projects.some((entry) => entry.budgetProjectId === pbm.id))
        throw new HttpError(
          409,
          'Ce budget fait déjà partie d’un projet Budget/Patrimoine',
          'already_assembled',
        );
      const problems = assemblyProblems(pbm, ppm, { budget, patrimoine, bpm, links });
      if (problems.length) throw new HttpError(400, ASSEMBLY_PROBLEMS[problems[0]]);
      let link = assemblyLink(links, pbm.id, ppm.id);
      if (!link) {
        let resumeStart=cycleStartOf(input.periodicity,input.startDate,today);
        const lastEnd=ledger.closures.filter(c=>c.budgetProjectId===pbm.id).map(c=>c.end).sort().at(-1);
        if(lastEnd && resumeStart<lastEnd){
          resumeStart=periodStart(lastEnd,input.periodicity);
          if(resumeStart<lastEnd)resumeStart=nextPeriod(resumeStart,input.periodicity);
        }
        link = {
          id: shortId('LIEN'),
          budgetProjectId: pbm.id,
          patrimoineProjectId: ppm.id,
          periodicity: input.periodicity,
          startDate: resumeStart,
          enabled: 'true',
        };
        createdLinks.push(link);
      }
      projects.push({
        id: shortId('BPMP'),
        title: input.title || coreProject.title,
        coreProjectId: coreProject.id,
        patrimoineCoreProjectId: ppm.coreProjectId,
        budgetProjectId: pbm.id,
        patrimoineProjectId: ppm.id,
        linkId: link.id,
        ownerUserId: manager.userId,
        entityId,
        entityType: input.entityType ?? input.profile ?? null,
        createdAt: new Date().toISOString(),
        profile: input.profile ?? null,
        vision: input.vision,
      });
    }
    if (createdLinks.length)
      validateBudgetLinks([...links, ...createdLinks], budget, patrimoine, ledger, today);
    const nextBpm = {
      version: 1,
      revision: bpm.revision + 1,
      projects: [...includeBpmProjects(bpm.projects,projects), ...projects],
      inflation: bpm.inflation,
    };
    const createdIds = new Set(createdLinks.map((link) => link.id));
    const nativeChanged =
      JSON.stringify(originalBudget) !== JSON.stringify(budget) ||
      JSON.stringify(originalPatrimoine) !== JSON.stringify(patrimoine);
    if (nativeChanged) await backupPrevious(ctx.budgetFilePath, originalBudget);
    if (nativeChanged) await backupPrevious(ctx.patrimoineFilePath, originalPatrimoine);
    try {
      if (nativeChanged)
        await bpmStorage.write(ctx.budgetFilePath, { ...budget, revision: budget.revision + 1 });
      if (nativeChanged)
        await bpmStorage.write(ctx.patrimoineFilePath, {
          ...patrimoine,
          revision: patrimoine.revision + 1,
        });
      if (createdLinks.length)
        await ctx.storeModuleParameters((before) => ({
          tables: {
            ...before.tables,
            'budget.patrimoine': [...(before.tables['budget.patrimoine'] ?? []), ...createdLinks],
          },
        }));
      await writeBpm(ctx, bpmFile, bpm, nextBpm);
    } catch (error) {
      await bpmStorage.write(ctx.budgetFilePath, originalBudget);
      await bpmStorage.write(ctx.patrimoineFilePath, originalPatrimoine);
      if (createdLinks.length)
        await ctx
          .storeModuleParameters((before) => ({
            tables: {
              ...before.tables,
              'budget.patrimoine': (before.tables['budget.patrimoine'] ?? []).filter(
                (entry) => !createdIds.has(entry.id),
              ),
            },
          }))
          .catch(() => undefined);
      throw error;
    }
    await settleLater(ctx);
    send(response, 201, {
      ...(await presentBpm(ctx, nextBpm, manager)),
      created: projects.map((entry) => entry.id),
    });
  });
}

/**
 * Les liaisons de l'atelier : Budget puis Patrimoine sont revalidés par leurs
 * modules et par le garde des clôtures, puis écrits ; si la seconde écriture
 * échoue, la première revient à son état antérieur.
 */
async function relink(ctx, response, { body, changes, bpmFile, manager }) {
  await ctx.enqueue(async () => {
    const [core, budget, patrimoine, bpm] = await Promise.all([
      readWorkspace(ctx.filePath),
      readBudget(ctx.budgetFilePath),
      readPatrimoine(ctx.patrimoineFilePath),
      readBpm(bpmFile),
    ]);
    if (body.revision !== bpm.revision) {
      send(response, 409, {
        error: 'revision_conflict',
        workspace: await presentBpm(ctx, bpm, manager),
      });
      return;
    }
    const usedBudgets = new Set(bpm.projects.map((entry) => entry.budgetProjectId));
    const usedPatrimoines = new Set(bpm.projects.map((entry) => entry.patrimoineProjectId));
    const free = {
      budgets: new Set(
        budget.budgetProjects
          .filter((e) => !e.id.startsWith('FOR-') && ownsBudget(e, manager.userId, bpm, core))
          .map((e) => e.id),
      ),
      core: new Set(
        core.projects
          .filter((p) => (manager.userId ? p.entityId === manager.userId : !p.entityId))
          .map((p) => p.id),
      ),
      tasks: new Set(
        core.tasks
          .filter((t) => (manager.userId ? t.entityId === manager.userId : !t.entityId))
          .map((t) => t.id),
      ),
      patrimoines: new Set(),
    };
    const now = new Date().toISOString();
    const next = applyAssemblyChanges(changes, { core, budget, patrimoine, free, now });
    const nextBudget = next.budget && {
      revision: budget.revision + 1,
      ...budgetWorkspaceOf(next.budget, now),
    };
    const nextPatrimoine = next.patrimoine && {
      version: 1,
      revision: patrimoine.revision + 1,
      ...patrimoineWorkspaceOf(next.patrimoine, now),
    };
    try {
      if (nextBudget) await ctx.budgetBridge.guardBudget(nextBudget);
      if (nextPatrimoine) await ctx.budgetBridge.guardPatrimoine(nextPatrimoine);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const nextBpm = { ...bpm, revision: bpm.revision + 1 };
    const writes = [
      ...(next.core
        ? [
            {
              file: ctx.filePath,
              before: core,
              after: { ...next.core, revision: core.revision + 1 },
            },
          ]
        : []),
      ...(nextBudget ? [{ file: ctx.budgetFilePath, before: budget, after: nextBudget }] : []),
      ...(nextPatrimoine
        ? [{ file: ctx.patrimoineFilePath, before: patrimoine, after: nextPatrimoine }]
        : []),
      { file: bpmFile, before: bpm, after: nextBpm },
    ];
    for (const write of writes) await backupPrevious(write.file, write.before);
    const done = [];
    try {
      for (const write of writes) {
        await bpmStorage.write(write.file, write.after);
        done.push(write);
      }
    } catch (error) {
      for (const write of done.reverse()) await bpmStorage.write(write.file, write.before);
      throw error;
    }
    send(response, 200, await presentBpm(ctx, nextBpm, manager));
  });
}

/**
 * Un cycle repris à une date passée clôture aussitôt ses périodes écoulées. La
 * clôture passe par la file des écritures : elle est lancée après la réponse.
 */
async function settleLater(ctx) {
  setTimeout(() => {
    void ctx.budgetBridge
      .settle()
      .catch((error) => console.error('[local-api] budget closure:', error));
  }, 0);
}

function assertVisionAllocations(vision, patrimoineProjectId, patrimoine) {
  const ids = new Set(
    patrimoine.allocations
      .filter((entry) => entry.projectId === patrimoineProjectId)
      .map((entry) => entry.id),
  );
  if (vision.goals.some((goal) => goal.allocationId && !ids.has(goal.allocationId)))
    throw new HttpError(400, 'Chaque objectif doit viser une allocation de ce projet patrimonial');
}
