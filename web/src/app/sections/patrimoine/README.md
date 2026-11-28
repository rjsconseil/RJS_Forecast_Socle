# Mon patrimoine : fonctionnalités et application autonome

> Squelette posé le 28/11/2026 : la vision et l'**entrée** de l'application. La **sortie** reste à définir selon les
> fonctions qui seront demandées.

**Vision.** Planifier le patrimoine sur les projets de vie qui ont une portée patrimoniale : constituer un apport ou une somme pour l’achat d’un bien immobilier, préparer le budget qui soutiendra toute une période de retraite…

**Entrée.** Le patrimoine constitué et son objectif, et les projets de la vie (projets du grand noyau) qui peuvent porter un but patrimonial.

**Sortie.** À définir.

Mon patrimoine se développe en **mode section** sur le grand noyau (socle), sans le modifier : il ne lit le socle que par
`platform/grand-noyau.ts`. Si une fondation manque au grand noyau, elle s'y ajoute d'abord en **mode socle** (PR à part).
Fiche de la section : `docs/sections/patrimoine.md` ; plan et règles : `docs/sections/README.md`.

| Dossier ou fichier | Étage | Contenu |
|---|---|---|
| `fonctionnalites/entree.ts` | Fonctionnalités Mon patrimoine | L'entrée de l'application, calculée sans écran à partir des lectures du grand noyau |
| `application/inscription.ts` | Application autonome | Inscription : espace propre `/mon-patrimoine` (pas encore de page dans BPM-Astra) |
| `application/accueil.page.ts` | Application autonome | Accueil : vision, entrée lue par le grand noyau, sortie à définir |

Dossier de travail : `~/Developer/RJS_Forecast_Travail/app-patrimoine`. Poste de travail : `npm run app -- patrimoine`,
`npm run test:app -- patrimoine`, `npm run e2e:app -- patrimoine`. Données propres à venir : tables `AA_<préfixe>_` (déclaration `application/donnees.json`).
