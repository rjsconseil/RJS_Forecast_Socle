# Mon budget : fonctionnalités et application autonome

> Squelette posé le 28/11/2026 : la vision et l'**entrée** de l'application. La **sortie** reste à définir selon les
> fonctions qui seront demandées.

**Vision.** Prendre en charge le patrimoine dès qu’il est disponible (ni dépensé ni engagé pour un projet ou une dépense à venir) et le « manager » : investissements en bourse ou sur des projets avec un but de rendement.

**Entrée.** Le patrimoine disponible : le patrimoine constitué (stock d’ouverture + résultats des cycles capitalisés) moins ce qui est engagé pour l’avenir. Tant que le grand noyau n’expose pas ces engagements, le disponible reste inconnu plutôt que surestimé.

**Sortie.** À définir.

Mon budget se développe en **mode section** sur le grand noyau (socle), sans le modifier : il ne lit le socle que par
`platform/grand-noyau.ts`. Si une fondation manque au grand noyau, elle s'y ajoute d'abord en **mode socle** (PR à part).
Fiche de la section : `docs/sections/budget.md` ; plan et règles : `docs/sections/README.md`.

| Dossier ou fichier | Étage | Contenu |
|---|---|---|
| `fonctionnalites/entree.ts` | Fonctionnalités Mon budget | L'entrée de l'application, calculée sans écran à partir des lectures du grand noyau |
| `application/inscription.ts` | Application autonome | Inscription : espace propre `/mon-budget` (pas encore de page dans BPM-Astra) |
| `application/accueil.page.ts` | Application autonome | Accueil : vision, entrée lue par le grand noyau, sortie à définir |

Dossier de travail : `~/Developer/RJS_Forecast_Travail/app-budget`. Poste de travail : `npm run app -- budget`,
`npm run test:app -- budget`, `npm run e2e:app -- budget`. Données propres à venir : tables `AA_<préfixe>_` (déclaration `application/donnees.json`).
