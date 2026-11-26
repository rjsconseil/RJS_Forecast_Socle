# Navigation unifiée de RJS Forecast

Section → Page → Sous-page → Section de contenu.

La section est la référence du parcours. Ses pages sont présentées à gauche. L'entrée d'une section directe suit la première page dans l'ordre configuré. La page partage son adresse avec sa sous-page d'accueil, toujours placée en premier dans la navigation horizontale. Les autres sous-pages sont rattachées par `parent` dans `PAGE_WORKSPACES`.

L'accueil ouvre ses actions par clic. Les autres onglets ouvrent leurs sections de contenu par survol ou par leur bouton au clavier et au toucher. Une section de contenu est une ancre, jamais une commande. Les menus se ferment en quittant leur zone ou avec Échap. Les liens conservent le contexte de lecture sans propager une saisie ouverte.

`CONTENT_SECTION_CATALOG` déclare les ancres éditoriales disponibles avant la première visite. Les titres h2 réellement rendus complètent la structure de la sous-page courante, notamment pour les contenus conditionnels. Une sous-page sans découpage déclaré conserve une entrée de contenu principale. Les titres existants gardent leurs identifiants ; les autres reçoivent une ancre dérivée de leur titre. Les dialogues et le bandeau sont exclus de ce sommaire.

Navigation system expose les sections de contenu dans l'arbre des liens ; leurs libellés et leur ordre utilisent le même mécanisme de configuration. Les sections découvertes dynamiquement ne sont pas ajoutées au catalogue persistant.

VE utilise le bandeau commun et trois sous-pages : Comprendre et commencer, Comprendre le financement, Choisir un espace. Les informations détaillées de financement et les cartes des espaces sont déplacées dans ces deux dernières vues.

Le catalogue éditorial reste à enrichir pour les sous-pages qui n'ont actuellement que l'entrée générique. La vérification visuelle navigateur n'a pas été réalisée dans ce chat.

## Atelier d’administration BPM

L’écran `/navigation` est limité au module BPM. L’atelier Arborescence propose la recherche, un filtre par section, les libellés et le classement des liens frères au clavier ou par glisser-déposer. Les adresses et les rattachements structurels restent définis par le plan du site.

L’atelier Zones et apparence distingue le menu gauche, les onglets, les actions, les sections de contenu, les retours et les cartes d’accueil. Les styles couvrent quatre niveaux, quinze propriétés et les états repos/survol/actif. Les menus de contenu proposent en plus le mode d’ouverture, la largeur et le délai de fermeture. Les réglages héritent du site, puis de BPM, puis de la page ou du modèle de fiche sélectionné.

Les modifications restent dans un brouillon jusqu’à l’enregistrement. Quarante actions peuvent être annulées ; les valeurs invalides de présentation bloquent l’enregistrement. La révision affiche les différences avant/après et permet l’export JSON des paramètres BPM. Les préréglages ne sont jamais appliqués automatiquement au site. La réinitialisation des ordres ne touche pas les autres modules. Le serveur valide les limites et refuse les écritures sur une ancienne révision.

Finalisation de l’atelier : les brouillons non enregistrés sont protégés à la fermeture et au changement de page ; les modifications sont verrouillées pendant l’écriture. Les ordres de sections des fiches utilisent la clé du modèle (`:id`) et non l’identifiant d’un projet particulier. Les champs invalides restent visibles jusqu’à leur correction. Les niveaux proposés dans l’éditeur suivent ceux réellement utilisés par la zone choisie.

Validation de l’atelier : compilation de production, tests frontend et suite API complète. Contrôle navigateur réalisé sur les panneaux Arborescence et Apparence, la sélection d’une zone, un préréglage et son annulation. Les derniers ajustements de protection du brouillon et de résolution des modèles sont couverts par les tests automatisés ; l’accès navigateur est redevenu indisponible lors de cette dernière passe.

## Refonte Navigation Studio

L’atelier utilise désormais trois panneaux simultanés : explorateur de l’arborescence, représentation du parent et de ses enfants, inspecteur de l’élément sélectionné. L’inspecteur sépare Identité, Style et Interaction. Les liens frères se déplacent dans la représentation centrale ; la simulation permet de comparer repos, survol et sélection en largeur normale ou étroite. Le changement d’élément sélectionne sa zone et son niveau de présentation.

Les styles effectifs peuvent être copiés puis collés vers une autre zone ou portée ; on peut rétablir l’héritage d’un niveau ou d’une zone entière. La comparaison enregistrée/brouillon, l’export et la protection des modifications sont conservés. Les destinations et la création des rattachements ne sont pas éditables dans cet atelier.

Cette refonte concerne l’administration uniquement, sans réécriture supplémentaire des pages BPM. La nouvelle interface n’a pas pu être contrôlée visuellement, l’accès navigateur étant indisponible.
