# RJS_Forecast - Guide Codex : Démarrer de zéro et Ma vision budgétaire

Version : 0.1. Date : 3 novembre 2026. Document de préparation à la réimplémentation.

## 1. Mission et ordre de lecture

Réimplémenter en Angular le parcours **Démarrer un projet / Partir de zéro**, ainsi que **toutes les pages de Ma vision budgétaire et leurs détails**. Alléger les écrans en conservant leurs chiffres clés, leurs graphes, leurs données et les actions nécessaires pour les alimenter. Reprendre l’esthétique du repository à partir des feuilles SCSS fournies.

Le présent Markdown est le document principal pour Codex. Le PDF est une copie de lecture. L’archive contient ce guide, les feuilles de style originales, les modèles de calcul utiles, les templates de référence et les inventaires JSON. Elle constitue un dossier de référence, pas une application déjà reconstruite.

Ordre conseillé : ce guide, `annexes/catalogue-ecrans.json`, `annexes/catalogue-graphes.json`, `annexes/correspondance-styles.json`, puis les seules sources nécessaires au lot. Lire `annexes/README-STYLES.md` avant toute importation SCSS.

**Source vérifiée en ligne :** repository privé `rjsconseil/rjs-forecast`, branche `main`, commit `54246fad6553f6388d8257711ae7ef58241b3450`. La tête de `main` correspond à ce commit lors de la vérification du 3 novembre 2026. Son message de livraison est « référence officielle du 31 octobre 2026 avec toutes les données ».

Trois catégories de consignes : **SOURCE** décrit le code observé ; **CIBLE** décrit la simplification proposée en réponse à la demande ; **SOCLE** rappelle les décisions transverses déjà établies. Une simplification de présentation ne donne pas à Codex le droit de changer une règle financière.

Ce guide complète le socle v0.5 et le contrat J1 v0.2. Il concerne la réalisation future des écrans BPM ; il n’étend pas implicitement J1 aux traitements financiers complets. Les nouvelles modalités d’écran entrent dans la revue de conception habituelle de RJS.

## 2. Périmètre et inventaire des destinations

Les routes ci-dessous sont relatives à `/budget-patrimoine-management`. Elles ont été rapprochées du catalogue de navigation et des composants réellement chargés. Les sous-sections internes sont recensées dans les fiches suivantes.

| ID | Destination source | Composant source | Traitement cible |
| --- | --- | --- | --- |
| START | `/creer`, chemin nouveau | `bpm-create.page.ts` | Accès direct au parcours de zéro ; sept étapes utiles après retrait du choix nouveau/existant. |
| DASH | `/tableau-de-bord` | `bpm-money.page.ts` | Synthèse, patrimoine, flux, projets et historique. |
| EXP | `/depenses` | `bpm-expenses.page.ts` et `.html` | Registre filtrable et détail d’une échéance. |
| PILOT | `/piloter` | `bpm-pilot.page.ts`, mode stats | Comparaisons, postes, provisions, progression et clôtures. |
| ACT | `/piloter/agir` | `bpm-pilot.page.ts`, mode actions | Saisie, échéances, budget type, épargne et simulation. |
| FUTURE | `/vision` | `bpm-vision.page.ts` | Objectifs, projection, hypothèses et répartition patrimoniale. |
| DETAIL-IN | `/argent/entrees` | `bpm-money-detail.page.ts` | Sources, opérations reçues et attendues. |
| DETAIL-CC | `/argent/postes/:poste` | `bpm-money-detail.page.ts` | Montants, part, plafond et opérations d’un centre. |
| DETAIL-NET | `/argent/reste` | `bpm-money-detail.page.ts` | Calcul du solde et rapprochement avec le compte. |
| DETAIL-EXP | `/depenses?...&operation=...&occurrence=...` | Détail interne au registre EXP | Panneau ou ligne dépliée ; aucune nouvelle page obligatoire. |
| EDIT-FLOW | Saisie et modification intégrées à ACT | `bpm-flow-editor.component.ts` | Un éditeur d’opération réutilisable par les pages de détail. |
| EDIT-GOAL | Formulaire et dialogue intégrés à FUTURE | `bpm-vision.page.ts` | Ajouter, modifier et retirer un objectif. |

Compatibilité source : `/argent` redirige vers le tableau de bord ; `/argent/a-preciser` aussi. La nature interne `a-preciser` existe encore dans les modèles, mais sa route dédiée n’est plus une page accessible dans le routage actuel. En cible, montrer les opérations sans centre par un filtre du registre, sans réactiver une page fantôme.

**Hors périmètre de cette livraison :** Assembler l’existant, atelier, pages de création des middleware, Mon entreprise, Mes patrimoines en tant que section distincte, Mon parcours, Formation et Administration complète. Les références à ces écrans dans les composants historiques doivent être remplacées par les actions BPM nécessaires, ou retirées si leur fonction est hors périmètre. Le calcul du cycle reste une dépendance métier ; cela n’ajoute pas sa page au présent inventaire.

Sources : `site/configuration/navigation-catalog.json`, `site/apps/web/src/app/app.routes.ts`. Dans l’archive, les chemins à partir de `site/` se trouvent sous `reference-code/` ou `styles-source/`, selon le fichier ; le manifeste donne le chemin exact.

## 3. Simplification visuelle à appliquer

Conserver les cinq pages du menu Ma vision budgétaire. Chaque page comporte un titre court, le contexte de lecture, une rangée de chiffres clés et ses blocs utiles. Un clic ouvre le détail ou la saisie ; les explications longues et les réglages avancés restent repliés.

| Élément source | Cible simplifiée |
| --- | --- |
| Bandeaux avec plusieurs textes, badges et parcours guidés | Un titre, une phrase, le user actif, le périmètre et la période. Une seule action principale. |
| Répétition des mêmes totaux dans le bandeau, les cartes et les sections | Une zone principale de chiffres ; les détails expliquent le calcul sans créer une synthèse concurrente. |
| Nombreux réglages de graphes visibles | Graphe par défaut lisible ; bouton Options conservant les formats et séries utiles. |
| Catalogues de profils, tutoriels, définitions et visites guidées | Aide courte à la demande ; les valeurs proposées restent éditables. Aucun module Formation requis. |
| Plusieurs formulaires ouverts simultanément | Un éditeur d’opération et un éditeur d’objectif, ouverts par action explicite. |
| Détails Personne, Prestataire, devis et interventions | Retirés du socle BPM réduit. La description et les centres personnalisés couvrent le besoin retenu. |
| Liens de modification vers les pages métier des middleware | Formulaire BPM appelant leurs services. Les interfaces middleware restent réservées au test. |
| Graphes et listes déclinés en doublons | Composants partagés ; chaque représentation garde un sens précis et un jeu de données identifié. |

Les champs requis pour produire les chiffres restent disponibles. Une section avancée, telle que les hypothèses d’inflation ou la répartition du patrimoine, peut être repliée mais doit rester retrouvable. Retirer un écran du menu ne doit pas supprimer sa fonction sans correspondance documentée.

## 4. Adapter le code historique au socle retenu

| Sujet | Source observée | Consigne SOCLE |
| --- | --- | --- |
| Mot `standard` | Dans `FlowPilotProject`, `standard: true` identifie le Budget principal. `defaultForEntity` sélectionne aussi le cadre principal. | Ne pas traduire ce booléen en « Budget standard » métier. Utiliser une correspondance explicite principal / projet de la vie. |
| Projet de vie | Le principal est préparé avec le user ; l’assistant historique peut ajouter d’autres budgets. | Un seul principal par user, spécialisé sur Budget et nommé Projet de vie. Son noyau reste générique. |
| Patrimoine | L’assistant détecte le Patrimoine du user et évite de le recréer lorsqu’il existe. | Un seul Patrimoine. Budget principal et Patrimoine partagent la même racine noyau selon la cible. |
| Démarrage | La commande historique crée des enregistrements et peut reprendre le Patrimoine existant. | Passer par Object Management. Si le principal existe, le paramétrer ; ne pas en créer un second. Une nouvelle branche est créée de zéro avec son noyau et au moins une tâche. |
| Tâches | Opérations et tâches disposent de références facultatives. | Aucune création métier de tâche directement sur le principal ; exécution via les projets de la vie. Une opération courante n’engendre pas automatiquement une tâche. |
| Branche | Des liaisons et clôtures historiques existent par Budget. | Respecter la chaîne principale et les règles de flux père/enfants retenues. Ne pas recopier automatiquement une clôture patrimoniale autonome pour chaque branche. |
| Centres de coûts | Les formulaires savent choisir ou nommer un centre. | Standards selon le type de user ; nouvelle valeur dans la liste personnalisée de ce user uniquement. Pas de propagation globale. |
| Composition | Anciennes commandes d’assemblage et de rattachement libre. | Aucune interface Assembler l’existant ni dépendance à ces commandes dans les nouveaux écrans. |
| Stock | Les projections comportent des replis techniques à zéro. | Une valeur inconnue reste inconnue dans l’interface et le contrat de lecture ; ne pas publier une projection fiable avec un stock manquant. |

La reprise des pages concerne leur finalité, leurs nombres et leur esthétique. Les anciennes écritures de création ne sont pas une spécification d’Object Management. Pour les branches, la provision des tâches, les dépassements et les écritures de financement restent les points fonctionnels ouverts du contrat J1 ; ce guide ne leur invente pas de réponse.

## 5. Contexte de lecture et contrats de données

Chaque lecture doit annoncer : user fonctionnel, Budget principal, périmètre principal ou consolidé, date de calcul, début inclus et fin exclue. Les montants sont des entiers en centimes ; les taux sont des pourcentages ; les dates métier sont des dates ISO sans heure. La navigation ne change jamais la périodicité de clôture.

| Lecture | Données minimales à exposer |
| --- | --- |
| Contexte | `userId`, identité du principal et du Patrimoine, périmètre, `start`, `endExclusive`, `today`, révision, droits d’action. |
| Synthèse | Reçu, dépensé, net, entrées restantes, dépenses restantes, solde attendu ; état ouvert/clos. |
| Principal / branches | ID Budget, rôle métier explicite, noyau, père, entrées et charges réalisées/prévues. Chaque Budget apparaît une fois. |
| Registre | Opération, occurrence prévue, règlement/date réelle éventuels, statut, montant prévu/réel, centre, Budget et tâche éventuelle. |
| Patrimoine | Stock connu ou null, date, contributions déjà incluses, résultat prévisionnel ajouté, objectif et estimation. |
| Historique | Périodes ordonnées, réel/prévu distincts, état futur/ouvert/clos, contributions et stock s’ils sont disponibles. |
| Projection | Stock de départ connu, apport par période et sa source, rendement, inflation par année, horizon, objectifs, résultats annuels. |

Pour conserver les liens actuels, reprendre les paramètres utiles : `projet`, `du`, `au`, `lecture`, `vue` et, dans le registre, `q`, `etat`, `poste`, `budget`, `tache`, `par`, `operation`, `occurrence`. Normaliser les paramètres autorisés à l’entrée ; ne pas propager les filtres d’une autre page par copie aveugle.

**Priorité des fenêtres source :** des bornes explicites valides sont prioritaires ; sinon `lecture` détermine la fenêtre ; sinon la période active est utilisée. Le registre Dépenses suit par défaut le cycle du projet. Les vues semaine/mois/année sont des lectures ; la clôture appartient au cycle métier.

Après une écriture, recharger les projections affectées ou appliquer le résultat serveur cohérent. Empêcher qu’une réponse ancienne remplace celle d’un autre user, projet ou intervalle sélectionné entre-temps.

## 6. START - Démarrer de zéro

SOURCE : huit étapes dans `STEPS.new` : départ, situation, projet, budget, patrimoine, cycle, vision, vérifier. Le catalogue de navigation parle encore d’un assistant en quatre étapes ; le composant effectif fait foi pour l’inventaire.

CIBLE : sélectionner automatiquement le chemin nouveau. Retirer l’étape de choix de parcours et conserver les sept contenus utiles ci-dessous. Une barre d’avancement et les boutons Précédent / Continuer suffisent ; les noms techniques des objets restent dans le debug.

| Étape cible | Champs et contenu | Contrôle et résultat |
| --- | --- | --- |
| 1. Situation | User actif et type ; profil proposé ; aperçu revenus, charges, épargne naturelle. | Aucune identité choisie en saisie libre. Une proposition ne vaut pas donnée réalisée. Conserver les modifications du brouillon. |
| 2. Projet | Nom et description du noyau. Rôle principal ou branche fourni par le parcours appelant. | Nom non vide. Principal déjà créé : configurer son ensemble ; branche : créer ses objets de zéro et au moins une tâche initiale. |
| 3. Budget | Revenus et charges ; centre, montant, cadence, première date, fin éventuelle ; plafonds facultatifs. | Centimes valides ; références du user ; centre personnalisé si nécessaire. Ni Personne ni Prestataire obligatoires. |
| 4. Patrimoine | Stock initial / état connu, nom ou repère du Patrimoine existant ; détails disponibles à la demande. | Utiliser le Patrimoine unique ; absence de valeur explicitement affichée. Une branche ne crée pas un nouveau stock. |
| 5. Cycle | Semaine, mois ou année ; première période. Le code propose période courante, suivante et reprise passée. | Modifier le cycle principal selon le service retenu. Reprise passée dans Options, avec effets de clôture annoncés ; aucune nouvelle cadence autonome de branche inventée. |
| 6. Vision | Rendement annuel, épargne visée facultative et objectifs datés. | Objectif : libellé, type, montant positif, date ; hypothèses explicites ; possibilité de préciser plus tard. |
| 7. Vérifier | User, projet, rôle, revenus/charges, solde type, stock connu, cycle et objectifs. | Une confirmation déclenche une demande stable et cohérente ; retour au tableau de bord après succès. |

Sous-formulaires source : les centres, flux, actifs/allocations et objectifs sont modifiables dans `BpmStartDetailsComponent`. En cible, conserver l’édition des données retenues dans des détails repliables. Les personnes/prestataires disparaissent. Les actifs/allocations, s’ils sont disponibles dans le middleware retenu, restent des détails du stock ; ils ne deviennent pas des prérequis arbitraires au démarrage.

Chiffres de relecture : total des revenus récurrents, charges récurrentes, différence, et stock renseigné. SOURCE : conversion mensuelle des propositions hebdomadaires par 52/12 et annuelles par 1/12 ; les lignes ponctuelles sont exclues de cette moyenne. CIBLE : libeller explicitement « moyenne mensuelle » ; les dates déterminent ensuite les véritables périodes.

Une annulation ne crée aucun objet du brouillon. Une erreur conserve la saisie. Une reprise de confirmation ne duplique pas les objets. Les IDs et références proviennent d’Object Management. L’initialisation déjà faite avec le user est distinguée des nouveaux éléments à enregistrer.

Styles : `bpm-pages.scss`, `bpm-create.page.scss`, `bpm-start-details.component.scss`, styles communs de formulaires et bandeau. Classes utiles : `bs-layout`, `bs-stage`, `bs-field`, `bs-cadences`, `bs-recap`, `bs-rail`. La colonne d’avancement devient une rangée compacte sur petit écran.

## 7. DASH - Tableau de bord

But : lire la période d’un seul regard, puis ouvrir ce qui explique un montant. SOURCE : les trois cartes principales sont Reçu, Dépensé et Reste ; `summary()` remplace les montants du seul principal par la consolidation `flowPilot` lorsqu’elle existe.

| Zone cible | Chiffres conservés | Interactions et graphes |
| --- | --- | --- |
| Synthèse | Reçu ; dépensé ; reste réel ; solde prévu à la clôture. À recevoir / à payer en sous-valeurs. | Cliquer Reçu vers DETAIL-IN, Dépensé vers EXP et Reste vers DETAIL-NET. |
| Patrimoine | Stock enregistré, effet signé de la période, estimation après période, objectif et progression. | G03 ; détail du calcul à la demande. Ne pas additionner une clôture déjà incluse. |
| Budget et flux | Revenus récurrents/ponctuels ; charges ; impact des projets de la vie. | Listes courtes, bouton Voir tout ; ouverture de l’opération dans le même contexte. |
| Où va l’argent | Dépensé par centre, reste positif, part sur 100 €. | G01 ; détail d’un centre via DETAIL-CC. En déficit, les parts reposent sur les dépenses. |
| Historique | Entrées, dépenses, net et patrimoine connu par période. | G02 ; six périodes par défaut proposé, Options pour séries et formats ; sélection d’une période. |

Conserver une seule explication courte du calcul : `reste = reçu - dépensé`, puis `prévu = reste + à recevoir - à payer`. Le bouton Comprendre ouvre la décomposition, pas une nouvelle synthèse indépendante.

La source contient un libellé « Budget standard de la période » pour le quotidien du principal. En cible, préférer **Budget du projet de vie** pour respecter le vocabulaire fonctionnel retenu. Les agrégats consolidés indiquent explicitement qu’ils comprennent les branches.

États : aucun projet -> Démarrer ; période future -> prévisions sans faux réalisé ; période clôturée -> solde enregistré ; aucune opération -> valeurs zéro connues et invitation à saisir ; stock manquant -> À renseigner ; erreur réseau -> message et Réessayer.

Styles : `bpm-money.scss`, `metric-tiles.component.scss`, `bpm-dashboard-wealth.component.scss`, `bpm-dashboard-history.component.scss`. Garder les attributs de cadre `data-bpm-frame="metrics"` et `data-bpm-frame="chart"` ou adapter ensemble leurs sélecteurs et le markup.

## 8. Sous-pages - Entrées, centre de coûts et solde

Les trois sous-pages partagent titre, retour au tableau de bord, période et liste d’opérations. CIBLE : même composant de détail paramétré, avec des branches métier explicites.

| ID | Chiffres et détails | Actions minimales |
| --- | --- | --- |
| DETAIL-IN | Total reçu, encore attendu, ventilation par source, opérations réalisées et échéances. | Ajouter une entrée ; ouvrir/modifier une opération ; pointer une échéance si la règle de paiement retenue le prévoit. |
| DETAIL-CC | Payé, encore prévu, plafond facultatif, marge avec le prévu, part dans les entrées ou dépenses. | Modifier centre/note ; ajouter une dépense ; retrouver les échéances dans EXP. |
| DETAIL-NET | Reçu, payé, net, net attendu, date de clôture, effet patrimonial. | Rapprocher les soldes de compte ; ajouter explicitement le montant manquant après relecture. |

SOURCE : `entriesOf`, `pendingOf`, `subSums`, `shareBasis` et `unexplainedGap` dans `bpm-money.model.ts`. Les sommes d’un même libellé sont regroupées ; les opérations restent accessibles individuellement. Le reste est signé ; il ne peut pas devenir une part négative dans un camembert.

Rapprochement : saisir solde initial et solde actuel. Variation réelle = actuel - initial ; écart = variation réelle - net calculé. Écart négatif : dépense potentiellement manquante ; écart positif : entrée potentiellement manquante. L’interface propose une saisie, sans enregistrer une opération automatiquement à partir de l’écart.

La précision d’un centre ou d’une note porte, dans la référence, sur la définition de l’opération, donc potentiellement toutes ses échéances. Afficher cette portée avant de confirmer. Elle ne modifie pas les montants ni les dates des règlements. Une nouvelle valeur de centre suit l’isolation standard/personnalisé par user du socle.

Période clôturée : le code conserve les montants ; centre et note peuvent encore être précisés. Un oubli financier passe par la période ouverte selon le contrat métier retenu. Ne pas proposer de modifier un montant clos depuis un formulaire générique.

Styles : `bpm-pages.scss`, `bpm-money.scss`, `bpm-money-detail.page.scss`. Garder les cartes de détail et la liste des montants ; replier le rapprochement jusqu’à son ouverture.

## 9. EXP - Dépenses de la période et détail d’une échéance

But : retrouver chaque charge payée ou attendue, son projet, sa tâche éventuelle et son centre. Les sous-sections source sont : synthèse, filtres, regroupements, échéance dépliée, note et historique des paiements.

CIBLE : trois chiffres en haut (**Payé**, **À payer**, **Non réalisé**), recherche visible, puis liste groupée par centre. Projet, état, tâche et regroupement par projet/date passent dans Affiner. Les totaux annoncent qu’ils suivent les filtres actifs.

| Détail d’une ligne | Conserver |
| --- | --- |
| Identité | Libellé, Budget, noyau, tâche éventuelle, centre ; ID accessible dans Détails. |
| Échéance | Date prévue, date réelle si payée, montant prévu, montant réel et différence. |
| Définition | Cadence, première date, fin éventuelle, description/note et décision retenue. |
| Historique | Règlements de l’opération, avec distinction hors période. |
| Action | Ouvrir le même éditeur BPM d’opération ; pas de renvoi obligatoire vers l’interface middleware. |

Les panneaux Personne, Prestataire, appréciations, interventions et devis sont retirés de cette vue réduite. Une désignation de fournisseur utile peut être portée par le centre personnalisé ou la description, sans reconstituer un objet Prestataire.

**Différence de date à conserver et expliquer :** ce registre sélectionne les échéances par leur date prévue. Le tableau de bord calcule le réalisé selon la date réelle du paiement. Une charge prévue le 31 octobre et payée le 2 novembre peut donc figurer au registre d’octobre, tout en diminuant le réalisé de novembre. L’écart entre ces deux vues ne doit pas être corrigé en falsifiant leurs dates.

Le statut Non réalisé identifie une échéance restée sans règlement à la clôture ; ce montant n’entre pas dans Payé. SOURCE : `expenseRegister` dans `bpm-expenses.mjs` et les sommes de `BpmExpensesPage`.

Un lien profond vers une opération absente des filtres affiche un message et permet de réinitialiser/changer de période. L’ouverture d’un détail conserve recherche et position de lecture.

Styles : `bpm-expenses.page.scss`, `bpm-money.scss`, `bpm-pages.scss`. Sur petit écran, conserver le montant et l’état visibles ; le détail s’ouvre sans élargir toute la page.

## 10. PILOT - Graphiques et chiffres

SOURCE : une synthèse consolidée précède le « Zoom sur votre projet de vie ». Le reste de la page utilise surtout les lectures du principal, ses postes et ses objectifs. Cette différence de périmètre doit être visible en cible.

| Bloc source | Cible allégée | Données conservées |
| --- | --- | --- |
| Synthèse des flux | Deux chiffres réel/prévu et vue consolidée des projets | G04 et G05, avec une explication courte de leur axe. |
| Repères du principal | Net, net attendu, épargne nécessaire, marge restante | Origine de l’épargne et période d’unité explicites. |
| Réel face au prévu | Graphe G06 | Fenêtres temporelles, barres signées et prolongement futur en pointillé. |
| Centres | G07 et tableau court | Payé, encore prévu, plafond et marge par centre. |
| Revenus | Liste par source | Reçu et attendu ; détail par clic plutôt qu’un second formulaire. |
| Événements à préparer | Liste repliable | Date, coût futur, périodes disponibles et provision par période. |
| Budget type | Résumé entrées / charges / épargne naturelle | Bouton Modifier vers ACT ; pas de formulaire dupliqué. |
| Avancement | G08 | Temps écoulé dans la période et progression de l’épargne ; indicateurs distincts. |
| Clôtures | Tableau compact | Période, résultat signé, patrimoine après clôture s’il est connu. |

G04 compare le réalisé au total prévu : ses courbes ne représentent pas un historique. G06 est, lui, une lecture chronologique. Garder cette différence de sens même si les deux composants utilisent des courbes SVG.

La lecture semaine/mois/année peut convertir un objectif ou un plafond moyen ; elle ne transforme pas les montants réels en moyennes. Les bornes temporelles des règlements restent celles de la vue demandée.

Styles : `bpm-flow-pilot.component.scss`, `bpm-vision.page.scss`, `bpm-pilot-charts.scss`, cartes de métriques. Le partage du SCSS de Vision dans le code actuel est une dépendance visuelle historique ; Codex peut en extraire les classes communes sans déplacer les règles financières.

## 11. ACT - Ce qu’il faut faire et formulaires

Une action principale : **Ajouter une entrée ou une charge**. Une liste d’échéances et les directives viennent ensuite. Budget type, objectif d’excédent et simulation restent accessibles en panneaux.

| Fonction | Champs / résultat | Garantie |
| --- | --- | --- |
| Créer/modifier une opération | Budget cible, entrée/sortie, libellé, montant, centre, date, cadence, fin facultative, note ; tâche éventuelle sur une branche. | Même objet en modification ; pas de Personne/Prestataire ; user et rattachements contrôlés. |
| Aperçu avant enregistrement | Résultat avant/après, variation du solde attendu et du stock estimé connu. | `preview` est une lecture ; aucune écriture ni clôture déclenchée. |
| Budget type | Plusieurs revenus/charges, montants et rythmes éditables ; total moyen et solde. | Enregistrement cohérent ; pas de recréation des lignes déjà présentes. |
| Échéances | Montant, date et état ; pointer ou annuler selon les règles retenues. | Une occurrence n’est pas réglée deux fois ; période close protégée. |
| Directives | Épargne demandée, provisions, plafond, disponible et montant indicatif par semaine. | Lire le même modèle que les chiffres ; afficher Non calculable si les entrées nécessaires manquent. |
| Objectif d’excédent | Montant cible, nombre de périodes et date de départ. | L’enregistrement modifie l’objectif, pas le stock. |
| Simulation | Effort supplémentaire par période, patrimoine futur et gain par rapport au scénario de base. | Calcul local sans mutation jusqu’à une action explicite d’adoption. |

SOURCE : les cadences d’opérations sont ponctuelle, hebdomadaire, mensuelle et annuelle. Un type est demandé pour une entrée ponctuelle. Le budget type calcule une moyenne par fréquence ; la véritable trésorerie suit les échéances.

SOURCE : les opérations approuvées peuvent être réalisées automatiquement à leur échéance par `budget-automatic.mjs`. Les commandes de pointage existent aussi. CIBLE : l’interface consomme la règle du middleware retenu ; elle ne doit ni créer un second règlement après une réalisation automatique ni présenter une future charge comme déjà payée. La conservation de cette politique métier doit être explicitée lors du lot d’écritures.

Le calendrier du noyau n’est pas requis pour utiliser ces formulaires. Une date peut être saisie directement. Les actions irréversibles ou ayant un effet financier annoncent cet effet avant leur confirmation ; les simples filtres et simulations restent immédiats.

Styles : `bpm-flow-editor.component.scss`, `bpm-month-type.component.scss`, `bpm-pages.scss`, `bpm-vision.page.scss`, `_forms.scss`. Les classes et tailles de contrôle restent cohérentes entre création, détail et correction.

## 12. FUTURE - Objectifs et avenir

Conserver la page et toutes ses familles de contenus, avec une lecture principale courte : hypothèses compactes, chiffres clés, graphe et objectifs. Les formulaires et fonctions patrimoniales détaillées passent dans Modifier / Options.

| Zone | Chiffres / fonction | Présentation cible |
| --- | --- | --- |
| Résultats | Patrimoine nominal à l’horizon ; valeur en euros d’aujourd’hui ; rendement réel ; érosion sans rendement | Quatre cartes compactes. Date d’horizon et statut Estimation visibles. |
| Objectif budgétaire | Minimum par période ; cible cumulée ; effort nécessaire ; progression | G12, avec un seul accès de modification. |
| Cap patrimonial | Objectif de stock, valeur connue, manque ou dépassement | G03/G12 ; ne pas déduire une fin d’usage automatique. |
| Apport de projection | Montant par période et origine : objectif, récurrent, historique ou aucun | Phrase courte ; comparaison à la moyenne réelle si disponible. |
| Projection annuelle | Nominal, valeur réelle et repères d’objectifs | G09 ; légende et valeurs consultables. |
| Objectifs de vie | Type, libellé, date, cible en euros actuels, couverture et statut | G10 ; ajouter/modifier/retirer via un formulaire. |
| Répartition | Allocations et valeurs connues ; association éventuelle d’un objectif | G11 et liste courte, si ces données sont fournies par le Patrimoine retenu. |
| Hypothèses | Rendement annuel, inflation par année et source, horizon de projection | Panneau Options ; recalcul cohérent après enregistrement. |
| Versement entre actifs | Source, destination, montant et date | Fonction avancée de la source ; appel au middleware Patrimoine si retenue, jamais une simple modification de graphe. |

Les types source sont études, retraite, achat, sécurité, transmission et autre. Études/achat/autre consomment le capital dans la projection ; retraite/sécurité/transmission le réservent sans le retirer du stock nominal. L’enregistrement d’un objectif ne réalise aucun paiement.

La source permet aussi des décisions de phase patrimoniale (accumulation/allocation) et des dépassements de cap. Les afficher dans le panneau avancé uniquement si le contrat Patrimoine les retient. Ces choix et les actifs ne sont pas nécessaires pour afficher le graphe de base à partir d’un stock connu. Leur présence dans l’ancienne page ne clôture pas les questions C09/C10 du socle.

La comparaison « apport retenu / moyenne réelle » apparaît à partir de deux clôtures, lorsque la projection ne repose pas déjà sur cette moyenne. Conserver les deux scénarios avec leurs mêmes autres hypothèses ; replier le tableau de comparaison.

Styles : `bpm-vision.page.scss`, `bpm-objectives.component.scss`, `bpm-project-switch.component.scss` et métriques communes. Préserver les classes de statut des objectifs et les styles nominal/réel des courbes.

## 13. Catalogue des graphes à reprendre

| ID | Graphe et page | Données / représentation | Source technique |
| --- | --- | --- | --- |
| G01 | Parcours de chaque euro / DASH | Barre segmentée par centre, reste positif ; lecture sur 100 € reçus ou dépensés. | `moneySegments`, `perHundred`, `bpm-money.scss`. |
| G02 | Historique / DASH | Courbes et barres par période ; réel, attendu, patrimoine, contributions et séparation principal/branches. | `bpm-dashboard-history.component.ts`, `.model.ts`, `.scss`. |
| G03 | Cap patrimonial / DASH et FUTURE | Stock et estimation face à une cible, valeur restante/dépassement. | `bpm-dashboard-wealth.component.*`, `bpm-objectives.component.*`. |
| G04 | Réalisé vers prévu / PILOT | Entrées, charges et solde ; une liaison graphique entre les deux états. Ce n’est pas un axe temporel. | `bpm-flow-pilot.component.*`, bloc `fp-bridge`. |
| G05 | Impact des projets / PILOT | Entrées, charges et nets par Budget, réalisés et attendus, axe partagé. | Même composant, bloc `fp-projects`. |
| G06 | Réel face au prévu / PILOT | Barres signées par fenêtre ; courbe du réel, prolongement prévisionnel différencié. | `lensBars`, `historyCurve`, `bpm-pilot-charts.scss`. |
| G07 | Plafonds et marges des centres / PILOT | Payé, prévu restant, plafond et dépassement. | `centerAllowances`, `bpm-vision.page.scss`. |
| G08 | Avancement de période / PILOT | Épargne réalisée / cible ; progression et temps écoulé distincts. | `ratio`, `rhythm`, classes `bp-progress` et `bv-progress`. |
| G09 | Projection patrimoniale / FUTURE | Deux courbes annuelles nominal/réel, surface et repères d’objectifs. | `visionProjection`, `visionChart`, classes `bv-chart`, `bv-nominal`, `bv-real`. |
| G10 | Couverture des objectifs / FUTURE | Couvert / cible nominale à la date ; statuts finançable, partiel, non financé, hors horizon. | `GoalReading`, classes `bv-goal`, `bv-progress`. |
| G11 | Répartition patrimoniale / FUTURE | Parts des allocations quand les valeurs sont connues. | Section `bv-alloc-title` et modèles d’allocations. |
| G12 | Objectifs budget et patrimoine / FUTURE | Progression de l’excédent cumulé et cap de stock ; valeurs actuelles et cibles. | `BpmObjectivesComponent`, `budgetSurplusProgress`. |

G02 possède six formats dans la source : combiné, courbes, barres, aire, camembert et anneau. Les conserver dans Options, avec des compositions préréglées plutôt que toutes les cases ouvertes. Proposition de défaut : entrées/dépenses en barres et net en courbe ; une variante patrimoine reste immédiatement accessible.

Pour camembert/anneau, seules des répartitions comparables sont admises : mouvements, origine des revenus, origine des dépenses, réalisé/restant des revenus ou dépenses. Ne pas additionner un stock avec ses flux, ni ajouter un net à ses propres entrées/sorties pour constituer un tout. Les signes restent explicites dans les valeurs ; le camembert ne représente pas un solde négatif.

Un graphe sans données affiche un état vide ; une série inconnue est absente/interrompue, jamais reliée à un faux zéro. Les axes partagent la même échelle dans une comparaison. Les montants signés, unités et dates restent lisibles. Les valeurs sont accessibles au clic/clavier ou dans un tableau associé ; les informations essentielles ne dépendent pas d’un survol.

## 14. Formules et sémantique à préserver

| Indicateur | Définition |
| --- | --- |
| Net réalisé | `incomeCents - expenseCents`. Les entrées/sorties réelles suivent leur date réelle. |
| Net attendu | `netCents + remainingIncomeCents - remainingExpenseCents`. Les échéances déjà réglées ne restent pas dans le restant. |
| Marge prudente avant entrées futures | `netCents - remainingExpenseCents`. À distinguer du net attendu. |
| Base des parts | Entrées si positives et au moins égales aux dépenses ; sinon dépenses. Si base nulle : aucune part calculable. |
| Somme par libellé | Addition des montants des opérations réelles sélectionnées ; ordre décroissant, libellé en second critère. |
| Moyenne de budget type | Montant × fréquence annuelle / nombre de périodes annuelles ; 52, 12 ou 1. Les ponctuels sont traités séparément. |
| Apport de projection | Épargne visée si renseignée, y compris zéro ; sinon solde récurrent connu ; sinon moyenne des clôtures ; sinon source Aucun. |
| Besoin d’épargne | `requiredContribution` recherche au centime l’apport finançant les objectifs de l’horizon. Peut être négatif ; null si non déterminable/sans objectif pertinent. |
| Plafond de dépenses | Revenus attendus - maximum(besoin d’épargne, 0) - provision d’événements. |
| Marge restante | Plafond - dépensé - dépenses encore prévues. Peut être négative. |
| Indication par semaine | Maximum(marge, 0) / maximum(jours restants / 7, 1), arrondi. |

Projection annuelle source : rendement appliqué au capital de l’année précédente, puis apport annuel ajouté, puis traitement des objectifs de l’année. Le modèle ne simule pas un rendement mensuel composé.

```text
apport_annuel = apport_par_période × (52 ou 12 ou 1)
indice_prix[n] = indice_prix[n-1] × (1 + inflation[n] / 100)
capital_avant_objectifs[n] = capital[n-1] × (1 + rendement / 100) + apport_annuel
objectif_nominal[n] = cible_en_euros_actuels × indice_prix[n]
couvert = min(max(capital_disponible, 0), objectif_nominal)
capital_réel[n] = capital_nominal[n] / indice_prix[n]
rendement_réel = (1 + rendement / 100) / (1 + inflation / 100) - 1
```

Les objectifs sont traités par date ; ceux de l’année de départ sont évalués avant le premier rendement annuel. Les objectifs à dépenser réduisent le nominal ; ceux à conserver immobilisent une part pour les suivants. La source réévalue leur financement en cas de déficit ultérieur. Les objectifs hors horizon restent identifiés comme tels, sans annoncer qu’ils sont financés.

Patrimoine estimé de période : partir du stock connu en distinguant les contributions déjà incluses. SOURCE : `periodWealthSummary` utilise `standing.totalCents - standing.budgetFlowCents + historicalFlowCents + currentClosureCents`. Cette formule remplace la part budgétaire par celle du périmètre lu ; elle n’ajoute pas une clôture deux fois. La cible doit obtenir cette décomposition du middleware adapté, sans la recalculer différemment dans chaque écran.

Les paramètres 52/12, l’ordre annuel, la conversion des valeurs réelles et les arrondis sont des comportements de référence observés ; une évolution future passe par une décision métier et des exemples de non-régression.

## 15. Services, commandes et gestion des erreurs

Les URL suivantes sont des références de l’ancien service. Leurs capacités doivent être retrouvées ; les routes finales et le stockage restent à Codex dans le cadre du socle.

| Capacité | API source | Contrat cible |
| --- | --- | --- |
| Lire le contexte | `GET /api/bpm/workspace` | Données du user autorisé, principal et branches ; pas de dépendance Formation. |
| Lire un relevé | `GET /api/bpm/projects/:id/statement?start=...&end=...` | Bornes inclus/exclu, périmètre, réel, attendu et décomposition patrimoniale. |
| Lire les dépenses | `GET /api/bpm/projects/:id/expenses` | Registre par date prévue et détails minimaux retenus. |
| Démarrer de zéro | `POST /api/bpm/projects` | Commande adaptée à Object Management ; unicités et reprise cohérente, création ou paramétrage selon la situation. |
| Créer/modifier une opération | `POST/PATCH /api/bpm/projects/:id/flows` | Montants, dates et références contrôlés ; révision attendue. |
| Prévisualiser | Même route avec `preview: true` | Résultat avant/après sans mutation. |
| Préciser centre/note | `PATCH .../flows` | Portée de l’opération explicite ; aucun changement financier caché. |
| Pointer/annuler | `POST/DELETE .../settlements` | Identité d’occurrence, contrôle des doubles règlements et des clôtures. |
| Enregistrer les objectifs | `PUT .../vision` | Rendement, épargne et objectifs validés ; projection recalculée. |
| Inflation | `PUT /api/bpm/inflation` | Année, taux et portée au user ; source effective retrouvable. |
| Fonction patrimoniale avancée | `POST .../transfers` ou `.../patrimoine-lifecycle` | Appeler uniquement le contrat Patrimoine effectivement retenu. |

Les anciennes routes `/assemblies`, `/assembly` et le détachement d’assemblage ne sont pas des dépendances des nouvelles pages. Les objets Personne/Prestataire ne doivent plus être nécessaires aux DTO ou à la validation d’une opération.

Erreurs visibles : accès refusé, référence absente/incompatible, saisie invalide, modification concurrente, service indisponible. Conserver le brouillon, annoncer le résultat réellement persistant et proposer de relire en cas de conflit. Un aperçu ou une navigation ne doit pas écrire dans les données métier. Une réussite de saisie invalide les lectures concernées.

## 16. Styles - identité visuelle à conserver

Les feuilles livrées sont celles du commit vérifié, sans réécriture de leurs déclarations. Elles constituent des sources de référence à intégrer par sélection, après adaptation du markup simplifié.

| Couche | Fichiers essentiels | Rôle |
| --- | --- | --- |
| Valeurs | `_contrat.scss`, `_tokens.scss`, `_contrat-ruptures.scss`, `_functions.scss` | Couleurs, espacements, tailles, rayons, ruptures et fonction `scaled`. |
| Base | `_fonts.scss`, `_base.scss`, `_identities.scss` | Polices, thème, fond, textes et accents du module. |
| Contrôles | `_components.scss`, `_forms.scss`, `_interactions.scss` | Boutons, panneaux, formulaires, focus et interactions. |
| Structure | `_shell.scss`, `_site-responsive.scss`, `_surface-language.scss`, `_bpm-presentation.scss` | Conteneur, adaptations, hiérarchie des surfaces et cadres BPM. |
| Partagé | `app-hero.component.scss`, `metric-tiles.component.scss`, `period-navigation.component.scss` | Bandeau, chiffres et navigation de période. |
| Pages | `bpm-pages.scss` puis feuilles de chaque écran | Mise en page métier et classes locales des graphes. |

Typographie source : Inter pour l’interface ; IBM Plex Mono pour certains nombres/libellés ; Newsreader pour les parties éditoriales, notamment le texte du bandeau dans la couche finale BPM. Les styles de base et la couche de présentation déterminent ensemble le résultat. Ne pas remplacer tout le site par une unique police en ne lisant que `_tokens.scss`.

Sens des couleurs : succès/excédent, attention/provisoire, danger/déficit. L’accent de navigation reste distinct du signe financier. Les séries utilisent les variables `--history-*` et les classes source ; une même mesure conserve sa couleur lorsqu’elle change de format. Les états restent lisibles par libellé, signe ou motif.

Préserver les coins, ombres, fonds, lignes, espacements et niveaux de cartes du repository, tout en réduisant le nombre de blocs ouverts. Les valeurs de thème restent centralisées. Les ajustements mobiles et `prefers-reduced-motion` sont conservés.

## 17. Styles - intégration et pièges de cascade

1. Lire la correspondance composant/SCSS et les templates de référence dans l’archive.
2. Déclarer le chemin Sass des utilitaires. SOURCE Angular : `stylePreprocessorOptions.includePaths = ["src/styles"]`. Les `@use 'functions'` et `@use 'contrat-ruptures'` doivent se résoudre.
3. Reprendre les variables générées et le thème avant les composants ; ajouter ensuite les styles des pages.
4. Conserver ou adapter ensemble `.app-shell`, `main`, `.bpm-reading`, `data-module`, `data-space`, `data-ui-pattern` et `data-bpm-frame`.
5. Garder les styles globaux à leur portée globale : la couche `_bpm-presentation.scss` cible notamment les composants enfants. La déplacer dans un composant encapsulé peut annuler son effet.
6. Charger les polices localement comme la source ; adapter les chemins des fichiers à l’arborescence du nouveau projet.
7. Après validation visuelle, retirer les sélecteurs et jetons inutilisés des modules exclus ; vérifier que le retrait ne change pas la cascade retenue.

**Ne pas importer en bloc le fichier historique `styles.scss`.** Il importe aussi Formation, les calendriers et d’autres domaines hors périmètre. Il est livré comme référence textuelle de l’ordre des couches, sous `reference-entree-globale.styles.scss.txt`. L’archive fournit séparément les feuilles utiles et leurs dépendances Sass locales.

Polices déclarées dans le package source : `@fontsource/inter`, `@fontsource/ibm-plex-mono`, `@fontsource-variable/newsreader`, tous en plage `^5.3.0`. Ce sont les déclarations observées, pas un verrouillage de version résolue. Les fichiers binaires de polices ne sont pas inclus dans l’archive ; Codex doit prévoir leur installation et les chemins de build. Les versions finales seront figées avec le projet reconstruit.

Les préférences de design peuvent également être surchargées par `DesignRuntimeService`, à la portée site -> module -> espace. Conserver le mécanisme du nouveau socle s’il existe ; les valeurs par défaut de `_contrat.scss` et des tokens suffisent comme base de référence. La présente livraison ne constitue pas un relevé des réglages d’une session de production.

Exemple de structure compatible avec les sélecteurs globaux ; adapter les éléments aux composants retenus :

```html
<div class="app-shell" data-module="bpm" data-space="bpm-parcours">
  <main>
    <div class="bpm-page bpm-reading">
      <section data-ui-pattern="panel" data-bpm-frame="metrics">...</section>
      <section data-ui-pattern="panel" data-bpm-frame="chart">...</section>
    </div>
  </main>
</div>
```

## 18. Jeux de données et critères d’acceptation

Ces exemples constituent des attentes de recette pour la reconstruction ; ils ne sont pas des résultats d’exécution de la nouvelle application.

| Cas | Entrées d’essai | Résultat attendu |
| --- | --- | --- |
| Période bénéficiaire | Reçu 3 000 €, payé 2 000 €, reste à recevoir 200 €, reste à payer 400 €. | Net 1 000 €, attendu 800 €, marge avant revenus futurs 600 €. |
| Déficit | Reçu 1 000 €, payé 1 200 €, attendu 300 € en entrée et 50 € en sortie. | Net -200 €, attendu +50 € ; parts sur les dépenses, pas un faux reste positif réalisé. |
| Stock négatif | Stock -500 €, contribution de période -200 € non encore incluse. | Estimation -700 € ; aucune borne à zéro et aucune désactivation automatique. |
| Estimation inconnue | Stock initial null. | À renseigner ; pas de courbe patrimoniale réputée fiable issue d’un zéro implicite. |
| Clôture déjà incluse | Stock connu 10 000 €, dont une clôture de 800 € ; lecture du même résultat. | Ne pas afficher 10 800 € par double addition. |
| Échéance et paiement | Charge 100 € prévue le 31 octobre, réglée le 2 novembre. | Registre d’octobre par prévu ; réalisé de novembre par date réelle. |
| Projection simple | Départ 10 000 €, apport mensuel 100 €, rendement 0 %, inflation 0 %, aucun objectif, un an. | Nominal et réel 11 200 €. |
| Projection avec inflation | Même départ/apport, rendement 5 %, inflation 2 %, un an. | Nominal 11 700 € ; réel 11 470,59 € après arrondi au centime. |
| Objectif consommé / conservé | Départ 10 000 €, cible immédiate 2 000 €, aucun rendement/apport. | Achat : nominal 8 000 €. Sécurité : nominal 10 000 €, 2 000 € réservés dans la projection. |
| Financement insuffisant | Départ 1 000 €, cible immédiate 2 000 €. | Couvert 1 000 €, 50 %, partiel ; aucune promesse de financement complet. |
| Personnalisation isolée | U1 crée un centre absent du catalogue. | Visible comme centre personnalisé de U1 ; absent du nouveau user U2. |
| Rejeu de démarrage | Même demande confirmée deux fois ou après réponse perdue. | Même ensemble, aucun principal/Patrimoine/branche supplémentaire. |

Ajouter les contrôles suivants aux tests pertinents : filtres et retour arrière conservés ; ancien appel réseau ignoré après changement de contexte ; somme des graphes conforme aux tableaux ; aperçu et simulation sans mutation ; période close protégée ; aucune dépendance Formation/Personne/Prestataire/assemblage ; aucun générateur d’ID dans les composants.

Recette visuelle proposée : ordinateur 1440 px, tablette 1024 px et 768 px, petit écran 390 px. Vérifier les signes négatifs, grands montants, listes vides, longues descriptions, objectifs hors horizon, mode sombre si retenu, focus clavier et gestes tactiles. Les barres d’une même comparaison doivent garder la même échelle ; les zéros et données absentes doivent être distingués.

## 19. Lots de réimplémentation proposés

| Lot | Travail | Preuve attendue |
| --- | --- | --- |
| B0 - préparer | Lire le guide, la source figée et le socle ; proposer les adaptateurs et la sélection des styles. | Correspondance écrans/contrats/styles ; écarts et questions métier identifiés. |
| B1 - lecture et styles | Contexte user/période, DTO, composants bandeau/chiffres/graphes, fixtures fictives. | Navigation de toutes les destinations retenues ; rendu des styles et états vides/erreurs. |
| B2 - démarrage | Parcours de zéro et confirmation via les commandes d’Object Management. | Unicités, reprise, données persistées et arrivée au tableau de bord. |
| B3 - période et détails | DASH, EXP et les trois détails ; lecture réelle des opérations et historique. | Chiffres concordants ; distinction dates prévues/réelles ; absence de doubles comptes. |
| B4 - pilotage et actions | PILOT, ACT, éditeur d’opération, budget type, échéances et simulations. | Aperçu sans écriture, écritures cohérentes, protection des clôtures. |
| B5 - avenir | Objectifs, projection, hypothèses et fonctions patrimoniales effectivement retenues. | Exemples chiffrés vérifiés ; inconnus/hors horizon ; aucune mutation par projection. |
| B6 - réception | Campagne pertinente, revue mobile, suppression des dépendances exclues, documentation du livré. | Code identifié, résultats exécutés, écarts, captures de recette et décision RJS. |

Un lot produit un résultat examinable. Les détails techniques compatibles avec les invariants restent à Codex. Les points fonctionnels encore ouverts sont explicités avant le lot concerné ; une fixture n’en tient pas lieu de décision.

## 20. Demande de départ prête à fournir à Codex

```text
Travaille sur la réimplémentation de RJS_Forecast selon ce guide et le socle retenu.
Lis d’abord les sections 1 à 5 et les inventaires JSON de l’archive.
Le repository de référence est figé au commit indiqué dans le manifeste.

Objectif : reprendre Démarrer de zéro et toutes les pages/détails de Ma vision
budgétaire, avec les chiffres clés et graphes, en allégeant leur présentation.
Reprends l’identité visuelle à partir des SCSS fournis et de leur cascade.

Respecte Object Management, les IDs stables, le principal/Patrimoine uniques,
le type porté par Budget et les projets de la vie avec leur propre noyau.
Attention : le booléen standard de certains DTO historiques désigne le principal.
N’importe pas les parcours d’assemblage, Formation, Personne ou Prestataire.

Commence par B0. Remets une proposition courte : composants, contrats de données,
styles réutilisés et écarts. N’entreprends pas tous les lots en une session.
Pour chaque lot ensuite, livre code identifié, tests réellement exécutés,
résultat visible et limites. Conserve les chiffres et leur sémantique ; ne décide
pas silencieusement d’une règle financière encore ouverte dans le socle.
```

## 21. Références techniques et annexes

Chemin commun des composants cités : `site/apps/web/src/app/bpm/`. Les modèles et pages correspondants sont fournis dans l’archive sous leur arborescence de référence. Les fichiers sources restent historiques : leur présence ne signifie pas qu’il faut copier leurs dépendances exclues.

| Référence | Usage dans la reconstruction |
| --- | --- |
| `navigation-catalog.json` + `app.routes.ts` | Périmètre réel des cinq pages, détails, alias et gardes. |
| `bpm-create.page.ts` + `bpm-start.model.ts` | Étapes, brouillon, propositions et validation de démarrage. |
| `bpm-money.page.ts` + `bpm-money.model.ts` | Synthèse, consolidation, parts et calculs du relevé. |
| `bpm-money-detail.page.ts` | Détails, précision d’une opération et rapprochement. |
| `bpm-expenses.page.*` + `bpm-expenses.mjs` | Registre par date prévue, détail et états. |
| `bpm-pilot.page.ts` + `bpm-lens.model.ts` | Vues temporelles, comparaisons, directives et actions. |
| `bpm-flow-pilot.component.ts` + `bpm-flow-pilot.mjs` | Consolidation, comparaison réel/prévu et décomposition patrimoniale. |
| `bpm-dashboard-history.component.ts` + `.model.ts` | Historique, formats et combinaisons admissibles de séries. |
| `bpm-vision.page.ts` + `bpm-vision.model.ts` | Projection, objectifs, inflation et effort nécessaire. |
| `bpm-objectives.component.ts` | Objectifs budgétaires et cap patrimonial. |
| `bpm.store.ts` + `bpm-routes.mjs` | Capacités API et gestion des révisions ; adapter les écritures au nouveau socle. |
| `bpm-profile.model.ts`, `bpm/reglages.csv`, `bpm/inflation-reference.csv` | Valeurs de référence ; ne pas les présenter comme des données réelles du user. |
| `styles-source/` + `annexes/correspondance-styles.json` | Feuilles SCSS, utilitaires, polices et correspondance par page. |
| `annexes/manifest-source.json` | Commit, chemins, liens GitHub, empreintes des fichiers et contenu du dossier. |

Limites de la vérification : inventaire et règles rapprochés du code courant du repository au commit indiqué ; aucune consultation d’une session de production et aucune recette navigateur de l’ancienne application pendant cette rédaction. Les contrôles de la livraison documentaire portent sur ses fichiers, leurs références et leur cohérence. Les tests de la future application restent à exécuter lors de la réalisation.
