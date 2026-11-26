# La comptabilité du projet de vie

_17 novembre 2026._

## Réserver des moyens et valider un flux

Le projet de vie possède son budget de vie et son patrimoine. Chaque projet de la vie organise ses
propres tâches, une enveloppe et des parts attribuées à ces tâches.

**Une enveloppe, une répartition entre tâches et une autorisation de dépassement sont des réservations
de moyens.** Elles ne créent ni dépense, ni revenu, ni prélèvement sur le patrimoine. Réduire ou libérer
une réservation ne produit donc aucun gain. L'ancienne commande de « facturation des dépassements »
reste compatible : elle consolide le montant autorisé dans l'enveloppe, sans créer de flux financier.

**Les dépenses et les entrées d'un projet de la vie sont portées par ses tâches.** Chaque achat ou
prestation utilise le formulaire commun des flux : libellé précis, poste de coût ou de revenu, montant,
date et tâche du projet. Il n'existe pas de deuxième mécanisme de paiement propre aux projets.

## Deux destinations comptables, choisies sur le flux

La source définie sur le projet sert de valeur proposée. Chaque flux peut choisir sa propre source :

| Source du flux | Effet après validation |
| --- | --- |
| Cycle budgétaire | La dépense augmente les charges et l'entrée augmente les revenus du cycle de sa date d'imputation. Son résultat rejoint le patrimoine à la clôture. |
| Patrimoine | La dépense réduit directement le patrimoine et l'entrée l'augmente, sans affecter les charges, les revenus, les plafonds ni le résultat d'un cycle. |

Les mouvements historiques sans source explicite utilisent celle de leur projet. Les allocations et les
parts ne déterminent jamais une charge comptable. Une validation est comptée une seule fois.

Le **patrimoine disponible** (`bpm.patrimoineDisponible`) reflète immédiatement les validations : stock
d'ouverture + résultats déjà capitalisés − dépenses nettes validées imputées au patrimoine. Il est
calculable même sans cycle configuré. Sur une lecture historique, les prélèvements sont bornés à la fin
de la période consultée ; en l'absence de période, ils sont arrêtés au jour courant.

Le stock avant la période (`bpm.patrimoineConstitue`) reste la référence des bilans et des clôtures : il
ne soustrait que les prélèvements antérieurs à la période. Les deux chiffres répondent donc à des dates
de lecture différentes ; un prélèvement ne doit jamais être soustrait deux fois.

## Date du paiement et date d'imputation

Un flux peut être prévu, puis réglé et validé par le formulaire commun. Sa **date réelle** conserve le
jour du paiement ou de l'encaissement. Sa **date d'imputation** choisit le moment de sa comptabilisation.
Ces deux dates peuvent appartenir à des cycles différents : le premier garde la trace du paiement,
le second porte seul l'effet sur ses chiffres. Une période clôturée ne peut pas être modifiée.

Pour les anciennes opérations sans date d'imputation, la date réelle reste la date comptable. Les
validations antérieures à la première attribution restent conservées dans l'historique du projet. Un
paiement effectué avant l'attribution peut être validé ensuite : sa date d'imputation détermine alors
sa prise en compte.

Une part initiale doit être attribuée avant toute dépense de tâche, ou réservée dans la même décision
explicite groupée que la validation. Un dépassement explicitement autorisé conserve toute part existante : il ne grossit pas le budget de référence pour masquer son négatif.

Une annulation retire le flux des calculs. Un remboursement est un revenu : il apparaît parmi les
entrées, et réduit la consommation financière nette de la part de tâche. Un revenu du patrimoine
augmente directement celui-ci.

## Budget restant d'une tâche

Le budget restant d'une tâche ne dépend que du temps :

- temps restant = (heures prévues − heures réellement saisies) / heures prévues ;
- budget restant = part de la tâche × temps restant.

Quand le temps saisi dépasse le temps prévu, le temps restant devient négatif et le budget restant aussi :
le dépassement de temps donne le dépassement de budget de la tâche.

Les achats validés n'entrent pas dans ce calcul. Ils restent visibles à part : la marge de trésorerie
(`cashRemainingCents` = part − achats nets validés), leur pourcentage de la part et leur équivalent en
heures sont des informations, pas une consommation de temps.

Exemple : une tâche de 10 heures dispose de 100 €. Avec 4 heures saisies, il reste 60 €, quels que soient
les achats. Avec 12 heures saisies, le reste est de −20 €. Un achat net de 60 € laisse 40 € de trésorerie
sur la part, sans changer les 60 € de budget restant au temps.

Une durée ou une part inconnue reste indiquée comme inconnue.

## Implémentation et contrôles

`budget/funding.mjs` porte les réservations, le calcul des parts et les helpers
`projectFundingSource` / `projectAccountingDate`. `budget/project-analysis.mjs` agrège les dépenses
et revenus séparément pour le cycle (`projets.chargesReglees`, `projets.revenusRegles`) et les
mouvements nets pour le patrimoine (`projets.prelevementsPatrimoine`, `projets.prelevementsAvant`,
`projets.prelevementsCumules`).

Les lectures BPM utilisent les mêmes opérations et les mêmes dates. Les tests se font sur un stockage
temporaire, notamment `api/test/funding-semantics.test.mjs` et `api/test/funding-source.test.mjs`.
