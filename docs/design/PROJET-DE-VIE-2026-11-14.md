# Projet de vie — lecture simplifiée

La page principale conserve ses six volets : cycle, charges indispensables, charges courantes, projets, résultats et patrimoine. La synthèse financière passe avant les compteurs d’état. Chaque volet conserve ses trois montants principaux, ses faits et indicateurs, ses alertes, ses commandes et son détail. Les plafonds, marges et dépassements des deux natures de charges restent visibles sans déplier.

La présentation des jauges devient une lecture horizontale des montants et de la progression. Les explications détaillées des jauges et les notes sont accessibles dans le détail du même volet. Les actions secondaires sont regroupées sous « Autres actions » ; l’action principale et les compteurs restent visibles. Les alertes ne déclenchent plus l’ouverture automatique de plusieurs grands panneaux. Les paramètres d’ouverture explicites, notamment `expanded=courante`, restent pris en compte.

Les sections complémentaires sont accessibles par quatre cartes de parcours et la navigation des sous-pages :

- Budget type : page existante `/projet-de-vie/budget-type`.
- Projets et décisions : nouvelle page `/projet-de-vie/financement`, conservant le tableau de financement, les demandes des projets et des tâches, les autorisations et la facturation.
- Échéances à traiter : nouvelle page `/projet-de-vie/echeances`, conservant les lignes ouvertes, leurs montants et dates, le détail et les actions de règlement.
- Suivi et clôture : page existante `/projet-de-vie/cloture`.

Les anciens fragments de financement, décisions et échéances redirigent vers la bonne page en conservant les paramètres. Les liens des volets conservent la période lue. Aucune règle de calcul ni commande financière n’est modifiée.

## Harmonisation visuelle

La synthèse et les quatre sous-pages reprennent les surfaces, couleurs, bordures, rayons et états de focus du socle BPM. Les montants ont une hiérarchie commune, les titres et descriptions ne sont plus comprimés par la grille héritée de la gestion de projets, et chaque volet forme un cadre continu avec ses commandes et son détail. Les plafonds et marges restent directement visibles dans un bandeau de repères.

Les tableaux d’échéances et de détail alignent les montants et disposent de zones de défilement utilisables au clavier. La matrice de financement conserve la colonne des projets pendant le défilement et distingue la période consultée. Le budget type réorganise ses champs en cartes avec libellés visibles sur petit écran ; les montants et commandes de clôture suivent le même rythme que les autres pages.

La présentation s’adapte aux petits écrans sans retirer d’information ni de commande. Les couleurs reposent sur les variables du site pour suivre ses thèmes.

Validation : compilation de production, 294 tests frontend réussis ; contrôle de l’isolation des nouvelles pages et de la conservation de la période. Le contrôle visuel dans le navigateur reste à effectuer, son accès étant indisponible dans ce chat.
