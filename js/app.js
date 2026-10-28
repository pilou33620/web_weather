(() => {
  const C = Calc;
  const { compass, AGE_BANDS, ageColor, riskScore, riskLevel, alignLpi, hourRisk, alertWindows, weatherLabel } = C;

  const $ = s => document.querySelector(s);
  // Tout texte reçu (noms de lieux, heures, messages) passe par esc avant innerHTML.
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toFixed(d));
  const hm = t => esc(String(t).slice(11, 16));
  const hhmm = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const banner = msg => { const b = $('#banner'); b.textContent = msg; b.hidden = false; setTimeout(() => { b.hidden = true; }, 8000); };

  // ---------- Réglages (propres à cet appareil) ----------
  const PESSAC = { nom: 'Pessac (33)', lat: 44.80565, lon: -0.6324 };
  function lireReglages() {
    try {
      const r = JSON.parse(localStorage.getItem('ww-reglages'));
      if (r && r.lieu && isFinite(r.lieu.lat) && isFinite(r.lieu.lon)) return { lieu: r.lieu, seuils: { ...C.SEUILS, ...r.seuils } };
    } catch (e) { /* stockage indisponible : réglages par défaut */ }
    return { lieu: PESSAC, seuils: { ...C.SEUILS } };
  }
  function ecrireReglages() {
    try { localStorage.setItem('ww-reglages', JSON.stringify(R)); } catch (e) { banner('Réglages non enregistrés : stockage du navigateur indisponible.'); }
  }
  const R = lireReglages(), SITE = R.lieu;
  const QS = `lat=${encodeURIComponent(SITE.lat)}&lon=${encodeURIComponent(SITE.lon)}`;

  async function getJson(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
    return j;
  }

  // ---------- Météo du lieu ----------
  let W = null, LPI = [];
  const nowIdx = d => Math.max(0, d.hourly.time.findIndex(t => t >= d.current.time.slice(0, 13) + ':00'));
  function dayLabel(t, today) {
    if (t.slice(0, 10) === today) return 'auj.';
    const dt = new Date(t.slice(0, 10) + 'T12:00'), ref = new Date(today + 'T12:00');
    if (dt - ref === 86400000) return 'dem.';
    return dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  async function charger() {
    try {
      const m = await getJson(`/api/meteo?${QS}`);
      W = m.prevision; LPI = alignLpi(W.hourly.time, m.lpi);
      renderHome(); renderDonnees(); renderVigilance(); renderStation();
    } catch (e) {
      banner(`Météo indisponible : ${e.message}`);
      if (!W) ['#home', '#donnees', '#vigilance'].forEach(s => { $(s).textContent = `Météo indisponible : ${e.message}`; });
    }
  }

  // ---------- Accueil ----------
  function brief(d, peak) {
    const dd = d.daily, out = [];
    [0, 1].forEach(k => {
      if (k >= dd.time.length) return;
      const pluie = dd.precipitation_sum[k];
      out.push(`<b>${k ? 'Demain' : "Aujourd'hui"}</b> : ${weatherLabel(dd.weather_code[k])[1].toLowerCase()}, ${fmt(dd.temperature_2m_min[k])} à ${fmt(dd.temperature_2m_max[k])} °C, ` +
        (pluie >= 0.1 ? `${fmt(pluie, 1)} mm de pluie (probabilité ${fmt(dd.precipitation_probability_max[k])} %)` : 'pas de pluie notable') +
        `, rafales jusqu'à ${fmt(dd.wind_gusts_10m_max[k])} km/h.`);
    });
    const pk = riskLevel(peak.s);
    out.push(`Risque d'orage sur 24 h : <b style="color:${pk.color}">${pk.label.toLowerCase()}</b> (pic ${peak.s} % vers ${hm(d.hourly.time[peak.i])}).`);
    return out.join(' ');
  }
  function renderHome() {
    const d = W, c = d.current, h = d.hourly, dd = d.daily, i = nowIdx(d), today = c.time.slice(0, 10);
    const [icon, label] = weatherLabel(c.weather_code);
    let peak = { s: -1, i }; const scores = [];
    for (let k = i; k < Math.min(i + 24, h.time.length); k++) { const s = riskScore(hourRisk(h, LPI, k)); scores.push(s); if (s > peak.s) peak = { s, i: k }; }
    const now = scores[0] ?? 0, lv = riskLevel(now), pk = riskLevel(peak.s);
    const alerts = alertWindows(h, LPI, i, Math.min(i + 48, h.time.length), R.seuils);
    const gmin = Math.min(...dd.temperature_2m_min), gmax = Math.max(...dd.temperature_2m_max), S = R.seuils;
    $('#home').innerHTML = `
      <div class="hero">
        <div class="muted">📍 ${esc(SITE.nom)}</div>
        <div class="temp">${fmt(c.temperature_2m)}°</div>
        <div class="desc">${icon} ${label} · Ressenti ${fmt(c.apparent_temperature)}°</div>
        <div class="chips"><span>💨 ${fmt(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}</span>
          <span>🌬️ rafales ${fmt(c.wind_gusts_10m)}</span><span>💧 ${fmt(c.relative_humidity_2m)} %</span><span>☁️ ${fmt(c.cloud_cover)} %</span></div>
      </div>
      <div class="card"><h3>📝 Brief météo</h3><div class="brief">${brief(d, peak)}</div></div>
      <div class="card"><h3>Risque d'orage <span class="muted">(indicatif${LPI[i] != null ? ', avec LPI ICON-D2' : ''})</span></h3>
        <div class="risk"><div class="big" style="color:${lv.color}">${now} %</div>
          <div style="flex:1"><div class="bar"><span style="width:${now}%;background:${lv.color}"></span></div>
            <div class="muted" style="margin-top:6px;font-size:13px">${lv.label} maintenant · pic <b style="color:${pk.color}">${peak.s} %</b> (${pk.label}) à ${hm(h.time[peak.i])}</div></div></div>
      </div>
      <div class="card"><h3>✨ Prochaines alertes probables <span class="tag">${alerts.length}</span></h3>
        ${alerts.length ? alerts.map(a => `<div class="alert-row"><div class="row"><b>${a.label}</b><span class="tag">Surveillance</span>
          <span style="margin-left:auto">${esc(dayLabel(h.time[a.start], today))} ${hm(h.time[a.start])}–${hm(h.time[a.end + 1] || h.time[a.end])}</span></div>
          <div class="muted" style="font-size:13px">pic ${hm(h.time[a.peak])} · ${esc(a.detail)}</div></div>`).join('')
          : '<div class="muted">Aucune alerte dans les 48 prochaines heures.</div>'}
        <div class="muted" style="font-size:12px;margin-top:8px">Seuils : CAPE ≥ ${fmt(S.cape)} et LI ≤ ${fmt(S.li, 1)} ; rafales ≥ ${fmt(S.rafales)} km/h ; LPI ≥ ${fmt(S.lpi, 1)} J/kg. Modifiables dans Réglages.</div>
      </div>
      <div class="card"><h3>Prochaines heures</h3><div class="hours">${Array.from({ length: 12 }, (_, k) => {
        const j = i + k; if (j >= h.time.length) return '';
        return `<div>${esc(h.time[j].slice(11, 13))} h<span style="display:block;font-size:20px">${weatherLabel(h.weather_code[j])[0]}</span><b>${fmt(h.temperature_2m[j])}°</b><span class="muted">${fmt(h.precipitation_probability[j])} %</span></div>`;
      }).join('')}</div></div>
      <div class="card"><h3>Sur ${dd.time.length} jours</h3>${dd.time.map((t, k) => `<div class="day">
        <div class="row"><span style="width:78px">${esc(dayLabel(t, today))}</span><span>${weatherLabel(dd.weather_code[k])[0]}</span>
          <span class="muted" style="width:44px">${fmt(dd.precipitation_probability_max[k])} %</span><span>${fmt(dd.temperature_2m_min[k])}°</span>
          <div class="range"><span style="left:${(dd.temperature_2m_min[k] - gmin) / (gmax - gmin || 1) * 100}%;right:${100 - (dd.temperature_2m_max[k] - gmin) / (gmax - gmin || 1) * 100}%"></span></div>
          <span>${fmt(dd.temperature_2m_max[k])}°</span></div>
        <div class="sub">💧 ${fmt(dd.precipitation_sum[k], 1)} mm · ☀️ UV ${fmt(dd.uv_index_max[k])} · 🌬️ rafales ${fmt(dd.wind_gusts_10m_max[k])} · 🌅 ${hm(dd.sunrise[k])}→${hm(dd.sunset[k])}</div></div>`).join('')}</div>`;
  }

  // ---------- Données : station, graphiques, modèles, fiabilité ----------
  function spark(title, vals, unit, color, dec = 0) {
    const ok = vals.filter(v => v != null && isFinite(v));
    if (ok.length < 2) return '';
    const w = 300, ht = 54, min = Math.min(...ok), max = Math.max(...ok), span = max - min || 1;
    const pts = vals.map((v, k) => (v == null ? null : `${(k / (vals.length - 1) * w).toFixed(1)},${(ht - 4 - (v - min) / span * (ht - 8)).toFixed(1)}`)).filter(Boolean).join(' ');
    return `<div class="spark"><div class="spark-h"><b>${title}</b><span>min ${fmt(min, dec)} · max ${fmt(max, dec)} ${unit}</span></div>
      <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="${title}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`;
  }
  // Bande p10-p90 de l'Ensemble et médiane.
  function bandSvg(title, b, unit, color) {
    const all = b.flat().filter(v => v != null);
    if (all.length < 2) return '';
    const w = 300, ht = 70, min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
    const x = k => (k / (b.length - 1) * w).toFixed(1), y = v => (ht - 4 - (v - min) / span * (ht - 8)).toFixed(1);
    const ok = b.map((v, k) => [v, k]).filter(([v]) => v[0] != null);
    const poly = [...ok.map(([v, k]) => `${x(k)},${y(v[2])}`), ...ok.reverse().map(([v, k]) => `${x(k)},${y(v[0])}`)].join(' ');
    const med = b.map((v, k) => (v[1] == null ? null : `${x(k)},${y(v[1])}`)).filter(Boolean).join(' ');
    return `<div class="spark"><div class="spark-h"><b>${title}</b><span>${fmt(min, 1)} à ${fmt(max, 1)} ${unit}</span></div>
      <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" style="height:${ht}px" role="img" aria-label="${title}"><polygon points="${poly}" fill="${color}" fill-opacity=".25" stroke="none"/>
      <polyline points="${med}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`;
  }
  function renderDonnees() {
    const d = W, c = d.current, h = d.hourly, i = nowIdx(d), end = Math.min(i + 48, h.time.length);
    const at = k => h[k][i], sl = k => h[k].slice(i, end);
    const tiles = [
      ['CAPE', at('cape'), 'J/kg', 0, 'Énergie disponible pour les orages. Repère courant : plus de 1000 = orages forts possibles'],
      ['Lifted Index', at('lifted_index'), '', 1, 'Négatif = atmosphère instable'],
      ['CIN', at('convective_inhibition'), 'J/kg', 0, 'Frein au déclenchement des orages'],
      ['LPI', LPI[i], 'J/kg', 1, LPI[i] == null ? 'Hors domaine ICON-D2' : 'Potentiel de foudre prévu (ICON-D2)'],
      ['Isotherme 0 °C', at('freezing_level_height'), 'm', 0, 'Altitude où la température passe à 0 °C'],
      ['Rafales', at('wind_gusts_10m'), 'km/h', 0, 'À 10 m du sol'],
      ['Pression', at('pressure_msl'), 'hPa', 0, 'Niveau de la mer'],
      ['Point de rosée', at('dew_point_2m'), '°C', 1, 'Plus il est proche de la température, plus l\'air est humide'],
      ['Visibilité', at('visibility') / 1000, 'km', 1, ''],
      ['Indice UV', at('uv_index'), '', 1, ''],
      ['Nuages', at('cloud_cover'), '%', 0, ''],
      ['Humidité', at('relative_humidity_2m'), '%', 0, ''],
    ];
    const rows = Array.from({ length: Math.min(24, h.time.length - i) }, (_, k) => {
      const j = i + k;
      return `<tr><td>${hm(h.time[j])}</td><td>${fmt(h.temperature_2m[j], 1)}</td><td>${fmt(h.precipitation[j], 1)}</td><td>${fmt(h.cape[j])}</td><td>${fmt(h.lifted_index[j], 1)}</td><td>${fmt(LPI[j], 1)}</td><td>${fmt(h.wind_gusts_10m[j])}</td><td>${fmt(h.pressure_msl[j])}</td></tr>`;
    }).join('');
    $('#donnees').innerHTML = `
      <h2>Station · ${esc(SITE.nom)}</h2>
      <div class="muted" style="margin:-6px 0 10px;font-size:12px">Valeurs du modèle (pas de capteur réel) · heure de ${hm(c.time)} · altitude ${fmt(d.elevation)} m · ${fmt(SITE.lat, 4)} ; ${fmt(SITE.lon, 4)}</div>
      <div class="tiles">${tiles.map(([k, v, u, dec, hint]) => `<div class="tile"><div class="k">${k}</div><div class="v">${fmt(v, dec)} <small>${u}</small></div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`).join('')}</div>
      <div class="card"><h3>Graphiques · 48 prochaines heures</h3>
        ${spark('Température', sl('temperature_2m'), '°C', '#ff9a4a', 1)}${spark('CAPE', sl('cape'), 'J/kg', '#ffd600')}
        ${spark('Lifted Index', sl('lifted_index'), '', '#b57cff', 1)}${spark('Rafales', sl('wind_gusts_10m'), 'km/h', '#2ecc9a')}
        ${spark('Précipitations', sl('precipitation'), 'mm', '#2b8cff', 1)}${spark('Pression', sl('pressure_msl'), 'hPa', '#9aa7c2')}</div>
      <div class="card"><h3>Modèles</h3><div id="modeles" class="muted">Chargement…</div></div>
      <div class="card"><h3>Fiabilité (Ensemble ICON, 40 membres)</h3><div id="fiabilite" class="muted">Chargement…</div></div>
      <div class="card"><h3>Tableau horaire (24 h)</h3><div class="tablewrap"><table>
        <tr><th>Heure</th><th>T °C</th><th>Pluie mm</th><th>CAPE</th><th>LI</th><th>LPI</th><th>Rafales</th><th>hPa</th></tr>${rows}</table></div></div>
      <div class="card"><h3>Sources et état</h3><div id="sources"></div></div>`;
    chargerModeles(); chargerEnsemble(); renderSources();
  }

  const NOMS_MODELES = { meteofrance_seamless: 'Météo-France (AROME/ARPEGE)', icon_seamless: 'DWD ICON', ecmwf_ifs025: 'ECMWF IFS', gfs_seamless: 'NOAA GFS' };
  async function chargerModeles() {
    const box = $('#modeles'); if (!box) return;
    try {
      const m = await getJson(`/api/modeles?${QS}`), h = m.hourly;
      const i = Math.max(0, h.time.findIndex(t => t >= W.current.time.slice(0, 13) + ':00'));
      const somme = a => a.slice(i, i + 24).reduce((s, v) => s + (v || 0), 0);
      box.classList.remove('muted');
      box.innerHTML = `<div class="tablewrap"><table><tr><th>Modèle</th><th>T °C</th><th>Rafales</th><th>CAPE</th><th>Pluie 24 h</th></tr>
        ${Object.keys(NOMS_MODELES).map(k => `<tr><td>${NOMS_MODELES[k]}</td><td>${fmt(h[`temperature_2m_${k}`]?.[i], 1)}</td>
          <td>${fmt(h[`wind_gusts_10m_${k}`]?.[i])}</td><td>${fmt(h[`cape_${k}`]?.[i])}</td><td>${h[`precipitation_${k}`] ? fmt(somme(h[`precipitation_${k}`]), 1) : '–'} mm</td></tr>`).join('')}
        </table></div><div class="muted" style="font-size:12px;margin-top:6px">Heure de ${hm(h.time[i])}. Un grand écart entre modèles = prévision incertaine.</div>`;
    } catch (e) { box.textContent = `Modèles indisponibles : ${e.message}`; }
  }
  async function chargerEnsemble() {
    const box = $('#fiabilite'); if (!box) return;
    try {
      const e = await getJson(`/api/ensemble?${QS}`), h = e.hourly;
      const i = Math.max(0, h.time.findIndex(t => t >= W.current.time.slice(0, 13) + ':00')), end = Math.min(i + 48, h.time.length);
      const t = C.bands(h, 'temperature_2m').slice(i, end), p = C.rainProb(h).slice(i, end);
      const blocs = [];
      for (let k = 0; k < p.length; k += 6) blocs.push([h.time[i + k], Math.max(...p.slice(k, k + 6).map(v => v ?? 0))]);
      const ecart = t.map(v => (v[0] == null ? 0 : v[2] - v[0])), moy = ecart.reduce((s, v) => s + v, 0) / (ecart.length || 1);
      box.classList.remove('muted');
      box.innerHTML = `${bandSvg('Température (10 %–90 % des membres, médiane)', t, '°C', '#ff9a4a')}
        <div class="muted" style="font-size:13px">Écart moyen entre membres : <b>${fmt(moy, 1)} °C</b> sur 48 h
        (${moy < 2 ? 'prévision fiable' : moy < 4 ? 'fiabilité moyenne' : 'prévision incertaine'}).</div>
        <div class="hours" style="margin-top:8px">${blocs.map(([tt, v]) => `<div>${esc(tt.slice(8, 10))}/${esc(tt.slice(5, 7))} ${esc(tt.slice(11, 13))} h<b>${fmt(v * 100)} %</b><span class="muted">pluie</span></div>`).join('')}</div>`;
    } catch (e) { box.textContent = `Ensemble indisponible : ${e.message}`; }
  }
  let ETAT = { radar: null, foudre: null };
  function renderSources() {
    const box = $('#sources'); if (!box) return;
    const line = (ok, name, txt) => `<div style="margin:4px 0"><span class="dot" style="background:${ok == null ? '#9e9e9e' : ok ? '#2ecc9a' : '#f44336'}"></span><b>${name}</b> <span class="muted">${esc(txt)}</span></div>`;
    const r = ETAT.radar, f = ETAT.foudre;
    box.innerHTML = line(!!W, 'Open-Meteo', W ? `OK · données de ${W.current.time.slice(11, 16)}` : 'indisponible') +
      line(W ? LPI.some(v => v != null) : null, 'LPI ICON-D2', LPI.some(v => v != null) ? 'disponible pour ce lieu' : 'hors domaine : score sans LPI') +
      line(r && !r.erreur, 'RainViewer', !r ? 'en attente (ouvrir Chasse orage)' : r.erreur || `OK · ${r.images.length} images, dernière à ${hhmm(r.images.at(-1) * 1000)}`) +
      line(f && f.connecte, 'Blitzortung', !f ? 'en attente (ouvrir Chasse orage)' : f.connecte ? `connecté · ${f.tampon} impacts mondiaux en mémoire` : `déconnecté${f.erreur ? ' · ' + f.erreur : ''}`);
  }

  // ---------- Vigilance indicative ----------
  const NIVEAUX = ['Vert', 'Jaune', 'Orange', 'Rouge'];
  function renderVigilance() {
    const d = W, today = d.current.time.slice(0, 10), v = C.vigilance(d.hourly, LPI, d.daily).slice(0, 3);
    const badge = ([n]) => `<span class="lvl lvl${n}">${NIVEAUX[n]}</span>`;
    $('#vigilance').innerHTML = `<h2>Vigilance · ${esc(SITE.nom)}</h2>
      <div class="card" style="border-color:#c0392b"><b>⚠️ Niveaux indicatifs calculés par nos seuils.</b>
        <div class="muted" style="font-size:13px">Ce n'est pas la vigilance officielle. Consultez <a href="https://vigilance.meteofrance.fr">vigilance.meteofrance.fr</a>.</div></div>
      <div class="card"><div class="vigi"><span class="head"></span><span class="head">⛈️ Orages</span><span class="head">🌬️ Vent</span><span class="head">🌧️ Pluie</span>
        ${v.map(j => `<b>${esc(dayLabel(j.jour, today))}</b>${badge(j.orages)}${badge(j.vent)}${badge(j.pluie)}
          <span></span><span class="muted" style="font-size:11px">score ${fmt(j.orages[1])} %</span><span class="muted" style="font-size:11px">${fmt(j.vent[1])} km/h</span><span class="muted" style="font-size:11px">${fmt(j.pluie[1], 1)} mm</span>`).join('')}
      </div></div>
      <div class="card muted" style="font-size:12px">Seuils jaune / orange / rouge : orages, score max du jour ≥ ${C.VIGI.orages.join(' / ')} % ;
        vent, rafales max ≥ ${C.VIGI.vent.join(' / ')} km/h ; pluie, cumul du jour ≥ ${C.VIGI.pluie.join(' / ')} mm.</div>`;
  }

  // ---------- Chasse orage ----------
  let STRIKES = [], decalage = 0;                    // décalage : horloge du serveur moins celle de l'appareil
  const maintenant = () => Date.now() + decalage;
  function renderStation() {
    if (!W || !$('#station')) return;
    const c = W.current, i = nowIdx(W), sc = riskScore(hourRisk(W.hourly, LPI, i)), lv = riskLevel(sc);
    $('#pill-risk').innerHTML = `☁️ Risque <b style="color:${lv.color}">${lv.label.toLowerCase()} ${sc} %</b>`;
    $('#station').innerHTML = `<div class="row"><b>📍 ${esc(SITE.nom)}</b><span class="muted">${hm(c.time)}</span><span class="tag" style="background:#10351f;color:${lv.color}">${sc} % ${lv.label}</span></div>
      <div class="chips" style="justify-content:flex-start;margin-top:6px"><span>🌡️ ${fmt(c.temperature_2m)}°</span><span>💨 ${fmt(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}</span>
      <span>🌬️ ${fmt(c.wind_gusts_10m)}</span><span>☁️ ${fmt(c.cloud_cover)} %</span><span>⚡ CAPE ${fmt(W.hourly.cape[i])}</span></div>`;
  }
  function makeMap(id, zoom) {
    const m = L.map(id, { center: [SITE.lat, SITE.lon], zoom, maxZoom: 13, zoomControl: false, preferCanvas: true });
    L.tileLayer('/tuiles/osm/{z}/{x}/{y}.png', { maxZoom: 13, className: 'fond-sombre',
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.circleMarker([SITE.lat, SITE.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2b8cff', fillOpacity: 1 }).bindTooltip(esc(SITE.nom)).addTo(m);
    return m;
  }
  const capeColor = v => (v == null ? null : v < 100 ? null : v < 500 ? '#2ecc9a' : v < 1000 ? '#ffd600' : v < 2000 ? '#ff9800' : '#f44336');

  async function initChasse() {
    const map = makeMap('map-chasse', 8);
    const gF = L.layerGroup().addTo(map), gC = L.layerGroup().addTo(map), gK = L.layerGroup();
    $('#legend').innerHTML = AGE_BANDS.slice(0, 5).map(b => `<span><span class="dot" style="background:${b[1]}"></span>${b[2]}</span>`).join('');
    // Ajouté à la carte à la première image connue : sans elle, Leaflet demanderait une adresse vide
    const rLayer = L.tileLayer('/tuiles/radar/0/{z}/{x}/{y}.png', { opacity: 0.7, zIndex: 2, maxNativeZoom: 7, maxZoom: 13,
      attribution: 'Radar : <a href="https://www.rainviewer.com">Rain Viewer</a>' });
    const layers = { foudre: gF, cellules: gC, radar: rLayer, cape: gK };
    const slider = $('#slider');
    let frames = [], times = [null], radarT = null;   // null : maintenant

    function show(k) {
      const T = times[k] ?? maintenant(), isNow = k >= times.length - 1;
      const f = frames[Math.min(k, frames.length - 1)];
      if (f != null && f !== radarT) {
        rLayer.setUrl(`/tuiles/radar/${f}/{z}/{x}/{y}.png`);
        if (radarT == null && $('[data-layer=radar]').classList.contains('on')) rLayer.addTo(map);
        radarT = f;
      }
      gF.clearLayers(); gC.clearLayers();
      const vis = C.visibleAt(STRIKES, T);
      vis.forEach(s => L.circleMarker([s.lat, s.lon], { radius: 4, weight: 1, color: '#fff', opacity: .8, fillColor: ageColor(s.age), fillOpacity: .95, interactive: false }).addTo(gF));
      const cl = C.cells(vis);
      cl.forEach(c => {
        const col = ageColor(c.age);
        L.circle([c.lat, c.lon], { radius: 12000, color: col, weight: 2, fillColor: col, fillOpacity: .08, interactive: false }).addTo(gC);
        L.marker([c.lat, c.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="cell-badge">${c.n}</div>`, iconSize: [22, 18] }) }).addTo(gC);
      });
      const n60 = vis.filter(s => s.age < 60), near = C.nearest(vis, SITE.lat, SITE.lon, 0, 60);
      $('#pill-flux').innerHTML = `⚡ <b>${n60.length}</b>/h &nbsp;☁️ <b>${cl.length}</b> &nbsp;<span style="color:#ff6b6b">${near ? fmt(near.km) + ' km ' + compass(near.bearing) : '–'}</span>`;
      $('#slider-time').textContent = isNow ? 'Maintenant' : hhmm(T);
      const ap = isNow ? C.approach(vis, SITE.lat, SITE.lon, R.seuils.approche) : null;
      $('#pill-approach').hidden = !ap;
      if (ap) $('#pill-approach').textContent = `⚠️ Orage à ${fmt(ap.km)} km (${compass(ap.bearing)}), il se rapproche`;
    }

    async function majRadar() {
      try {
        const r = await getJson('/api/radar');
        ETAT.radar = r;
        const auBout = +slider.value >= times.length - 1;
        frames = r.images; times = [...frames.map(t => t * 1000), null];
        slider.max = times.length - 1;
        if (auBout) slider.value = slider.max;
      } catch (e) { ETAT.radar = { erreur: e.message, images: [] }; banner(`Radar indisponible : ${e.message}`); }
      show(+slider.value);
    }
    async function majFoudre() {
      try {
        const f = await getJson(`/api/foudre?${QS}`);
        decalage = f.maintenant - Date.now(); STRIKES = f.impacts; ETAT.foudre = f.etat;
        const pf = $('#pill-foudre');
        pf.hidden = f.etat.connecte;
        pf.textContent = 'Foudre : flux Blitzortung déconnecté, nouvelle tentative en cours';
      } catch (e) { ETAT.foudre = { connecte: false, erreur: e.message }; }
      show(+slider.value); renderSources();
    }

    let grille = null;
    async function montrerCape() {
      gK.clearLayers();
      try {
        grille = grille || await getJson(`/api/grille?${QS}`);
      } catch (e) { banner(`Grille CAPE indisponible : ${e.message}`); return; }
      const ch = $('#cape-h'); ch.max = grille.time.length - 1;
      const k = Math.min(+ch.value, grille.time.length - 1), n = grille.lons.length;
      const dla = (grille.lats[1] - grille.lats[0]) / 2, dlo = (grille.lons[1] - grille.lons[0]) / 2;
      grille.cape[k].forEach((v, p) => {
        const col = capeColor(v), la = grille.lats[Math.floor(p / n)], lo = grille.lons[p % n];
        if (col) L.rectangle([[la - dla, lo - dlo], [la + dla, lo + dlo]], { stroke: false, fillColor: col, fillOpacity: .35, interactive: false }).addTo(gK);
      });
      $('#cape-time').textContent = `${grille.time[k].slice(11, 16)}${k ? ` (+${k} h)` : ''}`;
    }
    $('#cape-h').oninput = montrerCape;

    slider.oninput = () => show(+slider.value);
    let timer = null;
    $('#play').onclick = e => {
      if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶'; return; }
      e.target.textContent = '⏸';
      timer = setInterval(() => { slider.value = (+slider.value + 1) % times.length; show(+slider.value); }, 900);
    };
    document.querySelectorAll('.layers button').forEach(b => b.onclick = () => {
      const l = layers[b.dataset.layer];
      const on = b.classList.toggle('on'); b.setAttribute('aria-pressed', on);
      on ? l.addTo(map) : map.removeLayer(l);
      if (b.dataset.layer === 'cape') { $('#cape-player').hidden = !on; if (on) montrerCape(); }
    });
    renderStation();
    await Promise.all([majRadar(), majFoudre()]);
    setInterval(majFoudre, 60000);
    setInterval(majRadar, 5 * 60000);
    initChasse.map = map;
  }

  // ---------- Réglages ----------
  function initReglages() {
    $('#lieu-actuel').textContent = `Actuel : ${SITE.nom} (${fmt(SITE.lat, 3)} ; ${fmt(SITE.lon, 3)})`;
    const choisir = lieu => { R.lieu = lieu; ecrireReglages(); location.reload(); };
    $('#lieu-form').onsubmit = async ev => {
      ev.preventDefault();
      const res = $('#lieu-res'); res.textContent = 'Recherche…';
      try {
        const l = await getJson(`/api/lieux?q=${encodeURIComponent($('#lieu-q').value)}`);
        res.textContent = l.length ? '' : 'Aucun lieu trouvé.';
        l.forEach(x => {
          const b = document.createElement('button'); b.type = 'button';
          b.textContent = [x.nom, x.region, x.pays].filter(Boolean).join(', ');
          b.onclick = () => choisir({ nom: x.nom, lat: x.lat, lon: x.lon });
          res.append(b);
        });
      } catch (e) { res.textContent = `Recherche impossible : ${e.message}`; }
    };
    $('#lieu-defaut').onclick = () => choisir(PESSAC);
    const f = $('#seuils-form');
    const remplir = s => Object.keys(C.SEUILS).forEach(k => { f.elements[k].value = s[k]; });
    remplir(R.seuils);
    f.onsubmit = ev => {
      ev.preventDefault();
      Object.keys(C.SEUILS).forEach(k => { const v = parseFloat(f.elements[k].value); if (isFinite(v)) R.seuils[k] = v; });
      ecrireReglages(); banner('Seuils enregistrés.');
      if (W) { renderHome(); }
    };
    $('#seuils-defaut').onclick = () => { R.seuils = { ...C.SEUILS }; remplir(R.seuils); ecrireReglages(); if (W) renderHome(); };
  }

  // ---------- Navigation ----------
  const started = {};
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${b.dataset.view}`));
    const v = b.dataset.view;
    if (v === 'chasse' && !started.chasse) { started.chasse = true; initChasse(); }
    if (v === 'chasse' && initChasse.map) setTimeout(() => initChasse.map.invalidateSize(), 50);
    window.scrollTo(0, 0);
  });
  initReglages();
  charger();
  setInterval(charger, 10 * 60000);
})();
