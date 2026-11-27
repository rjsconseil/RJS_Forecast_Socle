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
