# Mes cycles : fonctionnalités et application autonome

> Squelette posé le 28/11/2026 : la vision et l'**entrée** de l'application. La **sortie** reste à définir selon les
> fonctions qui seront demandées.

**Vision.** Analyser les comportements financiers du quotidien, cycle après cycle, pour améliorer le taux d’épargne à chaque cycle.

**Entrée.** Les cycles et, pour chacun, ce qui a été reçu et dépensé (mouvements réglés du budget de vie, à leur date réelle), l’épargne et le taux d’épargne.

**Sortie.** À définir.

Mes cycles se développe en **mode section** sur le grand noyau (socle), sans le modifier : il ne lit le socle que par
`platform/grand-noyau.ts`. Si une fondation manque au grand noyau, elle s'y ajoute d'abord en **mode socle** (PR à part).
Fiche de la section : `docs/sections/cycles.md` ; plan et règles : `docs/sections/README.md`.

| Dossier ou fichier | Étage | Contenu |
|---|---|---|
| `fonctionnalites/entree.ts` | Fonctionnalités Mes cycles | L'entrée de l'application, calculée sans écran à partir des lectures du grand noyau |
| `application/inscription.ts` | Application autonome | Inscription : espace propre `/mes-cycles` (pas encore de page dans BPM-Astra) |
| `application/accueil.page.ts` | Application autonome | Accueil : vision, entrée lue par le grand noyau, sortie à définir |

Dossier de travail : `~/Developer/RJS_Forecast_Travail/app-cycles`. Poste de travail : `npm run app -- cycles`,
`npm run test:app -- cycles`, `npm run e2e:app -- cycles`. Données propres à venir : tables `AA_<préfixe>_` (déclaration `application/donnees.json`).
