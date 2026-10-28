(() => {
  const C = Calc;
  const { compass, AGE_BANDS, ageColor, riskScore, riskLevel, alignLpi, hourRisk, alertWindows, weatherLabel, haversineKm } = C;

  // ---------- Outils ----------
  const $ = s => document.querySelector(s);
  // Tout texte reçu (lieux, heures, messages, textes officiels) passe par esc avant innerHTML.
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toFixed(d));
  const hm = t => esc(String(t).slice(11, 16));
  const hh = t => esc(String(t).slice(11, 13));
  const hhmm = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const ms = t => new Date(t).getTime();                       // heure locale du lieu = heure de l'appareil (France)
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const jourCourt = t => cap(new Date(String(t).slice(0, 10) + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''));
  const dateCourte = t => new Date(String(t).slice(0, 10) + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  let minuterie = null;
  const banniere = msg => { const b = $('#banniere'); b.textContent = msg; b.hidden = false; clearTimeout(minuterie); minuterie = setTimeout(() => { b.hidden = true; }, 6000); };

  // Icônes (traits) : barre du haut, menu, tuiles.
  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const FLECHE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 2.5 2.8 10.4c-.8.3-.7 1.4.1 1.6l7.3 1.8 1.8 7.3c.2.8 1.3.9 1.6.1z"/></svg>';
  const ICO = {
    pos: FLECHE, centre: FLECHE,
    cloche: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    loupe: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    retour: svg('<path d="m15 4-8 8 8 8"/>'),
    accueil: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>'),
    chasse: svg('<path d="M7 15a4.5 4.5 0 1 1 1-8.9A6 6 0 0 1 19 8a3.5 3.5 0 0 1-1 7z"/><path d="m12.5 13-2 4h3l-2 4"/>'),
    station: svg('<rect x="3" y="5" width="12" height="14" rx="2"/><path d="M7 9v6M10 9v6M18 8a5 5 0 0 1 0 8M20.5 6a8.5 8.5 0 0 1 0 12"/>'),
    vigilance: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.2v.3"/>'),
    autre: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    graphiques: svg('<path d="M3 4v16h18"/><path d="m6 15 4-5 3 3 6-7"/>', 'style="color:#0a84ff"'),
    pro: svg('<path d="M7 14a4.5 4.5 0 1 1 1-8.9A6 6 0 0 1 19 7a3.5 3.5 0 0 1-1 7z" fill="#ff9500" stroke="#ff9500"/><path d="m12 15-2 3h3l-2 3" stroke="#ff9500"/>'),
    convection: svg('<path d="M7 13a4.5 4.5 0 1 1 1-8.9A6 6 0 0 1 19 6a3.5 3.5 0 0 1-1 7z" fill="#ff2d55" stroke="#ff2d55"/><path d="m8 16-1 2M12 16l-1 2M16 16l-1 2" stroke="#ff2d55"/>'),
    modeles: svg('<circle cx="12" cy="11" r="1.6"/><path d="M12 13v8M8.5 7.5a5 5 0 0 0 0 7M15.5 7.5a5 5 0 0 1 0 7M5.5 4.5a9 9 0 0 0 0 13M18.5 4.5a9 9 0 0 1 0 13"/>', 'style="color:#bf5af2"'),
    fiabilite: '<svg viewBox="0 0 24 24" fill="#34c759"><rect x="3" y="11" width="3.4" height="10" rx="1"/><rect x="7.6" y="6" width="3.4" height="15" rx="1"/><rect x="12.2" y="3" width="3.4" height="18" rx="1"/><rect x="16.8" y="8" width="3.4" height="13" rx="1"/></svg>',
    brief: svg('<path d="M14 3H6v18h7M14 3l4 4v4M14 3v4h4"/><circle cx="16.5" cy="16.5" r="3"/><path d="m19 19 2 2"/>', 'style="color:#0a84ff"'),
    actif: svg('<path d="m13 2-8 11h6l-2 9 9-12h-6z" fill="#ff3b30" stroke="#ff3b30"/>'),
    oeil: svg('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" fill="#ffcc00" stroke="#ffcc00"/><circle cx="12" cy="12" r="3" fill="#fff" stroke="#fff"/>'),
  };
  const ICO_ALERTE = { 'Orage probable': '⛈️', 'Pluies fortes': '🌧️', 'Rafales fortes': '💨', 'Foudre probable': '⚡' };

  // ---------- Réglages (propres à cet appareil) ----------
  const PESSAC = { nom: 'Pessac', lat: 44.80565, lon: -0.6324, dep: '33' };
  function lireReglages() {
    const r = { lieu: PESSAC, suivi: true, notifs: false, seuils: { ...C.SEUILS } };
    try {
      const s = JSON.parse(localStorage.getItem('ww-reglages-2'));
      if (s && s.lieu && isFinite(s.lieu.lat) && isFinite(s.lieu.lon)) Object.assign(r, s, { seuils: { ...C.SEUILS, ...s.seuils } });
    } catch (e) { /* stockage indisponible : réglages par défaut */ }
    return r;
  }
  const R = lireReglages();
  const ecrire = () => { try { localStorage.setItem('ww-reglages-2', JSON.stringify(R)); } catch (e) { banniere('Réglages non enregistrés : stockage du navigateur indisponible.'); } };
  const qs = () => `lat=${encodeURIComponent(R.lieu.lat)}&lon=${encodeURIComponent(R.lieu.lon)}`;

  async function getJson(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
    return j;
  }

  // ---------- Données ----------
  let W = null, LPI = [], VG = null, quandW = 0;
  const EXTRA = {};                                  // modeles, ensemble, convection : chargés à la demande
  let STRIKES = [], decalage = 0;
  const ETAT = { radar: null, foudre: null };
  const maintenant = () => Date.now() + decalage;
  const nowIdx = (times = W.hourly.time) => Math.max(0, times.findIndex(t => t >= W.current.time.slice(0, 13) + ':00'));

  async function charger() {
    try {
      const m = await getJson(`/api/meteo?${qs()}`);
      W = m.prevision; LPI = alignLpi(W.hourly.time, m.lpi); quandW = Date.now();
    } catch (e) { banniere(`Météo indisponible : ${e.message}`); }
    VG = null;
    if (R.lieu.dep) getJson(`/api/vigilance?dep=${encodeURIComponent(R.lieu.dep)}`).then(v => { VG = v; rafraichir(); }).catch(() => {});
    for (const k in EXTRA) delete EXTRA[k];
    rafraichir();
  }
  async function extra(nom) {
    const e = EXTRA[nom];
    if (e && Date.now() - e.t < 30 * 60000) return e.d;
    const d = await getJson(`/api/${nom}?${qs()}`);
    EXTRA[nom] = { t: Date.now(), d };
    return d;
  }
  // Page qui attend une donnée en plus : affiche « chargement », puis se redessine.
  function attendre(el, noms, rendu) {
    const manque = noms.filter(n => !EXTRA[n]);
    if (!manque.length) return true;
    el.innerHTML = '<div class="vide">Chargement…</div>';
    Promise.all(manque.map(extra)).then(() => { if (page === rendu) rendre(); })
      .catch(e => { el.innerHTML = `<div class="card">Données indisponibles : ${esc(e.message)}</div>`; });
    return false;
  }

  // ---------- Foudre réelle ----------
  let ACT = null;
  const dejaNotifie = { actif: 0, approche: 0 };
  async function majFoudre() {
    try {
      const f = await getJson(`/api/foudre?${qs()}`);
      decalage = f.maintenant - Date.now(); STRIKES = f.impacts; ETAT.foudre = f.etat;
    } catch (e) { ETAT.foudre = { connecte: false, erreur: e.message }; }
    ACT = C.activite(C.visibleAt(STRIKES, maintenant()), R.lieu.lat, R.lieu.lon, R.seuils.rayon);
    if (ACT && ACT.niveau === 'actif' && Date.now() - dejaNotifie.actif > 30 * 60000) {
      dejaNotifie.actif = Date.now();
      notifier('Orage actif proche', `${ACT.n} impact(s) à moins de ${ACT.rayon} km sur 60 min, le plus proche à ${fmt(ACT.km)} km.`);
    }
    if (carte.map) carte.show(+$('#curseur').value);
    if (page === 'accueil' || page === 'alertes') rendre();
    majBadge();
  }

  // ---------- Notifications ----------
  function notifier(titre, corps) {
    if (!R.notifs || !('Notification' in window) || Notification.permission !== 'granted') return;
    const sw = navigator.serviceWorker;
    (sw ? sw.getRegistration() : Promise.resolve(null))
      .then(reg => (reg ? reg.showNotification(titre, { body: corps, tag: 'orage' }) : new Notification(titre, { body: corps })))
      .catch(() => {});
  }
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Ce qui mérite la cloche : activité réelle, vigilance officielle jaune ou plus, alertes des 24 h.
  function elementsAlerte() {
    const out = [];
    if (ACT) out.push({ type: 'activite' });
    const p0 = VG && VG.officielle && VG.periodes[0];
    if (p0 && p0.couleur >= 2) out.push({ type: 'vigilance', p: p0 });
    if (W) {
      const i = nowIdx(), h = W.hourly;
      alertWindows(h, LPI, i, Math.min(i + 48, h.time.length), R.seuils)
        .filter(a => ms(h.time[a.start]) - Date.now() < 24 * 3600000).forEach(a => out.push({ type: 'prevision', a }));
    }
    return out;
  }
  function majBadge() {
    const n = elementsAlerte().length, b = $('#badge');
    b.hidden = !n; b.textContent = n;
  }

  // ---------- Lieu : suivi automatique, recherche ----------
  function changerLieu(lieu, suivi) {
    R.lieu = lieu; R.suivi = suivi; ecrire();
    ACT = null; STRIKES = [];
    carte.recentrer();
    charger(); majFoudre();
  }
  function suivre(force) {
    if (!navigator.geolocation || !window.isSecureContext) {
      if (force) banniere('Position indisponible : ouvrir l\'appli en HTTPS (adresse réseau avec appairage).');
      return;
    }
    navigator.geolocation.getCurrentPosition(async p => {
      const lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4);
      if (!force && haversineKm(lat, lon, R.lieu.lat, R.lieu.lon) < 1) return;
      let c = null;
      try { c = await getJson(`/api/commune?lat=${lat}&lon=${lon}`); } catch (e) { /* hors de France ou API Adresse muette */ }
      changerLieu({ nom: (c && c.nom) || 'Ma position', lat, lon, dep: c && c.departement }, true);
    }, e => { if (force) banniere(`Position refusée : ${e.message}`); }, { timeout: 15000, maximumAge: 10 * 60000 });
  }
  $('#f-recherche').onsubmit = async ev => {
    ev.preventDefault();
    const res = $('#res'); res.textContent = 'Recherche…';
    try {
      const l = await getJson(`/api/lieux?q=${encodeURIComponent($('#q').value)}`);
      res.textContent = l.length ? '' : 'Aucun lieu trouvé.';
      l.forEach(x => {
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = [x.nom, x.region, x.pays].filter(Boolean).join(', ');
        b.onclick = async () => {
          let c = null;
          try { c = await getJson(`/api/commune?lat=${x.lat}&lon=${x.lon}`); } catch (e) { /* pas de département : pas de vigilance officielle */ }
          changerLieu({ nom: x.nom, lat: x.lat, lon: x.lon, dep: c && c.departement }, false);
          location.hash = '#accueil';
        };
        res.append(b);
      });
    } catch (e) { res.textContent = `Recherche impossible : ${e.message}`; }
  };

  // ---------- Pages ----------
  const RACINES = ['accueil', 'chasse', 'station', 'vigilance', 'autre'];
  const TITRES = { chasse: 'Chasse orage', station: 'Station', vigilance: 'Vigilance', autre: 'Autre', graphiques: 'Graphiques',
    pro: 'Prévision orage pro', convection: 'Convection HD', modeles: 'Modèles', fiabilite: 'Fiabilité', brief: 'Brief météo',
    alertes: 'Alertes', recherche: 'Rechercher un lieu' };
  const NOMS_NAV = { accueil: 'Accueil', chasse: 'Chasse orage', station: 'Station', vigilance: 'Vigilance', autre: 'Autre' };
  document.querySelectorAll('nav button').forEach(b => { b.innerHTML = ICO[b.dataset.page] + NOMS_NAV[b.dataset.page]; b.onclick = () => { location.hash = '#' + b.dataset.page; }; });
  $('#b-cloche').insertAdjacentHTML('afterbegin', ICO.cloche);
  $('#b-loupe').innerHTML = ICO.loupe;
  $('#b-centre').innerHTML = ICO.centre;
  $('#b-cloche').onclick = () => { location.hash = '#alertes'; };
  $('#b-loupe').onclick = () => { location.hash = '#recherche'; };
  $('#b-centre').onclick = () => carte.recentrer(true);

  let page = 'accueil';
  function route() {
    const p = location.hash.slice(1);
    page = p === 'accueil' || TITRES[p] ? p : 'accueil';
    document.querySelectorAll('.page').forEach(s => s.classList.toggle('on', s.id === `p-${page}`));
    const racine = RACINES.includes(page);
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.page === (racine ? page : 'accueil')));
    document.body.classList.toggle('carte', page === 'chasse');
    $('#titre').textContent = page === 'accueil' ? R.lieu.nom : TITRES[page];
    const g = $('#b-gauche');
    g.hidden = page === 'chasse';
    g.innerHTML = racine ? ICO.pos : ICO.retour;
    g.setAttribute('aria-label', racine ? 'Ma position' : 'Retour');
    g.onclick = racine ? () => suivre(true) : () => (history.length > 1 ? history.back() : (location.hash = '#accueil'));
    $('#b-droite').hidden = !racine || page === 'chasse';
    $('#b-centre').hidden = page !== 'chasse';
    if (page === 'chasse') carte.init();
    window.scrollTo(0, 0);
    rendre();
  }
  window.addEventListener('hashchange', route);
  const RENDUS = {};
  function rendre() {
    const el = $(`#p-${page}`), f = RENDUS[page];
    if (!f) return;
    if (!W && page !== 'autre' && page !== 'alertes') { el.innerHTML = '<div class="vide">Chargement…</div>'; return; }
    f(el);
  }
  const rafraichir = () => { if (page === 'accueil') $('#titre').textContent = R.lieu.nom; majBadge(); rendre(); if (carte.map) carte.station(); };

  // ---------- Morceaux communs ----------
  function scores(i, n) { const h = W.hourly, out = []; for (let k = i; k < Math.min(i + n, h.time.length); k++) out.push(riskScore(hourRisk(h, LPI, k))); return out; }
  function pic(i, n) { const s = scores(i, n); let p = 0; s.forEach((v, k) => { if (v > s[p]) p = k; }); return { s: s[p] ?? 0, i: i + p }; }
  function blocAlerte(a) {
    const h = W.hourly, debut = h.time[a.start], fin = h.time[a.end + 1] || h.time[a.end], duree = a.end - a.start + 1;
    const jour = debut.slice(0, 10) === W.current.time.slice(0, 10) ? 'auj.' : jourCourt(debut).toLowerCase() + '.';
    return `<div class="alerte"><div class="ico">${ICO_ALERTE[a.label]}</div><div class="sp">
      <div class="t">${a.label} <span class="tag">Surveillance</span></div>
      <div class="d">${duree > 1 ? `${duree} h · ` : ''}pic ${hh(h.time[a.peak])}:00 · ${esc(a.detail)}</div></div>
      <div class="q"><b>${esc(jour)} ${hh(debut)}:00-${+hh(fin)}:00</b><small>${C.dans(ms(debut) - Date.now())}</small></div></div>`;
  }
  function blocActivite() {
    if (!ACT) return '';
    const actif = ACT.niveau === 'actif', age = ETAT.foudre && ETAT.foudre.derniere_trame_s;
    return `<div class="card evt">${actif ? ICO.actif : ICO.oeil}<div class="sp">
      <div class="row" style="flex-wrap:wrap"><span class="t">${actif ? 'Orage actif proche' : 'Activité électrique régionale'}</span>
      <span class="tag ${actif ? 'rouge' : ''}">${actif ? 'Actif' : 'Surveillance'}</span></div>
      <div class="muted">${ACT.n} impact${ACT.n > 1 ? 's' : ''} à moins de ${ACT.rayon} km sur 60 min.</div>
      <div class="muted" style="font-size:14px">Impact le plus proche : ${fmt(ACT.km)} km</div></div>
      ${age != null ? `<small class="muted">${age} s</small>` : ''}</div>`;
  }
  const COULEURS_MF = ['', 'Vert', 'Jaune', 'Orange', 'Rouge'];
  const FOND_MF = ['', '#d9f7e1', '#fff4c2', '#ffe8cc', '#ffe1df'];
  const PHEN = { 1: ['💨', 'Vent violent'], 2: ['🌧️', 'Pluie-inondation'], 3: ['⛈️', 'Orages'], 4: ['🌊', 'Crues'], 5: ['❄️', 'Neige-verglas'],
    6: ['🌡️', 'Canicule'], 7: ['🥶', 'Grand froid'], 8: ['🏔️', 'Avalanches'], 9: ['🌊', 'Vagues-submersion'] };
  const libelleTemps = (t, k) => (t.slice(11, 13) === '00' || k === 0 ? `${dateCourte(t)} ${hh(t)} h` : t.slice(11, 13) === '12' ? `${hh(t)} h` : null);

  // ---------- Accueil ----------
  RENDUS.accueil = el => {
    const c = W.current, h = W.hourly, dd = W.daily, i = nowIdx();
    const [icone, cond] = weatherLabel(c.weather_code);
    const alertes = alertWindows(h, LPI, i, Math.min(i + 48, h.time.length), R.seuils);
    const vig = VG && VG.officielle && VG.periodes[0];
    const gmin = Math.min(...dd.temperature_2m_min), gmax = Math.max(...dd.temperature_2m_max);
    const vj = C.vigilance(h, LPI, dd), NV = ['vert', 'jaune', 'orange', 'rouge'];
    el.innerHTML = `
      <div class="hero"><div class="temp">${fmt(c.temperature_2m)}°</div><div class="cond">${icone} ${cond}</div>
        <div class="ress">Ressenti ${fmt(c.apparent_temperature)}° · ${fmt(dd.temperature_2m_min[0])}° / ${fmt(dd.temperature_2m_max[0])}°</div></div>
      ${vig && vig.couleur >= 2 ? `<a class="bandeau" href="#vigilance" style="background:${FOND_MF[vig.couleur]};color:#000;text-decoration:none">⚠️ Vigilance ${COULEURS_MF[vig.couleur].toLowerCase()} Météo-France<span class="sp"></span>›</a>` : ''}
      <div class="tuiles">${[['graphiques', 'Graphiques'], ['pro', 'Analyse orage pro'], ['convection', 'Convection HD'], ['modeles', 'Modèles'], ['fiabilite', 'Fiabilité'], ['brief', 'Brief météo']]
        .map(([p, n]) => `<button class="tuile" data-aller="${p}">${ICO[p]}<span>${n}</span></button>`).join('')}</div>
      ${blocActivite()}
      <div class="card"><h3>✨ Prochaines alertes probables <span class="compte">${alertes.length}</span></h3>
        ${alertes.length ? alertes.map(blocAlerte).join('') : '<div class="muted">Aucune alerte dans les 48 prochaines heures.</div>'}
        <div class="note">Basé sur la prévision horaire du lieu, avec nos seuils (modifiables dans Autre). Les notifications d'orage proche viennent des impacts réels.</div></div>
      <div class="card"><h3>Prochaines heures</h3><div class="heures">${Array.from({ length: 24 }, (_, k) => {
        const j = i + k; if (j >= h.time.length) return '';
        const p = h.precipitation_probability[j];
        return `<div>${hh(h.time[j])} h<span class="i">${weatherLabel(h.weather_code[j])[0]}</span><b>${fmt(h.temperature_2m[j])}°</b><span class="p">${p >= 10 ? fmt(p) + ' %' : '&nbsp;'}</span></div>`;
      }).join('')}</div></div>
      <div class="card"><h3>Sur ${dd.time.length} jours</h3>${dd.time.map((t, k) => {
        const delta = k ? dd.temperature_2m_max[k] - dd.temperature_2m_max[k - 1] : 0, orage = vj[k].orages[1];
        const bits = [];
        if (Math.abs(delta) >= 3) bits.push(`<span>${delta > 0 ? '↑' : '↓'}${fmt(Math.abs(delta))}°</span>`);
        if (dd.precipitation_sum[k] >= 0.1) bits.push(`<span>💧 ${fmt(dd.precipitation_sum[k], 1)} mm</span>`);
        if (dd.wind_gusts_10m_max[k] >= 40) bits.push(`<span>💨 ${fmt(dd.wind_gusts_10m_max[k])}</span>`);
        bits.push(`<span>☀️ UV ${fmt(dd.uv_index_max[k])}</span>`, `<span>🌅 ${hm(dd.sunrise[k])}→${hm(dd.sunset[k])}</span>`);
        if (orage >= 20) bits.push(`<span class="eclair">⚡ ${orage} %</span>`);
        return `<div class="jour" data-jour><div class="l1">
          <span class="n">${k ? jourCourt(t) + '.' : 'Auj.'}<small>${dateCourte(t)}</small></span><span>${weatherLabel(dd.weather_code[k])[0]}</span>
          <span class="p">${fmt(dd.precipitation_probability_max[k])} %</span><span class="min">${fmt(dd.temperature_2m_min[k])}°</span>
          <div class="barre"><span style="left:${(dd.temperature_2m_min[k] - gmin) / (gmax - gmin || 1) * 100}%;right:${100 - (dd.temperature_2m_max[k] - gmin) / (gmax - gmin || 1) * 100}%"></span></div>
          <span>${fmt(dd.temperature_2m_max[k])}°</span><span class="chev">›</span></div>
          <div class="l2">${bits.join('')}</div>
          <div class="det">Rafales max ${fmt(dd.wind_gusts_10m_max[k])} km/h · pluie ${fmt(dd.precipitation_sum[k], 1)} mm (proba ${fmt(dd.precipitation_probability_max[k])} %) · score d'orage max ${orage} % · vigilance indicative : orages ${NV[vj[k].orages[0]]}, vent ${NV[vj[k].vent[0]]}, pluie ${NV[vj[k].pluie[0]]}</div></div>`;
      }).join('')}</div>`;
    el.querySelectorAll('[data-aller]').forEach(b => b.onclick = () => { location.hash = '#' + b.dataset.aller; });
    el.querySelectorAll('[data-jour]').forEach(d => d.onclick = () => d.classList.toggle('ouvert'));
  };

  // ---------- Alertes (cloche) ----------
  RENDUS.alertes = el => {
    const items = elementsAlerte();
    el.innerHTML = (items.length ? '' : '<div class="vide">Aucune alerte en cours.</div>') + items.map(x => {
      if (x.type === 'activite') return blocActivite();
      if (x.type === 'vigilance') return `<a class="card evt" href="#vigilance" style="color:inherit;text-decoration:none;background:${FOND_MF[x.p.couleur]}">⚠️<div class="sp"><span class="t">Vigilance ${COULEURS_MF[x.p.couleur].toLowerCase()}</span><div class="muted">Météo-France, département ${esc(VG.departement)}</div></div>›</a>`;
      return `<div class="card">${blocAlerte(x.a)}</div>`;
    }).join('') + notifNote();
  };
  function notifNote() {
    if (!('Notification' in window)) return '<div class="note">Notifications non prises en charge par ce navigateur. Sur iPhone, ajouter l\'appli à l\'écran d\'accueil.</div>';
    return `<div class="note">Notifications : ${R.notifs && Notification.permission === 'granted' ? 'activées' : 'désactivées (Autre → Notifications)'}.</div>`;
  }

  // ---------- Station ----------
  RENDUS.station = el => {
    const c = W.current, h = W.hourly, i = nowIdx(), x = C.indices(h, i), at = k => (h[k] ? h[k][i] : null);
    const tiles = [
      ['Température', c.temperature_2m, '°C', 1, `Ressenti ${fmt(c.apparent_temperature, 1)} °C`],
      ['Vent', c.wind_speed_10m, 'km/h', 0, `${compass(c.wind_direction_10m)} · rafales ${fmt(c.wind_gusts_10m)} km/h`],
      ['Humidité', c.relative_humidity_2m, '%', 0, `Point de rosée ${fmt(at('dew_point_2m'), 1)} °C`],
      ['Pression', c.pressure_msl, 'hPa', 0, 'Niveau de la mer'],
      ['CAPE', at('cape'), 'J/kg', 0, 'Énergie pour les orages'],
      ['Lifted Index', at('lifted_index'), '', 1, 'Négatif = instable'],
      ['CIN', at('convective_inhibition'), 'J/kg', 0, 'Frein au déclenchement'],
      ['LPI', LPI[i], 'J/kg', 1, LPI[i] == null ? 'Hors domaine ICON-D2' : 'Potentiel de foudre'],
      ['Isotherme 0 °C', at('freezing_level_height'), 'm', 0, ''],
      ['K-Index', x && x.K, '', 0, x ? C.LECTURE.K(x.K) : ''],
      ['Nuages', c.cloud_cover, '%', 0, `bas ${fmt(at('cloud_cover_low'))} · moy. ${fmt(at('cloud_cover_mid'))} · hauts ${fmt(at('cloud_cover_high'))}`],
      ['Visibilité', at('visibility') == null ? null : at('visibility') / 1000, 'km', 1, `UV ${fmt(at('uv_index'), 1)}`],
    ];
    const rows = Array.from({ length: Math.min(24, h.time.length - i) }, (_, k) => {
      const j = i + k;
      return `<tr><td>${hm(h.time[j])}</td><td>${fmt(h.temperature_2m[j], 1)}</td><td>${fmt(h.precipitation[j], 1)}</td><td>${fmt(h.wind_gusts_10m[j])}</td><td>${fmt(h.cape[j])}</td><td>${fmt(h.lifted_index[j], 1)}</td><td>${fmt(LPI[j], 1)}</td><td>${riskScore(hourRisk(h, LPI, j))} %</td></tr>`;
    }).join('');
    el.innerHTML = `<p class="muted" style="margin-top:0">📍 ${esc(R.lieu.nom)} · ${hm(c.time)} · altitude ${fmt(W.elevation)} m. Valeurs du modèle (pas de capteur réel).</p>
      <div class="tiles">${tiles.map(([k, v, u, d, hint]) => `<div class="tile"><div class="k">${k}</div><div class="v">${fmt(v, d)} <small>${u}</small></div><div class="h">${esc(hint)}</div></div>`).join('')}</div>
      <div class="card"><h3>24 prochaines heures</h3><div class="tableau"><table>
        <tr><th>Heure</th><th>T °C</th><th>Pluie</th><th>Rafales</th><th>CAPE</th><th>LI</th><th>LPI</th><th>Orage</th></tr>${rows}</table></div></div>`;
  };

  // ---------- Vigilance ----------
  RENDUS.vigilance = el => {
    if (VG && VG.officielle) {
      el.innerHTML = VG.periodes.map((p, k) => `<div class="card"><h3>${k ? 'Demain' : "Aujourd'hui"} <span class="niv n${p.couleur}" style="margin-left:auto">${COULEURS_MF[p.couleur]}</span></h3>
          ${p.phenomenes.filter(ph => ph.couleur >= 2).map(ph => `<div class="risque"><span class="ico">${(PHEN[ph.id] || ['⚠️'])[0]}</span><div class="sp"><b>${(PHEN[ph.id] || ['', 'Phénomène ' + ph.id])[1]}</b>
            <span class="muted" style="font-size:13px">${ph.tranches.filter(t => t.couleur >= 2).map(t => `${hm(t.debut)} → ${hm(t.fin)}`).join(' · ')}</span></div><span class="niv n${ph.couleur}">${COULEURS_MF[ph.couleur]}</span></div>`).join('') || '<div class="muted">Pas de vigilance particulière.</div>'}
          ${p.texte ? `<div class="section" style="font-size:15px">${esc(p.texte)}</div>` : ''}</div>`).join('') +
        `<div class="note">Source : Météo-France, département ${esc(VG.departement)}. Heures en UTC. <a href="https://vigilance.meteofrance.fr">vigilance.meteofrance.fr</a></div>`;
      return;
    }
    const v = C.vigilance(W.hourly, LPI, W.daily).slice(0, 3), today = W.current.time.slice(0, 10);
    const badge = ([n]) => `<span class="niv n${n + 1}">${COULEURS_MF[n + 1]}</span>`;
    el.innerHTML = `<div class="card" style="background:#fff4c2"><b>Niveaux indicatifs calculés par nos seuils.</b>
        <div style="font-size:14px">Ce n'est pas la vigilance officielle${VG && VG.raison ? ` (${esc(VG.raison)})` : !R.lieu.dep ? ' (lieu hors de France)' : ''}. Voir <a href="https://vigilance.meteofrance.fr">vigilance.meteofrance.fr</a>.</div></div>
      ${v.map(j => `<div class="card"><h3>${j.jour === today ? "Aujourd'hui" : jourCourt(j.jour) + '. ' + dateCourte(j.jour)}</h3>
        <div class="vigi"><span>⛈️ Orages</span><span class="muted">score ${fmt(j.orages[1])} %</span>${badge(j.orages)}
        <span>💨 Vent</span><span class="muted">${fmt(j.vent[1])} km/h</span>${badge(j.vent)}
        <span>🌧️ Pluie</span><span class="muted">${fmt(j.pluie[1], 1)} mm</span>${badge(j.pluie)}</div></div>`).join('')}
      <div class="note">Seuils jaune / orange / rouge : orages ${C.VIGI.orages.join(' / ')} % ; rafales ${C.VIGI.vent.join(' / ')} km/h ; pluie ${C.VIGI.pluie.join(' / ')} mm par jour.</div>`;
  };

  // ---------- Graphiques ----------
  const MOD = [['auto', 'Auto', '#0a84ff'], ['ecmwf_ifs025', 'ECMWF', '#5e5ce6'], ['gfs_seamless', 'GFS', '#e58ef5'], ['icon_seamless', 'ICON', '#30b050'],
    ['meteofrance_arome_france', 'AROME', '#ff6b6b'], ['meteofrance_arome_france_hd', 'AROME-HD', '#ff9f0a'], ['meteofrance_arpege_europe', 'ARPEGE', '#40c8e0']];
  const GR = { periode: 48, modeles: new Set(['auto', 'ecmwf_ifs025', 'icon_seamless']) };
  // Valeurs d'une variable pour un modèle, alignées sur les heures [i, fin) de la prévision « Auto ».
  function serie(nom, mod, i, fin) {
    const h = W.hourly;
    if (mod === 'auto') return h[nom] ? h[nom].slice(i, fin) : [];
    const m = EXTRA.modeles && EXTRA.modeles.d.hourly, v = m && m[`${nom}_${mod}`];
    if (!v) return [];
    const pos = new Map(m.time.map((t, k) => [t, k]));
    return h.time.slice(i, fin).map(t => (pos.has(t) ? v[pos.get(t)] : null));
  }
  function ecartMax(series) {
    if (series.length < 2) return null;
    let e = 0;
    series[0].forEach((_, k) => { const v = series.map(s => s[k]).filter(x => x != null); if (v.length > 1) e = Math.max(e, Math.max(...v) - Math.min(...v)); });
    return e;
  }
  RENDUS.graphiques = el => {
    if (!attendre(el, ['modeles'], 'graphiques')) return;
    const h = W.hourly, i = nowIdx(), fin = Math.min(i + GR.periode, h.time.length), times = h.time.slice(i, fin);
    const sel = MOD.filter(m => GR.modeles.has(m[0])), duree = GR.periode === 168 ? '7 j' : GR.periode + 'h';
    const lab = GR.periode <= 48 ? libelleTemps : (t, k) => (t.slice(11, 13) === '00' ? `${jourCourt(t).toLowerCase()} ${t.slice(8, 10)}` : null);
    const sc = scores(i, GR.periode), p = sc.reduce((b, v, k) => (v > sc[b] ? k : b), 0), lv = riskLevel(sc[p] ?? 0), j = i + p;
    const top = sc.map((v, k) => [v, i + k]).sort((a, b) => b[0] - a[0]).slice(0, 5);
    const temp = sel.map(m => serie('temperature_2m', m[0], i, fin)), e = ecartMax(temp.filter(s => s.length));
    const pluie = serie('precipitation', 'auto', i, fin);
    el.innerHTML = `
      <div class="onglets">${[[24, '24h'], [48, '48h'], [72, '72h'], [168, '7j']].map(([v, n]) => `<button data-p="${v}" class="${v === GR.periode ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="muted" style="font-size:15px;margin-bottom:6px">Modèles à comparer</div>
      <div class="puces">${MOD.map(([k, n, col]) => `<button data-m="${k}" class="${GR.modeles.has(k) ? 'on' : ''}" style="${GR.modeles.has(k) ? `background:${col}` : ''}">${n}</button>`).join('')}</div>
      <div class="card"><h3>Analyse orageuse (${duree})</h3>
        <div class="pic">${Graph.anneau(sc[p] ?? 0, lv.color, `${sc[p] ?? 0}%`, lv.label)}
          <div><div class="gros" style="color:${lv.color}">Pic ${sc[p] ?? 0}% ${lv.label}</div><div style="font-size:18px">${jourCourt(h.time[j])}. ${hh(h.time[j])} h</div>
          <div class="muted" style="font-size:14px">CAPE ${fmt(h.cape[j])} J/kg · CIN ${fmt(h.convective_inhibition[j])} · LI ${fmt(h.lifted_index[j], 1)}</div>
          <div class="muted" style="font-size:14px">Td ${fmt(h.dew_point_2m[j], 1)} °C · proba ${fmt(h.precipitation_probability[j])} %${LPI[j] != null ? ` · LPI ${fmt(LPI[j], 1)}` : ''}</div></div></div>
        ${Graph.chart({ times, series: [{ vals: sc, type: 'area', color: '#ff9500' }], min: 0, max: 100, label: lab, title: 'Score d\'orage' })}
        <div class="muted" style="margin-top:6px">Heures les plus à risque</div>
        <table class="liste">${top.map(([v, k]) => `<tr><td><span class="pastille" style="background:${riskLevel(v).color}"></span> ${jourCourt(h.time[k])}. ${hh(h.time[k])} h</td><td style="color:${riskLevel(v).color};font-weight:700">${v}%</td><td class="d">CAPE ${fmt(h.cape[k])} · LI ${fmt(h.lifted_index[k], 1)}</td></tr>`).join('')}</table></div>
      <div class="card"><h3>Température (${duree})</h3>
        ${Graph.chart({ times, series: sel.map((m, k) => ({ vals: temp[k], color: m[2] })), label: lab, title: 'Température' })}
        <div class="legende">${sel.map(m => `<span><span class="pastille" style="background:${m[2]}"></span> ${m[1]}</span>`).join('')}</div>
        ${e != null ? `<div class="note">Écart max : ${fmt(e, 1)} °C — plus la zone est large, moins les modèles sont d'accord.</div>` : ''}</div>
      <div class="card"><h3>Précipitations & probabilité</h3>
        ${Graph.chart({ times, min: 0, max: Math.max(20, ...pluie.map(v => v || 0)),
          series: [{ vals: pluie, type: 'bar', color: '#0a84ff', opacity: 0.8 },
            ...sel.map(m => ({ vals: serie('precipitation_probability', m[0], i, fin).map(v => (v == null ? null : v / 5)), color: m[2] }))], label: lab, title: 'Précipitations' })}
        <div class="note">Barres bleues = pluie (mm/h, Auto). Courbes = proba de précipitation par modèle (échelle /5).</div></div>
      <div class="card"><h3>Vent & rafales (km/h)</h3>
        ${Graph.chart({ times, min: 0, series: [{ vals: serie('wind_gusts_10m', 'auto', i, fin), type: 'bar', color: '#ff9500', opacity: 0.35 },
          ...sel.map(m => ({ vals: serie('wind_speed_10m', m[0], i, fin), color: m[2] }))], label: lab, title: 'Vent' })}
        <div class="note">Lignes = vent moyen par modèle. Barres orange = rafales (Auto).</div></div>
      <div class="card"><h3>Couverture nuageuse par étage (%)</h3>
        ${Graph.chart({ times, min: 0, max: 100, series: [['cloud_cover_high', '#9ad0ff'], ['cloud_cover_mid', '#5a9bd8'], ['cloud_cover_low', '#3a3a4a']].map(([k, col]) => ({ vals: serie(k, 'auto', i, fin), color: col })), label: lab, title: 'Nuages' })}
        <div class="legende"><span><span class="pastille" style="background:#3a3a4a"></span> bas</span><span><span class="pastille" style="background:#5a9bd8"></span> moyens</span><span><span class="pastille" style="background:#9ad0ff"></span> hauts</span></div></div>`;
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { GR.periode = +b.dataset.p; rendre(); });
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      const k = b.dataset.m;
      if (GR.modeles.has(k) && GR.modeles.size > 1) GR.modeles.delete(k); else GR.modeles.add(k);
      rendre();
    });
  };

  // ---------- Prévision orage pro ----------
  RENDUS.pro = el => {
    const h = W.hourly, i = nowIdx(), sc = scores(i, 24), p = pic(i, 24), lv = riskLevel(p.s), x = C.indices(h, p.i);
    if (!x) { el.innerHTML = '<div class="card">Niveaux de pression indisponibles pour ce lieu.</div>'; return; }
    const [type, desc] = C.typeOrage(x), rq = C.risques(x, LPI[p.i]);
    const ICR = { 'Grêle': '🌨️', 'Vents violents': '💨', 'Tornade': '🌪️', 'Foudre': '⚡' };
    const cl = pc => (pc < 15 ? 'vert' : pc < 40 ? '' : pc < 70 ? 'orange' : 'rouge');
    const energie = x.cape < 500 ? 'faible' : x.cape < 1000 ? 'modérée' : x.cape < 2000 ? 'forte' : 'très forte';
    const principaux = rq.filter(r => r[1] >= 15).map(r => `${r[0]} (${C.niveauRisque(r[1]).toLowerCase()})`);
    const discussion = `Énergie convective ${energie} (CAPE ${fmt(x.cape)} J/kg, LI ${fmt(x.li, 1)}). ` +
      `Cisaillement 0-6 km ${x.sh6 < 36 ? 'faible' : x.sh6 < 72 ? 'marqué' : 'fort'} (${fmt(x.sh6)} km/h)${x.sh6 >= 36 ? ' favorisant l\'organisation et la pérennité' : ''}. ` +
      (x.sh1 >= 25 ? `Cisaillement basses couches significatif (${fmt(x.sh1)} km/h) — vigilance tornadique. ` : '') +
      (x.iso0 != null ? `Isotherme 0 °C à ${fmt(x.iso0)} m${x.iso0 < 3000 ? ', la grêle arrive facilement au sol' : ', la petite grêle fond en partie avant le sol'}. ` : '') +
      (x.cin > 150 ? `Inhibition forte (CIN ${fmt(x.cin)} J/kg) : déclenchement difficile. ` : '') +
      `Profil → <b>${type}</b>. ${desc}${principaux.length ? ` Risques principaux : ${principaux.join(', ')}.` : ''}`;
    const IND = [['K-Index', x.K, 0, C.LECTURE.K(x.K)], ['Total Totals', x.TT, 0, C.LECTURE.TT(x.TT)], ['SCP*', x.SCP, 1, C.LECTURE.SCP(x.SCP)],
      ['STP*', x.STP, 1, C.LECTURE.STP(x.STP)], ['EHI*', x.EHI, 1, C.LECTURE.EHI(x.EHI)], ['LCL', x.LCL, 0, C.LECTURE.LCL(x.LCL), ' m'],
      ['Shear 0-3 km', x.sh3, 0, '', ' km/h'], ['Shear 0-6 km', x.sh6, 0, '', ' km/h'], ['SRH 0-1 km*', x.SRH1, 0, '', ' m²/s²'], ['SRH 0-3 km*', x.SRH3, 0, '', ' m²/s²']];
    const coul = (n, v) => ({ 'K-Index': v >= 35 ? '#ff3b30' : v >= 25 ? '#ff9500' : '', 'Total Totals': v >= 50 ? '#ff9500' : '', 'SCP*': v >= 1 ? '#ff9500' : '',
      'STP*': v >= 1 ? '#ff3b30' : '', 'LCL': v < 1000 ? '#ff3b30' : '' }[n] || '');
    el.innerHTML = `
      <div class="card"><div class="row"><h3 style="margin:0">⚡ Pic prévu</h3><span class="sp"></span><span class="grand" style="color:${lv.color};font-size:40px">${p.s}%</span></div>
        <div class="row" style="margin:6px 0"><span class="muted">🕒</span><b>${jourCourt(h.time[p.i])}. ${esc(h.time[p.i].slice(8, 10))} ${hh(h.time[p.i])} h</b><span class="sp"></span><span class="tag" style="background:${lv.color};color:#fff">${lv.label}</span></div>
        ${Graph.chart({ times: h.time.slice(i, i + 24), series: [{ vals: sc, type: 'area', color: '#ff9500' }], min: 0, max: 100, label: (t, k) => (k % 6 === 0 ? `${hh(t)} h` : null), title: 'Score d\'orage 24 h' })}</div>
      <div class="card"><h3>🌀 Type d'orage attendu</h3><div class="grand" style="color:#ff9500">${type}</div><div class="muted">${desc}</div></div>
      <div class="card"><h3>📖 Discussion technique</h3><div class="texte">${discussion}</div></div>
      <div class="card"><h3>❗ Risques spécifiques</h3>${rq.map(([n, pc]) => `<div class="risque"><span class="ico">${ICR[n]}</span><div class="sp"><b>${n}</b><span class="muted">Probabilité ~${pc}%</span></div><span class="tag ${cl(pc)}">${C.niveauRisque(pc)}</span></div>`).join('')}
        <div class="note">Probabilités heuristiques tirées des indices ci-dessous, pas un modèle validé.</div></div>
      <div class="card"><h3>ƒ(x) Indices composites (au pic)</h3><table class="liste indices">${IND.map(([n, v, d, l, u]) => `<tr><td>${n}</td><td style="color:${coul(n, v)}">${fmt(v, d)}${u || ''}</td><td>${l}</td></tr>`).join('')}</table>
        <div class="note">SCP > 1 = potentiel supercellule. STP > 1 = tornade significative possible. K > 30 = orages probables. TT > 50 = orages forts.<br>
        * Hélicité (SRH) approchée à partir des vents 10 m / 925 / 850 / 700 hPa et d'un mouvement de cellule de Bunkers : Open-Meteo ne fournit pas la SRH. SCP, STP et EHI en dépendent.</div></div>`;
  };

  // ---------- Convection HD ----------
  RENDUS.convection = el => {
    if (!attendre(el, ['convection'], 'convection')) return;
    const a = EXTRA.convection.d.arome, lpi = EXTRA.convection.d.lpi;
    if (!a || !a.time) { el.innerHTML = '<div class="card">AROME-HD indisponible pour ce lieu (hors de France ?).</div>'; return; }
    const debut = Math.max(0, a.time.findIndex(t => ms(t) >= Date.now() - 15 * 60000)), fin = Math.min(debut + 48, a.time.length);
    const times = a.time.slice(debut, fin), pl = (a.precipitation || []).slice(debut, fin), cape = (a.cape || []).slice(debut, fin), raf = (a.wind_gusts_10m || []).slice(debut, fin);
    const m = lpi ? new Map(lpi.time.map((t, k) => [t, lpi.valeurs[k]])) : null, lp = m ? times.map(t => m.get(t) ?? null) : null;
    const argmax = v => v.reduce((b, x, k) => ((x ?? -1) > (v[b] ?? -1) ? k : b), 0);
    const k1 = pl.findIndex(v => v >= 0.1), kc = argmax(cape), kr = argmax(raf);
    const lab = (t, k) => (k % 8 === 0 ? hm(t) : null);
    el.innerHTML = `<div class="card"><h3>⏱️ 12 prochaines heures (AROME-HD 1,5 km)</h3>
        <div class="texte">${k1 >= 0 ? `🌧️ Prochaine pluie à <b>${hm(times[k1])}</b> (${fmt(pl[k1] * 4, 1)} mm/h).` : '🌧️ Pas de pluie prévue sur 12 h.'}<br>
        🔥 CAPE max <b>${fmt(cape[kc])} J/kg</b> à ${hm(times[kc])}.<br>💨 Rafales max <b>${fmt(raf[kr])} km/h</b> à ${hm(times[kr])}.</div></div>
      <div class="card"><h3>Pluie (mm par 15 min)</h3>${Graph.chart({ times, min: 0, max: Math.max(2, ...pl.map(v => v || 0)), series: [{ vals: pl, type: 'bar', color: '#0a84ff', opacity: 0.8 }], label: lab, title: 'Pluie' })}</div>
      <div class="card"><h3>CAPE (J/kg)</h3>${Graph.chart({ times, min: 0, series: [{ vals: cape, type: 'area', color: '#ff9500' }], label: lab, title: 'CAPE' })}</div>
      <div class="card"><h3>Rafales (km/h)</h3>${Graph.chart({ times, min: 0, series: [{ vals: raf, color: '#30b050' }], label: lab, title: 'Rafales' })}</div>
      ${lp && lp.some(v => v != null) ? `<div class="card"><h3>Potentiel de foudre LPI (J/kg, ICON-D2)</h3>${Graph.chart({ times, min: 0, max: Math.max(3, ...lp.map(v => v || 0)), series: [{ vals: lp, color: '#ffcc00', width: 2.5 }], label: lab, title: 'LPI' })}</div>` : ''}
      <div class="note">Modèle Météo-France AROME-HD par quart d'heure, via Open-Meteo. Une prévision, pas une mesure.</div>`;
  };

  // ---------- Modèles ----------
  RENDUS.modeles = el => {
    if (!attendre(el, ['modeles'], 'modeles')) return;
    const i = nowIdx(), fin = Math.min(i + 48, W.hourly.time.length), times = W.hourly.time.slice(i, fin);
    const somme = v => v.slice(0, 24).reduce((s, x) => s + (x || 0), 0), maxi = v => Math.max(...v.slice(0, 24).map(x => x ?? -1));
    const temp = MOD.map(m => serie('temperature_2m', m[0], i, fin));
    el.innerHTML = `<div class="card"><h3>Maintenant (${hm(W.hourly.time[i])})</h3><div class="tableau"><table>
        <tr><th>Modèle</th><th>T °C</th><th>Rafales</th><th>CAPE</th><th>LI</th><th>Pluie 24 h</th><th>Proba max</th></tr>
        ${MOD.map(([k, n, col]) => {
          const v = nom => serie(nom, k, i, fin);
          return `<tr><td><span class="pastille" style="background:${col}"></span> ${n}</td><td>${fmt(v('temperature_2m')[0], 1)}</td><td>${fmt(v('wind_gusts_10m')[0])}</td><td>${fmt(v('cape')[0])}</td>
            <td>${fmt(v('lifted_index')[0], 1)}</td><td>${v('precipitation').length ? fmt(somme(v('precipitation')), 1) + ' mm' : '–'}</td><td>${v('precipitation_probability').length ? fmt(maxi(v('precipitation_probability'))) + ' %' : '–'}</td></tr>`;
        }).join('')}
        </table></div><div class="note">Auto = meilleur modèle choisi par Open-Meteo pour le lieu. AROME et AROME-HD ne couvrent que 2 jours.</div></div>
      <div class="card"><h3>Température 48 h</h3>${Graph.chart({ times, series: MOD.map((m, k) => ({ vals: temp[k], color: m[2] })), label: libelleTemps, title: 'Température' })}
        <div class="legende">${MOD.map(m => `<span><span class="pastille" style="background:${m[2]}"></span> ${m[1]}</span>`).join('')}</div>
        <div class="note">Écart max entre modèles : ${fmt(ecartMax(temp.filter(s => s.length)), 1)} °C.</div></div>`;
  };

  // ---------- Fiabilité ----------
  function confiance() {
    const e = EXTRA.ensemble && EXTRA.ensemble.d.hourly;
    if (!e) return null;
    const i = Math.max(0, e.time.findIndex(t => t >= W.current.time.slice(0, 13) + ':00'));
    const b = C.bands(e, 'temperature_2m').slice(i, i + 48), ec = b.map(v => (v[0] == null ? 0 : v[2] - v[0]));
    const moy = ec.reduce((s, v) => s + v, 0) / (ec.length || 1);
    return { i, b, moy, niveau: moy < 2 ? 'élevée' : moy < 4 ? 'moyenne' : 'faible' };
  }
  RENDUS.fiabilite = el => {
    if (!attendre(el, ['ensemble', 'modeles'], 'fiabilite')) return;
    const e = EXTRA.ensemble.d.hourly, cf = confiance(), times = e.time.slice(cf.i, cf.i + 48), p = C.rainProb(e).slice(cf.i, cf.i + 48);
    const i = nowIdx(), fin = Math.min(i + 48, W.hourly.time.length);
    const pluies = MOD.map(m => serie('precipitation', m[0], i, fin)).filter(s => s.length).map(s => s.slice(0, 24).reduce((a, v) => a + (v || 0), 0));
    el.innerHTML = `<div class="card"><h3>Confiance ${cf.niveau}</h3><div class="texte">Écart moyen entre les 40 membres de l'Ensemble ICON : <b>${fmt(cf.moy, 1)} °C</b> sur 48 h.
        Cumul de pluie sur 24 h selon les modèles : <b>${fmt(Math.min(...pluies), 1)} à ${fmt(Math.max(...pluies), 1)} mm</b>.</div></div>
      <div class="card"><h3>Température : dispersion de l'Ensemble</h3>
        ${Graph.chart({ times, series: [{ type: 'band', lo: cf.b.map(v => v[0]), hi: cf.b.map(v => v[2]), color: '#ff9500' }, { vals: cf.b.map(v => v[1]), color: '#ff9500' }], label: libelleTemps, title: 'Dispersion' })}
        <div class="note">Bande = 10 % à 90 % des membres, ligne = médiane. Plus la bande est large, moins la prévision est sûre.</div></div>
      <div class="card"><h3>Probabilité de pluie (% des membres)</h3>
        ${Graph.chart({ times, min: 0, max: 100, series: [{ vals: p.map(v => (v == null ? null : v * 100)), type: 'bar', color: '#0a84ff', opacity: 0.7 }], label: libelleTemps, title: 'Probabilité de pluie' })}</div>`;
  };

  // ---------- Brief météo ----------
  RENDUS.brief = el => {
    if (!attendre(el, ['ensemble', 'modeles'], 'brief')) return;
    const h = W.hourly, i = nowIdx(), p = pic(i, 48), lv = riskLevel(p.s), cf = confiance();
    const fen = alertWindows(h, LPI, i, Math.min(i + 48, h.time.length), R.seuils).find(a => a.label === 'Orage probable');
    let raf = i, pmax = i, cumul = 0;
    for (let k = i; k < Math.min(i + 24, h.time.length); k++) {
      if (h.wind_gusts_10m[k] > h.wind_gusts_10m[raf]) raf = k;
      if (h.precipitation[k] > h.precipitation[pmax]) pmax = k;
      cumul += h.precipitation[k] || 0;
    }
    const jh = k => `${jourCourt(h.time[k]).toLowerCase()} ${+hh(h.time[k])}h`;
    const vig = VG && VG.officielle && VG.periodes[0];
    const duree = d => (d < 60000 ? `${Math.round(d / 1000)} s` : `${Math.round(d / 60000)} min`);
    const dot = col => `<span class="pastille" style="background:${col}"></span>`;
    const vcol = v => (v >= 90 ? '#ff3b30' : v >= 60 ? '#ff9500' : v >= 40 ? '#ffcc00' : '#34c759');
    const pcol = v => (v >= 40 ? '#ff3b30' : v >= 20 ? '#ff9500' : v >= 5 ? '#ffcc00' : '#34c759');
    const resume = `Risque orageux jusqu'à ${p.s}/100, pic ${jh(p.i)}. ${p.s >= 25 ? 'Convection possible sur le créneau indiqué.' : 'Pas d\'orage marqué attendu.'}${vig && vig.couleur >= 2 ? ` Vigilance ${COULEURS_MF[vig.couleur].toLowerCase()}.` : ''}`;
    const fo = ETAT.foudre && ETAT.foudre.connecte;
    const sources = [['Open-Meteo (best_match)', !!W, duree(Date.now() - quandW)], ['LPI ICON-D2', LPI.some(v => v != null), LPI.some(v => v != null) ? 'disponible' : 'hors domaine'],
      ['Ensemble ICON', !!cf, cf ? 'ok' : '–'], ['Blitzortung', fo, fo ? 'connecté' : 'déconnecté'],
      ['Météo-France vigilance', VG && VG.officielle, VG ? (VG.officielle ? 'ok' : esc(VG.raison)) : (R.lieu.dep ? '…' : 'hors de France')]];
    el.innerHTML = `<div class="card"><div class="row"><h3 style="margin:0">📝 ${esc(R.lieu.nom)}</h3><span class="sp"></span><small class="muted">${duree(Date.now() - quandW)}</small></div>
        <div class="texte" style="margin-top:8px">${resume}</div><div class="muted" style="margin-top:8px">🛡️ Confiance ${cf ? cf.niveau : 'inconnue'}</div></div>
      <div class="card"><div class="row"><h3 style="margin:0">${dot(lv.color)} Orages</h3><span class="sp"></span>${fen ? `<small class="muted">${jh(fen.start)} → ${jh(Math.min(fen.end + 1, h.time.length - 1))}</small>` : ''}</div>
        <div class="muted" style="margin-top:6px">Risque orageux jusqu'à ${p.s}/100, pic ${jh(p.i)}. ${fen ? `Créneau favorable : CAPE jusqu'à ${fmt(h.cape[fen.peak])} J/kg.` : 'Aucun créneau au-dessus de nos seuils.'}</div></div>
      <div class="card"><h3>${dot(vcol(h.wind_gusts_10m[raf]))} Vent / rafales</h3><div class="muted">Rafales jusqu'à ${fmt(h.wind_gusts_10m[raf])} km/h vers ${jh(raf)}.</div></div>
      <div class="card"><h3>${dot(pcol(cumul))} Précipitations</h3><div class="muted">Cumul 24 h ~${fmt(cumul, 1)} mm, pointe ${fmt(h.precipitation[pmax], 1)} mm/h${h.precipitation[pmax] >= 0.1 ? ` vers ${jh(pmax)}` : ''}.</div></div>
      <div class="card"><h3>${dot(vig ? ['', '#34c759', '#ffcc00', '#ff9500', '#ff3b30'][vig.couleur] : '#8e8e93')} ${vig ? `Vigilance ${COULEURS_MF[vig.couleur].toLowerCase()}` : 'Vigilance'}</h3>
        <div class="muted">${vig ? esc(vig.texte || 'Pas de commentaire de Météo-France.') : 'Vigilance officielle indisponible : voir la vigilance indicative.'}</div></div>
      <div class="card"><h3>${dot(cf && cf.niveau === 'élevée' ? '#34c759' : '#ffcc00')} Incertitude</h3><div class="muted">${cf && cf.niveau === 'élevée' ? 'Les modèles et les membres de l\'Ensemble sont proches : prévision assez sûre sur 48 h.' : 'Au-delà de 24 h, la localisation et l\'intensité des cellules restent incertaines (divergence des modèles).'}</div></div>
      <div class="card"><h3>Sources</h3>${sources.map(([n, ok, t]) => `<div class="source">${dot(ok ? '#34c759' : '#ff9500')}${n}<small>${t}</small></div>`).join('')}</div>`;
  };

  // ---------- Autre (réglages, état) ----------
  RENDUS.autre = el => {
    const S = R.seuils, f = ETAT.foudre;
    el.innerHTML = `<div class="card"><h3>📍 Lieu</h3><div>${esc(R.lieu.nom)} <span class="muted">(${fmt(R.lieu.lat, 3)} ; ${fmt(R.lieu.lon, 3)}${R.lieu.dep ? ` · dép. ${esc(R.lieu.dep)}` : ''})</span></div>
        <label class="row" style="margin-top:10px">Suivre ma position automatiquement<input type="checkbox" class="interrupteur" id="i-suivi" ${R.suivi ? 'checked' : ''}></label>
        ${window.isSecureContext ? '' : '<div class="note">La position exige le HTTPS : ouvrir l\'adresse réseau donnée par le serveur.</div>'}
        <div class="row"><button class="lien" id="b-chercher">Choisir une ville…</button><span class="sp"></span><button class="lien" id="b-pessac">Revenir à Pessac</button></div></div>
      <div class="card"><h3>🔔 Notifications</h3>
        <label class="row">Orage actif proche et approche<input type="checkbox" class="interrupteur" id="i-notifs" ${R.notifs ? 'checked' : ''}></label>
        <div class="note">Quand l'appli est ouverte ou en arrière-plan. Sur iPhone : partager → « Sur l'écran d'accueil », puis ouvrir l'appli depuis l'icône.</div></div>
      <div class="card"><h3>⚙️ Seuils d'alerte <span class="muted" style="font-size:13px;font-weight:400">(heuristiques)</span></h3>
        <form class="form" id="f-seuils">
          <label>Orage probable : CAPE ≥<input name="cape" type="number" min="0" max="10000" step="50" value="${S.cape}">J/kg</label>
          <label>… et Lifted Index ≤<input name="li" type="number" min="-15" max="10" step="0.5" value="${S.li}"></label>
          <label>Rafales fortes ≥<input name="rafales" type="number" min="20" max="200" step="5" value="${S.rafales}">km/h</label>
          <label>Pluies fortes ≥<input name="pluie" type="number" min="1" max="100" step="1" value="${S.pluie}">mm/h</label>
          <label>Foudre probable : LPI ≥<input name="lpi" type="number" min="0" max="50" step="0.5" value="${S.lpi}">J/kg</label>
          <label>Orage actif proche sous<input name="rayon" type="number" min="5" max="300" step="5" value="${S.rayon}">km</label>
          <div class="row"><button class="bouton" type="submit">Enregistrer</button><span class="sp"></span><button class="lien" type="button" id="b-defaut">Valeurs par défaut</button></div>
        </form></div>
      <div class="card"><h3>📡 Sources et état</h3>
        <div class="source"><span class="pastille" style="background:${W ? '#34c759' : '#ff3b30'}"></span>Open-Meteo<small>${W ? 'données de ' + hm(W.current.time) : 'indisponible'}</small></div>
        <div class="source"><span class="pastille" style="background:${f && f.connecte ? '#34c759' : '#ff3b30'}"></span>Blitzortung<small>${f ? (f.connecte ? `connecté · ${f.tampon} impacts en mémoire` : esc(f.erreur || 'déconnecté')) : '…'}</small></div>
        <div class="source"><span class="pastille" style="background:${ETAT.radar && !ETAT.radar.erreur ? '#34c759' : '#8e8e93'}"></span>RainViewer<small>${ETAT.radar ? (ETAT.radar.erreur ? esc(ETAT.radar.erreur) : `${ETAT.radar.images.length} images`) : 'ouvrir Chasse orage'}</small></div>
        <div class="source"><span class="pastille" style="background:${VG && VG.officielle ? '#34c759' : '#ff9500'}"></span>Vigilance Météo-France<small>${VG ? (VG.officielle ? 'ok' : esc(VG.raison)) : R.lieu.dep ? '…' : 'hors de France'}</small></div></div>
      <div class="card muted" style="font-size:13px"><h3 style="color:var(--text)">À propos</h3>
        Unités : °C, km/h, mm. Le score de risque, les alertes, l'analyse pro et la vigilance indicative sont calculés par nos seuils : ce ne sont pas des prévisions officielles.<br><br>
        Météo : <a href="https://open-meteo.com">Weather data by Open-Meteo.com</a> (CC BY 4.0) · Radar : <a href="https://www.rainviewer.com">Weather data by Rain Viewer</a> ·
        Foudre : <a href="https://www.blitzortung.org">Blitzortung.org</a> (CC BY-SA 4.0) · Vigilance : <a href="https://vigilance.meteofrance.fr">Météo-France</a> ·
        Communes : <a href="https://adresse.data.gouv.fr">API Adresse</a> (Licence ouverte) · Fond de carte : <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></div>`;
    $('#i-suivi').onchange = e => { R.suivi = e.target.checked; ecrire(); if (R.suivi) suivre(true); };
    $('#b-chercher').onclick = () => { location.hash = '#recherche'; };
    $('#b-pessac').onclick = () => changerLieu(PESSAC, false);
    $('#i-notifs').onchange = async e => {
      if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
        const r = await Notification.requestPermission().catch(() => 'denied');
        if (r !== 'granted') { e.target.checked = false; banniere('Notifications refusées par le navigateur.'); return; }
      }
      R.notifs = e.target.checked; ecrire();
      if (R.notifs) notifier('Notifications activées', 'Vous serez prévenu quand un orage est proche.');
    };
    const form = $('#f-seuils');
    form.onsubmit = ev => {
      ev.preventDefault();
      Object.keys(C.SEUILS).forEach(k => { const v = parseFloat(form.elements[k].value); if (isFinite(v)) R.seuils[k] = v; });
      ecrire(); banniere('Seuils enregistrés.'); carte.rayon(); majFoudre();
    };
    $('#b-defaut').onclick = () => { R.seuils = { ...C.SEUILS }; ecrire(); rendre(); carte.rayon(); };
  };

  // ---------- Chasse orage (carte) ----------
  const carte = {
    map: null,
    init() {
      if (this.map) { setTimeout(() => this.map.invalidateSize(), 50); return; }
      const map = this.map = L.map('carte', { center: [R.lieu.lat, R.lieu.lon], zoom: 8, maxZoom: 13, zoomControl: false, preferCanvas: true });
      L.tileLayer('/tuiles/osm/{z}/{x}/{y}.png', { maxZoom: 13, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · Radar <a href="https://www.rainviewer.com">Rain Viewer</a> · Foudre <a href="https://www.blitzortung.org">Blitzortung</a>' }).addTo(map);
      map.attributionControl.setPrefix(false);
      this.site = L.circleMarker([R.lieu.lat, R.lieu.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }).addTo(map);
      this.cercle = L.circle([R.lieu.lat, R.lieu.lon], { radius: R.seuils.rayon * 1000, color: '#0a84ff', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
      this.gF = L.layerGroup().addTo(map); this.gC = L.layerGroup().addTo(map); this.gV = L.layerGroup(); this.gK = L.layerGroup();
      // Ajouté à la carte à la première image connue : sans elle, Leaflet demanderait une adresse vide
      this.rLayer = L.tileLayer('/tuiles/radar/0/{z}/{x}/{y}.png', { opacity: 0.65, zIndex: 2, maxNativeZoom: 7, maxZoom: 13 });
      this.couches = { foudre: [this.gF, this.gC], radar: [this.rLayer], vent: [this.gV], cape: [this.gK] };
      this.frames = []; this.times = [null]; this.radarT = null; this.grille = null;
      $('#pl-legende').innerHTML = '⚡ ' + AGE_BANDS.map(b => `<span><span class="pastille" style="background:${b[1]}"></span> ${b[2].replace(/ /g, '').replace('min', 'm')}</span>`).join('');
      const cur = $('#curseur');
      cur.oninput = () => this.show(+cur.value);
      let timer = null;
      $('#play').onclick = e => {
        if (timer) { clearInterval(timer); timer = null; e.currentTarget.textContent = '▶'; return; }
        e.currentTarget.textContent = '⏸';
        timer = setInterval(() => { cur.value = (+cur.value + 1) % this.times.length; this.show(+cur.value); }, 900);
      };
      document.querySelectorAll('.couches [data-couche]').forEach(b => b.onclick = () => {
        const on = b.classList.toggle('on'); b.setAttribute('aria-pressed', on);
        const c = b.dataset.couche;
        if (c === 'info') { $('#info-carte').hidden = !on; this.info(); return; }
        if (c === 'radar' && this.radarT == null) return;
        (this.couches[c] || []).forEach(l => (on ? l.addTo(map) : map.removeLayer(l)));
        if (c === 'vent' || c === 'cape') this.prevision();
      });
      $('#cape-h').oninput = () => this.prevision();
      $('#b-rayon').onclick = () => {
        const PAS = [10, 30, 50, 100];
        R.seuils.rayon = PAS[(PAS.indexOf(R.seuils.rayon) + 1) % PAS.length]; ecrire(); this.rayon(); majFoudre();
      };
      this.rayon(); this.station(); this.majRadar();
      setInterval(() => this.majRadar(), 5 * 60000);
      setTimeout(() => map.invalidateSize(), 50);
    },
    rayon() {
      $('#b-rayon').textContent = `⌖ ${R.seuils.rayon}`;
      if (this.cercle) this.cercle.setRadius(R.seuils.rayon * 1000);
    },
    recentrer(garderZoom) {
      if (!this.map) return;
      const ll = [R.lieu.lat, R.lieu.lon];
      this.site.setLatLng(ll); this.cercle.setLatLng(ll);
      this.map.setView(ll, garderZoom ? this.map.getZoom() : 8);
      this.grille = null; this.gV.clearLayers(); this.gK.clearLayers();
      if (this.map.hasLayer(this.gV) || this.map.hasLayer(this.gK)) this.prevision();
    },
    async majRadar() {
      const cur = $('#curseur');
      try {
        const r = await getJson('/api/radar');
        ETAT.radar = r;
        const auBout = +cur.value >= this.times.length - 1;
        this.frames = r.images; this.times = [...r.images.map(t => t * 1000), null];
        cur.max = this.times.length - 1;
        if (auBout) cur.value = cur.max;
      } catch (e) { ETAT.radar = { erreur: e.message, images: [] }; }
      this.show(+cur.value);
    },
    show(k) {
      if (!this.map) return;
      const T = this.times[k] ?? maintenant(), isNow = k >= this.times.length - 1, map = this.map;
      const f = this.frames[Math.min(k, this.frames.length - 1)];
      if (f != null && f !== this.radarT) {
        this.rLayer.setUrl(`/tuiles/radar/${f}/{z}/{x}/{y}.png`);
        if (this.radarT == null && $('[data-couche=radar]').classList.contains('on')) this.rLayer.addTo(map);
        this.radarT = f;
      }
      this.gF.clearLayers(); this.gC.clearLayers();
      const vis = C.visibleAt(STRIKES, T);
      vis.forEach(s => L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1, color: '#fff', fillColor: ageColor(s.age), fillOpacity: 0.95, interactive: false }).addTo(this.gF));
      const cl = C.cells(vis);
      cl.forEach(c => {
        const col = ageColor(c.age);
        L.circle([c.lat, c.lon], { radius: Math.min(25000, 6000 + 1500 * Math.sqrt(c.n)), color: col, weight: 2, fillColor: col, fillOpacity: 0.12, interactive: false }).addTo(this.gC);
        L.marker([c.lat, c.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="cellule">⛈️<br><b>${c.n}</b></div>`, iconSize: [40, 44], iconAnchor: [20, 22] }) }).addTo(this.gC);
      });
      const near = C.nearest(vis, R.lieu.lat, R.lieu.lon, 0, 60), ok = ETAT.foudre && ETAT.foudre.connecte;
      $('#pl-flux').innerHTML = `<span class="pastille" style="background:${ok ? '#34c759' : '#ff3b30'}"></span> Flux foudre<span class="sep"></span>⚡ ${vis.length}<span class="sep"></span>🌩️ ${cl.length}<span class="sep"></span>
        <span style="color:${near && near.km < R.seuils.rayon ? '#ff6b6b' : '#fff'}">${near ? fmt(near.km) + ' km' : '–'}</span>`;
      $('#curseur-t').textContent = hhmm(isNow ? maintenant() : T);
      const ap = isNow ? C.approach(vis, R.lieu.lat, R.lieu.lon, R.seuils.rayon * 2) : null;
      $('#pl-approche').hidden = !ap;
      if (ap) {
        $('#pl-approche').textContent = `⚠️ Orage à ${fmt(ap.km)} km (${compass(ap.bearing)}), il se rapproche`;
        if (Date.now() - dejaNotifie.approche > 30 * 60000) { dejaNotifie.approche = Date.now(); notifier('Orage en approche', `À ${fmt(ap.km)} km au ${compass(ap.bearing)}, il se rapproche.`); }
      }
    },
    station() {
      if (!W) return;
      const c = W.current, i = nowIdx(), sc = riskScore(hourRisk(W.hourly, LPI, i)), lv = riskLevel(sc), p = pic(i, 24);
      $('#pl-risque').innerHTML = `☁️ Risque ${lv.label.toLowerCase()} <b style="color:${lv.color}">${sc}%</b> <span style="opacity:.7">· ${hh(W.hourly.time[p.i])} h</span>`;
      $('#station').innerHTML = `<div class="row"><b style="font-size:18px">➤ ${esc(R.lieu.nom)}</b><span class="sp"></span><span style="opacity:.6">${hm(c.time)}</span></div>
        <div class="row"><div class="chips"><span>🌡️ ${fmt(c.temperature_2m)}°</span><span>💨 ${fmt(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}</span>
        ${c.wind_gusts_10m >= 25 ? `<span>🌬️ ${fmt(c.wind_gusts_10m)}</span>` : ''}<span>☁️ ${fmt(c.cloud_cover)}%</span>${W.hourly.cape[i] >= 100 ? `<span>⚡ ${fmt(W.hourly.cape[i])}</span>` : ''}</div>
        <div class="note-r" style="color:${lv.color}">${sc}%<small>${lv.label}</small></div></div>`;
    },
    async prevision() {
      const map = this.map, vent = map.hasLayer(this.gV), cape = map.hasLayer(this.gK);
      $('#lect-cape').hidden = !vent && !cape;
      this.gV.clearLayers(); this.gK.clearLayers();
      if (!vent && !cape) return;
      try { this.grille = this.grille || await getJson(`/api/grille?${qs()}`); } catch (e) { banniere(`Grille indisponible : ${e.message}`); return; }
      const g = this.grille, ch = $('#cape-h'); ch.max = g.time.length - 1;
      const k = Math.min(+ch.value, g.time.length - 1), n = g.lons.length;
      const dla = (g.lats[1] - g.lats[0]) / 2, dlo = (g.lons[1] - g.lons[0]) / 2;
      const capeCol = v => (v == null || v < 100 ? null : v < 500 ? '#34c759' : v < 1000 ? '#ffcc00' : v < 2000 ? '#ff9500' : '#ff3b30');
      const ventCol = v => (v < 20 ? '#1b6e2e' : v < 40 ? '#c79100' : v < 60 ? '#e07b00' : '#d70015');
      g.cape[k].forEach((v, p) => {
        const li = Math.floor(p / n), co = p % n, la = g.lats[li], lo = g.lons[co];
        if (cape && capeCol(v)) L.rectangle([[la - dla, lo - dlo], [la + dla, lo + dlo]], { stroke: false, fillColor: capeCol(v), fillOpacity: 0.35, interactive: false }).addTo(this.gK);
        const s = g.vent[k][p], d = g.direction[k][p];
        if (vent && s != null && d != null && li % 2 === 0 && co % 2 === 0)   // un point sur deux : lisible
          L.marker([la, lo], { interactive: false, icon: L.divIcon({ className: '', iconSize: [30, 34], iconAnchor: [15, 17],
            html: `<div class="fleche" style="color:${ventCol(g.rafales[k][p] ?? s)}"><div style="transform:rotate(${d + 180}deg);font-size:20px">↑</div>${fmt(s)}</div>` }) }).addTo(this.gV);
      });
      $('#cape-t').textContent = `${g.time[k].slice(11, 16)}${k ? ` +${k}h` : ''}`;
    },
    info() {
      $('#info-carte').innerHTML = `<b>Impacts</b> : couleur = ancienneté (violet < 5 min … bleu 1-2 h). <b>Cellules</b> : impacts de moins de 30 min regroupés par carreaux d'environ 20 km.
        <b>Cercle pointillé</b> : rayon « orage actif proche » (bouton ⌖). <b>Radar</b> : Rain Viewer, images des 2 dernières heures.<br>
        <b>CAPE</b> (🔥) : vert 100-500, jaune 500-1000, orange 1000-2000, rouge > 2000 J/kg. <b>Vent</b> (💨) : flèche = sens, chiffre = km/h, couleur = rafales.
        Grille de 15×15 points Open-Meteo, curseur « Prévi. » sur 24 h.<br>Foudre : Blitzortung.org (réseau communautaire, couverture non garantie).`;
    },
  };

  // ---------- Démarrage ----------
  if (!location.hash) history.replaceState(null, '', '#accueil');
  route();
  charger();
  majFoudre();
  if (R.suivi) suivre(false);
  setInterval(charger, 10 * 60000);
  setInterval(majFoudre, 60000);
})();
