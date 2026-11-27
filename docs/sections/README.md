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

## Cycle de vie d'une fonctionnalité : de la section au socle

Une fonctionnalité naît dans une section, mûrit dans sa première version autonome, puis peut **remonter au socle**
quand elle sert d'autres sections. Mes projets ouvre la voie : le noyau porte déjà les deux briques d'un outil de
gestion de projet (les projets, les tâches et leur lien), et beaucoup de ses fonctionnalités avancées ont vocation à
devenir des fonctionnalités du socle, utiles aux autres sections (par exemple Mon budget, appelé à devenir une
application de gestion des finances et des investissements).

| Étape | Où elle vit | Où elle se documente |
|---|---|---|
| 1. Née dans une section | `web/src/app/sections/<clé>/`, données `<préfixe>_` | Fiche de la section, §3 |
| 2. Candidate à la remontée | Même endroit, écrite de façon générique (sans dépendre de la section) | Fiche de la section, §5 « Candidates à la remontée » |
| 3. Remontée au socle | Socle, disponible aux cinq sections | [`../socle/`](../socle/README.md), avec son origine ; la fiche d'origine renvoie vers elle |

Pour qu'une fonctionnalité puisse remonter sans être réécrite, elle est écrite dès le départ avec des calculs purs
séparés de l'écran, sans nommer la section dans ses règles, et en ne lisant le socle que par ses lectures et commandes publiques.

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
