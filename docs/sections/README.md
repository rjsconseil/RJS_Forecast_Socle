# Documentation par section : plan

> **Statut : squelette.** Ce dossier fixe la manière dont le site sera documenté.
> Les fiches se rempliront au fil du développement de chaque section ; rien n'y est encore livré.

## Le modèle documenté : trois étages

BPM-Astra est **un seul site** (une application, une API, une base). Il se lit en trois étages.

| Étage | Ce qu'il contient | Où dans le code | Rythme |
|---|---|---|---|
| **1. Le grand noyau (socle)**<br>*« les fonctionnalités communes à tout le site »* | Le noyau technique et les middlewares communs (Budget, Patrimoine, Cycle, Calendrier, Navigation), derrière **une seule interface**. Fonctionnalités transverses et simples, prêtes à l'emploi pour toutes les sections. | API et base ; côté site, l'interface unique [`platform/grand-noyau.ts`](../../web/src/app/platform/grand-noyau.ts) | Stable ; n'évolue qu'en mode socle |
| **2. Les fonctionnalités par section**<br>*« zones de fonctionnalités par section »* | Une par section : les fonctions propres à la section (calculs, règles), séparées de tout écran | `web/src/app/sections/<clé>/fonctionnalites/`, données `<préfixe>_` | Au long cours, section par section |
| **3. Les applications autonomes**<br>*« les applications autonomes ou hybrides »* | L'application autonome de chaque section, et les applications autonomes hybrides qui reprennent des fonctionnalités de plusieurs sections | `web/src/app/sections/<clé>/application/` et `web/src/app/hybrides/<nom>/` | Au long cours, pour un public averti (semi-professionnel, professionnel) |

C'est la même architecture que celle du grand noyau, reprise un étage au-dessus :

| Grand noyau (aujourd'hui) | Site par sections (trois étages) | Point commun |
|---|---|---|
| Noyau (objets, registre, partitions) | Grand noyau (socle) : *les fonctionnalités communes à tout le site* | La base stable, qui ne connaît pas ce qui est construit dessus |
| Couche middleware (Budget, Patrimoine, Cycle, Calendrier, Navigation) | Couche middleware : *zones de fonctionnalités par section* | Les règles et calculs métier, sans écran, qui n'appellent que l'étage du dessous |
| Couche présentation BPM-Astra | Couche présentation : *les applications autonomes ou hybrides* | Les écrans, qui assemblent les étages du dessous |

Différence actuelle : les fonctionnalités par section sont pour l'instant des calculs côté site, sur les lectures du grand
noyau. Le jour où une section aura ses propres données (tables `<préfixe>_`), ses fonctionnalités auront aussi une partie
côté serveur, comme un middleware ; l'emplacement prévu pour elles dans l'API est une évolution du grand noyau (mode socle).

Règles d'appel, vérifiées par les tests de garde (`api/test/application-isolation.test.mjs`) :

- les **fonctionnalités d'une section** n'appellent que le grand noyau (par son interface unique) et les fonctionnalités d'autres sections ; elles ne contiennent aucun écran ;
- une **application autonome** appelle le grand noyau, les fonctionnalités d'une ou plusieurs sections, et le cadre d'accueil BPM-Astra
  ([`astra/cadre.ts`](../../web/src/app/astra/cadre.ts)) ; jamais une autre application ;
- tout fichier de `sections/` ou `hybrides/` appartient aux fonctionnalités d'une section ou à une application autonome.

Une application hybride (un peu de Mes projets, un peu de Mon budget) appelle ainsi les fonctionnalités de deux sections sans dépendre
des écrans de leurs sections. Les écrans existants de BPM-Astra restent où ils sont ; ils rejoignent ces étages au fil du
développement de chaque section.

Règles de documentation :

1. Une fonctionnalité **propre à une section** se documente dans la fiche de cette section, jamais dans le grand noyau.
2. Une fonctionnalité **ajoutée au grand noyau** se documente dans [`../socle/`](../socle/README.md), avec ses effets sur les cinq sections. La fiche de la section qui l'a demandée renvoie vers elle.
3. Une section ne réécrit pas le grand noyau. Elle dit ce qu'elle en utilise, et le lien suffit.

## Deux modes de développement

Le grand noyau (socle) offre une interface unique (lectures, commandes, composants communs) au service des fonctionnalités par section et des
applications autonomes qui l'entourent.

| | **Mode section** | **Mode socle** |
|---|---|---|
| Quand | La fonctionnalité ne demande rien que le socle n'offre déjà | La fonctionnalité a besoin d'une fondation que le socle n'a pas |
| Où | Fonctionnalités `sections/<clé>/fonctionnalites/` et application autonome `sections/<clé>/application/`, données `<préfixe>_` | Le grand noyau seul (API, base, règles, interface `platform/grand-noyau.ts`), **sans aucun développement propre à une section** |
| Règles | Libre : pas d'intégration au socle, pas limité par les règles communes ; seulement les règles de rangement et l'usage du socle par son interface | Toutes les règles communes ; effets décrits sur les cinq sections |
| Validation | Tests de la section | **Non-régression complète** de toutes les fonctionnalités du socle (tests de l'API, du site, de bout en bout, jeux d'essai) |
| Livraison | PR de la section | PR du socle, distincte ; la section ne s'en sert qu'une fois cette PR fusionnée, dans une PR de section suivante |

On ne mélange jamais les deux modes dans une même PR.

## Applications autonomes hybrides

En plus des cinq applications autonomes de section, le site pourra offrir des **applications autonomes hybrides** qui
appellent les fonctionnalités par section de plusieurs sections (par exemple un peu de Mes projets et un peu de Mon budget). Elles reposent sur les
fondations communes du socle : c'est pourquoi une fondation est écrite de façon générique, sans nommer la section qui l'a
fait naître. Une application hybride assemble ; elle ne rend pas une section dépendante d'une autre. Chacune aura sa
fiche, sur le même gabarit, avec en plus la liste des sections dont elle reprend des fonctionnalités.

## Cycle de vie d'une fonctionnalité : la section garde l'application, le grand noyau reçoit les fondations

Les fonctionnalités avancées d'une section **restent dans la section** : elles forment son application autonome (pour
Mes projets, l'application de gestion de projet). Ce qui fait évoluer le socle, ce sont **leurs fondations** : les
briques de base dont ces fonctionnalités ont besoin et qui servent aussi aux autres sections. Mes projets ouvre la voie :
le noyau porte déjà les deux briques d'un outil de gestion de projet (les projets, les tâches et leur lien), et ses
nouveaux besoins donneront au socle des fonctionnalités de gestion de projet de base, utiles par exemple à Mon budget
quand il gérera les investissements.

Chaque fonctionnalité se lit donc en deux couches :

| Couche | Où elle vit | Où elle se documente |
|---|---|---|
| **Couche avancée** (l'outil, l'écran, les règles propres) | La section : `web/src/app/sections/<clé>/`, données `<préfixe>_` | Fiche de la section, §3 |
| **Fondation** (la brique de base générique qu'elle utilise) | D'abord repérée dans la section, puis intégrée au socle et disponible aux cinq sections | Fiche de la section, §5 (fondation repérée), puis [`../socle/`](../socle/README.md) avec son origine et ses effets sur les cinq sections |

**Exemple.** Aujourd'hui, le budget et les dépenses d'un projet ne passent que par ses tâches. Une application de
gestion de projet aura besoin d'autres façons d'imputer des charges à un projet (par exemple une charge posée
directement sur le projet). La **fondation**, « imputer une charge à un projet autrement que par une tâche », touche le
noyau, le financement, la clôture et les bilans : elle entre au socle, avec ses effets sur les cinq sections, et
devient utilisable par exemple par Mon budget pour ses investissements. La **couche avancée** (saisie, ventilation,
suivi de la charge dans l'outil de gestion de projet) reste dans Mes projets.

Pour que la fondation puisse entrer au socle sans réécrire la couche avancée, on les sépare dès le départ : calculs
purs à part de l'écran, fondation sans nommer la section, lecture du socle par ses lectures et commandes publiques.

## Organisation des fichiers

```
docs/
  socle/README.md          catalogue du grand noyau (socle) : fonctionnalités prêtes à l'emploi
  sections/README.md       ce plan
  sections/_gabarit.md     modèle de fiche de section
  sections/quotidien.md    Mon quotidien
  sections/projets.md      Mes projets (en cours)
  sections/budget.md       Mon budget
  sections/patrimoine.md   Patrimoine
  sections/cycles.md       Cycles
```

Chaque fiche suit [`_gabarit.md`](_gabarit.md). Le journal de chaque section (versions, corrections, débogage) se tient dans sa fiche ; le `CHANGELOG.md` du dépôt garde une ligne par livraison avec un renvoi vers la fiche.

## État des sections

| Section | Clé | Fiche | Phase |
|---|---|---|---|
| Mon quotidien | `quotidien` | [quotidien.md](quotidien.md) | Socle seul, développement non commencé |
| Mes projets | `projets` | [projets.md](projets.md) | **Développement en cours** (1re section) |
| Mon budget | `budget` | [budget.md](budget.md) | Socle seul, développement non commencé |
| Patrimoine | `patrimoine` | [patrimoine.md](patrimoine.md) | Socle seul, développement non commencé |
| Cycles | `cycles` | [cycles.md](cycles.md) | Socle seul, développement non commencé |
