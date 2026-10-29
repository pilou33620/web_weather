// Rendu de chaque page de js/app.js dans un faux DOM, avec les vraies réponses d'un serveur lancé à part.
//   python3 serveur.py --local --sans-maj --sans-navigateur --port 8893 &
//   node test/rendu_pages.js http://127.0.0.1:8893
// Affiche un bilan court : erreurs JavaScript, « undefined » ou « NaN » dans le HTML produit.
// CHAMP=temperature|vent|nuages|cape|pression : dessine aussi cette couche de la carte avec la vraie grille.
const fs = require('fs'), vm = require('vm'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8893';
const racine = path.join(__dirname, '..');

const elements = new Map();
function element(sel) {
  if (!elements.has(sel)) {
    const el = { sel, innerHTML: '', textContent: '', hidden: false, value: '0', max: '0', dataset: {}, style: {}, elements: new Proxy({}, { get: () => ({ value: '1' }) }),
      classList: { set: new Set(), toggle(c, v) { const on = v ?? !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; }, contains(c) { return this.set.has(c); }, add(c) { this.set.add(c); } },
      setAttribute() {}, insertAdjacentHTML(_, h) { this.innerHTML = h + this.innerHTML; }, append() {}, querySelectorAll: () => [] };
    elements.set(sel, el);
  }
  return elements.get(sel);
}
const navBoutons = ['accueil', 'carte', 'station', 'vigilance', 'autre'].map(p => ({ ...element('nav-' + p), dataset: { page: p } }));
const pages = ['accueil', 'carte', 'station', 'vigilance', 'autre', 'graphiques', 'pro', 'convection', 'modeles', 'fiabilite', 'brief', 'alertes', 'recherche'];
const chaine = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : chaine()), apply: () => chaine() });
let hashListener = null;
const erreurs = [];
const ctx = {
  console, setTimeout: (f) => setTimeout(f, 0), clearTimeout, setInterval: () => 0, clearInterval() {}, Promise, Map, Set, Math, JSON, Date, Number, String, Object, Array, isFinite, parseFloat, encodeURIComponent,
  Calc: require(path.join(racine, 'js/calc.js')), Graph: require(path.join(racine, 'js/graph.js')), L: chaine(),
  document: {
    querySelector: s => element(s),
    querySelectorAll: s => (s === 'nav button' ? navBoutons : s === '.page' ? pages.map(p => element('#p-' + p)) : []),
    body: element('body'), createElement: () => element('nouveau-' + Math.random()),
  },
  location: { hash: '#accueil', reload() {} },
  history: { length: 1, back() {}, replaceState() {} },
  // CHAMP=pression node test/rendu_pages.js … : la carte s'ouvre avec cette couche, la foudre et les cellules
  localStorage: { getItem: () => (process.env.CHAMP ? JSON.stringify({ lieu: { nom: 'Pessac', lat: 44.80565, lon: -0.6324, dep: '33' },
    carte: { radar: true, foudre: true, cellules: true, champ: process.env.CHAMP } }) : null), setItem() {} },
  navigator: {},
  fetch: (url) => fetch(BASE + url),
  window: null,
};
ctx.window = { addEventListener: (ev, f) => { if (ev === 'hashchange') hashListener = f; }, isSecureContext: false, scrollTo() {} };
ctx.addEventListener = ctx.window.addEventListener;
vm.createContext(ctx);
const code = fs.readFileSync(path.join(racine, 'js/app.js'), 'utf8').replace(/\bwindow\./g, 'window.');
process.on('unhandledRejection', e => erreurs.push('promesse : ' + (e && e.stack || e)));
try { vm.runInContext(code, ctx); } catch (e) { erreurs.push('démarrage : ' + e.stack); }

const attendre = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await attendre(4000);                                   // météo, foudre, vigilance
  for (const p of pages) {
    ctx.location.hash = '#' + p;
    try { hashListener(); } catch (e) { erreurs.push(`${p} : ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
    await attendre(3000);                                 // données en plus (modèles, ensemble, convection)
    try { hashListener(); } catch (e) { erreurs.push(`${p} (2e rendu) : ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
    const html = element('#p-' + p).innerHTML;
    const bad = (html.match(/undefined|NaN|\[object Object\]/g) || []);
    if (bad.length) erreurs.push(`${p} : ${bad.length} × « ${bad[0]} » dans le HTML (${html.slice(Math.max(0, html.indexOf(bad[0]) - 80), html.indexOf(bad[0]) + 20).replace(/\s+/g, ' ')})`);
    if (!['carte', 'recherche', 'alertes'].includes(p) && html.length < 200) erreurs.push(`${p} : page presque vide (${html.replace(/\s+/g, ' ').slice(0, 120)})`);
  }
  console.log(erreurs.length ? erreurs.join('\n') + `\nECHEC : ${erreurs.length} problème(s)` : `OK : ${pages.length} pages rendues sans erreur`);
  process.exit(erreurs.length ? 1 : 0);
})();
