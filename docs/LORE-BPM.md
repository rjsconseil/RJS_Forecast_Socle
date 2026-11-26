# Le lore de BPM

_17 novembre 2026. La vision de Budget/Patrimoine Management racontée une fois, et le lexique qui en
découle. Chaque écran, onglet, bouton et message emploie ces mots-là, avec ce sens-là, et pas d'autres._

## Le récit

Chaque personne a **un seul projet de vie**. Il est à la fois son budget et la racine de tout le reste.

Le projet de vie avance par **cycle** : une suite de **périodes**, toujours de même longueur, qui
commencent au même **jour d'ancrage**. Pendant une période, des **entrées** arrivent et des
**dépenses** partent. Chacune est d'abord une **échéance** : prévue à une date, pour un montant.
Quand elle a lieu, on la **règle** : elle devient **payée** ou **reçue**.

Les dépenses sont rangées dans des **postes** (logement, alimentation, loisirs…), eux-mêmes découpés
en **catégories**. Un **plafond** fixe ce qu'un poste ou une catégorie peut dépenser sur une période.

À la fin de chaque période, on la **clôture** : son **résultat**, ce qui reste, rejoint le
**patrimoine**, et son **bilan** est enregistré avec ses faits et ses **faits marquants**. Le patrimoine part d'un **point de départ** et grandit cycle après cycle vers un
**cap**. L'**épargne visée** dit ce que chaque période doit lui apporter ; les **objectifs datés**
disent ce qu'il doit permettre, et quand.

Les projets de la vie font **partie intégrante** du projet de vie (voir docs/COMPTABILITE-PROJET-DE-VIE.md). Le projet de vie finance des **projets de la vie** : un voyage, une cuisine, un vélo. Il
leur **attribue** une **enveloppe**. Chaque projet avance par **tâches**, et chaque tâche reçoit
une **part** de l'enveloppe : on la **répartit**. Une tâche qui a besoin de plus fait une
**demande** ; un projet qui dépasse son enveloppe demande un **dépassement**. Le projet de vie
les **accorde** ou les **refuse**. Un projet est financé par le **cycle** (ses dépenses comptent dans le cycle où elles sont réglées) ou, s'il est long, coûteux ou hors budget du cycle, par le **patrimoine** (ses dépenses y sont **prélevées**, hors de tout cycle).

Projets et tâches se lisent **par statut** : à faire, à prioriser, en cours, terminés. Deux regards : la **vision projets**, quand on sait sur quel projet travailler, et la **vision tâches**, pour noter, trier et prioriser toutes les tâches de la vie sans raisonner projet par projet. Une tâche peut naître **sans projet** et être **rattachée** plus tard.

Le projet de vie est le **père** de tous les projets de la vie, et il dure autant que l'usage de BPM. Le fil qui relie tout « Mon projet de vie » est **l'argent des projets** : l'enveloppe attribuée devient des parts de tâches, puis des dépenses réglées, qui pèsent sur le cycle, sur les postes et leurs plafonds, et sur le patrimoine. On gère les projets **au quotidien** dans la Gestion du projet de vie ; « Mes projets de la vie » sert à **consulter** leur état à date.

Le **calendrier** ne décide rien : il **reflète**, à leur date, les échéances, les fins de période
et les étapes des projets.

## Le lexique des actions

Un verbe, un sens. Un bouton commence toujours par l'un de ces verbes.

| Verbe | Sens | Exemples d'écran |
| --- | --- | --- |
| **Ouvrir** | Afficher un objet ou une page pour le lire ou agir dessus | Ouvrir le projet, Ouvrir le tableau de bord |
| **Saisir** | Ajouter une entrée ou une dépense | Saisir une entrée, Saisir une dépense |
| **Régler** | Marquer une échéance payée ou reçue (boutons « Payé » / « Reçu ») | Régler le retard, Échéances à régler |
| **Créer** | Faire naître un projet, une tâche, un objectif, une catégorie | Créer un projet de la vie |
| **Modifier** | Changer un objet qui existe | Modifier le projet |
| **Fixer** | Donner sa valeur à un repère : ancrage du cycle, plafond, épargne visée, cap, hypothèses | Fixer un plafond, Fixer le cap patrimonial |
| **Attribuer** | Donner une enveloppe à un projet, ou un complément | Attribuer l'enveloppe |
| **Répartir** | Partager une enveloppe entre les tâches | Répartir l'enveloppe |
| **Accorder / Refuser** | Répondre à une demande de part ou de dépassement | Accorder, Refuser |
| **Avancer** | Faire progresser une tâche ou un projet | Avancer les tâches |
| **Rattacher** | Relier une tâche à un projet | Rattacher des tâches |
| **Reporter** | Déplacer une date | Reporter d'un an, Reporter de 7 j |
| **Clôturer** | Fermer une période et verser son résultat au patrimoine | Clôturer la période |
| **Rapprocher** | Comparer le cycle au solde du compte | Rapprocher mes comptes |
| **Retirer** | Ôter un objet de la vue sans en effacer l'histoire | Retirer l'objectif |

Verbes écartés, car ils doublaient un verbe du lexique : *Voir, Consulter, Examiner, Gérer, Piloter*
(→ Ouvrir), *Traiter* (→ Régler ou Ouvrir), *Définir, Ajuster, Configurer, Régler un repère* (→ Fixer),
*Budgéter, Financer* (→ Attribuer), *Décider* (→ Accorder ou refuser), *Faire avancer* (→ Avancer),
*Saisir une charge* (→ Saisir une dépense). Les noms « Décisions attendues » et « Financer et décider »
restent : ils nomment un lieu, pas un geste.

## Le plan, dans ces mots

1. **Vue d'ensemble** → **Synthèse** : à faire maintenant, le cycle, les projets, le calendrier, le patrimoine.
2. **Mon projet de vie** (cycle budgétaire et accumulation du patrimoine)
   - Tableau de bord : vue de la période · registre de flux · rapprochement bancaire
   - Gestion du projet de vie : pilotage du cycle · projets de la vie · échéances à traiter · budget type · suivi et clôture · bilans des cycles · ancrage du cycle
   - Patrimoine et objectifs : objectifs datés · projection · épargne et cap · point de départ
   - Postes, catégories et plafonds : suivi des plafonds · plafonds · catégories · postes et revenus
3. **Mes projets de la vie**
   - Projets par statut · financer et décider : la **vision projets**, un projet à la fois ; sa fiche range ses tâches par statut.
   - Tâches par statut · rattacher des tâches : la **vision tâches**, toutes les tâches de la vie tous projets confondus ; on y note une idée sans projet (pense-bête), on priorise entre projets, on rattache plus tard.
4. **Calendrier** : le reflet.

Le lexique est aussi dans le code : `web/src/app/bpm/ui/lexicon.ts`. Un test refuse les verbes écartés
dans les libellés d'action de BPM.
