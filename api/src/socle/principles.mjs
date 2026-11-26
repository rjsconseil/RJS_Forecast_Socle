// Principes d'architecture du socle RJS Forecast. Chacun porte un nom, une règle fonctionnelle,
// le mécanisme technique qui le garantit et le refus levé quand on tente de le contourner.
// Ils ne sont pas des conventions : le socle les applique, les tests d'architecture les vérifient.
export const PRINCIPLES = [
  {
    id: 'P1', code: 'SENS_UNIQUE', name: 'Sens unique',
    rule: 'La couche du dessous ne connaît pas celle du dessus : un module ne voit que les modules qu’il déclare, de niveau inférieur ou égal. Le dessus enrichit le dessous par extension, jamais l’inverse.',
    mechanism: 'Registre (ordre et niveaux à l’enregistrement) + portée par module (`moduleScope`) : `socle.modules` ne rend que les dépendances déclarées ; extensions et compositions s’exécutent dans la portée de leur fournisseur.',
    refusal: 'LAYER_VIOLATION',
  },
  {
    id: 'P2', code: 'ECRITURE_UNIQUE', name: 'Écriture unique',
    rule: 'Tout objet naît et change par une commande d’Object Management, dans une transaction atomique, et seul le module propriétaire d’une nature écrit ses objets.',
    mechanism: 'État publié gelé (aucune écriture hors transaction) ; `om.create/update` réservés au propriétaire de la nature ; contrôle de sortie de transaction (tout objet apparu est déclaré, aucun ne disparaît) ; les modules n’ont pas accès à l’écrivain du stockage.',
    refusal: 'WRITE_OUTSIDE_DOMAIN · UNTRACKED_WRITE',
  },
  {
    id: 'P3', code: 'FACADE_PUBLIQUE', name: 'Façade publique',
    rule: 'Un module n’importe d’un autre que sa façade (`api.mjs`), et seulement s’il en dépend. Ses fichiers internes restent privés.',
    mechanism: 'Test d’architecture sur les imports entre modules.',
    refusal: 'test « façade publique »',
  },
  {
    id: 'P4', code: 'LECTURE_DECLAREE', name: 'Lecture déclarée',
    rule: 'Un module ne lit que ses propres collections et celles qu’il déclare (`reads`), appartenant à ses dépendances. Jamais celles d’un module qu’il ne déclare pas.',
    mechanism: 'Contrat `reads` vérifié à l’enregistrement (nature d’une dépendance) et test d’architecture sur les accès `state.<collection>`.',
    refusal: 'LAYER_VIOLATION · test « lecture déclarée »',
  },
  {
    id: 'P5', code: 'DONNEES_GEREES', name: 'Données gérées',
    rule: 'Les données passent par un système de gestion à deux étages : la gestion (schémas, transactions, intégrité) et le stockage (moteur interchangeable). Chaque module a son schéma ; les données applicatives sont séparées des données techniques.',
    mechanism: '`DataManager` (catalogue des schémas, transactions) au-dessus d’un moteur de stockage choisi par configuration.',
    refusal: 'DATA_ENGINE_UNAVAILABLE',
  },
  {
    id: 'P6', code: 'MIDDLEWARES_TYPES', name: 'Middlewares typés et indépendants',
    rule: 'Au niveau 2, trois rôles : le middleware métier (Budget, Patrimoine, Navigation system) ne dépend d’aucun autre middleware métier ; le middleware technique sert les middlewares métier ; le middleware transverse sert les middlewares métier et les applications. Technique et transverse ne s’appuient que sur le niveau du dessous.',
    mechanism: 'Champ `role` du contrat de module, contrôlé par `Registry.register` ; deux middlewares métier se parlent par extension, jamais par dépendance.',
    refusal: 'erreur d’enregistrement',
  },
];
export const principle = (id) => PRINCIPLES.find((p) => p.id === id || p.code === id) ?? null;
