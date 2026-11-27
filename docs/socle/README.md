# Le socle : catalogue des fonctionnalités transverses

> **Statut : squelette.** Les fonctionnalités du socle sont prêtes à l'emploi et disponibles pour les cinq sections ;
> ce catalogue les décrira une par une, pour que chaque section puisse s'y appuyer sans les relire dans le code.
> La description détaillée de l'architecture reste dans [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Principe
Le socle est volontairement réduit à des fonctionnalités transverses et simples. Tout ce qui va au-delà vit dans une section
(voir [`../sections/README.md`](../sections/README.md)). Une fonctionnalité n'entre au socle que si elle sert plusieurs sections et reste simple ;
elle est alors documentée ici avec ses effets sur chacune des cinq sections.

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
| Date | Fonctionnalité | Demandée par | Effet sur les cinq sections | PR |
|---|---|---|---|---|
