import csp from './navigation-preview-csp.json';

/**
 * Script de l'aperçu de la navigation (cadre isolé `sandbox="allow-scripts"`, document `srcdoc`).
 * Le texte est fixe : les données de l'aperçu sont lues dans le bloc JSON `#preview-data`, qui n'est pas exécuté.
 * Un cadre `srcdoc` hérite de la CSP du site : ce script y est autorisé par son empreinte SHA-256, sans
 * `'unsafe-inline'`. L'empreinte est dans navigation-preview-csp.json, lu aussi par scripts/site-server.mjs ;
 * un test vérifie qu'elle correspond à ce texte. Toute modification du script impose de la recalculer
 * (le test donne la nouvelle valeur).
 */
export const NAVIGATION_PREVIEW_SCRIPT =
  "const data=JSON.parse(document.getElementById('preview-data').textContent);\n" +
  "const history=[];\n" +
  "function show(key,record=true){\n" +
  " const target=data.destinations[key]||key;\n" +
  " if(!data.screens[target])return;\n" +
  " if(record)history.push(target);\n" +
  " document.querySelector('#screen').innerHTML=data.screens[target];\n" +
  " document.body.classList.remove('menu');\n" +
  " document.querySelectorAll('.tab').forEach(tab=>{\n" +
  "  let timer;\n" +
  "  const menu=tab.querySelector('.submenu');\n" +
  "  if(menu?.dataset.trigger==='hover'){\n" +
  "   tab.addEventListener('mouseenter',()=>{clearTimeout(timer);tab.classList.add('open')});\n" +
  "   tab.addEventListener('mouseleave',()=>{timer=setTimeout(()=>tab.classList.remove('open'),Number(menu.dataset.delay))});\n" +
  "  }\n" +
  " });\n" +
  " const anchor=document.getElementById(key);\n" +
  " if(anchor)anchor.scrollIntoView({behavior:'smooth'});else window.scrollTo(0,0);\n" +
  "}\n" +
  "document.addEventListener('click',event=>{\n" +
  " const more=event.target.closest('.more');\n" +
  " if(more){const tab=more.parentElement;tab.classList.toggle('open');more.setAttribute('aria-expanded',String(tab.classList.contains('open')));return;}\n" +
  " const button=event.target.closest('[data-key]');\n" +
  " if(button){event.preventDefault();show(button.dataset.key);}\n" +
  "});\n" +
  "document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.tab.open').forEach(tab=>tab.classList.remove('open'))});\n" +
  "document.querySelector('#menu').onclick=()=>document.body.classList.toggle('menu');\n" +
  "document.querySelector('#back').onclick=()=>{if(history.length>1){history.pop();show(history[history.length-1],false)}};\n" +
  "show(data.initial);\n";

/** Source CSP qui autorise ce script, par exemple `'sha256-…'` sans les guillemets. */
export const NAVIGATION_PREVIEW_SCRIPT_HASH: string = csp.script;
