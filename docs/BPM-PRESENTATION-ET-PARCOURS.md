# Présentation et coordination BPM

La présentation est composée de blocs réutilisables ; les pages assemblent ces blocs et décrivent
leur contexte. Les règles et écritures métier continuent de passer par les middlewares existants.

## Blocs communs

| Bloc | Responsabilité |
|---|---|
| `ui/heading.ts` | Titre, introduction et lien de retour des pages et espaces projets |
| `ui/page-frame.ts` | Bandeau, période, contexte et emplacements d’actions/filtres |
| `ui/toolbar.ts` | Outils contextuels, repli adaptés au petit écran |
| `ui/form-actions.ts` | Enregistrer/annuler, disponibilité et état d’enregistrement |
| `ui/entry-flow.ts` | Ouverture, relecture et reprise d’une opération depuis son adresse |
| `ui/operation-editor.ts` | Un formulaire commun aux pages qui créent/modifient une opération |
| `ui/drafts.ts` | Conservation des champs et clés de demande, par utilisateur et formulaire |
| `ui/query-state.ts` | État de présentation lié à l’adresse, avec le contrat d’un signal |
| `ui/navigation.ts` | Historique du parcours, boutons Retour/Suivant et confirmations |
| `ui/navigation-model.ts` | Curseur et transitions de l’historique, indépendants des composants |

Les anciens fichiers `bpm/dashboard.ts`, `bpm/operations.ts` et `bpm/pages/vision.ts` ne sont plus
routés ni consommés et ont été supprimés. Les pages actives restent `pages/dashboard`,
`pages/expenses` et `objectives/objectives.page`. Les adaptations futures doivent enrichir ces
composants et les blocs communs plutôt que recréer une page parallèle.

## Contexte et retours

- Les boutons Retour et Suivant suivent l’historique réel du navigateur, à l’intérieur du module BPM.
  Un identifiant de visite dans l’état navigateur relie les retours aux entrées du parcours, même
  après un rechargement. Le parcours est borné à 60 visites et isolé par utilisateur et onglet.
- Un lien portant `bpmBack` revient à la visite précédente si elle est connue ; son `href` reste
  utilisable lors d’une arrivée directe ou d’une ouverture dans un autre onglet.
- La recherche remplace la visite courante pour éviter une étape par caractère. Les changements de
  vue ou d’étape peuvent créer une visite. Une nouvelle direction après un retour remplace seulement
  le chemin à venir, conformément au comportement du navigateur.
- Les filtres, la période, les cadres de projets dépliés et l’ouverture d’un objectif sont dans
  l’adresse. Leur remise à zéro dans un même geste fusionne tous les changements.

## Assistant et formulaires

L’assistant utilise `/creer?step=N`. Chaque étape reste soumise aux validations existantes ; une
adresse ne permet pas d’atteindre une étape encore inaccessible. Les boutons de l’assistant
réutilisent la visite précédente/suivante lorsqu’elle correspond à l’étape demandée. Le brouillon
complet et sa clé de demande sont conservés pendant ces déplacements. La confirmation ouvre le
projet créé, ou le projet de vie configuré, pour poursuivre le pilotage.

Les pages Tableau de bord, Dépenses, Entrées, Solde, Centre, Projet de vie, Plafonds, Projet et Actions utilisent
`entry=new` ou `entry=<identifiant de ligne>` via `BpmEntryFlow`. Une modification relit la ligne
avant de présenter le formulaire et vérifie son appartenance au budget de la page. Le formulaire n’affiche jamais les données d’une ligne précédente
pendant le chargement d’une autre. Une navigation vers les catégories ne jette pas la saisie :
revenir dans le parcours rouvre le formulaire et reprend ses champs.

Les éditeurs d’opération, projet, tâche et objectif conservent les champs et la clé de demande dans
le stockage de session du navigateur. Les commandes Retour/Suivant sont aussi disponibles dans les formulaires modaux, dont les
actions sont désactivées pendant l’enregistrement. Un enregistrement ou une annulation explicite efface le
brouillon. Une navigation conserve le brouillon. Les éditions utilisent une portée comprenant la
révision de l’objet ; les données d’un autre utilisateur ne sont jamais reprises.

## Validation

169 tests d’interface réussis, dont les nouveaux tests de parcours : retours et reprises multiples,
conservation des filtres, fusion de leurs remises à zéro, isolement des profils, brouillons,
identité de demande et navigation de l’assistant. Les tests couvrent aussi les contrôles réels de
l’assistant (séquence `input` puis `change`), la suspension du détail d’une tâche pendant la saisie
d’une dépense et le comptage des postes dépassés lorsque leurs catégories dépassent également.
Compilation Angular de production réussie.


Vérification dans le navigateur : détour Projet de vie → nouvelle opération → Catégories → Retour
avec reprise du libellé et du montant, puis Suivant vers les catégories ; liste filtrée sur « Japon »
et dépliée → fiche projet → Retour, avec recherche et détail des tâches conservés.

### Recette enregistrée dans l’instance locale

Le profil **TEST BPM · Parcours et reprise · 2026-11-07** conserve trois projets de la vie,
cinq tâches (dont une sans projet), quatorze opérations et quatre catégories. Les écritures ont été
effectuées par l’API en fonctionnement ou dans l’interface, sans ouverture concurrente du stockage.
Les identifiants et résultats sont dans `api/data/recettes/parcours-2026-11-07.json`.

- Cuisine : enveloppe de 1 200 €, part de 800 €, 160 € réglés et demande de 250 € en attente.
- Voyage : projet et dépense future préparés avant attribution d’une enveloppe.
- Atelier vélo : créé avec sa tâche depuis les sept étapes de l’assistant, avec retour puis
  reprise ; enveloppe de 300 € enregistrée, demande de 175 € accordée, règlement de 75 € effectué
  depuis la tâche. La fermeture de l’éditeur reprend le détail de cette tâche.
- Saisie du projet de vie : détour vers les catégories pour créer « Achats de proximité »,
  retour au formulaire avec les champs conservés puis enregistrement unique de 37,50 €.
- Plafonds : poste et catégorie dépassés ensemble, catégorie dépassée seule et poste dépassé seul.
- Lecture croisée : 235 € remontés au projet de vie pour 1 500 € d’enveloppes attribuées.

La recette a corrigé la perte des choix de l’assistant entre `input` et `change`, la superposition
des fenêtres tâche/opération et un compteur qui soustrayait une catégorie déjà dédupliquée.
Les 6 062 objets existants des autres profils ont été comparés à la sauvegarde et sont inchangés.
