/*
 * RJS Forecast · BPM — Navigation system v2 (moteur unique).
 *
 * Une seule mécanique pour toute la navigation : `resolve({ s, p, sp, a })` complète les arguments
 * manquants par le premier élément visible, et un seul composant de menu (`Flyout`) sert aux
 * actions de la sous-page d'accueil comme aux sections des autres sous-pages : seuls les
 * arguments changent (contenu, déclencheur).
 */
(function () {
  'use strict';

  /* ───────────────────────── Réglages ───────────────────────── */
  const LS_SETTINGS = 'rjs-bpm-sim:settings:v2';
  const LS_MODEL = 'rjs-bpm-sim:model:v2';

  const DEFAULTS = {
    // Comportements
    sectionEntry: 'first-page',      // first-page | section-home
    homeTrigger: 'click',            // click | hover | hover-click
    sectionTrigger: 'hover',         // hover | click | hover-click
    openDelay: 60,
    closeDelay: 240,
    menuWidth: 270,
    tabChevron: 'touch',             // always | touch | never
    sectionNumbers: true,
    tabCounts: true,
    sidebarSubpages: 'active',       // none | active | all
    sidebarSections: false,
    formMode: 'sheet',               // sheet | modal | inline
    smoothScroll: true,
    breadcrumbs: true,
    // Cadre du haut
    header: 'compact',               // standard | compact | ultra
    condenseOnScroll: true,
    sectionBand: true,
    bandProgress: true,
    bandStepper: true,
    // Apparence
    theme: 'light',                  // light | dark | auto
    density: 'comfortable',          // compact | comfortable | airy
    radius: 10,
    fontScale: 100,
    sidebarWidth: 252,
    sidebarStyle: 'full',            // full | rail
    tabStyle: 'underline',           // underline | pill | segment
    accentMode: 'section',           // section | uniform
    showIntention: true,
    tones: {},
    // Simulation
    audience: 'member',              // member | visitor
    viewport: 'auto',
    reveal: false,
  };

  const TONES = {
    navy: '#2563a6', teal: '#087b70', iris: '#6554b8', petrol: '#15748b', plum: '#87538c',
  };

  const RULES = [
    ['N1', 'Section', 'La section est la référence unique du parcours. Tout ce qui s’affiche lui est relié, à commencer par la barre des sections (niveau 1).'],
    ['N2', 'Pages', 'Les pages de la section sont listées verticalement dans la navigation latérale gauche (niveau 2). À l’ouverture de la section, la première page est sélectionnée d’office : elle est l’accueil de la section.'],
    ['N3', 'Sous-page d’accueil', 'Chaque page pointe sa page d’accueil par le libellé de son lien : c’est sa première sous-page, toujours en tête de la navigation horizontale du contenu (niveau 3). La page et sa sous-page d’accueil partagent la même adresse.'],
    ['N4', 'Actions', 'La sous-page d’accueil porte les actions de la page : au clic sur son onglet, une liste verticale fait apparaître les formulaires de saisie.'],
    ['N5', 'Sections de sous-page', 'Les autres sous-pages se suivent à l’horizontale. Chacune est découpée en sections (niveau 4), listées verticalement au survol de son onglet ; la liste disparaît dès que la souris quitte la zone.'],
    ['N6', 'Ancre', 'Cliquer une section ouvre sa sous-page et amène le contenu au niveau de cette section. Une section est une ancre, jamais une commande.'],
    ['N7', 'Cadre compact', 'Le cadre du haut réunit titre, onglets et outils au plus serré. Le titre de la section courante s’affiche juste dessous ; le contenu défile sous lui.'],
    ['N8', 'Une seule mécanique', 'Section, page, sous-page et section se résolvent par la même fonction : les arguments manquants prennent le premier élément visible. Menus d’actions et de sections partagent le même composant ; seuls le contenu et le déclencheur changent.'],
    ['N9', 'Une vue, une adresse', 'Chaque vue a son adresse : #/section/page/sous-page/section. ← et → suivent l’historique ; ↑ remonte d’un niveau dans le plan.'],
    ['N10', 'Clavier et toucher', 'Chaque onglet peut avoir un bouton d’ouverture : ↓ ouvre la liste, Échap la ferme, ↑↓ la parcourent. Rien n’exige le survol.'],
    ['N11', 'Réglages', 'Libellés, ordre, visibilité, déclencheurs, délais et apparence se règlent ici ; les rattachements (section → page → sous-page → section) restent structurels.'],
  ];

  const LEVELS = [
    { key: 'l1', label: 'Niveau 1 · Sections', color: '#e0559a' },
    { key: 'l2', label: 'Niveau 2 · Pages', color: '#f08c2e' },
    { key: 'l3', label: 'Niveau 3 · Sous-pages', color: '#2aa36b' },
    { key: 'l4', label: 'Niveau 4 · Sections de sous-page', color: '#2f80ed' },
    { key: 'act', label: 'Actions de l’accueil', color: '#9b51e0' },
    { key: 'band', label: 'Titre de section', color: '#00a3b4' },
  ];

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const NS = (window.NavigationSystem = {
    DEFAULTS, TONES, RULES, LEVELS,
    settings: Object.assign({}, DEFAULTS, store.get(LS_SETTINGS) || {}),
    model: store.get(LS_MODEL) || clone(window.BPM_MODEL),
    route: null,
    listeners: [],
  });
  NS.settings.tones = Object.assign({}, NS.settings.tones);

  NS.saveSettings = () => store.set(LS_SETTINGS, NS.settings);
  NS.saveModel = () => store.set(LS_MODEL, NS.model);
  NS.resetSettings = () => { NS.settings = clone(DEFAULTS); store.del(LS_SETTINGS); NS.refresh(); };
  NS.resetModel = () => { NS.model = clone(window.BPM_MODEL); store.del(LS_MODEL); NS.refresh(); };
  NS.set = (key, value) => { NS.settings[key] = value; NS.saveSettings(); NS.refresh(); };
  NS.onChange = (fn) => NS.listeners.push(fn);

  /* ───────────────────────── Résolution (N8) ───────────────────────── */
  const shown = (list) => (list || []).filter((x) => !x.hidden);
  NS.visibleSections = () => shown(NS.model.sections).filter((s) =>
    NS.settings.audience === 'visitor' ? s.id === 'ensemble' || s.audience === 'visitor' : s.audience !== 'visitor');

  /** La fonction unique : chaque niveau manquant prend le premier élément visible. */
  NS.resolve = function (r = {}) {
    const sections = NS.visibleSections();
    const section = sections.find((x) => x.id === r.s) || sections[0];
    const pages = shown(section && section.pages);
    let page = pages.find((x) => x.id === r.p) || null;
    if (!page && (r.p || NS.settings.sectionEntry === 'first-page')) page = pages[0] || null;
    const subpages = shown(page && page.subpages);
    const subpage = page ? subpages.find((x) => x.id === r.sp) || subpages[0] || null : null;
    const anchors = shown(subpage && subpage.sections);
    const anchor = anchors.find((x) => x.id === r.a) || null;
    return { section, page, subpage, anchor, sections, pages, subpages, anchors, isHome: !!subpage && subpage === subpages[0] };
  };

  NS.href = (s, p, sp, a) => '#/' + [s, p, sp, a].filter(Boolean).join('/');
  NS.parse = (hash) => { const [s, p, sp, a] = (hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent); return { s, p, sp, a }; };
  NS.go = (s, p, sp, a) => { const h = NS.href(s, p, sp, a); if (location.hash === h) onRoute(); else location.hash = h; };
  NS.goPath = (path) => { const [s, p, sp, a] = path.split('/'); NS.go(s, p, sp, a); };

  /* ───────────────────────── Utilitaires ───────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const hash = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => { let s = hash(seed) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), ((s ^= s >>> 16) >>> 0) / 4294967296); };
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const isTouch = () => matchMedia('(pointer: coarse)').matches;
  NS.toneOf = (section) => (NS.settings.accentMode === 'uniform' ? NS.settings.tones.__uniform || TONES.navy : NS.settings.tones[section.id] || TONES[section.tone] || TONES.navy);

  /* ───────────────────────── Menu flottant unique (N4, N5, N8) ───────────────────────── */
  const Flyout = {
    el: null, owner: null, openTimer: 0, closeTimer: 0,
    init() {
      this.el = $('#flyout');
      this.el.addEventListener('mouseenter', () => clearTimeout(this.closeTimer));
      this.el.addEventListener('mouseleave', () => { if (this.owner && this.owner.dataset.mode !== 'click') this.scheduleClose(); });
      this.el.addEventListener('keydown', (e) => this.keys(e));
      document.addEventListener('pointerdown', (e) => {
        if (this.owner && !this.el.contains(e.target) && !this.owner.closest('.tab-wrap, .tool-wrap').contains(e.target)) this.close();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.owner) { const o = this.owner; this.close(); o.focus(); } });
    },
    /**
     * Attache un menu à un déclencheur. Mêmes arguments pour tous les menus du site :
     * { mode: click|hover|hover-click, title, kind: actions|sections|tools, items: () => [...] }
     */
    attach(trigger, opts) {
      trigger.dataset.mode = opts.mode;
      const wrap = trigger.closest('.tab-wrap, .tool-wrap');
      const hoverable = opts.mode !== 'click';
      if (hoverable) {
        wrap.addEventListener('mouseenter', () => { if (isTouch()) return; clearTimeout(this.closeTimer); clearTimeout(this.openTimer); this.openTimer = setTimeout(() => this.open(trigger, opts), NS.settings.openDelay); });
        wrap.addEventListener('mouseleave', () => { clearTimeout(this.openTimer); if (this.owner === trigger) this.scheduleClose(); });
      }
      trigger._menu = opts;
      trigger.addEventListener('click', (e) => {
        const opensOnClick = opts.mode !== 'hover' || opts.kind === 'tools';
        const isCurrent = opts.kind === 'tools' || trigger.classList.contains('is-current');
        if (!opensOnClick) { this.close(); return; }
        // Onglet d'une autre sous-page : le lien navigue, la liste s'ouvre après le rendu.
        if (!isCurrent) { NS.pendingMenu = trigger.dataset.sp; return; }
        e.preventDefault();
        if (this.owner === trigger && this.el.classList.contains('is-open')) this.close(); else this.open(trigger, opts);
      });
      trigger.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); this.open(trigger, opts, true); } });
      const chevron = wrap.querySelector('.tab-chevron');
      if (chevron) chevron.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (this.owner === trigger) this.close(); else this.open(trigger, opts, true); });
    },
    open(trigger, opts, focusFirst) {
      clearTimeout(this.closeTimer);
      if (this.owner && this.owner !== trigger) this.owner.setAttribute('aria-expanded', 'false');
      this.owner = trigger;
      trigger.setAttribute('aria-expanded', 'true');
      const items = opts.items();
      const el = this.el;
      el.dataset.kind = opts.kind;
      el.innerHTML = `<div class="fly-head"><span class="fly-kind">${esc(opts.kindLabel)}</span><strong>${esc(opts.title)}</strong></div>
        <ul class="fly-list" role="menu">${items.map((it, i) => `<li role="none"><a role="menuitem" href="${esc(it.href || '#')}" data-i="${i}" class="${it.current ? 'is-current' : ''}">
          <span class="fly-mark">${opts.kind === 'sections' ? (NS.settings.sectionNumbers ? String(i + 1).padStart(2, '0') : '§') : opts.kind === 'actions' ? '＋' : esc(it.icon || '·')}</span>
          <span class="fly-text"><span class="fly-label">${esc(it.label)}</span>${it.hint ? `<span class="fly-hint">${esc(it.hint)}</span>` : ''}</span></a></li>`).join('')}</ul>`;
      $$('a', el).forEach((a) => a.addEventListener('click', (e) => { const it = items[+a.dataset.i]; if (it.run) { e.preventDefault(); it.run(); } this.close(); }));
      el.hidden = false;
      this.place(trigger);
      requestAnimationFrame(() => el.classList.add('is-open'));
      if (focusFirst) { const first = $('a', el); first && first.focus(); }
    },
    place(trigger) {
      const app = $('#app').getBoundingClientRect();
      const r = trigger.closest('.tab-wrap, .tool-wrap').getBoundingClientRect();
      const width = Math.min(NS.settings.menuWidth, app.width - 16);
      this.el.style.width = width + 'px';
      let left = trigger.dataset.align === 'end' ? r.right - width : r.left;
      left = Math.max(app.left + 8, Math.min(left, app.right - width - 8));
      this.el.style.left = left + 'px';
      this.el.style.top = r.bottom + 4 + 'px';
    },
    scheduleClose() { clearTimeout(this.closeTimer); this.closeTimer = setTimeout(() => this.close(), NS.settings.closeDelay); },
    close() {
      if (!this.el) return;
      clearTimeout(this.closeTimer); clearTimeout(this.openTimer);
      if (this.owner) this.owner.setAttribute('aria-expanded', 'false');
      this.owner = null;
      this.el.classList.remove('is-open');
      this.el.hidden = true;
    },
    keys(e) {
      const links = $$('a', this.el); const i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (links[i + 1] || links[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (links[i - 1] || links[links.length - 1]).focus(); }
      if (e.key === 'Tab') this.close();
    },
  };
  NS.Flyout = Flyout;

  /* ───────────────────────── Rendu des zones ───────────────────────── */
  function renderTopbar(ctx) {
    const nav = $('#sections-nav');
    nav.innerHTML = ctx.sections.map((s) => `<a href="${NS.href(s.id)}" class="sec-link ${s === ctx.section ? 'is-current' : ''}" style="--tone:${NS.toneOf(s)}" ${s === ctx.section ? 'aria-current="page"' : ''} title="${esc(s.intention)}">
      <span class="sec-acr">${esc(s.acronym)}</span><span class="sec-label">${esc(s.label)}</span></a>`).join('');
  }

  function renderSidebar(ctx) {
    const st = NS.settings;
    const s = ctx.section;
    const side = $('#sidebar');
    side.style.setProperty('--tone', NS.toneOf(s));
    const pageItems = ctx.pages.map((p, i) => {
      const current = p === ctx.page;
      const subs = shown(p.subpages);
      const showSubs = st.sidebarSubpages === 'all' || (st.sidebarSubpages === 'active' && current);
      return `<li class="side-item ${current ? 'is-current' : ''}">
        <a class="side-page" href="${NS.href(s.id, p.id)}" ${current ? 'aria-current="page"' : ''} title="${esc(p.label)}">
          <span class="side-sym" aria-hidden="true">${esc(p.symbol)}</span>
          <span class="side-text"><span class="side-label">${esc(p.label)}</span>${i === 0 ? '<span class="side-tag">Accueil de la section</span>' : p.step ? `<span class="side-step">${esc(p.step)}</span>` : ''}</span>
        </a>
        ${showSubs && subs.length ? `<ul class="side-subs">${subs.map((sp, j) => {
          const cur = current && sp === ctx.subpage;
          const anchors = shown(sp.sections);
          return `<li><a href="${NS.href(s.id, p.id, sp.id)}" class="${cur ? 'is-current' : ''}">${j === 0 ? '<span class="home-dot" title="Sous-page d’accueil">⌂</span>' : ''}${esc(sp.label)}</a>
            ${cur && st.sidebarSections && anchors.length ? `<ul class="side-anchors">${anchors.map((a) => `<li><a href="${NS.href(s.id, p.id, sp.id, a.id)}" data-anchor="${esc(a.id)}">${esc(a.label)}</a></li>`).join('')}</ul>` : ''}</li>`;
        }).join('')}</ul>` : ''}
      </li>`;
    }).join('');
    side.innerHTML = `<div class="side-head">
        <a class="side-section" href="${NS.href(s.id)}"><span class="side-acr">${esc(s.acronym)}</span><span><strong>${esc(s.label)}</strong>${st.showIntention ? `<small>${esc(s.intention)}</small>` : ''}</span></a>
      </div>
      <nav aria-label="Pages de la section"><ul class="side-list">${pageItems}</ul></nav>
      <div class="side-foot"><span>${esc(NS.model.zone.acronym)} · ${esc(NS.model.zone.label)}</span></div>`;
  }

  function renderMasthead(ctx) {
    const st = NS.settings;
    const { section: s, page: p, subpage: sp } = ctx;
    const head = $('#masthead');
    head.style.setProperty('--tone', NS.toneOf(s));
    if (!p) {
      head.innerHTML = `<div class="frame-head"><div class="frame-title"><span class="page-sym">${esc(s.acronym)}</span><div><h1>${esc(s.label)}</h1><p class="lead">${esc(s.description)}</p></div></div></div>`;
      return;
    }
    const crumbs = [
      [NS.model.zone.acronym, null], [s.label, NS.href(s.id)], [p.label, NS.href(s.id, p.id)],
    ];
    if (!ctx.isHome) crumbs.push([sp.label, null]);
    const up = !ctx.isHome ? NS.href(s.id, p.id) : ctx.pages[0] !== p ? NS.href(s.id) : null;
    const tabs = ctx.subpages.map((x, i) => {
      const home = i === 0;
      const count = home ? shown(x.actions).length : shown(x.sections).length;
      const chevron = st.tabChevron === 'always' || (st.tabChevron === 'touch' && isTouch());
      return `<div class="tab-wrap ${home ? 'is-home' : ''}" data-zone-level="${home ? 'act' : 'l4'}">
        <a class="tab ${x === sp ? 'is-current' : ''}" href="${NS.href(s.id, p.id, x.id)}" data-sp="${esc(x.id)}" aria-haspopup="menu" aria-expanded="false" ${x === sp ? 'aria-current="page"' : ''}>
          ${home ? '<span class="tab-home" aria-hidden="true">⌂</span>' : ''}<span class="tab-label">${esc(x.label)}</span>${st.tabCounts && count ? `<span class="tab-count" title="${home ? count + ' actions' : count + ' sections'}">${home ? '＋' + count : count}</span>` : ''}
        </a>${chevron && count ? '<button class="tab-chevron" type="button" aria-label="Ouvrir la liste">▾</button>' : ''}
      </div>`;
    }).join('');
    head.innerHTML = `
      <div class="frame-head">
        <div class="frame-title">
          ${up ? `<a class="up-link" href="${up}" title="Remonter d’un niveau" aria-label="Remonter d’un niveau">↑</a>` : ''}
          <span class="page-sym" aria-hidden="true">${esc(p.symbol)}</span>
          <div class="frame-text">
            ${st.breadcrumbs ? `<nav class="crumbs" aria-label="Fil d’Ariane">${crumbs.map(([l, h], i) => h && i < crumbs.length - 1 ? `<a href="${h}">${esc(l)}</a>` : `<span>${esc(l)}</span>`).join('<i>/</i>')}</nav>` : ''}
            <h1>${esc(p.label)}${!ctx.isHome ? `<span class="h1-sub"> · ${esc(sp.label)}</span>` : ''}</h1>
            <p class="lead">${esc(sp.lead || p.description)}</p>
          </div>
        </div>
        <div class="frame-tools">
          <span class="period-chip" title="Période lue">Nov. 2026</span>
          <div class="tool-wrap"><button class="tool-btn" id="tools-btn" type="button" data-align="end" aria-haspopup="menu" aria-expanded="false">Outils ▾</button></div>
        </div>
      </div>
      <nav class="tabs" aria-label="Sous-pages de ${esc(p.label)}" data-zone-level="l3">${tabs}</nav>
      ${st.sectionBand ? '<div class="section-band" id="section-band" data-zone-level="band"></div>' : ''}`;

    // Un seul mécanisme, des arguments différents (N8).
    $$('.tab', head).forEach((tab, i) => {
      const x = ctx.subpages[i];
      const home = i === 0;
      Flyout.attach(tab, home ? {
        mode: st.homeTrigger, kind: 'actions', kindLabel: 'Actions', title: x.label,
        items: () => shown(x.actions).map((a) => ({ label: a.label, hint: a.goto ? 'Ouvre un autre espace' : 'Ouvre un formulaire', run: () => runAction(a, ctx) })),
      } : {
        mode: st.sectionTrigger, kind: 'sections', kindLabel: 'Sections', title: x.label,
        items: () => shown(x.sections).map((a) => ({ label: a.label, href: NS.href(s.id, p.id, x.id, a.id), current: x === sp && NS.currentAnchor === a.id })),
      });
    });
    if (NS.pendingMenu) {
      const pending = $$('.tab', head).find((t) => t.dataset.sp === NS.pendingMenu);
      NS.pendingMenu = null;
      if (pending) requestAnimationFrame(() => Flyout.open(pending, pending._menu));
    }
    Flyout.attach($('#tools-btn', head), {
      mode: 'click', kind: 'tools', kindLabel: 'Outils', title: sp.label,
      items: () => [
        { icon: '⎙', label: 'Imprimer la sous-page', run: () => toast('Simulation : impression préparée.') },
        { icon: '⇩', label: 'Exporter les données', run: () => toast('Simulation : export préparé.') },
        { icon: '⚙', label: 'Régler la navigation', run: () => window.Studio && window.Studio.open('behaviour') },
        { icon: '?', label: 'Aide de la sous-page', run: () => toast(sp.lead || p.description) },
      ],
    });
  }

  /* ───────────────────────── Titre de section (N7) ───────────────────────── */
  NS.currentAnchor = null;
  function updateBand(ctx) {
    const band = $('#section-band');
    const anchors = ctx.anchors;
    if (!band || !anchors.length) { if (band) band.innerHTML = ''; return; }
    const i = Math.max(0, anchors.findIndex((a) => a.id === NS.currentAnchor));
    const a = anchors[i];
    const st = NS.settings;
    band.innerHTML = `<span class="band-mark">${st.sectionNumbers ? String(i + 1).padStart(2, '0') : '§'}</span>
      <span class="band-title" aria-live="polite">${esc(a.label)}</span>
      ${st.bandProgress ? `<span class="band-dots" aria-hidden="true">${anchors.map((x, j) => `<a href="${NS.href(ctx.section.id, ctx.page.id, ctx.subpage.id, x.id)}" class="${j === i ? 'is-current' : j < i ? 'is-past' : ''}" title="${esc(x.label)}"></a>`).join('')}</span><span class="band-count">${i + 1} / ${anchors.length}</span>` : ''}
      ${st.bandStepper ? `<span class="band-step"><a href="${i > 0 ? NS.href(ctx.section.id, ctx.page.id, ctx.subpage.id, anchors[i - 1].id) : '#'}" class="${i > 0 ? '' : 'is-off'}" aria-label="Section précédente">↑</a><a href="${i < anchors.length - 1 ? NS.href(ctx.section.id, ctx.page.id, ctx.subpage.id, anchors[i + 1].id) : '#'}" class="${i < anchors.length - 1 ? '' : 'is-off'}" aria-label="Section suivante">↓</a></span>` : ''}`;
    $$('.side-anchors a').forEach((l) => l.classList.toggle('is-current', l.dataset.anchor === a.id));
  }

  let spyLock = 0;
  let realignTimer = 0;
  function spy() {
    const ctx = NS.ctx;
    const main = $('#main');
    $('#app').classList.toggle('is-condensed', NS.settings.condenseOnScroll && main.scrollTop > 28);
    if (!ctx || !ctx.anchors.length || performance.now() < spyLock) return;
    const top = $('#masthead').getBoundingClientRect().bottom + 12;
    let current = ctx.anchors[0].id;
    for (const a of ctx.anchors) {
      const el = document.getElementById('sec-' + a.id);
      if (el && el.getBoundingClientRect().top <= top) current = a.id;
    }
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) current = ctx.anchors[ctx.anchors.length - 1].id;
    if (current !== NS.currentAnchor) { NS.currentAnchor = current; updateBand(ctx); }
  }

  /** Espace de fin : la dernière section doit pouvoir monter sous le titre de section (N6). */
  function fitEnd() {
    const end = $('.content-end');
    const last = $$('.csec').pop();
    if (!end || !last) return;
    const head = $('#masthead');
    const collapsible = NS.settings.condenseOnScroll ? ($('.lead', head)?.offsetHeight || 0) + ($('.crumbs', head)?.offsetHeight || 0) : 0;
    end.style.minHeight = Math.max(24, $('#main').clientHeight - (head.offsetHeight - collapsible) - last.offsetHeight - 24) + 'px';
  }

  function scrollToAnchor(id, instant) {
    const main = $('#main');
    const el = document.getElementById('sec-' + id);
    if (!el) return;
    const offset = $('#masthead').getBoundingClientRect().bottom - main.getBoundingClientRect().top;
    // Le cadre se condense pendant le défilement : on vise sa hauteur condensée.
    const condensedDelta = NS.settings.condenseOnScroll && main.scrollTop <= 28 ? ($('.lead', $('#masthead'))?.offsetHeight || 0) + ($('.crumbs', $('#masthead'))?.offsetHeight || 0) : 0;
    const top = main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top - offset + condensedDelta - 8;
    const smooth = !instant && NS.settings.smoothScroll;
    main.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    NS.currentAnchor = id; updateBand(NS.ctx);
    // Le cadre se condense pendant le trajet : on verrouille le suivi puis on réaligne au pixel près.
    spyLock = performance.now() + (smooth ? 900 : 400);
    clearTimeout(realignTimer);
    realignTimer = setTimeout(() => {
      const delta = el.getBoundingClientRect().top - ($('#masthead').getBoundingClientRect().bottom + 8);
      if (Math.abs(delta) > 2) main.scrollTo({ top: main.scrollTop + delta, behavior: 'auto' });
      setTimeout(() => { spyLock = 0; }, 60);
    }, smooth ? 650 : 260);
  }

  /* ───────────────────────── Contenu de démonstration ───────────────────────── */
  const POOL = {
    ops: ['Salaire', 'Loyer', 'Courses Biocoop', 'Navigo', 'Électricité', 'Assurance habitation', 'Mutuelle', 'Prime annuelle', 'Restaurant', 'Abonnement fibre', 'Pharmacie', 'Cinéma', 'Remboursement CAF', 'Essence', 'Coiffeur'],
    postes: ['Logement', 'Alimentation', 'Transport', 'Santé', 'Loisirs', 'Énergie', 'Assurances', 'Revenus'],
    projets: ['Cuisine · parcours complet', 'Voyage au Japon', 'Vélo cargo', 'Salle de bain', 'Fonds d’urgence', 'Formation UX', 'Toiture', 'Mariage'],
    taches: ['Devis plombier', 'Commande des meubles', 'Réservation des vols', 'Pose du carrelage', 'Choix de l’assurance', 'Visite du showroom', 'Dossier de subvention', 'Achat du matériel'],
    kpis: [['Reçu', 1], ['Dépensé', -1], ['Reste à vivre', 1], ['Impact patrimonial', 1], ['À venir', -1], ['Écart', 0], ['Marge restante', 1], ['Engagé', -1], ['Épargne du cycle', 1], ['Projets financés', 1]],
    status: [['Réglé', 'ok'], ['À venir', 'info'], ['À vérifier', 'warn'], ['En retard', 'bad']],
    months: ['déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.'],
  };
  /** Textes propres aux sections éditoriales (VE et 01). */
  const TEXTS = {
    role: ['<strong>BPM pilote votre budget et votre patrimoine comme un seul projet de vie.</strong> Vos entrées et dépenses alimentent le budget du cycle ; ce qui reste à la clôture rejoint votre patrimoine.', 'Vous lisez d’abord la période, vous agissez ensuite depuis le montant concerné : chaque chiffre mène à son détail et aux actions utiles.', 'Les actions de chaque page sont sous son onglet d’accueil ⌂ ; les autres onglets déroulent leurs sections au survol.'],
    unique: ['<strong>Le projet de vie est unique.</strong> Il englobe vos charges indispensables et courantes, vos projets de la vie et le résultat de chaque cycle.', 'Il naît une seule fois, avec votre profil, votre budget et votre patrimoine.'],
    flux: ['<strong>Flux.</strong> Toute entrée ou dépense, réglée ou à venir.', '<strong>Opération.</strong> Un flux daté, rattaché à un poste et, si besoin, à un projet.'],
    plafonds: ['<strong>Poste.</strong> Un grand ensemble de dépenses (logement, alimentation…), découpé en catégories.', '<strong>Plafond.</strong> La limite d’un poste ou d’une catégorie pour un cycle. Il signale un dépassement sans jamais bloquer une dépense.'],
    enveloppes: ['<strong>Enveloppe.</strong> Le budget attribué à un projet de la vie.', '<strong>Part.</strong> La fraction d’une enveloppe confiée à une tâche ; une tâche peut demander une part supplémentaire, décidée dans le projet.'],
    pourquoi: ['<strong>Tout commence par le projet de vie.</strong> Sans lui, ni budget ni patrimoine : c’est le cadre où chaque montant prend sa place.', 'Vous le créez une fois ; il évolue ensuite à chaque cycle.', 'Comptez deux minutes : un nom, un patrimoine de départ si vous le connaissez, le début de votre cycle.'],
  };
  const day = (r) => `${String(1 + Math.floor(r() * 28)).padStart(2, '0')}/11`;

  const BLOCKS = {
    kpis(r, sec) {
      const start = Math.floor(r() * POOL.kpis.length);
      return `<div class="kpis">${[0, 1, 2, 3].map((k) => { const [l, sign] = POOL.kpis[(start + k * 3) % POOL.kpis.length]; const v = Math.round(200 + r() * 4200); const d = Math.round((r() - 0.4) * 18);
        return `<div class="kpi"><span class="kpi-label">${l}</span><strong class="kpi-value ${sign < 0 ? 'neg' : ''}">${sign < 0 ? '−' : ''}${eur.format(v)}</strong><span class="kpi-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)} % vs cycle préc.</span></div>`; }).join('')}</div>`;
    },
    table(r) {
      const rows = Array.from({ length: 6 }, () => { const neg = r() > 0.3; const [st, cls] = pick(r, POOL.status); return `<tr><td>${day(r)}</td><td>${pick(r, POOL.ops)}</td><td><span class="tag">${pick(r, POOL.postes)}</span></td><td><span class="pill ${cls}">${st}</span></td><td class="num ${neg ? 'neg' : 'pos'}">${neg ? '−' : '+'}${eur.format(Math.round(8 + r() * 900))}</td></tr>`; }).join('');
      return `<div class="table-wrap" tabindex="0"><table><thead><tr><th>Date</th><th>Libellé</th><th>Poste</th><th>Statut</th><th class="num">Montant</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    },
    bars(r) {
      return `<ul class="bars">${POOL.postes.slice(0, 5).map((p) => { const pct = Math.round(20 + r() * 100); const lim = Math.round(150 + r() * 900); const cls = pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok';
        return `<li><span class="bar-label">${p}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${Math.min(pct, 100)}%"></span></span><span class="bar-val"><strong>${eur.format(Math.round((lim * pct) / 100))}</strong> / ${eur.format(lim)}</span></li>`; }).join('')}</ul>`;
    },
    cards(r) {
      const start = Math.floor(r() * POOL.projets.length);
      return `<div class="cards">${[0, 1, 2].map((k) => { const name = POOL.projets[(start + k) % POOL.projets.length]; const pct = Math.round(r() * 100); const env = Math.round(500 + r() * 9000);
        return `<article class="card"><header><strong>${name}</strong><span class="pill ${pct > 90 ? 'warn' : 'info'}">${pct > 90 ? 'À surveiller' : 'En cours'}</span></header><p>Enveloppe ${eur.format(env)} · ${Math.round(2 + r() * 8)} tâches</p><div class="bar-track"><span class="bar-fill ok" style="width:${pct}%"></span></div><footer><span>${pct} % consommé</span><a href="#" data-demo>Détail →</a></footer></article>`; }).join('')}</div>`;
    },
    chart(r) {
      let v = 20 + r() * 20; const pts = POOL.months.map(() => (v = Math.max(5, Math.min(95, v + (r() - 0.35) * 14))));
      const W = 600, H = 170; const xs = (i) => 20 + (i * (W - 40)) / (pts.length - 1); const ys = (y) => H - 20 - (y / 100) * (H - 40);
      const line = pts.map((y, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(y).toFixed(1)}`).join(' ');
      return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution sur douze mois"><path class="chart-area" d="${line} L${xs(pts.length - 1)},${H - 20} L20,${H - 20} Z"/><path class="chart-line" d="${line}"/>${[25, 50, 75].map((g) => `<line class="chart-grid" x1="20" x2="${W - 20}" y1="${ys(g)}" y2="${ys(g)}"/>`).join('')}${pts.map((y, i) => `<circle class="chart-dot" cx="${xs(i)}" cy="${ys(y)}" r="${i === pts.length - 1 ? 4.5 : 0}"/><text x="${xs(i)}" y="${H - 4}" class="chart-x">${POOL.months[i]}</text>`).join('')}</svg>
        <figcaption>Patrimoine projeté : <strong>${eur.format(Math.round(42000 + pts[pts.length - 1] * 900))}</strong> fin nov. 2027</figcaption></figure>`;
    },
    timeline(r, sec) {
      return `<ol class="timeline">${[0, 1, 2, 3].map((k) => `<li><span class="tl-date">${day(r)}</span><div><strong>${pick(r, [...POOL.taches, ...POOL.ops])}</strong><p>${pick(r, ['Échéance confirmée.', 'À vérifier avant la fin du cycle.', 'Versement au patrimoine.', 'Décision attendue.', 'Rattaché au projet de vie.'])}</p></div></li>`).join('')}</ol>`;
    },
    text(r, sec) {
      const own = TEXTS[sec.id];
      if (own) return `<div class="prose">${own.map((p, i) => i === own.length - 1 && own.length > 2 ? `<aside class="callout">ⓘ ${p}</aside>` : `<p>${p}</p>`).join('')}</div>`;
      return `<div class="prose"><p><strong>${esc(sec.label)}.</strong> ${pick(r, ['Chaque montant conserve son origine : du revenu reçu jusqu’à la tâche qui le consomme, vous pouvez remonter la chaîne à tout moment.', 'Le projet de vie est unique : il englobe vos charges, vos projets de la vie et la capitalisation de chaque cycle clos.', 'Les plafonds informent sans bloquer : une dépense est toujours enregistrée, le dépassement est signalé au poste et à la catégorie.'])}</p>
        <p>${pick(r, ['Vous lisez d’abord, vous agissez ensuite depuis le montant concerné.', 'Les réglages sont explicites et réversibles tant que la période n’est pas close.', 'Le cycle budgétaire se clôt une fois les contrôles relus ; son résultat rejoint le patrimoine.'])}</p>
        <aside class="callout">ⓘ ${pick(r, ['Astuce : survolez un onglet pour voir ses sections.', 'Les actions de la page sont sous l’onglet d’accueil ⌂.', 'Le titre de section au-dessus du contenu suit votre lecture.'])}</aside></div>`;
    },
    checklist(r) {
      const items = Array.from({ length: 4 }, () => pick(r, ['Relire les opérations à vérifier', 'Confirmer les échéances de la semaine', 'Décider la demande « Pose du carrelage »', 'Rapprocher le compte courant', 'Valider le résultat du cycle', 'Ajuster le plafond Loisirs', 'Rattacher deux tâches sans projet', 'Choisir les sources du calendrier']));
      return `<ul class="checklist">${[...new Set(items)].map((t, i) => `<li><label><input type="checkbox" ${r() > 0.55 ? 'checked' : ''}> <span>${t}</span></label></li>`).join('')}</ul>`;
    },
    fields(r, sec) {
      const f = [['Compte', 'Compte courant · Banque Populaire'], ['Début du cycle', '25 de chaque mois'], ['Stock d’ouverture', eur.format(38400)], ['Date de référence', '01/01/2026'], ['Durée', '1 mois'], ['Profil', 'Camille R.']];
      const start = Math.floor(r() * f.length);
      return `<dl class="fields">${[0, 1, 2, 3].map((k) => { const [l, v] = f[(start + k) % f.length]; return `<div><dt>${l}</dt><dd>${v}</dd></div>`; }).join('')}</dl><button class="btn ghost" type="button" data-edit="${esc(sec.label)}">Modifier ${esc(sec.label.toLowerCase())}</button>`;
    },
    calendar(r) {
      const cells = []; for (let i = 0; i < 6; i++) cells.push('<span class="cal-out"></span>');
      for (let d = 1; d <= 30; d++) { const inc = r() > 0.85, chg = r() > 0.6; cells.push(`<span class="cal-day ${d === 15 ? 'is-today' : ''}"><b>${d}</b>${inc ? '<i class="dot inc"></i>' : ''}${chg ? '<i class="dot chg"></i>' : ''}</span>`); }
      return `<div class="calendar"><div class="cal-head">${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div><p class="cal-legend"><i class="dot inc"></i> entrée <i class="dot chg"></i> dépense</p></div>`;
    },
    kanban(r) {
      return `<div class="kanban">${['À faire', 'En cours', 'Terminé'].map((c) => `<div class="kcol"><h4>${c}</h4>${Array.from({ length: 1 + Math.floor(r() * 3) }, () => `<div class="kcard"><strong>${pick(r, POOL.taches)}</strong><span>${pick(r, POOL.projets)} · ${eur.format(Math.round(50 + r() * 1200))}</span></div>`).join('')}</div>`).join('')}</div>`;
    },
  };

  function renderContent(ctx) {
    const content = $('#content');
    const { section: s, page: p, subpage: sp } = ctx;
    if (!p) {
      content.innerHTML = `<div class="section-home"><p class="eyebrow">${esc(s.intention)}</p><div class="cards">${ctx.pages.map((x) => `<a class="card card-link" href="${NS.href(s.id, x.id)}"><header><span class="page-sym">${esc(x.symbol)}</span><strong>${esc(x.label)}</strong></header><p>${esc(x.description)}</p><footer><span>${shown(x.subpages).length} sous-pages</span><span>${esc(x.step || '')} →</span></footer></a>`).join('')}</div></div>`;
      return;
    }
    content.innerHTML = `<div id="inline-form-slot"></div>` + ctx.anchors.map((a, i) => {
      const r = rng(`${s.id}/${p.id}/${sp.id}/${a.id}`);
      const block = (BLOCKS[a.kind] || BLOCKS.text)(r, a);
      return `<section class="csec" id="sec-${esc(a.id)}" data-zone-level="l4c" aria-labelledby="h-${esc(a.id)}">
        <h2 id="h-${esc(a.id)}"><span class="csec-n">${NS.settings.sectionNumbers ? String(i + 1).padStart(2, '0') : '§'}</span>${esc(a.label)}<a class="csec-anchor" href="${NS.href(s.id, p.id, sp.id, a.id)}" aria-label="Lien vers cette section">#</a></h2>
        ${block}
      </section>`;
    }).join('') + '<div class="content-end"></div>';
    $$('[data-demo]', content).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); toast('Simulation : la fiche s’ouvrirait ici.'); }));
    $$('[data-edit]', content).forEach((b) => b.addEventListener('click', () => openForm({ label: b.dataset.edit, form: 'fields' }, ctx)));
  }

  /* ───────────────────────── Formulaires d'action (N4) ───────────────────────── */
  const FORMS = {
    operation: (a) => [['Libellé', 'text', a.direction === 'income' ? 'Salaire de novembre' : 'Courses de la semaine'], ['Montant', 'money', ''], ['Date', 'date', '2026-11-15'], ['Poste', 'select', a.direction === 'income' ? ['Revenus', 'Primes', 'Remboursements'] : POOL.postes.slice(0, 7)], ['Statut', 'radio', ['Réglé', 'À venir']], ['Note', 'textarea', '']],
    project: () => [['Nom du projet', 'text', ''], ['Budget de départ', 'money', ''], ['Début', 'date', '2026-12-01'], ['Fin visée', 'date', '2027-06-30'], ['Description', 'textarea', '']],
    task: () => [['Titre de la tâche', 'text', ''], ['Projet', 'select', ['Plus tard', ...POOL.projets.slice(0, 5)]], ['Part de budget', 'money', ''], ['Échéance', 'date', '2026-12-15']],
    goal: () => [['Objectif', 'text', 'Apport immobilier'], ['Montant visé', 'money', '30000'], ['Date visée', 'date', '2028-09-01'], ['Priorité', 'radio', ['Haute', 'Normale', 'Basse']]],
    cap: () => [['Poste', 'select', POOL.postes.slice(0, 7)], ['Plafond par cycle', 'money', '450'], ['Alerte à', 'select', ['80 %', '90 %', '100 %']]],
    category: () => [['Nom', 'text', ''], ['Poste parent', 'select', POOL.postes.slice(0, 7)]],
    cycle: () => [['Jour d’ancrage', 'select', ['1er', '5', '10', '25', 'Dernier jour']], ['Durée', 'radio', ['1 mois', '2 semaines']], ['Premier cycle', 'date', '2026-01-25']],
    closing: () => [['Cycle', 'select', ['Oct. 2026 → nov. 2026']], ['Contrôles relus', 'check', ''], ['Résultat à capitaliser', 'money', '612'], ['Commentaire', 'textarea', '']],
    decision: () => [['Demande', 'select', ['Pose du carrelage · 420 €', 'Réservation des vols · 1 180 €']], ['Décision', 'radio', ['Accepter', 'Refuser', 'Reporter']], ['Motif', 'textarea', '']],
    period: () => [['Période', 'select', ['Nov. 2026', 'Oct. 2026', 'Sept. 2026', 'Cycle personnalisé']], ['Lecture', 'radio', ['Dates réelles', 'Dates prévues']]],
    view: () => [['Vue', 'radio', ['Semaine', 'Mois', 'Année']], ['Afficher', 'check', '']],
    onboarding: () => [['Nom du profil', 'text', ''], ['Patrimoine de départ', 'money', ''], ['Début du cycle', 'date', '2026-11-25']],
    journey: () => [['Reprendre à', 'select', ['Registre de flux · Registre détaillé', 'Gestion du projet de vie · Charges courantes', 'Projets et financement · Décider les financements']]],
    fields: () => [['Valeur', 'text', ''], ['Date d’effet', 'date', '2026-11-15']],
  };

  function runAction(action, ctx) {
    if (action.goto) { NS.goPath(action.goto); return; }
    openForm(action, ctx);
  }

  function field([label, type, value], i) {
    const id = 'f' + i;
    if (type === 'select') return `<label class="fld"><span>${label}</span><select id="${id}">${value.map((v) => `<option>${esc(v)}</option>`).join('')}</select></label>`;
    if (type === 'radio') return `<fieldset class="fld"><legend>${label}</legend><div class="seg">${value.map((v, j) => `<label><input type="radio" name="${id}" ${j ? '' : 'checked'}><span>${esc(v)}</span></label>`).join('')}</div></fieldset>`;
    if (type === 'textarea') return `<label class="fld"><span>${label} <em>facultatif</em></span><textarea id="${id}" rows="2"></textarea></label>`;
    if (type === 'check') return `<label class="fld fld-check"><input type="checkbox" id="${id}"> <span>${label}</span></label>`;
    if (type === 'money') return `<label class="fld"><span>${label}</span><span class="money"><input id="${id}" inputmode="decimal" value="${esc(value)}" placeholder="0"><i>€</i></span></label>`;
    return `<label class="fld"><span>${label}</span><input id="${id}" type="${type}" value="${esc(value)}"></label>`;
  }

  function openForm(action, ctx) {
    closeForm();
    const mode = NS.settings.formMode;
    const fields = (FORMS[action.form] || FORMS.fields)(action);
    const html = `<form class="form-panel mode-${mode}" id="action-form" style="--tone:${NS.toneOf(ctx.section)}" aria-labelledby="form-title">
      <header><span class="eyebrow">${esc(ctx.page.label)} · ${esc(ctx.subpages[0].label)}</span><h3 id="form-title">${esc(action.label)}</h3><button type="button" class="x" data-close aria-label="Fermer">✕</button></header>
      <div class="form-body">${fields.map(field).join('')}</div>
      <footer><button type="button" class="btn ghost" data-close>Annuler</button><button type="submit" class="btn primary">Enregistrer</button></footer></form>`;
    if (mode === 'inline') {
      const slot = $('#inline-form-slot');
      if (!slot) return;
      slot.innerHTML = html;
      $('#main').scrollTo({ top: 0, behavior: NS.settings.smoothScroll ? 'smooth' : 'auto' });
    } else {
      const layer = $('#form-layer');
      layer.innerHTML = `<div class="form-backdrop" data-close></div>${html}`;
      layer.hidden = false;
      layer.className = 'form-layer mode-' + mode;
      requestAnimationFrame(() => layer.classList.add('is-open'));
    }
    const form = $('#action-form');
    $$('[data-close]', form.parentElement).forEach((b) => b.addEventListener('click', closeForm));
    form.addEventListener('submit', (e) => { e.preventDefault(); closeForm(); toast(`« ${action.label} » simulé : aucune donnée enregistrée.`); });
    const first = $('input, select, textarea', form); first && first.focus({ preventScroll: true });
  }
  function closeForm() {
    const layer = $('#form-layer');
    if (layer) { layer.classList.remove('is-open'); layer.hidden = true; layer.innerHTML = ''; }
    const slot = $('#inline-form-slot'); if (slot) slot.innerHTML = '';
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !NS.Flyout.owner) closeForm(); });
  NS.openForm = openForm;

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('is-on'); setTimeout(() => (t.hidden = true), 250); }, 2600);
  }
  NS.toast = toast;

  /* ───────────────────────── Apparence ───────────────────────── */
  function applySettings() {
    const st = NS.settings;
    const app = $('#app');
    const theme = st.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : st.theme;
    Object.assign(app.dataset, { theme, density: st.density, header: st.header, sidebar: st.sidebarStyle, tabs: st.tabStyle, reveal: st.reveal ? 'on' : 'off', band: st.sectionBand ? 'on' : 'off', form: st.formMode });
    app.style.setProperty('--radius', st.radius + 'px');
    app.style.setProperty('--fs', st.fontScale / 100);
    app.style.setProperty('--side-w', st.sidebarWidth + 'px');
    const vp = { auto: '', desktop: '1440px', laptop: '1180px', tablet: '820px', mobile: '390px' }[st.viewport] ?? '';
    $('#stage').dataset.viewport = st.viewport;
    app.style.maxWidth = vp || '';
    document.documentElement.dataset.theme = theme;
  }

  /* ───────────────────────── Routage ───────────────────────── */
  let lastKey = '';
  function onRoute() {
    const r = NS.parse(location.hash);
    const ctx = NS.resolve(r);
    NS.ctx = ctx;
    NS.route = r;
    const key = [ctx.section?.id, ctx.page?.id, ctx.subpage?.id].join('/');
    const same = key === lastKey;
    Flyout.close();
    if (!same) {
      closeForm();
      NS.currentAnchor = ctx.anchors[0] ? ctx.anchors[0].id : null;
      renderAll(ctx);
      $('#main').scrollTop = 0;
      $('#app').classList.remove('is-condensed');
      $('#app').classList.remove('side-open');
      document.title = [ctx.subpage && !ctx.isHome ? ctx.subpage.label : null, ctx.page ? ctx.page.label : null, ctx.section.label, 'BPM · Simulation'].filter(Boolean).join(' · ');
    }
    lastKey = key;
    if (ctx.anchor) requestAnimationFrame(() => scrollToAnchor(ctx.anchor.id, !same));
    NS.listeners.forEach((fn) => fn(ctx));
  }

  function renderAll(ctx) {
    const app = $('#app');
    app.style.setProperty('--tone', NS.toneOf(ctx.section));
    renderTopbar(ctx);
    renderSidebar(ctx);
    renderMasthead(ctx);
    renderContent(ctx);
    if (ctx.page) updateBand(ctx);
    fitEnd();
  }

  NS.refresh = function () {
    applySettings();
    lastKey = '';
    const keepScroll = $('#main').scrollTop;
    const anchor = NS.currentAnchor;
    onRoute();
    $('#main').scrollTop = keepScroll;
    if (anchor) { NS.currentAnchor = anchor; spy(); updateBand(NS.ctx); }
  };

  /* ───────────────────────── Démarrage ───────────────────────── */
  function boot() {
    Flyout.init();
    applySettings();
    const main = $('#main');
    let raf = 0;
    main.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy); Flyout.owner && Flyout.close(); }, { passive: true });
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('resize', () => { Flyout.close(); fitEnd(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => NS.settings.theme === 'auto' && applySettings());
    $('#hist-back').addEventListener('click', () => history.back());
    $('#hist-fwd').addEventListener('click', () => history.forward());
    $('#burger').addEventListener('click', () => $('#app').classList.toggle('side-open'));
    $('#side-scrim').addEventListener('click', () => $('#app').classList.remove('side-open'));
    // Les liens d'ancre de la même sous-page ne rechargent rien : ils défilent (N6).
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#/"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const r = NS.parse(a.getAttribute('href'));
      const cur = NS.ctx;
      if (r.a && cur.subpage && r.s === cur.section.id && r.p === cur.page.id && r.sp === cur.subpage.id) {
        e.preventDefault();
        history.replaceState(null, '', a.getAttribute('href'));
        scrollToAnchor(r.a);
        Flyout.close();
      }
    });
    if (!location.hash) history.replaceState(null, '', NS.href(NS.visibleSections()[1]?.id || NS.visibleSections()[0].id));
    onRoute();
  }
  NS.scrollToAnchor = scrollToAnchor;
  NS.checks = function () {
    const out = [];
    const ids = new Set();
    NS.model.sections.forEach((s) => {
      if (!shown(s.pages).length) out.push(['error', `${s.acronym} ${s.label} : aucune page visible.`]);
      shown(s.pages).forEach((p, pi) => {
        const subs = shown(p.subpages);
        if (!subs.length) out.push(['error', `${p.label} : aucune sous-page ; la page n’a pas d’accueil (N3).`]);
        if (subs[0] && !shown(subs[0].actions).length) out.push(['warn', `${p.label} : l’accueil « ${subs[0].label} » ne porte aucune action (N4).`]);
        subs.slice(1).forEach((sp) => { if (!shown(sp.sections).length) out.push(['warn', `${p.label} › ${sp.label} : aucune section de contenu (N5).`]); });
        subs.forEach((sp) => {
          const key = `${s.id}/${p.id}/${sp.id}`;
          if (ids.has(key)) out.push(['error', `Adresse en double : ${key} (N9).`]);
          ids.add(key);
          if (sp.label === p.label && subs.length > 1) out.push(['warn', `${p.label} : la sous-page d’accueil porte le même libellé que la page.`]);
        });
      });
    });
    const total = NS.model.sections.reduce((n, s) => n + s.pages.reduce((m, p) => m + p.subpages.length, 0), 0);
    if (!out.length) out.push(['ok', `Plan d’équerre : ${NS.model.sections.length} sections, ${total} sous-pages, chaque page a son accueil et ses sections.`]);
    return out;
  };

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
