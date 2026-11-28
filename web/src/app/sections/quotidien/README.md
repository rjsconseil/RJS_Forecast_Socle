# Mon quotidien : fonctionnalités et application autonome

> Squelette posé le 28/11/2026 : la vision et l'**entrée** de l'application. La **sortie** reste à définir selon les
> fonctions qui seront demandées.

**Vision.** Gérer au même endroit son emploi du temps et son budget personnel : ce qu’on a à faire et ce qu’on dépense, jour après jour.

**Entrée.** Le budget personnel du quotidien : les mouvements du budget de vie (entrées et dépenses, prévues et réglées) du cycle en cours, lus par le grand noyau. L’emploi du temps entrera quand le grand noyau exposera ses lectures du calendrier.

**Sortie.** À définir.

Mon quotidien se développe en **mode section** sur le grand noyau (socle), sans le modifier : il ne lit le socle que par
`platform/grand-noyau.ts`. Si une fondation manque au grand noyau, elle s'y ajoute d'abord en **mode socle** (PR à part).
Fiche de la section : `docs/sections/quotidien.md` ; plan et règles : `docs/sections/README.md`.

| Dossier ou fichier | Étage | Contenu |
|---|---|---|
| `fonctionnalites/entree.ts` | Fonctionnalités Mon quotidien | L'entrée de l'application, calculée sans écran à partir des lectures du grand noyau |
| `application/inscription.ts` | Application autonome | Inscription : espace propre `/mon-quotidien` (pas encore de page dans BPM-Astra) |
| `application/accueil.page.ts` | Application autonome | Accueil : vision, entrée lue par le grand noyau, sortie à définir |

Dossier de travail : `~/Developer/RJS_Forecast_Travail/app-quotidien`. Poste de travail : `npm run app -- quotidien`,
`npm run test:app -- quotidien`, `npm run e2e:app -- quotidien`. Données propres à venir : tables `AA_<préfixe>_` (déclaration `application/donnees.json`).
