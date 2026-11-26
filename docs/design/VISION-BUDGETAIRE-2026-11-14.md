# Ma vision budgétaire — sous-pages

Le tableau de bord conserve sa synthèse. Ses deux sous-pages sont désormais :

- **Registre de flux** (`/tableau-de-bord/entrees`) : registre commun des entrées et dépenses, ouvert sur les deux sens. Les chiffres séparent reçu et payé, à recevoir et à payer, et différence signée des flux réglés. Recherche, regroupements, fenêtres libres, catégories, fiches de détail et saisie restent disponibles. Les totaux proviennent du registre API et suivent la sélection. La lecture par dates prévues se distingue explicitement de la lecture par dates réelles.
- **Rapprochement bancaire** (`/tableau-de-bord/rapprochement`) : sélection du cycle, règlements de son début jusqu’à la date de calcul (ou au dernier jour du cycle clos), saisie manuelle de plusieurs comptes, total des soldes, variation bancaire, variation budgétaire, solde théorique et écart. Un parcours explique le périmètre, les virements internes, les décalages de date et la correction de mouvements identifiés. Aucun écart n’est transformé automatiquement en opération.

Les soldes saisis restent en mémoire dans le composant, sans synchronisation bancaire ni persistance. Changer de cycle ou d’utilisateur recrée l’outil. Il s’agit d’une comparaison des variations ; un écart nul ne certifie pas le pointage de chaque ligne.

L’ancienne adresse `/depenses/registre` redirige vers le registre commun en conservant les paramètres et fragments. « Graphiques et chiffres » est retiré de la navigation et `/piloter` redirige vers le tableau de bord. `/piloter/agir` conserve son rôle dans la gestion du projet de vie.

Validation : compilation de production et 293 tests frontend réussis, dont calculs multi-comptes, valeurs invalides, saisie des soldes et recalcul du résultat. L’accès au navigateur n’était pas disponible dans ce chat : contrôle visuel manuel restant à effectuer.
