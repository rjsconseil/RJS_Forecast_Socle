# Documentation par section : plan

> **Statut : squelette.** Ce dossier fixe la manière dont le site sera documenté.
> Les fiches se rempliront au fil du développement de chaque section ; rien n'y est encore livré.

## Le modèle documenté

BPM-Astra est **un seul site** (une application, une API, une base). Il se lit en deux étages.

| Étage | Ce qu'il contient | Rythme | Public |
|---|---|---|---|
| **Le socle** | Les fonctionnalités transverses et simples, volontairement réduites : objets, cycle, budget, mouvements, clôture, navigation, sections, liens entre sections. **Elles sont prêtes à l'emploi et disponibles pour les cinq sections.** | Stable. Il n'évolue que pour un besoin vraiment transverse et simple. | Tout utilisateur |
| **Les sections** | Mon quotidien, Mes projets, Mon budget, Patrimoine, Cycles. Chacune construit sur le socle des applications plus avancées, semi-professionnelles ou professionnelles, qui vont au-delà du but du socle. | Développement et débogage au long cours, section par section. | Utilisateurs avisés, préparés à un outil plus riche |

Règles qui s'appliquent à toute la documentation :

1. Une fonctionnalité **propre à une section** se documente dans la fiche de cette section, jamais dans le socle.
2. Une fonctionnalité **ajoutée au socle** se documente dans [`../socle/`](../socle/README.md), avec ses effets sur les cinq sections. La fiche de la section qui l'a demandée renvoie vers elle.
3. Une section ne réécrit pas le socle. Elle dit ce qu'elle en utilise, et le lien suffit.
4. Le code reste rangé de la même façon : `web/src/app/sections/<clé>/` pour les écrans propres à une section, et les tables préfixées par section (`MQ_`, `MP_`, `MB_`, `PT_`, `CL_`).

## Deux modes de développement

Le socle est un **grand noyau** qui offre une interface (lectures, commandes, composants communs) au service des cinq
applications de section qui l'entourent.

| | **Mode section** | **Mode socle** |
|---|---|---|
| Quand | La fonctionnalité ne demande rien que le socle n'offre déjà | La fonctionnalité a besoin d'une fondation que le socle n'a pas |
| Où | `web/src/app/sections/<clé>/`, données `<préfixe>_` | Le socle seul (API, base, règles, composants communs), **sans aucun développement propre à une section** |
| Règles | Libre : pas d'intégration au socle, pas limité par les règles communes ; seulement les règles de rangement et l'usage du socle par son interface | Toutes les règles communes ; effets décrits sur les cinq sections |
| Validation | Tests de la section | **Non-régression complète** de toutes les fonctionnalités du socle (tests de l'API, du site, de bout en bout, jeux d'essai) |
| Livraison | PR de la section | PR du socle, distincte ; la section ne s'en sert qu'une fois cette PR fusionnée, dans une PR de section suivante |

On ne mélange jamais les deux modes dans une même PR.

## Cycle de vie d'une fonctionnalité : la section garde l'application, le socle reçoit les fondations

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
  socle/README.md          catalogue des fonctionnalités du socle (prêtes à l'emploi)
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
