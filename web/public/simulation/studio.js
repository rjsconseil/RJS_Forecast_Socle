/*
 * RJS Forecast · BPM — Atelier « Navigation system ».
 * Règles et contrôles, comportements, cadre, apparence, structure éditable, simulation.
 * Toute modification passe par NavigationSystem.set / saveModel puis refresh : une seule source.
 */
(function () {
  'use strict';
  const NS = window.NavigationSystem;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS_UI = 'rjs-bpm-sim:studio:v2';
  const ui = Object.assign({ open: true, tab: 'rules', openKeys: ['s:vision', 'p:vision/tableau-de-bord'] }, (() => { try { return JSON.parse(localStorage.getItem(LS_UI)) || {}; } catch { return {}; } })());
  const saveUi = () => { try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch { /* indisponible */ } };

  const TABS = [['rules', 'Règles'], ['behaviour', 'Comportements'], ['frame', 'Cadre'], ['look', 'Apparence'], ['structure', 'Structure'], ['sim', 'Simulation']];

  /* ───────── Contrôles génériques ───────── */
  const seg = (key, label, options, hint) => `<div class="st-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><div class="st-seg" role="group" aria-label="${esc(label)}">${options.map(([v, l]) => `<button type="button" data-set="${key}" data-val="${esc(v)}" aria-pressed="${String(NS.settings[key]) === String(v)}">${l}</button>`).join('')}</div></div>`;
  const range = (key, label, min, max, step, unit, hint) => `<div class="st-row"><label for="r-${key}">${label}${hint ? `<small>${hint}</small>` : ''}</label><div class="st-range"><input id="r-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${NS.settings[key]}" data-range="${key}"><output>${NS.settings[key]} ${unit}</output></div></div>`;
  const toggle = (key, label, hint) => `<div class="st-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><button type="button" class="st-switch" role="switch" aria-checked="${!!NS.settings[key]}" data-toggle="${key}" aria-label="${esc(label)}"></button></div>`;
  const group = (title, body) => `<section class="st-group"><h3>${title}</h3>${body}</section>`;

  /* ───────── Panneaux ───────── */
  const PANELS = {
    rules() {
      const checks = NS.checks();
      return group('Niveaux de navigation', `<div class="st-levels">${NS.LEVELS.map((l) => `<div><i style="background:${l.color}"></i>${l.label}</div>`).join('')}</div>
          <p class="st-note">Activez « Révéler les zones » dans Simulation pour les voir sur la page.</p>`)
        + group('Contrôles du plan', checks.map(([lvl, t]) => `<div class="st-check ${lvl}">${lvl === 'ok' ? '✓' : lvl === 'warn' ? '!' : '✕'} <span>${esc(t)}</span></div>`).join(''))
        + group('Règles du Navigation system v2', `<ol class="st-rules">${NS.RULES.map(([id, title, text]) => `<li><b>${id}</b><div><strong>${title}</strong><p>${text}</p></div></li>`).join('')}</ol>`)
        + group('Démonstration', `<p class="st-note" style="margin:0 0 8px">Enchaîne les règles N1 à N7 sur la page, pas à pas.</p><div class="st-actions"><button class="st-btn" type="button" data-cmd="demo">▶ Lancer la démonstration</button></div>`);
    },
    behaviour() {
      return group('Entrée de section (N2)', seg('sectionEntry', 'À l’ouverture', [['first-page', 'Première page'], ['section-home', 'Accueil de section']], 'Sélection d’office ou cartes'))
        + group('Menus des onglets (N4 · N5 · N8)',
          seg('homeTrigger', 'Actions de l’accueil', [['click', 'Clic'], ['hover', 'Survol'], ['hover-click', 'Les deux']])
          + seg('sectionTrigger', 'Sections des sous-pages', [['hover', 'Survol'], ['click', 'Clic'], ['hover-click', 'Les deux']])
          + range('openDelay', 'Délai d’ouverture', 0, 400, 20, 'ms')
          + range('closeDelay', 'Délai de fermeture', 0, 800, 20, 'ms', 'Après la sortie du survol')
          + range('menuWidth', 'Largeur des listes', 200, 400, 10, 'px')
          + seg('tabChevron', 'Bouton d’ouverture', [['touch', 'Tactile'], ['always', 'Toujours'], ['never', 'Jamais']], 'Accès sans survol (N10)')
          + toggle('sectionNumbers', 'Numéroter les sections')
          + toggle('tabCounts', 'Compteurs sur les onglets', '＋n actions, n sections'))
        + group('Navigation latérale (N2)',
          seg('sidebarSubpages', 'Sous-pages', [['none', 'Aucune'], ['active', 'Page active'], ['all', 'Toutes']])
          + toggle('sidebarSections', 'Sections de la sous-page', 'Sous la sous-page courante')
          + toggle('showIntention', 'Intention de la section'))
        + group('Formulaires d’action (N4)', seg('formMode', 'Ouverture', [['sheet', 'Panneau'], ['modal', 'Fenêtre'], ['inline', 'En ligne']]))
        + group('Défilement (N6)', toggle('smoothScroll', 'Défilement fluide vers une section') + toggle('breadcrumbs', 'Fil d’Ariane'));
    },
    frame() {
      return group('Cadre du haut (N7)',
        seg('header', 'Format', [['standard', 'Standard'], ['compact', 'Compact'], ['ultra', 'Ultra-compact']], 'Ultra : titre et onglets sur une ligne')
        + toggle('condenseOnScroll', 'Condenser au défilement', 'Masque fil d’Ariane et chapeau'))
        + group('Titre de section (N7)',
          toggle('sectionBand', 'Afficher le titre de section', 'Entre le cadre et le contenu')
          + toggle('bandProgress', 'Progression', 'Points et rang n / total')
          + toggle('bandStepper', 'Section précédente / suivante'))
        + group('Onglets des sous-pages (N3)', seg('tabStyle', 'Style', [['underline', 'Soulignés'], ['pill', 'Pilules'], ['segment', 'Segments']]));
    },
    look() {
      const sections = NS.model.sections;
      return group('Thème', seg('theme', 'Apparence', [['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Système']]) + seg('density', 'Densité', [['compact', 'Dense'], ['comfortable', 'Confort'], ['airy', 'Aérée']]))
        + group('Formes et texte', range('radius', 'Arrondis', 0, 18, 1, 'px') + range('fontScale', 'Taille du texte', 85, 125, 5, '%') + range('sidebarWidth', 'Largeur du menu', 200, 320, 4, 'px') + seg('sidebarStyle', 'Menu latéral', [['full', 'Complet'], ['rail', 'Rail d’icônes']]))
        + group('Couleurs des sections',
          seg('accentMode', 'Accent', [['section', 'Par section'], ['uniform', 'Uniforme']])
          + `<div class="st-colors">${(NS.settings.accentMode === 'uniform' ? [{ id: '__uniform', acronym: 'Tous', tone: 'navy' }] : sections).map((s) => `<label><input type="color" value="${NS.settings.tones[s.id] || NS.TONES[s.tone] || '#2563a6'}" data-tone="${s.id}"> ${esc(s.acronym)}</label>`).join('')}</div>
          <div class="st-actions"><button class="st-btn" type="button" data-cmd="reset-tones">Couleurs d’origine</button></div>`);
    },
    structure() {
      return group('Arborescence', `<p class="st-note" style="margin:0 0 8px">Renommez, réordonnez (↑↓), masquez (◐) ou ajoutez. La première sous-page d’une page est son accueil ⌂ et porte les actions.</p><div class="st-tree">${tree()}</div>`)
        + group('Échange', `<div class="st-actions"><button class="st-btn" type="button" data-cmd="export">⇩ Exporter JSON</button><button class="st-btn" type="button" data-cmd="show-import">⇧ Importer</button><button class="st-btn danger" type="button" data-cmd="reset-model">Réinitialiser la structure</button></div>
          <div id="import-box" hidden><textarea class="st-json" id="import-json" placeholder="Collez ici un export JSON (structure et réglages)"></textarea><div class="st-actions"><button class="st-btn" type="button" data-cmd="import">Appliquer</button></div></div>`);
    },
    sim() {
      const opts = [];
      NS.visibleSections().forEach((s) => s.pages.filter((p) => !p.hidden).forEach((p) => p.subpages.filter((x) => !x.hidden).forEach((sp, i) => opts.push(`<option value="${s.id}/${p.id}/${sp.id}">${esc(s.acronym)} · ${esc(p.label)} › ${i === 0 ? '⌂ ' : ''}${esc(sp.label)}</option>`))));
      return group('Appareil', seg('viewport', 'Largeur', [['auto', 'Fenêtre'], ['desktop', '1440'], ['laptop', '1180'], ['tablet', '820'], ['mobile', '390']]))
        + group('Lecture', toggle('reveal', 'Révéler les zones', 'Contour et nom de chaque niveau') + seg('audience', 'Profil', [['member', 'Connecté'], ['visitor', 'Visiteur']], 'Le visiteur voit VE et 01'))
        + group('Aller à', `<select class="st-jump" id="jump">${opts.join('')}</select>`)
        + group('Réglages', `<div class="st-actions"><button class="st-btn" type="button" data-cmd="export">⇩ Exporter</button><button class="st-btn danger" type="button" data-cmd="reset-settings">Réglages par défaut</button></div><p class="st-note">Réglages et structure sont conservés dans ce navigateur.</p>`);
    },
  };

  /* ───────── Arborescence éditable ───────── */
  function node(level, color, key, path, label, extra = '') {
    return `<div class="st-node ${extra.includes('data-hidden') ? 'is-hidden' : ''}" data-path="${path}">${extra.includes('chev') ? '<span class="chev">▸</span>' : '<span class="chev"></span>'}<span class="lvl" style="background:${color}">${level}</span>${extra.replace('chev', '').replace('data-hidden', '')}<input type="text" value="${esc(label)}" data-rename="${path}" aria-label="Libellé">
      <button class="ic" type="button" data-move="${path}" data-dir="-1" title="Monter">↑</button><button class="ic" type="button" data-move="${path}" data-dir="1" title="Descendre">↓</button>
      ${key === 'del' ? `<button class="ic" type="button" data-del="${path}" title="Supprimer">✕</button>` : `<button class="ic" type="button" data-hide="${path}" title="Masquer / afficher">◐</button>`}</div>`;
  }
  function tree() {
    const L = Object.fromEntries(NS.LEVELS.map((l) => [l.key, l.color]));
    const open = (k) => (ui.openKeys.includes(k) ? 'open' : '');
    return NS.model.sections.map((s, si) => `<details ${open('s:' + s.id)} data-key="s:${s.id}"><summary>${node(s.acronym, L.l1, 'hide', `${si}`, s.label, 'chev' + (s.hidden ? 'data-hidden' : ''))}</summary><div class="st-kids">
      ${s.pages.map((p, pi) => `<details ${open('p:' + s.id + '/' + p.id)} data-key="p:${s.id}/${p.id}"><summary>${node('P', L.l2, 'hide', `${si}.${pi}`, p.label, `chev<input type="text" class="sym" value="${esc(p.symbol)}" data-symbol="${si}.${pi}" aria-label="Symbole">` + (p.hidden ? 'data-hidden' : ''))}</summary><div class="st-kids">
        ${p.subpages.map((sp, spi) => `<details ${open('sp:' + s.id + '/' + p.id + '/' + sp.id)} data-key="sp:${s.id}/${p.id}/${sp.id}"><summary>${node('S', L.l3, 'hide', `${si}.${pi}.${spi}`, sp.label, 'chev' + (spi === 0 ? '<span class="home-badge">⌂ accueil</span>' : '') + (sp.hidden ? 'data-hidden' : ''))}</summary><div class="st-kids">
          ${spi === 0 ? (sp.actions || []).map((a, ai) => node('＋', L.act, 'del', `${si}.${pi}.${spi}.a${ai}`, a.label)).join('') + `<button class="st-btn" type="button" style="height:24px;margin:2px 0 4px" data-add-action="${si}.${pi}.${spi}">＋ Action</button>` : ''}
          ${(sp.sections || []).map((c, ci) => node('§', L.l4, 'del', `${si}.${pi}.${spi}.c${ci}`, c.label)).join('')}
          <button class="st-btn" type="button" style="height:24px;margin:2px 0 6px" data-add-section="${si}.${pi}.${spi}">＋ Section</button>
        </div></details>`).join('')}
        <button class="st-btn" type="button" style="height:24px;margin:2px 0 6px" data-add-subpage="${si}.${pi}">＋ Sous-page</button>
      </div></details>`).join('')}
    </div></details>`).join('');
  }
  /** Retrouve la liste et l'index d'un chemin « s.p.sp.cN | aN ». */
  function locate(path) {
    const parts = path.split('.');
    let list = NS.model.sections; let item = null; let index = 0;
    parts.forEach((part, depth) => {
      if (depth > 0) list = depth === 1 ? item.pages : depth === 2 ? item.subpages : part[0] === 'a' ? (item.actions = item.actions || []) : (item.sections = item.sections || []);
      index = depth === 3 ? +part.slice(1) : +part;
      item = list[index];
    });
    return { list, index, item };
  }
  const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'element';
  const uniqueId = (list, label) => { let id = slug(label); let n = 2; while (list.some((x) => x.id === id)) id = slug(label) + '-' + n++; return id; };
  function commitModel() { NS.saveModel(); NS.refresh(); }

  /* ───────── Rendu et événements ───────── */
  const root = $('#studio');
  function render() {
    const scroll = $('.st-body', root)?.scrollTop || 0;
    root.innerHTML = `<div class="st-head"><h2>Navigation system <span>v2</span></h2><p>Une mécanique unique : Section → Page → Sous-page → Section.</p>
      <div class="st-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${ui.tab === id}">${l}</button>`).join('')}</div></div>
      <div class="st-body" role="tabpanel">${PANELS[ui.tab]()}</div>`;
    $('.st-body', root).scrollTop = scroll;
    const jump = $('#jump', root);
    if (jump && NS.ctx && NS.ctx.page) jump.value = `${NS.ctx.section.id}/${NS.ctx.page.id}/${NS.ctx.subpage.id}`;
  }
  function setOpen(open) {
    ui.open = open; saveUi();
    $('#workbench').classList.toggle('studio-open', open);
    $('#studio-toggle').setAttribute('aria-expanded', String(open));
    $('#studio-toggle .studio-toggle-text').textContent = open ? 'Masquer' : 'Navigation system';
    setTimeout(() => NS.Flyout.close(), 0);
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { ui.tab = t.dataset.tab; saveUi(); render(); return; }
    if (t.dataset.set) {
      const cur = NS.settings[t.dataset.set];
      const v = typeof cur === 'number' ? +t.dataset.val : typeof cur === 'boolean' ? t.dataset.val === 'true' : t.dataset.val;
      NS.set(t.dataset.set, v); render(); return;
    }
    if (t.dataset.toggle) { NS.set(t.dataset.toggle, !NS.settings[t.dataset.toggle]); render(); return; }
    if (t.dataset.move) {
      e.preventDefault();
      const { list, index } = locate(t.dataset.move); const j = index + +t.dataset.dir;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j], list[index]]; commitModel(); render(); return;
    }
    if (t.dataset.hide) { e.preventDefault(); const { item } = locate(t.dataset.hide); item.hidden = !item.hidden; commitModel(); render(); return; }
    if (t.dataset.del) { e.preventDefault(); const { list, index } = locate(t.dataset.del); list.splice(index, 1); commitModel(); render(); return; }
    if (t.dataset.addSection) { const { item } = locate(t.dataset.addSection); item.sections = item.sections || []; item.sections.push({ id: uniqueId(item.sections, 'nouvelle-section'), label: 'Nouvelle section', kind: 'text' }); commitModel(); render(); return; }
    if (t.dataset.addAction) { const { item } = locate(t.dataset.addAction); item.actions = item.actions || []; item.actions.push({ id: uniqueId(item.actions, 'action'), label: 'Nouvelle action', form: 'fields' }); commitModel(); render(); return; }
    if (t.dataset.addSubpage) {
      const { item } = locate(t.dataset.addSubpage);
      item.subpages.push({ id: uniqueId(item.subpages, 'sous-page'), label: 'Nouvelle sous-page', lead: 'Sous-page ajoutée dans le Navigation system.', sections: [{ id: 'contenu', label: 'Contenu principal', kind: 'text' }] });
      commitModel(); render(); return;
    }
    const cmd = t.dataset.cmd;
    if (cmd === 'reset-settings') { NS.resetSettings(); render(); }
    if (cmd === 'reset-model' && confirm('Rétablir la structure d’origine ? Vos libellés et ordres modifiés seront perdus.')) { NS.resetModel(); render(); }
    if (cmd === 'reset-tones') { NS.set('tones', {}); render(); }
    if (cmd === 'export') {
      const blob = new Blob([JSON.stringify({ version: 2, settings: NS.settings, model: NS.model }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bpm-navigation-system.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (cmd === 'show-import') { const box = $('#import-box', root); box.hidden = !box.hidden; }
    if (cmd === 'import') {
      try {
        const data = JSON.parse($('#import-json', root).value);
        if (data.model && Array.isArray(data.model.sections)) { NS.model = data.model; NS.saveModel(); }
        if (data.settings) { NS.settings = Object.assign({}, NS.DEFAULTS, data.settings); NS.saveSettings(); }
        NS.refresh(); render(); NS.toast('Configuration importée.');
      } catch { NS.toast('JSON illisible : rien n’a été modifié.'); }
    }
    if (cmd === 'demo') demo();
  });
  // Les boutons d'un <summary> ne doivent pas plier la branche.
  root.addEventListener('click', (e) => { if (e.target.closest('summary') && e.target.closest('button, input')) e.preventDefault(); }, true);
  root.addEventListener('keydown', (e) => { if (e.target.matches('summary input') && (e.key === ' ' || e.key === 'Enter')) { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  root.addEventListener('keyup', (e) => { if (e.target.matches('summary input') && e.key === ' ') e.preventDefault(); });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.range) { t.nextElementSibling.textContent = `${t.value} ${t.nextElementSibling.textContent.split(' ').pop()}`; NS.settings[t.dataset.range] = +t.value; NS.saveSettings(); NS.refresh(); }
    if (t.dataset.tone) { NS.settings.tones = Object.assign({}, NS.settings.tones, { [t.dataset.tone]: t.value }); NS.saveSettings(); NS.refresh(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.rename) { const { item } = locate(t.dataset.rename); if (t.value.trim()) { item.label = t.value.trim(); commitModel(); } render(); }
    if (t.dataset.symbol) { const { item } = locate(t.dataset.symbol); item.symbol = t.value.trim().slice(0, 2) || '·'; commitModel(); }
    if (t.id === 'jump') NS.goPath(t.value);
  });
  root.addEventListener('toggle', (e) => {
    const d = e.target; if (!d.dataset || !d.dataset.key) return;
    ui.openKeys = ui.openKeys.filter((k) => k !== d.dataset.key); if (d.open) ui.openKeys.push(d.dataset.key); saveUi();
  }, true);

  /* ───────── Démonstration des règles ───────── */
  let demoTimer = 0;
  function demo() {
    clearTimeout(demoTimer);
    const steps = [
      ['N1 · La section « Ma vision budgétaire » est la référence.', () => { NS.set('reveal', true); NS.go('vision'); }],
      ['N2 · Sa première page, Tableau de bord, est sélectionnée d’office.', () => {}],
      ['N3 · Sa sous-page d’accueil « Vue de la période » ouvre la navigation horizontale.', () => {}],
      ['N4 · Au clic, l’accueil déroule ses actions (formulaires).', () => { const t = $('.tab-wrap.is-home .tab'); t && NS.Flyout.open(t, t._menu); }],
      ['N5 · Au survol, « Registre de flux » déroule ses sections.', () => { const t = $$('.tab')[1]; t && NS.Flyout.open(t, t._menu); }],
      ['N6 · Un clic sur une section amène le contenu à son niveau.', () => { NS.Flyout.close(); NS.go('vision', 'tableau-de-bord', 'registre', 'registre'); }],
      ['N7 · Le titre de section suit la lecture sous le cadre compact.', () => { NS.set('reveal', false); }],
    ];
    let i = 0;
    const next = () => { if (i >= steps.length) return; const [msg, fn] = steps[i++]; fn(); NS.toast(msg); demoTimer = setTimeout(next, 2900); };
    next();
  }

  $('#studio-toggle').addEventListener('click', () => setOpen(!ui.open));
  NS.onChange(() => { if (ui.tab === 'sim' || ui.tab === 'rules') render(); });
  window.Studio = { open(tab) { if (tab) ui.tab = tab; setOpen(true); render(); }, render };
  setOpen(ui.open);
  render();
})();
