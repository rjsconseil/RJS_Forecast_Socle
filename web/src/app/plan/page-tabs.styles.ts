/** Styles partagés entre les onglets BPM et leur simulation statique. */
export const PAGE_TABS_STYLES = `
    :host {
      display: block;
      min-width: 0;
      grid-column: 1 / -1;
    }
    .page-tab-group {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .content-section-menu {
      position: fixed;
      top: var(--section-menu-top);
      left: var(--section-menu-left);
      z-index: 1000;
      display: grid;
      min-width: min(220px, calc(100vw - 24px));
      max-width: calc(100vw - 24px);
      padding: 6px;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 12px;
      /* N8 : même surface opaque que la liste des actions, lisible au-dessus du contenu qui défile. */
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      box-shadow: 0 14px 34px rgb(20 32 50 / 0.22);
      animation: page-tab-menu-in 140ms ease-out;
    }
    .page-tabs {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 10px 0 2px;
      padding: 4px;
      border-radius: 12px;
      background: color-mix(in srgb, currentColor 7%, transparent);
      width: fit-content;
      max-width: 100%;
    }
    .page-tab {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 6px 14px;
      border-radius: 9px;
      color: inherit;
      font-weight: 600;
      font-size: 0.92rem;
      text-decoration: none;
      opacity: 0.82;
      white-space: nowrap;
      transition:
        opacity 160ms ease,
        background-color 160ms ease,
        box-shadow 240ms ease;
    }
    .page-tab:hover,
    .page-tab:focus-visible {
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    /* Couleurs propres : les bandeaux sombres redéfinissent --ink en blanc, l'onglet courant doit rester lisible partout. */
    .page-tab.is-current {
      opacity: 1;
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      box-shadow:
        0 1px 2px rgb(0 0 0 / 0.2),
        0 8px 18px -8px rgb(0 0 0 / 0.45);
    }
    /* Le chevron prolonge son onglet ; la liste s'ouvre dessous, au premier plan : la bande ne la rogne jamais. */
    .page-tab-more {
      display: inline-grid;
      place-items: center;
      align-self: center;
      flex: none;
      width: 24px;
      height: 28px;
      margin-inline-start: -4px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.8rem;
      line-height: 1;
      opacity: 0.7;
      cursor: pointer;
      transition:
        opacity 160ms ease,
        background-color 160ms ease;
    }
    .page-tab-more span {
      display: inline-block;
      transition: transform 160ms ease;
    }
    .page-tab-more:hover,
    .page-tab-more:focus-visible,
    .page-tab-more[aria-expanded='true'] {
      opacity: 1;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
    .page-tab-more[aria-expanded='true'] span {
      transform: rotate(180deg);
    }
    .page-tab-more:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    .page-tab-menu {
      position: fixed;
      inset: auto;
      margin: 0;
      min-width: 220px;
      max-width: min(320px, calc(100vw - 24px));
      padding: 6px;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 12px;
      /* Mêmes couleurs propres que l'onglet courant : lisible sur un bandeau clair comme sombre. */
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      box-shadow: 0 14px 34px rgb(20 32 50 / 0.22);
    }
    .page-tab-menu:popover-open {
      display: grid;
      gap: 2px;
      animation: page-tab-menu-in 140ms ease-out;
    }
    @keyframes page-tab-menu-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .page-tab-menu-title {
      margin: 0;
      padding: 4px 10px 6px;
      opacity: 0.66;
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .page-tab-link {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 6px 10px;
      border-radius: 8px;
      color: inherit;
      font-size: 0.9rem;
      font-weight: 550;
      text-decoration: none;
    }
    .page-tab-link span {
      opacity: 0.6;
    }
    .page-tab-link:hover,
    .page-tab-link:focus-visible {
      background: color-mix(in srgb, currentColor 9%, transparent);
      outline: none;
    }
    /* Navigation system v2 · sections numérotées et section lue */
    .section-number {
      flex: none;
      min-width: 24px;
      height: 22px;
      display: inline-grid;
      place-items: center;
      border-radius: 6px;
      font: 700 0.7rem/1 ui-monospace, 'SF Mono', Menlo, monospace;
      background: color-mix(in srgb, currentColor 9%, transparent);
    }
    .page-tab-link.is-current {
      font-weight: 700;
      background: color-mix(in srgb, currentColor 7%, transparent);
    }
    .page-tab-link.is-current .section-number {
      background: var(--page-tab-current-ink, #14213d);
      color: var(--page-tab-current-bg, #fff);
    }
    /* N7 · le titre de la section courante, sous le cadre collant */
    .section-band {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 34px;
      margin: 6px 0 0;
      padding: 4px 6px 4px 4px;
      border-radius: 10px;
      background: color-mix(in srgb, currentColor 6%, transparent);
      font-size: 0.86rem;
    }
    .band-mark {
      flex: none;
      padding: 3px 7px;
      border-radius: 7px;
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      font: 700 0.72rem/1.2 ui-monospace, 'SF Mono', Menlo, monospace;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
    }
    .band-title {
      min-width: 0;
      overflow: hidden;
      font-weight: 700;
      white-space: nowrap;
      text-overflow: ellipsis;
      animation: section-band-in 220ms ease-out;
    }
    @keyframes section-band-in {
      from {
        opacity: 0;
        transform: translateY(3px);
      }
    }
    .band-dots {
      display: flex;
      gap: 5px;
      margin-inline-start: auto;
    }
    .band-dots button {
      width: 8px;
      height: 8px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: color-mix(in srgb, currentColor 22%, transparent);
      cursor: pointer;
      transition:
        width 180ms ease,
        background-color 180ms ease;
    }
    .band-dots button.is-past {
      background: color-mix(in srgb, currentColor 48%, transparent);
    }
    .band-dots button.is-current {
      width: 20px;
      border-radius: 4px;
      background: currentColor;
    }
    .band-count {
      min-width: 38px;
      opacity: 0.7;
      font-size: 0.76rem;
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
    .band-step {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .band-step:hover:not(:disabled) {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
    .band-step:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .band-dots button:focus-visible,
    .band-step:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    @media (max-width: 700px) {
      .band-dots {
        display: none;
      }
      .band-count {
        margin-inline-start: auto;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .band-title {
        animation: none;
      }
      .page-tab-menu:popover-open {
        animation: none;
      }
      .page-tab-more span {
        transition: none;
      }
    }
    @media (max-width: 700px) {
      .page-tab-more {
        height: 36px;
      }
      .page-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        width: 100%;
      }
    }
`;
