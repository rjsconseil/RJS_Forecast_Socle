# BPM — Mon projet de vie, première étape

Le point d'entrée de BPM est `/projet-de-vie`. Une seule section principale visible, **MPV - Mon projet de vie**, porte toutes les pages métier. La section de démarrage reste disponible aux visiteurs.

## Pages et sous-pages

| Page | Adresse | Sous-pages et outils |
| --- | --- | --- |
| Mon projet de vie | `/projet-de-vie` | Vue d’ensemble, échéances, budget type, clôture, bilans, ancrage du cycle |
| Tableau de bord | `/tableau-de-bord` | Vue de la période, registre des flux, rapprochement bancaire |
| Projets de la vie | `/projet-de-vie/projets` | Cockpit et tableau par statut, financement et décisions, fiches des projets |
| Tâches par statut | `/app/taches` | Tableau global, création, rattachement à un projet existant |
| Calendrier | `/calendrier-budget` | Calendrier partagé, agenda et replanification |
| Patrimoine et objectifs | `/vision` | Objectifs, projection, épargne et cap, point de départ |
| Postes, catégories et plafonds | `/plafonds` | Suivi, plafonds, catégories, postes et revenus |

Les anciennes sections conservent leurs identifiants et leurs noms préfixés : MPV - Vue d’ensemble, MPV - Projets de la vie, MPV - Calendrier. Elles sont masquées et redirigent vers leur destination intégrée. Elles ne déclarent plus de pages en double.

## Un seul moteur de navigation

La déclaration `bpm.application.ts` demeure la source de vérité : Section → Page → Sous-page → sections de contenu / actions. Aucun menu BPM parallèle n’est ajouté.

- `PlanZone.home` désigne l’accueil intégré.
- `PlanSection.homePage` maintient cet accueil en tête même en présence d’un ordre enregistré avant la refonte ; les autres pages restent ordonnables.
- `hidden` et `redirectTo` conservent les anciens repères sans les exposer dans les menus.
- `ApplicationObject.home` est la liste ; `base` conserve les adresses des fiches. Les projets sont listés dans `/projet-de-vie/projets` et leurs fiches restent sous `/app/gestion-projet/:id`, avec les onglets budget et tâches.
- Le catalogue, les accès rapides, les fils d’Ariane, les modèles de fiches et la simulation Navigation system utilisent cette même structure. `defaultHome` transmet l’accueil déclaré au générateur de simulation.
- Les alias de listes conservent le contexte des favoris et de l’historique. Les redirections Angular conservent paramètres et fragments. Les anciennes ancres de synthèse sont traduites vers les sections de l’accueil central.

## Cockpit de gestion de projet

La liste canonique affiche création de projet/tâche, rattachement, autorisations, moyens et priorités cliquables. Une tâche peut être créée depuis une carte avec son projet présélectionné. Chaque carte propose sa prochaine action. Le projet de vie lui-même reste à l’accueil, sans carte en double dans la liste des projets de la vie.

La fiche projet et ses sous-vues disposent d’un poste de pilotage commun : tâche sélectionnée, statut, dates et temps, part de budget, dépenses et gains, enveloppe, demandes et prochains règlements. Les actions ouvrent les formulaires et commandes existants. Les fenêtres de détail se retrouvent après édition.

L’accueil central conserve les indicateurs et actions du cycle, les volets détaillés, les moyens des projets, le patrimoine et la reprise d’activité. Il intègre une synthèse des tâches et les prochains événements du calendrier partagé.

## Règles conservées

Attribuer une enveloppe ou une part de tâche ne débite ni le cycle ni le patrimoine. Les dépenses et gains sont saisis depuis une tâche, puis suivent leur validation et leur source de financement. Cette étape de refonte ne modifie ni les commandes comptables ni les données enregistrées.

## Deuxième section et deux cockpits — évolution validée

La demande suivante fait évoluer la première étape : BPM possède désormais deux sections principales.

1. **MPV - Mon projet de vie** : cockpit de vie à `/projet-de-vie`, pilotage détaillé, tableau de bord et flux, patrimoine, plafonds, calendrier.
2. **MPV - Gestion de projet** : accueil `/app/gestion-projet`, liste canonique `/projet-de-vie/projets`, tâches globales, pilotage du cycle spécialisé, planning de gestion et agenda.

Le nouveau cockpit commun est décliné selon son accueil : cycle/échéances/patrimoine pour la vie, conduite des projets pour la gestion. Il présente séparément les enveloppes réservées, les coûts nets validés imputés au cycle et les mouvements sur le patrimoine pendant la période. Les retards et décisions courantes sont explicitement distingués des chiffres du cycle consulté.

Trois vagues ont été réalisées : structure et lecture croisée ; commandes de tâche et réglage du temps ; spécialisation des deux accueils, compacité et vérifications. Les six volets de l’ancien accueil restent dans `/projet-de-vie/pilotage`. Les liens `expanded`, `entry` et les anciennes ancres y sont repris.

Les potentiomètres partagent le composant `BpmDial` : glissement, flèches clavier, boutons +/− et saisie précise. Le cockpit des projets règle l’enveloppe ; la fiche règle la part et les temps ; les accueils règlent le temps de la tâche sélectionnée. Tout réglage prépare un brouillon. L’enregistrement exige le bouton d’application et transmet la révision lue. Les boutons de statut exécutent la commande choisie. Aucune nouvelle mécanique comptable n’est créée.
