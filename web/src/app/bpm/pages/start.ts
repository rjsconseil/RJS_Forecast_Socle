import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LIFE_PROJECT_CHAIN } from '../onboarding';
import { BpmPageFrame } from '../ui';

const WHY = [
  { title: 'Il porte votre budget', detail: 'Vos entrées et vos sorties vivent dans le budget du projet de vie, période après période.' },
  { title: 'Il finance vos projets de la vie', detail: 'Un voyage, un équipement, une formation : chacun reçoit une enveloppe prise sur ce budget.' },
  { title: 'Il fait grandir votre patrimoine', detail: 'Le résultat de chaque période clôturée rejoint votre patrimoine unique.' },
];

/**
 * Accueil de « Démarrer un projet », réservé au visiteur non connecté : ce qu'est le projet de vie et
 * pourquoi il précède toutes les fonctionnalités. Il se crée une seule fois, avec son user, puis se
 * modifie dans « Gestion du projet de vie ».
 */
@Component({
  selector: 'bpm-start-page',
  imports: [RouterLink, BpmPageFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bpm-page
      title="Démarrer un projet"
      kicker="Votre point de départ"
      lead="Avant de piloter un budget ou un projet, créez votre projet de vie : le projet unique qui englobe tous les autres."
    >
      <a primary class="app-hero-action" routerLink="/creer/projet-de-vie">Créer mon projet de vie →</a>
      <a actions class="btn btn-secondary" routerLink="/utilisateurs">J’ai déjà un projet de vie : me connecter</a>

      <section class="bpm-card st-block" aria-labelledby="st-what">
        <h2 id="st-what">Qu’est-ce que le projet de vie ?</h2>
        <p>
          C’est le cadre de toute votre vie financière dans le site : <strong>un seul par profil</strong>. Il réunit votre
          budget du quotidien, votre patrimoine et tous les projets de la vie que vous voudrez financer ensuite.
        </p>
      </section>

      <section class="st-block" aria-labelledby="st-why">
        <h2 id="st-why">Pourquoi le créer en premier ?</h2>
        <div class="st-grid">
          @for (w of why; track w.title) {
            <article class="bpm-card"><h3>{{ w.title }}</h3><p>{{ w.detail }}</p></article>
          }
        </div>
        <p class="bpm-help">Sans projet de vie, aucun budget, projet ni patrimoine ne peut être suivi : toutes les fonctionnalités en dépendent.</p>
      </section>

      <section class="bpm-card st-block" aria-labelledby="st-chain">
        <h2 id="st-chain">Ce qui est créé, une seule fois et en une seule écriture</h2>
        <ol class="st-chain">
          @for (step of chain; track step.title) {
            <li><strong>{{ step.title }}</strong><small>{{ step.detail }}</small></li>
          }
        </ol>
        <p class="bpm-help">
          Ensuite, votre projet de vie se modifie dans <strong>Ma vision budgétaire › Gestion du projet de vie</strong> ;
          il n’est supprimé qu’avec votre profil.
        </p>
        <div class="bpm-actions"><a class="btn btn-primary" routerLink="/creer/projet-de-vie">Créer mon projet de vie</a></div>
      </section>
    </bpm-page>
  `,
  styles: `
    .st-block { display: grid; gap: var(--ecart-12, 12px); margin-top: var(--ecart-24, 24px); }
    .st-block h2, .st-block h3 { margin: 0; }
    .st-block p { margin: 0; }
    .st-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--ecart-12, 12px); }
    .st-grid .bpm-card { display: grid; gap: 6px; }
    .st-chain { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 0; padding-left: 1.2em; }
    .st-chain li { display: grid; gap: 2px; }
  `,
})
export class BpmStartPage {
  protected readonly why = WHY;
  protected readonly chain = LIFE_PROJECT_CHAIN;
}
