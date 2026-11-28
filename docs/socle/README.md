# Le grand noyau (socle) : catalogue des fonctionnalités transverses

*Légende : « les fonctionnalités communes à tout le site ».*

> **Statut : squelette.** Les fonctionnalités du socle sont prêtes à l'emploi et disponibles pour les cinq sections ;
> ce catalogue les décrira une par une, pour que chaque section puisse s'y appuyer sans les relire dans le code.
> La description détaillée de l'architecture reste dans [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Principe
Le grand noyau (socle) réunit le noyau technique et les middlewares communs (Budget, Patrimoine, Cycle, Calendrier,
Navigation) derrière une seule interface : l'API côté serveur, et [`platform/grand-noyau.ts`](../../web/src/app/platform/grand-noyau.ts)
côté site. Les fonctionnalités par section et les applications autonomes ne l'appellent que par là.
Une fondation qui lui manque s'y ajoute en **mode socle** : seule, sans développement propre à une section, et validée par une
non-régression complète de toutes ses fonctionnalités avant qu'une section ne l'utilise (voir [`../sections/README.md`](../sections/README.md)).

Le socle est volontairement réduit à des fonctionnalités transverses et simples. Tout ce qui va au-delà vit dans une section
(voir [`../sections/README.md`](../sections/README.md)). Une fonctionnalité entre au socle quand elle sert plusieurs sections : soit un besoin transverse simple, soit la
**fondation** d'une fonctionnalité avancée née dans une section (la fonctionnalité avancée, elle, reste dans sa section ;
Mes projets en sera la première source). Elle est alors documentée ici avec son origine et ses effets sur chacune des cinq sections.

## Format d'une entrée
| Rubrique | Contenu |
|---|---|
| But | Ce que la fonctionnalité garantit, en une phrase |
| Accès | Route(s) de l'API, service(s) ou composant(s) du site |
| Sections concernées | Les cinq, avec l'effet pour chacune |
| Limites | Ce qu'elle ne fait pas, volontairement |
| Preuves | Tests qui la couvrent |

## Catalogue (à remplir)
1. Objets et registre des natures
2. Utilisateurs, contexte et partitions
3. Cycle : horloge, phases, verrou
4. Budget de vie : enveloppes, plafonds, échéances
5. Mouvements du quotidien
6. Projets et tâches du noyau
7. Clôture et bilans
8. Patrimoine et objectifs
9. Calendrier
10. Navigation, sections, accueil de section, ouverture d'un fait à sa source
11. Flux entre sections
12. Authentification et stockage

## Ajouts au socle
| Date | Fonctionnalité | Origine (besoin transverse, ou fondation venue de telle section) | Effet sur les cinq sections | PR |
|---|---|---|---|---|
| 27/11/2026 | Point d'inscription des applications autonomes (pages, gestes, jeux d'essai déclarés dans le dossier de l'application ; registre `web/src/app/sections/inscriptions.ts`) | Besoin transverse : ajouter une page à Mes projets obligeait à modifier le menu du socle | Chaque section (et chaque application hybride) ajoute ses pages après celles du socle dans sa partie de BPM-Astra, sans toucher au socle. Mes projets y inscrit Pilotage ; les quatre autres n'ont encore rien inscrit | PR « Le socle à l'abri » |
| 27/11/2026 | Contrat figé du grand noyau (photo de l'interface du site et des routes de l'API), mode de chaque PR, poste de travail par application | Mise à l'abri du socle avant le développement des applications autonomes | Aucun effet fonctionnel ; toute évolution du grand noyau passe par une PR en mode socle qui met la photo à jour | PR « Le socle à l'abri » |
| 27/11/2026 | Espace propre des applications autonomes (inscription `espace` : adresse, titre, écran) et section « Applications autonomes » de la zone Noyau transverse ; base commune des données des applications (déclaration `donnees.json`, tables `AA_` + préfixe de la section, catalogue en lecture seule, instanciation par règles, routes `/api/aa/…`) | Demande de Roosevelt : l'application Mes projets dans l'interface habituelle du site, BPM-Astra intact | Chaque section peut ouvrir son application autonome à sa propre adresse, avec un lien depuis le noyau, et déclarer son modèle de données (tables `AA_<préfixe>_…`, catalogue, règles d'instanciation) sans toucher au socle. Aucune application n'a encore d'espace : la section reste cachée | PR « Espace des applications autonomes » |

## Faire évoluer le grand noyau (mode socle)
1. PR à part, sans aucun fichier d'application (le contrôle « Mode de la PR » le vérifie).
2. Si l'interface `platform/grand-noyau.ts`, le cadre `astra/cadre.ts` ou les routes de l'API changent : `npm run contrat -- --maj`, et la photo `api/test/contrat/` modifiée fait partie de la PR.
3. Non-régression complète : `npm test`, `npm run api:check`, `npm --prefix web run lint`, `npm --prefix web run test:coverage`, `npm run build`, `npm run seeds:check`, `npm run e2e:ci` (tout est rejoué sur GitHub).
4. Une ligne dans « Ajouts au socle » ci-dessus, avec ses effets sur les cinq sections ; après la fusion, l'étiquette suivante (`socle-v1.1`…).
| 28/11/2026 | Zone « Applications autonomes » : une bande de l'accueil des modules (/modules), une entrée des zones principales et une section par application ; la section du Noyau transverse est retirée | Demande de Roosevelt : lancer Mes projets depuis l'accueil des modules, dans une section dédiée | Les applications autonomes sont au niveau des autres zones, pas sous le noyau | PR « Zone des applications autonomes » |
