

<pasted_content id="f7df">
corrections et interfaces BPM

Tu interviens sur l’application RJS_Forecast existante. Fais évoluer cette base, en conservant les parties conformes et les données existantes.

La mission comporte deux résultats : fiabiliser les mécanismes déjà codés et mettre en place les pages, sous-pages, contenus et graphes décrits ci-dessous. Ce prompt constitue la demande fonctionnelle autonome pour ce travail.

Commence par examiner le code et identifier les services concernés. Présente un plan court, puis commence l’implémentation. Travaille en lots cohérents, avec des résultats vérifiables. Tu choisis les détails techniques compatibles avec les contraintes exprimées ; une réorganisation technique ne doit pas changer une règle métier.

1. Architecture et règles à conserver

	●	Le noyau contient les projets et les tâches génériques. Un projet explique son objectif, regroupe ses tâches et agrège leur état et leurs temps. Une tâche peut être autonome ou rattachée à un projet. Conserve les règles existantes et validées de calcul des états et leur affichage par colonnes.
	●	Object Management centralise la création des IDs métier, les références, la provenance, les créations composées et leur rejeu. Aucun composant d’interface ne génère un ID métier ni ne reconstitue lui-même une composition.
	●	Pour un user dans l’application BPM, il existe exactement un Budget spécialisé « projet de vie » et un Patrimoine unique, avec leur composition principale et leur racine noyau. La création du user initialise cet ensemble de façon atomique et rejouable.
	●	Le type « projet de vie » est porté par l’objet Budget, jamais par le projet noyau. Le noyau reste générique.
	●	Un « projet de la vie » comprend un Budget standard, son propre projet noyau et son rattachement au Budget principal. Son parcours de création de zéro comprend au moins une tâche ; il ne crée pas un nouveau Patrimoine.
	●	Les parcours métier créent les tâches dans les projets de la vie, sans proposer de création directement sur le projet de vie. La généricité technique du noyau est conservée. Une tâche rattachée au noyau d’un Budget standard est qualifiée de « tâche d’un projet budgétisé ».
	●	Budget et Patrimoine restent deux objets distincts, composés au niveau applicatif BPM. Les services financiers sont dans les middleware concernés ; BPM orchestre et présente leurs résultats.
	●	À la clôture, le résultat signé de la période est capitalisé une seule fois dans le Patrimoine, y compris s’il est nul ou négatif. Le nouveau cycle repart à zéro et l’historique est conservé. Un Patrimoine négatif est autorisé sans borne de durée.
	●	Les centres de coûts standards dépendent du type de user. Un nouveau centre saisi par l’utilisateur est ajouté à sa liste personnalisée uniquement ; il ne rejoint pas le catalogue global.
	●	La gestion des utilisateurs est distincte de l’Administration. Conserve leurs responsabilités et les interfaces existantes. Les pages Budget et Patrimoine de niveau middleware restent des interfaces de test ; les actions métier passent par BPM.
	●	Les modules Formation et leurs dépendances, les objets Personne et Prestataire, ainsi que le parcours d’assemblage d’objets existants restent exclus. Un fournisseur peut être représenté par un centre personnalisé ou une description.

Ne change pas les IDs existants lors des modifications. Préserve les données déjà enregistrées ; si un changement de modèle l’exige, prévois une migration explicite et testable.

2. Corrections à réaliser en premier

C01 — Lecture historique des périodes closes

Le résultat d’une clôture doit rester cohérent avec la capitalisation réellement enregistrée, même si une formule ou un paramètre est modifié ensuite.

Cas à couvrir : clôture à 100 €, puis modification de la formule courante ajoutant 1 €. La période close doit toujours présenter son résultat enregistré de 100 € et son effet patrimonial cohérent. Un éventuel recalcul comparatif doit être présenté séparément et explicitement, sans remplacer l’historique.

Conserve la formule, ses paramètres ou leurs versions et les données nécessaires pour expliquer la clôture. Corrige notamment la lecture du dashboard dans api/src/modules/bpm/index.mjs, qui réévalue actuellement les métriques avec les formules courantes.

C02 — Montant annoncé avant clôture

La confirmation de clôture doit afficher le résultat qui sera effectivement capitalisé. Ce montant ne doit dépendre ni de l’ordre des cartes ni de la première métrique du tableau de bord.

Cas à couvrir : revenus 100 €, charges 20 €, carte Revenus placée en premier. La confirmation annonce 80 € et la clôture transfère 80 €. Corrige la dépendance à heroText() dans web/src/app/bpm/dashboard.ts. Le calcul de confirmation et la commande de clôture partagent le même contrat ; si les données changent entre les deux, demande une relecture plutôt que de confirmer un montant périmé.

C03 — Réalisation future

Une opération ou un règlement futur ne peut pas être présenté comme déjà réalisé aujourd’hui. Contrôle cette règle dans les services, en création comme lors du pointage, pour les revenus et les charges.

Cas à couvrir : aujourd’hui 3 novembre, revenu de 500 € prévu le 25 novembre. Il contribue au prévisionnel et non au réalisé. Refuse une demande de réalisation future avec un message clair ; conserve le brouillon pour permettre sa saisie comme prévision. Ne modifie pas silencieusement le statut demandé.

Cette correction ne décide pas d’une politique de réalisation automatique à l’échéance.

C04 — Distinguer budget initial et solde attendu

Conserve, si utile, le budget prévisionnel initial comme référence distincte. Le « solde prévu à la clôture » doit être calculé ainsi :

net réalisé = revenus effectivement reçus - dépenses effectivement payées

solde attendu = net réalisé + revenus restant à recevoir - dépenses restant à payer

Une échéance déjà réglée ne reste pas une seconde fois dans le restant. Cas à couvrir : revenu prévu 100 €, reçu 120 €, dépense future 50 € → net réalisé 120 €, solde attendu 70 €. La valeur initiale de 50 € peut rester un indicateur de référence, avec un nom différent.

C05 — Diagnostic d’un objet et diagnostic global

Corrige api/src/socle/object-management/inspect.mjs : les IDs d’objets affectés doivent être séparés des messages décrivant les anomalies.

Lorsqu’une tâche possède une référence projet invalide, le contrôle global et la ligne de cette tâche doivent tous deux indiquer l’anomalie. La fiche de l’objet permet de comprendre la référence concernée. Étends la cohérence aux références obligatoires absentes, aux natures incompatibles, aux références vers un autre user et aux objets manquants d’une demande de création.

Un résultat non exécuté reste distinct d’un résultat réussi.

C06 — Ensemble principal obligatoire lorsque BPM est actif

Dans une configuration noyau isolée, la composition BPM peut ne pas être applicable. Dans l’application avec BPM actif, un user sans Budget principal, Patrimoine ou composition complète ne doit pas être déclaré conforme.

Cas à couvrir : user créé dans un environnement noyau seul, puis ouverture du même stockage avec BPM actif. Le diagnostic indique précisément les éléments manquants ou un état de préparation explicite. « Au plus un » ne suffit pas pour une chaîne obligatoire « exactement un ». N’initialise pas d’objets pendant une simple lecture de diagnostic.

C07 — Export de preuve depuis un instantané commun

Ajoute une action permettant d’obtenir le JSON et les CSV d’Object Management depuis un seul instantané figé. Tu peux choisir une archive commune ou une consultation figée par identifiant d’instantané.

Tous les fichiers d’un même export portent le même identifiant d’instantané, la révision, la date et le périmètre. Une écriture effectuée pendant ou entre les téléchargements ne doit pas mélanger plusieurs états dans ce dossier de preuve. Les exports restent sans effet sur les données métier.

C08 — Vocabulaire

Utilise le libellé validé « tâche d’un projet budgétisé » dans les contrats de lecture et les interfaces concernés. Distingue partout « projet de vie » et « projet de la vie ». Ne traduis pas un ancien booléen technique nommé standard en rôle métier sans vérifier sa signification : le principal est le Budget spécialisé, les branches sont les Budgets standards.

C09 — Validation stricte des dates

Corrige le validateur partagé de dates civiles. Le format ISO et Date.parse ne suffisent pas : le 31 février doit être refusé, sans normalisation silencieuse en mars.

Vérifie les jours valides, les mois et les années bissextiles. Applique le contrôle aux dates des projets, tâches, opérations, règlements et cycles. Les erreurs sont retournées au champ concerné et ne détruisent pas la saisie.

C10 — Suivi sans arrêt après 600 périodes

Supprime le plafonnement silencieux de api/src/modules/bpm/periods.mjs. La période courante doit être calculée correctement quel que soit l’âge du projet de vie. L’historique peut être paginé ou chargé à la demande.

Cas à couvrir : cycle démarré en janvier 2026, date simulée en janvier 2078. L’application retrouve la période de 2078, sans sélectionner décembre 2075 comme période courante. La navigation historique et la recherche de la prochaine période à clôturer restent cohérentes.

C11 — Protéger les écritures du stockage

Deux instances de stockage lisant le même fichier peuvent actuellement écraser leurs écritures respectives. Supprime cette perte silencieuse.

Tu peux protéger et imposer un seul écrivain, ou rendre le stockage capable de gérer plusieurs écrivains. Choisis une solution proportionnée à l’architecture actuelle et indique sa garantie réelle. Une seconde instance incompatible doit être refusée ou entrer en conflit explicite ; elle ne doit pas effacer une création déjà confirmée.

Teste le cas de deux instances sur le même stockage ainsi que la concurrence dans une instance et le redémarrage. Ce besoin n’impose pas une infrastructure distribuée.

3. Services nécessaires aux interfaces

Les pages doivent fonctionner avec des données persistées et cohérentes. Complète les services nécessaires à leurs fonctions ; une maquette statique ou un bouton sans effet ne constitue pas une livraison fonctionnelle.

	●	Prendre en charge les opérations ponctuelles et récurrentes : cadence hebdomadaire, mensuelle ou annuelle, première date, fin éventuelle et occurrences identifiables. Une cadence saisie doit être conservée et produire ses occurrences ; elle ne doit jamais être ignorée silencieusement.
	●	Distinguer définition de l’opération, occurrence attendue et règlement effectif. Conserver date et montant prévus, date et montant réels. Empêcher les doubles règlements d’une même occurrence selon le modèle de paiement retenu.
	●	Séparer les sommes par date prévue des sommes par date réelle. Une charge prévue le 31 octobre mais payée le 2 novembre figure dans le registre prévu d’octobre et dans le réalisé de novembre.
	●	Respecter les clôtures : aucune modification financière silencieuse du passé. Les corrections d’un historique existant doivent suivre une règle explicitement définie ; ne crée pas arbitrairement de mécanisme de réouverture ou de rattrapage automatique.
	●	Exposer des lectures communes pour la synthèse, le registre, les centres, l’historique et la projection. Un même montant ne doit pas être recalculé avec une formule différente dans chaque composant.
	●	Stocker et calculer les montants monétaires en centimes entiers. Expliciter les unités des contrats et effectuer les conversions aux frontières appropriées sans casser silencieusement les API existantes.
	●	Conserver les révisions attendues, les commandes rejouables et la traçabilité lors des modifications et des créations composées.

Les choix encore ouverts doivent rester explicites : réalisation automatique ou manuelle à échéance, catalogue définitif des cycles et rattrapages, financement père/enfants, répartition et consommation monétaire des provisions de tâches, dépassements, actifs et phases patrimoniales avancées. Conserve les mécanismes opérationnels actuels tant qu’une règle différente n’est pas définie. Si un point empêche une fonction, expose son contexte, le choix nécessaire et l’impact ; poursuis les travaux indépendants. N’affiche pas de chiffres inventés pour remplir cette fonction.

4. Organisation des pages à mettre en place

Au niveau BPM, organise la navigation en deux grandes sections :

	1.	Démarrer un projet, avec uniquement Partir de zéro.
	2.	Ma vision budgétaire, avec cinq pages : Tableau de bord, Dépenses de la période, Graphiques et chiffres, Ce qu’il faut faire, Objectifs et avenir.

Les détails se rejoignent depuis les chiffres, graphes et listes. Ils ne deviennent pas cinq nouveaux menus concurrents. Garde les accès Noyau, Object Management, tests middleware, Utilisateurs et Administration clairement distincts de cet espace métier.

Voici les destinations à rendre adressables. Tu peux adapter le préfixe aux routes existantes et conserver des redirections pour les anciens liens ; chaque destination doit rester identifiable et accessible directement.

|Destination                |Chemin relatif BPM proposé          |Accès principal                             |
|---------------------------|------------------------------------|--------------------------------------------|
|Partir de zéro             |`/creer`                            |Section Démarrer un projet                  |
|Tableau de bord            |`/tableau-de-bord`                  |Ma vision budgétaire                        |
|Dépenses de la période     |`/depenses`                         |Ma vision budgétaire                        |
|Graphiques et chiffres     |`/piloter`                          |Ma vision budgétaire                        |
|Ce qu’il faut faire        |`/piloter/agir`                     |Ma vision budgétaire                        |
|Objectifs et avenir        |`/vision`                           |Ma vision budgétaire                        |
|Détail des entrées         |`/argent/entrees`                   |Chiffre Reçu et sources de revenus          |
|Détail d’un centre de coûts|`/argent/postes/:poste`             |Ventilation, graphe et ligne de centre      |
|Détail du solde            |`/argent/reste`                     |Chiffres Reste et Solde attendu             |
|Détail d’une échéance      |`/depenses?operation=…&occurrence=…`|Ligne du registre ; panneau ou ligne dépliée|

L’éditeur d’opération est partagé entre les pages ; l’éditeur d’objectif s’ouvre dans Objectifs et avenir. Les opérations sans centre se retrouvent par un filtre du registre, sans page « À préciser » supplémentaire.

5. Cadre commun des pages BPM

Chaque page affiche un titre court, une phrase utile, le user actif, le projet ou périmètre lu et la période. Une action principale est mise en avant ; les explications et réglages avancés sont repliables.

Conserve les chiffres clés et les graphes en priorité. Évite de répéter le même total dans le bandeau, les cartes et plusieurs sections. Les détails expliquent la zone de synthèse plutôt que de créer une synthèse concurrente.

	●	Distinguer périmètre principal et consolidé. Chaque Budget apparaît une seule fois ; les écritures internes ne doivent pas être comptées deux fois. Si la consolidation dépend d’un arbitrage père/enfants non défini, afficher le périmètre effectivement calculable et annoncer sa limite.
	●	Partager le contexte user, Budget, période, début inclus, fin exclue et date de calcul entre page, graphe, détail et action.
	●	Proposer les lectures semaine/mois/année et la navigation temporelle sans changer implicitement le cycle métier de clôture. Une vue n’est pas une modification du cycle.
	●	Conserver dans les liens utiles la période, le projet et les filtres de recherche, état, centre, Budget, tâche et regroupement. Le retour arrière retrouve la sélection ; l’ouverture d’un détail garde la position de lecture.
	●	Ignorer une réponse réseau devenue ancienne après changement de user, de projet ou de période. Recharger les lectures affectées après une écriture réussie.
	●	Prévoir chargement, absence de données, données inconnues, erreur et nouvelle tentative. Zéro connu et valeur inconnue sont deux états distincts.
	●	Garder les brouillons en cas d’erreur ou de conflit ; annoncer ce qui est effectivement enregistré. Une navigation, un aperçu, une simulation ou un changement de filtre ne crée aucune écriture métier.

6. Démarrer un projet — Partir de zéro

Mettre en place un assistant en sept étapes. Ne proposer aucun choix d’assemblage d’objets existants.

|Étape                   |Contenu attendu                                                                                                                                                                                                                                                                        |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1. Votre situation      |User actif et son type ; profil de départ proposé ; aperçu des revenus, charges et épargne naturelle. Les propositions sont éditables et ne valent pas des opérations réalisées. Ne pas écraser les modifications déjà saisies.                                                        |
|2. Le projet            |Nom et description. Le parcours indique s’il configure le principal ou crée une branche. Le rôle n’est pas déduit du nom. Pour une branche, demander au moins une tâche initiale avec ses informations nécessaires.                                                                    |
|3. Le budget            |Revenus et charges : libellé, centre, montant, cadence, première date et fin éventuelle ; plafonds facultatifs. Afficher les totaux moyens et le solde type. Permettre un centre personnalisé propre au user.                                                                          |
|4. Le patrimoine        |Stock initial connu ou à renseigner ; repère du Patrimoine unique du user. Une branche utilise cet ensemble existant et n’ouvre pas un second stock. Les détails d’actifs restent facultatifs et dépendent des capacités retenues.                                                     |
|5. Le cycle             |Cycle du principal, première période et date de début ; distinction période courante, suivante et reprise passée. Présenter uniquement des choix effectivement pris en charge. Ne pas activer un cycle hebdomadaire/annuel ou un rattrapage automatique sans son contrat métier validé.|
|6. Votre vision         |Rendement annuel, épargne visée facultative et objectifs datés : libellé, type, montant positif en euros d’aujourd’hui, date. Possibilité de compléter plus tard.                                                                                                                      |
|7. Vérifier et confirmer|Récapitulatif du user, rôle, nom, revenus/charges, solde type, stock connu, cycle et objectifs. Confirmation unique, état de traitement et arrivée au tableau de bord après succès.                                                                                                    |

Afficher la progression, Précédent, Continuer et Annuler. Les aides courtes restent disponibles à la demande. Une moyenne doit être nommée comme telle ; elle ne remplace pas les échéances réelles.

Le principal existe normalement depuis la création du user : l’assistant configure cet ensemble, il ne crée pas un deuxième projet de vie. Pour une branche, il crée de zéro la composition nécessaire par Object Management. L’ajout ou la mise à jour de tous les éléments d’une confirmation est cohérent et rejouable.

L’annulation ne persiste aucun nouvel élément du brouillon et ne supprime pas l’ensemble principal préexistant. Un double clic, une réponse perdue ou la reprise d’une confirmation ne crée aucun doublon. Aucun formulaire ne permet de reprendre et d’assembler des objets middleware libres.

7. Ma vision budgétaire — Tableau de bord

Afficher les blocs suivants, avec une lecture initiale courte :

	1.	Synthèse de la période : Reçu, Dépensé, Reste réel, Solde prévu à la clôture. À recevoir et À payer apparaissent en sous-valeurs. Reçu ouvre les entrées ; Dépensé ouvre le registre ; Reste ouvre le détail du solde.
	2.	Patrimoine : stock enregistré, effet signé de la période, estimation après période, objectif de stock et progression. Explication du calcul à la demande ; ne pas ajouter une capitalisation déjà incluse.
	3.	Budget et flux : listes courtes des revenus récurrents et ponctuels, charges et projets de la vie ; accès Voir tout et ouverture de l’opération concernée. Le quotidien du principal est nommé « Budget du projet de vie ».
	4.	Où va l’argent : ventilation des dépenses par centre et représentation sur 100 €. Le clic ouvre le détail du centre.
	5.	Historique : entrées, dépenses, net et Patrimoine connu par période. Montrer six périodes par défaut, avec accès aux autres périodes et options de représentation.

Les périodes closes affichent les résultats enregistrés. Les périodes futures restent des prévisions. Un stock absent est « À renseigner ». Sans opération, les zéros connus sont affichés avec une invitation à saisir. La commande de clôture indique sa date, ses conditions et son effet signé réel sur le Patrimoine.

8. Ma vision budgétaire — Dépenses de la période

En tête : Payé, À payer, Non réalisé, puis une recherche visible et une liste regroupée par centre. Un panneau Affiner contient projet/Budget, état, tâche éventuelle, dates et regroupement par centre, projet ou date. Les totaux indiquent qu’ils suivent les filtres.

Le registre sélectionne les occurrences par leur date prévue. Le réalisé des synthèses suit la date réelle de règlement ; expliquer cette différence dans une aide courte.

Chaque ligne permet d’ouvrir un détail contenant :

	●	libellé, Budget/projet, centre et tâche éventuelle ; identifiants accessibles dans Détails ;
	●	date et montant prévus, date et montant réels, différence et statut ;
	●	cadence, première date, fin éventuelle et note de l’opération ;
	●	historique des règlements, avec distinction de ceux hors de la période ;
	●	accès au même éditeur BPM d’opération et aux actions de pointage autorisées.

« Non réalisé » désigne une échéance restée sans règlement à la clôture et ne contribue pas à Payé. Un lien profond filtré hors du registre permet de comprendre l’absence et de changer les filtres ou la période. L’ouverture du panneau ne fait pas perdre la recherche.

9. Ma vision budgétaire — Graphiques et chiffres

Conserver ces familles de contenu :

|Bloc                     |Contenu attendu                                                                                                                    |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
|Synthèse des flux        |Réalisé et attendu ; visualisation de leur différence et impact des projets. Le périmètre consolidé, s’il est calculé, est annoncé.|
|Zoom sur le projet de vie|Net, net attendu, épargne nécessaire, plafond et marge restante. Montrer la source et l’unité temporelle des valeurs.              |
|Réel face au prévu       |Lecture chronologique par fenêtre ; barres signées, courbe du réel et prévision différenciée.                                      |
|Centres de coûts         |Payé, restant prévu, plafond facultatif et marge/dépassement ; graphe et tableau court, détail par clic.                           |
|Revenus                  |Reçu et encore attendu par source, accès au détail.                                                                                |
|Événements à préparer    |Événement, date, coût futur, périodes disponibles et provision indicative par période lorsque calculable.                          |
|Budget type              |Résumé des entrées, charges et épargne naturelle moyennes ; action Modifier vers Ce qu’il faut faire.                              |
|Avancement               |Temps écoulé dans la période et progression financière vers la cible, montrés séparément.                                          |
|Clôtures                 |Tableau des périodes, résultat signé et Patrimoine après clôture lorsqu’il est connu ; accès à la période.                         |

Une liaison graphique « réalisé vers prévu » compare deux états ; elle ne doit pas être présentée comme une chronologie. La conversion d’un plafond moyen entre vues ne transforme pas les montants réellement payés en moyennes.

10. Ma vision budgétaire — Ce qu’il faut faire

Action principale : Ajouter une entrée ou une charge. Présenter ensuite les échéances à traiter et les indications calculables. Les fonctions suivantes restent accessibles dans des panneaux identifiables :

	1.	Éditeur d’opération partagé : Budget cible, entrée/charge, libellé, montant, centre, date, cadence, fin facultative, note et tâche éventuelle d’une branche. La modification conserve l’identité de l’opération.
	2.	Aperçu avant enregistrement : avant/après du solde attendu et du stock estimé lorsqu’il est connu. Aucune mutation durant l’aperçu.
	3.	Échéances à traiter : en retard ou du jour, montant/date/état, action Payé ou Reçu avec les valeurs réelles. Les actions et annulations disponibles respectent les clôtures et la politique de règlement effectivement retenue.
	4.	Budget type : plusieurs revenus/charges avec montants et rythmes éditables ; totaux moyens et solde. L’enregistrement met à jour les lignes existantes sans les recréer à chaque passage.
	5.	Directives : épargne nécessaire, provisions indicatives, plafond, disponible et montant indicatif par semaine, accompagnés de leurs hypothèses. Si une donnée manque, afficher Non calculable et la raison.
	6.	Objectif d’excédent budgétaire : montant cible, nombre de périodes et date de départ. Son enregistrement ne modifie pas directement le stock patrimonial.
	7.	Simulation : effort supplémentaire par période, Patrimoine futur et écart au scénario de base. Aucune écriture jusqu’à une adoption explicite et précisément décrite.

Ne pas déclencher automatiquement un second règlement d’une occurrence déjà réalisée. Ne pas transformer une opération courante en tâche. Ne pas créer de mouvement père/enfant ni d’allocation financière de tâche sur la seule base d’une estimation de temps.

11. Ma vision budgétaire — Objectifs et avenir

Afficher une page complète avec les familles de contenu suivantes ; les formulaires et options avancées sont repliés par défaut.

	●	Hypothèses compactes : horizon, rendement annuel, inflation par année et source, apport par période et son origine. Chaque résultat porte le statut Estimation.
	●	Chiffres clés : Patrimoine nominal à l’horizon, valeur en euros d’aujourd’hui, rendement réel et érosion sans rendement.
	●	Projection annuelle : deux courbes nominal/réel, valeurs consultables, repères des objectifs et tableau associé.
	●	Objectifs de vie : ajouter, modifier et retirer un objectif ; type, libellé, date, cible en euros d’aujourd’hui, cible nominale à l’échéance, montant couvert, pourcentage et statut finançable/partiel/non financé/hors horizon.
	●	Objectif budgétaire : minimum ou apport par période, cible cumulée, effort nécessaire et progression.
	●	Cap patrimonial : objectif de stock, valeur connue, manque ou dépassement. Atteindre un cap ne ferme pas automatiquement le user ni son projet de vie.
	●	Comparaison des apports : scénario retenu et scénario fondé sur la moyenne réelle, lorsque deux clôtures au moins existent et que la projection n’utilise pas déjà cette moyenne. Garder les mêmes autres hypothèses.
	●	Répartition patrimoniale : allocations, valeurs connues et graphe de répartition, uniquement si le middleware expose effectivement ce modèle. Même principe pour un versement entre actifs ou un changement de phase patrimoniale : fonction avancée dépendant d’un contrat retenu, sans mouvement implicite créé par un graphe.

Les objectifs de projection sont distincts des « projets de la vie » budgétisés : ajouter un objectif daté ne crée ni Budget, ni tâche, ni paiement.

Pour la projection de base, utiliser une convention annuelle explicite : rendement sur le capital de l’année précédente, puis apport annuel, puis objectifs de l’année. Les objectifs de l’année de départ sont traités avant le premier rendement annuel.

apport annuel = apport par période × fréquence annuelle (52, 12 ou 1)

indice des prix[n] = indice des prix[n-1] × (1 + inflation[n] / 100)

capital avant objectifs[n] = capital[n-1] × (1 + rendement / 100) + apport annuel

cible nominale[n] = cible en euros d’aujourd’hui × indice des prix[n]

capital réel[n] = capital nominal[n] / indice des prix[n]

rendement réel = (1 + rendement / 100) / (1 + inflation / 100) - 1

Types proposés : études, retraite, achat, sécurité, transmission, autre. Études/achat/autre consomment le capital dans la projection ; retraite/sécurité/transmission en réservent une part sans la soustraire du stock nominal. Traiter les objectifs par date et ne pas réutiliser une somme déjà réservée pour financer les suivants. Une couverture partielle reste partielle ; réévaluer les couvertures si un déficit ultérieur les remet en cause. Un objectif hors horizon reste identifié comme tel.

Ces calculs simulent un scénario ; ils n’écrivent aucun paiement ni aucune valorisation réelle. Un stock initial inconnu interdit de présenter une projection patrimoniale comme fiable. Le stock négatif n’est pas ramené artificiellement à zéro.

12. Sous-pages de détail

Chaque détail conserve le contexte et un retour vers sa page d’origine.

|Sous-page      |Contenu et actions                                                                                                                                                           |
|---------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Entrées        |Total reçu, encore attendu, ventilation par source, opérations reçues et échéances. Ajouter une entrée, ouvrir/modifier une opération et pointer une échéance lorsque permis.|
|Centre de coûts|Payé, restant prévu, plafond facultatif, marge et part des entrées ou dépenses. Liste des opérations et échéances, ajout d’une charge, précision du centre ou de la note.    |
|Solde          |Reçu, payé, net réalisé, net attendu, date de clôture et effet patrimonial. Décomposition des montants et rapprochement de compte repliable.                                 |

Pour le rapprochement : saisir solde initial et solde actuel ; calculer variation du compte = actuel − initial, puis écart = variation − net calculé. Un écart négatif suggère une dépense potentiellement manquante ; un écart positif une entrée potentiellement manquante. Proposer une saisie après relecture, sans créer automatiquement une opération.

Si une modification de centre ou de note concerne la définition d’une opération récurrente, annoncer sa portée sur les occurrences. Elle ne doit pas modifier implicitement les montants ou dates des règlements. Les corrections financières d’une période close restent protégées.

13. Graphes à conserver

Chaque graphe doit être alimenté par un contrat de lecture réel. Un état vide ou non calculable vaut mieux qu’une série fictive présentée comme réelle.

|Graphe                        |Page                                  |Représentation attendue                                                                                           |
|------------------------------|--------------------------------------|------------------------------------------------------------------------------------------------------------------|
|Parcours de chaque euro       |Tableau de bord                       |Barre segmentée des dépenses par centre et du reste positif ; lecture sur 100 € reçus ou dépensés.                |
|Historique des périodes       |Tableau de bord                       |Entrées/dépenses en barres et net en courbe par défaut ; variante Patrimoine et options de séries.                |
|Cap patrimonial               |Tableau de bord et Objectifs et avenir|Stock connu et estimation face à la cible, manque ou dépassement.                                                 |
|Réalisé vers prévu            |Graphiques et chiffres                |Entrées, charges et net, liaison entre état réalisé et attendu ; sans faux axe temporel.                          |
|Impact des projets            |Graphiques et chiffres                |Entrées, charges et nets par Budget, réalisé/attendu et échelle commune, selon le périmètre financièrement défini.|
|Réel face au prévu            |Graphiques et chiffres                |Barres signées par fenêtre, courbe réelle et prolongement prévisionnel différencié.                               |
|Plafonds et marges            |Graphiques et chiffres                |Dépensé, restant prévu, plafond et dépassement par centre.                                                        |
|Avancement de période         |Graphiques et chiffres                |Progression de l’épargne vers sa cible et temps écoulé distincts.                                                 |
|Projection patrimoniale       |Objectifs et avenir                   |Courbes annuelles nominal/réel, repères d’objectifs et valeurs accessibles.                                       |
|Couverture des objectifs      |Objectifs et avenir                   |Couvert/cible, pourcentage et statut de chaque objectif.                                                          |
|Répartition patrimoniale      |Objectifs et avenir                   |Parts des allocations dont les valeurs sont connues, si le modèle retenu les fournit.                             |
|Objectifs budget et Patrimoine|Objectifs et avenir                   |Progression de l’excédent cumulé et du stock face à leurs cibles respectives.                                     |

Pour l’historique, garder dans Options les formats combiné, courbes, barres, aire, camembert et anneau. Les formats de répartition ne sont proposés que pour des séries compatibles : mouvements, origine des revenus/dépenses ou réalisé/restant d’un même flux. Ne pas additionner stock et flux, ni net et entrées/sorties pour constituer un tout. Aucun secteur ne représente un solde négatif.

Si les entrées sont positives et couvrent les dépenses, elles constituent la base des parts ; sinon utiliser les dépenses. Si la base vaut zéro, ne pas calculer de part. Une valeur inconnue reste absente ou interrompt la série ; elle ne devient pas zéro. Les échelles, signes, unités, dates et légendes doivent permettre la comparaison.

Les valeurs sont accessibles au clic, au clavier et dans un tableau associé ; les informations essentielles ne dépendent pas d’un survol de souris.

14. Esthétique et simplification

Mettre en place une présentation cohérente sur toutes ces pages : bandeau compact, contexte, chiffres clés, graphes et listes utiles. Réduire le nombre de blocs ouverts simultanément ; garder les formulaires, explications longues et hypothèses avancées dans des panneaux ou dialogues.

	●	Typographies : Inter pour l’interface, IBM Plex Mono pour les nombres/libellés qui le nécessitent, Newsreader pour les textes éditoriaux du bandeau. Charger les polices localement.
	●	Thème centralisé : fond ardoise clair #f1f5f9, surfaces blanches, texte principal #1e293b, texte secondaire #475569, filets #e2e8f0. Utiliser l’accent du module pour la navigation et les actions, distinct des couleurs financières.
	●	Garder une hiérarchie nette de panneaux et cartes : filets fins, ombres douces, rayons cohérents, rythme d’espacement régulier ; cadres de chiffres et graphes avec des marges internes de 16 à 24 px selon la largeur. Centraliser les valeurs dans les tokens du thème.
	●	Vert pour excédent/succès, ambre pour attention/provisoire, rouge pour déficit/erreur. Le signe et le libellé doivent rester compréhensibles sans la couleur.
	●	Une mesure conserve sa couleur d’un graphe et d’un format à l’autre. Les séries nominal/réel et réalisé/prévu restent visuellement distinctes.
	●	Organiser les styles en couches : tokens, base et typographie, contrôles/formulaires, structure responsive, composants partagés, styles de pages. Conserver les styles globaux à la portée nécessaire pour les composants enfants.
	●	Mutualiser les bandeaux, cartes de métriques, navigation de période, tableaux, graphes et éditeurs. Ne pas réintroduire de dépendance aux modules exclus par une importation globale de styles.
	●	Prévoir clavier, focus visible, contrastes, gestes tactiles et réduction des animations. Sur tablette, les montants, états et actions restent lisibles ; les dialogues et paires de champs se replient sur petit écran.

La simplification porte sur la densité et la présentation. Les chiffres, leurs règles et les fonctions décrites restent accessibles.

15. Tests et critères de réception

Exécute les tests existants et ajoute des tests pertinents pour les corrections et les nouveaux contrats. Les tests financiers doivent vérifier la règle attendue, pas figer le comportement erroné. Vérifie les interfaces dans un navigateur, en complément du contrôle des types/templates et du build de production.

Au minimum, couvre :

	●	C01 à C11, avec les exemples donnés et les conditions de concurrence/persistance ;
	●	création du user et unicités, rejeu après réponse perdue, principal déjà présent et création de branche sans deuxième Patrimoine ;
	●	toutes les destinations et sous-pages, liens profonds, filtres, retour arrière et absence de réponse réseau périmée ;
	●	revenus et charges récurrents, occurrences, réalisé/restant, dates prévues/réelles et protection des périodes closes ;
	●	centre personnalisé de U1 absent du catalogue de U2 ;
	●	concordance des cartes, graphes, tableaux, détails et résultats persistés ;
	●	absence de mutation par aperçu, simulation, navigation ou export ;
	●	conservation des états et temps des tâches, déplacements de colonnes, conflits et rechargement ;
	●	rendu ordinateur 1440 px, tablette 1024/768 px et petit écran 390 px, signes négatifs, grands montants, textes longs et données manquantes.

Exemples financiers supplémentaires :

|Situation                                                                     |Résultat attendu                                                     |
|------------------------------------------------------------------------------|---------------------------------------------------------------------|
|Reçu 3 000 €, payé 2 000 €, restant à recevoir 200 €, restant à payer 400 €   |Net 1 000 €, attendu 800 €.                                          |
|Reçu 1 000 €, payé 1 200 €, restant à recevoir 300 €, restant à payer 50 €    |Net −200 €, attendu +50 €.                                           |
|Stock −500 €, résultat −200 € à capitaliser                                   |Stock après clôture −700 €, une seule capitalisation.                |
|Stock 10 000 € comprenant déjà une clôture de 800 €                           |La lecture de cette clôture ne transforme pas le stock en 10 800 €.  |
|Stock de départ 10 000 €, apport mensuel 100 €, un an, rendement/inflation 0 %|Projection nominale et réelle 11 200 €.                              |
|Même scénario, rendement 5 %, inflation 2 %                                   |Nominal 11 700 €, réel 11 470,59 € après arrondi au centime.         |
|Capital 1 000 €, objectif immédiat 2 000 €                                    |Couverture 1 000 €, 50 %, statut partiel.                            |
|Stock initial inconnu                                                         |À renseigner ; aucune projection réputée fiable issue d’un faux zéro.|

16. Ordre d’exécution et livraison

Procède dans cet ordre, en gardant les lots examinables :

	1.	Corrections et invariants : C01 à C11, tests financiers et Object Management, compatibilité des données existantes.
	2.	Contrats de lecture et structure d’interface : navigation, contexte, composants partagés, styles, états vides/erreurs, contrats nécessaires aux pages. Compléter ensuite les écritures et récurrences nécessaires sans maquiller les capacités absentes.
	3.	Démarrage, tableau de bord, dépenses et détails : parcours persisté complet et concordance des chiffres.
	4.	Graphiques et chiffres, actions et avenir : calculs, graphes, formulaires, simulations et objectifs, dans les limites métier explicitement définies.
	5.	Réception : tests, build, recette navigateur responsive, vérification des régressions et compte rendu du livré.

Pour chaque lot, livre le code modifié, les tests réellement exécutés, les résultats observables et les limites restantes. Tiens à jour une matrice courte « exigence → page/service → preuve → statut ». Distingue implémenté et testé, implémenté à vérifier, bloqué par un choix métier, et restant à faire.

Ne présente pas des données de démonstration comme les données du user. Une famille de contenu conditionnelle dont le contrat n’existe pas doit apparaître dans le compte rendu comme telle ; elle ne peut pas être déclarée terminée grâce à un simple panneau vide.

Le résultat attendu est une application corrigée, avec une organisation BPM claire, des pages réellement alimentées, des chiffres explicables et un dossier de validation permettant de contrôler ce qui a été réalisé.
</pasted_content id="f7df">
