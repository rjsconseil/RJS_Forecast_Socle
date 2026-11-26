# Calendrier partagé : instances et administration

Le calendrier est un module transverse : moteur `api/src/modules/calendar`, rendu et chargement `web/src/app/calendar`. Une page utilise une instance nommée ; elle ne recopie ni les cases, ni l’aperçu, ni le panneau latéral.

## Configuration dans le site

Administration → Calendriers · Sources et affichage (`/admin/calendriers`). L’instance Budget/Patrimoine, utilisée par `/calendrier-budget`, est présentée en premier avec ses six sources actuelles : revenus, revenus récurrents attendus, dépenses, dépenses récurrentes attendues, fins de période et versements au patrimoine.

- **Disponible** : la source est exposée par cette instance. Une source indisponible est exclue des éléments et événements renvoyés par le moteur.
- **Affichée au départ** : état initial d’une source disponible ; l’utilisateur peut la réactiver si le choix des sources est autorisé.
- **Accès** : dépliant fermé, ouvert à l’arrivée, ou masqué avec réglages imposés.
- **Commandes** : sources, informations par événement, indicateurs, nombre d’événements par case et inclusion des éléments terminés. Une commande verrouillée conserve sa valeur administrée.
- **Lecture initiale** : vue, densité, champs et inclusion des terminés ; **indicateurs** : un à quatre indicateurs proposés au survol.

L’enregistrement utilise les paramètres existants (`calendrier.<id>`), avec validation serveur, contrôle de révision, historique et retour à la valeur livrée. Les règles de date, de récurrence, de montant et de replanification sont conservées par l’éditeur. Aucun choix de couleur, de thème ou d’effet n’y est ajouté.

Les préférences personnelles sont locales au navigateur et isolées par utilisateur, identifiant d’instance et révision. Une nouvelle révision administrée repart des valeurs nominales lors de la prochaine lecture. Les configurations d’aperçu sans identifiant ne persistent pas de préférences.

## Instancier dans un module Angular

Importer `CalendarSpaceComponent` dans les imports du composant hôte, puis :

```html
<rjs-calendar-space calendar="budgetPatrimoine" />
```

L’instance charge automatiquement ses styles, ses paramètres et les événements de l’utilisateur actif. Elle fournit la navigation temporelle, les commandes autorisées, le dépliant Sources et affichage, les cases magnifiées et le panneau réactif. `noyau` et `patrimoine` sont également disponibles.

Pour une page avec son propre bandeau, utiliser `[externalTools]="true"`. La page hôte peut reprendre `toolbarState()`, `personalization()`, `movePeriod()`, `selectView()` et `setIncludeDone()`. Elle doit respecter `data.interaction.access` et `data.interaction.controls` reçus par `(loaded)` lorsqu’elle expose les commandes. Le composant contrôle aussi les mutations de préférences : masquer un bouton n’est pas l’unique protection.

`(displayedEventsChange)` fournit exactement la liste filtrée utilisée par les cases, l’aperçu et le panneau. La page peut l’utiliser pour ses propres totaux. `(opened)` et `[openInPlace]="true"` permettent de prendre en charge l’ouverture des objets dans la page hôte.

## Ajouter une nouvelle instance nommée

Définir la configuration nominale dans `api/src/modules/calendar/defaults.mjs`, puis l’enregistrer dans `CALENDARS` du module `index.mjs`. Son paramètre et son formulaire apparaissent automatiquement dans l’administration. Passer ce nouvel identifiant à `calendar` sur la page hôte. Deux pages qui utilisent le même identifiant partagent volontairement les mêmes réglages ; deux identifiants ont des configurations indépendantes.

Une configuration ponctuelle peut aussi être passée par `[configuration]` à la place de `calendar`, pour un aperçu sans écriture. Les sources décrivent les objets métier, pas des requêtes arbitraires. Les lectures restent limitées à l’utilisateur du contexte. Le filtrage d’une source dans un calendrier est un réglage de présentation, pas une modification des autorisations sur les autres écrans du site.

## Contrat complémentaire

```json
{
  "interaction": {
    "access": "collapsed",
    "controls": { "sources": true, "fields": true, "indicators": true, "density": true, "completed": true },
    "fields": { "amount": true, "total": true, "type": false, "status": false, "group": false },
    "includeDone": true
  }
}
```

Chaque élément accepte `disponible` (défaut `true`), en plus de `affiche`. Les anciennes configurations restent valides. Les valeurs manquantes d’`interaction` sont complétées par le moteur.
