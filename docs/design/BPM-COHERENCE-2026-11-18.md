# BPM : repères, imputations et prévisions

## Lecture de l'application

Météo observe les trois sections MPV. Mon projet de vie porte le budget et les cycles ; Gestion de projet organise les enveloppes et les tâches ; Patrimoine suit le stock et les objectifs. Le plan et les routes restent déclarés dans `bpm.application.ts`.

L'analyse a identifié quatre écarts : une météo limitée à deux sections, un aperçu parfois calculé sur le cycle courant au lieu du cycle d'imputation, des textes présentant encore les autorisations comme des charges, et l'absence de lecture réunissant les flux annoncés des projets avec les prévisions du cycle et du stock.

## Règles visibles dans les interfaces

- Préparer une enveloppe, une part, un plafond ou un objectif ne crée aucun flux.
- Annoncer un achat ou un gain alimente une prévision, séparée du réalisé.
- Valider un flux de tâche précise le montant réel, la date bancaire, la date d'imputation et la destination.
- Le cycle d'annonce et celui du paiement conservent leurs traces. Seul le cycle d'imputation porte la charge ou le revenu. Les bilans nouvellement enregistrés conservent également la trace d'annonce ; les bilans historiques enregistrés restent inchangés.
- Le patrimoine reçoit les résultats clos et les mouvements directement imputés au stock. Ceux-ci ne touchent pas au résultat d'un cycle.

## Mise en œuvre

`reads.projectFlows` expose les flux validés, les opérations annoncées et les traces intercycles, avec projet, tâche, poste et dates. Il utilise les critères de validation et de source du middleware Budget existant, sans seconde comptabilité. Le panneau partagé est présent dans Cycle et clôture, Patrimoine et le budget d'un projet.

`reads.financialOutlook` projette 3, 6 ou 12 cycles à partir des opérations et récurrences connues. Le résultat courant validé, les échéances du quotidien, les flux de tâches annoncés au cycle et les mouvements directs sur le stock sont séparés. Les résultats passés non capitalisés sont explicités et ajoutés une seule fois. Une validation retire son opération des prévisions. Les prélèvements directs en retard sont présentés dans la première estimation ; les échéances de cycles passés restent à régulariser, sans report automatique.

L'aperçu d'une opération utilise le cycle d'imputation et le patrimoine disponible. Le scénario patrimonial à long terme démarre également du stock disponible, après les mouvements directs validés. Les réservations ne sont jamais soustraites.

Le repère commun `BpmCompass` donne le contexte et des liens utiles propres à chaque page. Il transmet seulement la période lorsque la destination l'utilise. Les titres secondaires sont exclus du sommaire automatique grâce au mécanisme existant `data-nav-skip`, en suivant les groupes déclarés dans Navigation system. Ils restent visibles dans le contenu. Les tableaux détaillés des flux et des prévisions se déplient à la demande.

## Vérification

Tests sur stockage temporaire : trois cycles distincts pour annonce, paiement et imputation ; source patrimoine ; gains ; annulation ; isolement utilisateur ; absence de cycle ; absence de double compte à la validation et à la clôture. Tests d'interface : couverture des sous-pages, transmission du contexte et dates des cycles ancrés, en complément de la suite existante. Les vérifications navigateur bloquent les écritures API.
