# Présentation du calendrier : design et effets d'affichage

La présentation du calendrier a deux couches séparées :

| Couche | Rôle | Définition | Peau qui l'applique |
|---|---|---|---|
| **Design** | Apparence statique : surfaces, traits, rayons, polices, ombres, couleurs d'état | `calendar-design.ts` (jetons) | `../calendar-skin-design.scss` |
| **Effets d'affichage** | Mouvement : apparition, disparition, cascade, survol, aperçu, changement de période | `calendar-effects.ts` (primitives et réglages) | `../calendar-skin-effects.scss` et `animate.leave` du composant |

« Standard » est le choix par défaut des deux couches : il ne pose rien, le calendrier garde son
apparence et ses fondus d'origine. Le module livre aussi une proposition, **Horizon** (design) et
**Fondu fluide** (effet), plus l'effet **Sans animation**. La personne choisit dans le volet
« Sources et affichage », groupe « Apparence » ; l'administration peut fixer le choix d'ouverture
(`design`, `effet` dans le paramètre `calendrier.<id>`) et fermer la commande (`controls.appearance`).

## Ajouter le design d'un site

Un design est une donnée : aucune ligne de CSS n'est nécessaire.

```ts
import { provideCalendarDesigns } from './app/calendar/presentation/calendar-presentation';

export const appConfig: ApplicationConfig = {
  providers: [
    provideCalendarDesigns({
      id: 'charte-maison',
      label: 'Charte maison',
      description: 'Les couleurs et la typographie du site.',
      swatch: ['#ffffff', '#0f766e', '#134e4a'],
      tokens: {
        font: "'Source Sans 3', sans-serif",
        accent: '#0f766e',            // une variante, jamais une couleur d'état
        accentSoft: 'rgba(15,118,110,.10)',
        surface: '#ffffff',
        surfaceAlt: '#f6faf9',
        radius: '12px',
        // Couleurs d'état : gardez un rouge, un vert et un bleu nets.
        stateNegative: '#dc2626',
        statePositive: '#16a34a',
        stateNeutral: '#2563eb',
      },
    }),
  ],
};
```

Les jetons disponibles et leur rôle sont listés dans `DESIGN_TOKENS`. Un jeton absent prend une valeur
de repli neutre. Pour aller plus loin qu'un jeton, nommez une classe (`className`) et livrez vos règles
sous `[data-cal-design='charte-maison']`.

**Couleurs d'état.** Le rouge dit un dépassement ou un négatif, le vert un gain ou un positif, le bleu une
situation standard. Seules ces trois couleurs précises portent un état ; le design n'emploie que leurs
variantes (indigo, cyan, sarcelle, ardoise…).

## Ajouter un effet d'affichage

Un effet choisit une primitive par moment et déclare ses réglages, que la personne ajuste au curseur :

```ts
import { provideCalendarEffects } from './app/calendar/presentation/calendar-presentation';

provideCalendarEffects({
  id: 'doux',
  label: 'Doux',
  description: 'Fondus lents, sans mouvement.',
  motion: { enter: 'fade', leave: 'fade', stagger: false, hover: 'lift', period: 'crossfade' },
  defaults: { enterMs: 500, leaveMs: 400, hoverMs: 200 },
});
```

| Moment | Primitives |
|---|---|
| `enter` (jours, événements, éléments de liste, aperçu) | `none`, `fade`, `fade-up`, `fade-scale` |
| `leave` (événement masqué, élément retiré, aperçu fermé) | `none`, `fade`, `fade-down` |
| `stagger` | cascade : chaque jour ou élément décale son apparition |
| `hover` | `none`, `lift`, `glow` |
| `period` (mois, semaine, année) | `none`, `crossfade` |

Réglages possibles (`EFFECT_PARAMETERS`) : `enterMs`, `leaveMs`, `staggerMs`, `distancePx`, `peekMs`,
`hoverMs`. Seuls ceux que l'effet met dans `defaults` apparaissent dans le volet. Toutes les primitives
s'effacent quand la personne demande moins d'animations (`prefers-reduced-motion`).

Un identifiant repris par le site remplace la définition du module ; « standard » ne se remplace pas.
