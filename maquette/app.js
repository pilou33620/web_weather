(() => {
  const { haversineKm, compass, AGE_BANDS, ageColor, riskScore, riskLevel, alertWindows, weatherLabel,
    CELLS, cellPos, offset, simulateStrikes, visibleAt, nearest } = Calc;

  const SITE = { name: 'Pessac (33)', lat: 44.80565, lon: -0.6324 };
  const OM = 'https://api.open-meteo.com/v1/forecast';
  const RV = 'https://api.rainviewer.com/public/weather-maps.json';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const BASE = ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const LABELS = ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
  const CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,precipitation';
  const HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,cape,lifted_index,convective_inhibition,freezing_level_height,uv_index,visibility';
  const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max';

  const $ = s => document.querySelector(s);
  const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));
  const hhmm = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const banner = msg => { const b = $('#banner'); b.textContent = msg; b.hidden = false; setTimeout(() => { b.hidden = true; }, 8000); };

  // ---------- Données ----------
  let W = null;
  const STRIKES = simulateStrikes(SITE.lat, SITE.lon, Date.now());

  async function getJson(url, nom) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${nom} : HTTP ${r.status}`);
    return r.json();
  }
  const weatherReady = getJson(`${OM}?${new URLSearchParams({
    latitude: SITE.lat, longitude: SITE.lon, timezone: 'Europe/Paris', forecast_days: 7,
    wind_speed_unit: 'kmh', current: CURRENT, hourly: HOURLY, daily: DAILY })}`, 'Open-Meteo')
    .then(d => { W = d; renderHome(d); renderTech(d); return d; });
  weatherReady.catch(e => { banner(`Météo indisponible : ${e.message}`); $('#home').textContent = 'Météo indisponible.'; $('#tech').textContent = 'Météo indisponible.'; });

  let radarP = null;
  const loadRadar = () => radarP || (radarP = getJson(RV, 'RainViewer').then(j => ({ host: j.host, frames: j.radar.past })));
  const radarUrl = (r, f) => `${r.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
  const RADAR_OPTS = { opacity: 0.7, zIndex: 2, maxNativeZoom: 7, maxZoom: 12,
    attribution: 'Radar : <a href="https://www.rainviewer.com">Rain Viewer</a>' };

  const nowIdx = d => d.hourly.time.findIndex(t => t >= d.current.time.slice(0, 13) + ':00');
  const hourRisk = (h, i) => ({ cape: h.cape[i], li: h.lifted_index[i], cin: h.convective_inhibition[i],
    gust: h.wind_gusts_10m[i], pop: h.precipitation_probability[i] });
  function dayLabel(t, today) {
    if (t.slice(0, 10) === today) return 'auj.';
    const dt = new Date(t.slice(0, 10) + 'T12:00'), ref = new Date(today + 'T12:00');
    if (dt - ref === 86400000) return 'dem.';
    return dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ---------- Accueil ----------
  function renderHome(d) {
    const c = d.current, h = d.hourly, dd = d.daily, i = nowIdx(d), today = c.time.slice(0, 10);
    const [icon, label] = weatherLabel(c.weather_code);
    let peak = { s: -1, i }; const scores = [];
    for (let k = i; k < Math.min(i + 24, h.time.length); k++) { const s = riskScore(hourRisk(h, k)); scores.push(s); if (s > peak.s) peak = { s, i: k }; }
    const now = scores[0], lv = riskLevel(now), pk = riskLevel(peak.s);
    const alerts = alertWindows(h, i, Math.min(i + 48, h.time.length));
    const gmin = Math.min(...dd.temperature_2m_min), gmax = Math.max(...dd.temperature_2m_max);

    $('#home').innerHTML = `
      <div class="hero">
        <div class="muted">📍 ${SITE.name}</div>
        <div class="temp">${fmt(c.temperature_2m)}°</div>
        <div class="desc">${icon} ${label} · Ressenti ${fmt(c.apparent_temperature)}°</div>
        <div class="chips"><span>💨 ${fmt(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}</span>
          <span>🌬️ rafales ${fmt(c.wind_gusts_10m)}</span><span>💧 ${fmt(c.relative_humidity_2m)} %</span><span>☁️ ${fmt(c.cloud_cover)} %</span></div>
      </div>
      <div class="card"><h3>Risque d'orage <span class="muted">(indicatif)</span></h3>
        <div class="risk"><div class="big" style="color:${lv.color}">${now} %</div>
          <div style="flex:1"><div class="bar"><span style="width:${now}%;background:${lv.color}"></span></div>
            <div class="muted" style="margin-top:6px;font-size:13px">${lv.label} maintenant · pic <b style="color:${pk.color}">${peak.s} %</b> (${pk.label}) à ${h.time[peak.i].slice(11, 16)}</div></div></div>
      </div>
      <div class="card"><h3>✨ Prochaines alertes probables <span class="tag">${alerts.length}</span></h3>
        ${alerts.length ? alerts.map(a => `<div class="alert-row"><div class="row"><b>${a.label}</b><span class="tag">Surveillance</span>
          <span style="margin-left:auto">${dayLabel(h.time[a.start], today)} ${h.time[a.start].slice(11, 16)}–${(h.time[a.end + 1] || h.time[a.end]).slice(11, 16)}</span></div>
          <div class="muted" style="font-size:13px">pic ${h.time[a.peak].slice(11, 16)} · ${a.detail}</div></div>`).join('')
          : '<div class="muted">Aucune alerte dans les 48 prochaines heures.</div>'}
        <div class="muted" style="font-size:12px;margin-top:8px">Seuils de la maquette : CAPE ≥ 500 et LI ≤ -1 ; rafales ≥ 60 km/h.</div>
      </div>
      <div class="card"><h3>Prochaines heures</h3><div class="hours">${Array.from({ length: 12 }, (_, k) => {
        const j = i + k; if (j >= h.time.length) return '';
        return `<div>${h.time[j].slice(11, 13)} h<span style="display:block;font-size:20px">${weatherLabel(h.weather_code[j])[0]}</span><b>${fmt(h.temperature_2m[j])}°</b><span class="muted">${fmt(h.precipitation_probability[j])} %</span></div>`;
      }).join('')}</div></div>
      <div class="card"><h3>Sur 7 jours</h3>${dd.time.map((t, k) => `<div class="day">
        <div class="row"><span style="width:78px">${dayLabel(t, today)}</span><span>${weatherLabel(dd.weather_code[k])[0]}</span>
          <span class="muted" style="width:44px">${fmt(dd.precipitation_probability_max[k])} %</span><span>${fmt(dd.temperature_2m_min[k])}°</span>
          <div class="range"><span style="left:${(dd.temperature_2m_min[k] - gmin) / (gmax - gmin || 1) * 100}%;right:${100 - (dd.temperature_2m_max[k] - gmin) / (gmax - gmin || 1) * 100}%"></span></div>
          <span>${fmt(dd.temperature_2m_max[k])}°</span></div>
        <div class="sub">💧 ${fmt(dd.precipitation_sum[k], 1)} mm · ☀️ UV ${fmt(dd.uv_index_max[k])} · 🌬️ rafales ${fmt(dd.wind_gusts_10m_max[k])} · 🌅 ${dd.sunrise[k].slice(11)}→${dd.sunset[k].slice(11)}</div></div>`).join('')}</div>`;
  }

  // ---------- Technique ----------
  function spark(title, vals, unit, color, dec = 0) {
    const w = 300, ht = 54, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = vals.map((v, k) => `${(k / (vals.length - 1) * w).toFixed(1)},${(ht - 4 - (v - min) / span * (ht - 8)).toFixed(1)}`).join(' ');
    return `<div class="spark"><div class="spark-h"><b>${title}</b><span>min ${fmt(min, dec)} · max ${fmt(max, dec)} ${unit}</span></div>
      <svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>`;
  }
  function renderTech(d) {
    const c = d.current, h = d.hourly, i = nowIdx(d), end = Math.min(i + 48, h.time.length);
    const at = k => h[k][i], sl = k => h[k].slice(i, end);
    const tiles = [
      ['CAPE', at('cape'), 'J/kg', 0, 'Énergie disponible pour les orages. Repère courant : plus de 1000 = orages forts possibles'],
      ['Lifted Index', at('lifted_index'), '', 1, 'Négatif = atmosphère instable'],
      ['CIN', at('convective_inhibition'), 'J/kg', 0, 'Frein au déclenchement des orages'],
      ['Isotherme 0 °C', at('freezing_level_height'), 'm', 0, 'Altitude où la température passe à 0 °C'],
      ['Rafales', at('wind_gusts_10m'), 'km/h', 0, 'À 10 m du sol'],
      ['Pression', at('pressure_msl'), 'hPa', 0, 'Niveau de la mer'],
      ['Point de rosée', at('dew_point_2m'), '°C', 1, 'Plus il est proche de la température, plus l\'air est humide'],
      ['Visibilité', at('visibility') / 1000, 'km', 1, ''],
      ['Indice UV', at('uv_index'), '', 1, ''],
      ['Nuages', at('cloud_cover'), '%', 0, ''],
      ['Humidité', at('relative_humidity_2m'), '%', 0, ''],
      ['Probabilité de pluie', at('precipitation_probability'), '%', 0, ''],
    ];
    const rows = Array.from({ length: Math.min(24, h.time.length - i) }, (_, k) => {
      const j = i + k;
      return `<tr><td>${h.time[j].slice(11, 16)}</td><td>${fmt(h.temperature_2m[j], 1)}</td><td>${fmt(h.precipitation[j], 1)}</td><td>${fmt(h.cape[j])}</td><td>${fmt(h.lifted_index[j], 1)}</td><td>${fmt(h.wind_gusts_10m[j])}</td><td>${fmt(h.pressure_msl[j])}</td></tr>`;
    }).join('');
    $('#tech').innerHTML = `
      <h2>Données techniques · ${SITE.name}</h2>
      <div class="muted" style="margin:-6px 0 10px;font-size:12px">Heure de ${c.time.slice(11, 16)} · altitude ${fmt(d.elevation)} m · ${SITE.lat.toFixed(4)} ; ${SITE.lon.toFixed(4)}</div>
      <div class="tiles">${tiles.map(([k, v, u, dec, hint]) => `<div class="tile"><div class="k">${k}</div><div class="v">${fmt(v, dec)} <small>${u}</small></div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`).join('')}</div>
      <div class="card"><h3>48 prochaines heures</h3>
        ${spark('Température', sl('temperature_2m'), '°C', '#ff9a4a', 1)}${spark('CAPE', sl('cape'), 'J/kg', '#ffd600')}
        ${spark('Lifted Index', sl('lifted_index'), '', '#b57cff', 1)}${spark('Rafales', sl('wind_gusts_10m'), 'km/h', '#2ecc9a')}
        ${spark('Précipitations', sl('precipitation'), 'mm', '#2b8cff', 1)}${spark('Pression', sl('pressure_msl'), 'hPa', '#9aa7c2')}</div>
      <div class="card"><h3>Tableau horaire (24 h)</h3><div class="tablewrap"><table>
        <tr><th>Heure</th><th>T °C</th><th>Pluie mm</th><th>CAPE</th><th>LI</th><th>Rafales</th><th>hPa</th></tr>${rows}</table></div></div>
      <div class="card"><h3>Sources et état</h3><div id="sources"></div></div>`;
    updateSources();
  }
  async function updateSources() {
    const box = $('#sources'); if (!box) return;
    const line = (color, name, txt) => `<div style="margin:4px 0"><span class="dot" style="background:${color}"></span><b>${name}</b> <span class="muted">${txt}</span></div>`;
    const om = W ? line('#2ecc9a', 'Open-Meteo', `OK · données de ${W.current.time.slice(11, 16)}`) : line('#f44336', 'Open-Meteo', 'indisponible');
    box.innerHTML = om + line('#9e9e9e', 'RainViewer', 'chargement…') + line('#ffd600', 'Blitzortung', 'non connecté : foudre simulée dans la maquette');
    try {
      const r = await loadRadar(), last = r.frames.at(-1).time * 1000;
      box.innerHTML = om + line('#2ecc9a', 'RainViewer', `OK · ${r.frames.length} images, dernière il y a ${Math.round((Date.now() - last) / 60000)} min`) + line('#ffd600', 'Blitzortung', 'non connecté : foudre simulée dans la maquette');
    } catch (e) {
      box.innerHTML = om + line('#f44336', 'RainViewer', e.message) + line('#ffd600', 'Blitzortung', 'non connecté : foudre simulée dans la maquette');
    }
  }

  // ---------- Cartes ----------
  function makeMap(id, zoom) {
    const m = L.map(id, { center: [SITE.lat, SITE.lon], zoom, zoomControl: false, preferCanvas: true });
    L.tileLayer(BASE, { maxZoom: 12, attribution: 'Fond : Esri, HERE, Garmin, © OpenStreetMap contributors' }).addTo(m);
    L.tileLayer(LABELS, { maxZoom: 12, zIndex: 3, opacity: 0.85 }).addTo(m); // noms de lieux au-dessus du radar
    m.attributionControl.setPrefix(false);
    L.circleMarker([SITE.lat, SITE.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2b8cff', fillOpacity: 1 }).bindTooltip(SITE.name).addTo(m);
    return m;
  }
  const badge = (la, lo, n) => L.marker([la, lo], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="cell-badge">${n}</div>`, iconSize: [22, 18] }) });

  // Dessine impacts + cellules à l'instant tMs ; renvoie les statistiques.
  function drawStrikes(g, gc, tMs, nowMs, opts = {}) {
    g.clearLayers(); gc.clearLayers();
    const vis = visibleAt(STRIKES, tMs);
    vis.forEach(s => L.circleMarker([s.lat, s.lon], { radius: opts.radius || 4, weight: 1, color: '#fff', opacity: .8, fillColor: ageColor(s.age), fillOpacity: .95, interactive: false }).addTo(g));
    let cells = 0;
    CELLS.forEach((c, ci) => {
      const mine = vis.filter(s => s.cell === ci && s.age < 30);
      if (!mine.length) return;
      cells++;
      const p = cellPos(c, (nowMs - tMs) / 60000), [la, lo] = offset(SITE.lat, SITE.lon, p.x, p.y);
      const col = ageColor(Math.min(...mine.map(s => s.age)));
      L.circle([la, lo], { radius: 15000, color: col, weight: 2, fillColor: col, fillOpacity: .08, interactive: false }).addTo(gc);
      badge(la, lo, mine.length).addTo(gc);
    });
    return { vis, cells };
  }

  let radarFrame = -1;
  async function initChasse() {
    const map = makeMap('map-chasse', 7);
    const gF = L.layerGroup().addTo(map), gC = L.layerGroup().addTo(map);
    $('#legend').innerHTML = AGE_BANDS.map(b => `<span><span class="dot" style="background:${b[1]}"></span>${b[2]}</span>`).join('');
    let radar = null, rLayer = null;
    try {
      radar = await loadRadar();
      rLayer = L.tileLayer(radarUrl(radar, radar.frames.at(-1)), RADAR_OPTS).addTo(map);
    } catch (e) { banner(`Radar indisponible : ${e.message}`); }
    const frames = radar ? radar.frames : [], nowMs = Date.now();
    const times = [...frames.map(f => f.time * 1000), nowMs];
    const slider = $('#slider'); slider.max = times.length - 1; slider.value = slider.max;
    const layers = { foudre: gF, cellules: gC, radar: rLayer };

    function show(k) {
      const T = times[k], isNow = k === times.length - 1;
      const fi = Math.min(k, frames.length - 1);
      if (rLayer && fi !== radarFrame) { rLayer.setUrl(radarUrl(radar, frames[fi])); radarFrame = fi; }
      const { vis, cells } = drawStrikes(gF, gC, T, nowMs);
      const n60 = vis.filter(s => s.age < 60), near = nearest(vis, SITE.lat, SITE.lon, 0, 60);
      $('#pill-flux').innerHTML = `⚡ <b>${n60.length}</b> &nbsp;☁️ <b>${cells}</b> &nbsp;<span style="color:#ff6b6b">${near ? fmt(near.km) + ' km' : '–'}</span>`;
      $('#slider-time').textContent = isNow ? 'Maintenant' : hhmm(T);
      const ap = $('#pill-approach'), now = nearest(vis, SITE.lat, SITE.lon, 0, 10), before = nearest(vis, SITE.lat, SITE.lon, 20, 40);
      ap.hidden = !(isNow && now && before && now.km < 60 && now.km < before.km - 2);
      if (!ap.hidden) ap.textContent = `⚠️ Orage à ${fmt(now.km)} km (${compass(now.bearing)}), il se rapproche`;
    }
    slider.oninput = () => show(+slider.value);
    let timer = null;
    $('#play').onclick = e => {
      if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶'; return; }
      e.target.textContent = '⏸';
      timer = setInterval(() => { slider.value = (+slider.value + 1) % times.length; show(+slider.value); }, 900);
    };
    document.querySelectorAll('.layers button').forEach(b => b.onclick = () => {
      const l = layers[b.dataset.layer]; if (!l) return;
      const on = b.classList.toggle('on'); on ? l.addTo(map) : map.removeLayer(l);
    });
    show(times.length - 1);
    initChasse.map = map;

    weatherReady.then(d => {
      const c = d.current, i = nowIdx(d), sc = riskScore(hourRisk(d.hourly, i)), lv = riskLevel(sc);
      $('#pill-risk').innerHTML = `☁️ Risque <b style="color:${lv.color}">${lv.label.toLowerCase()} ${sc} %</b>`;
      $('#station').innerHTML = `<div class="row"><b>📍 ${SITE.name}</b><span class="muted">${c.time.slice(11, 16)}</span><span class="tag" style="background:#10351f;color:${lv.color}">${sc} % ${lv.label}</span></div>
        <div class="chips" style="justify-content:flex-start;margin-top:6px"><span>🌡️ ${fmt(c.temperature_2m)}°</span><span>💨 ${fmt(c.wind_speed_10m)} ${compass(c.wind_direction_10m)}</span>
        <span>🌬️ ${fmt(c.wind_gusts_10m)}</span><span>☁️ ${fmt(c.cloud_cover)} %</span><span>⚡ CAPE ${fmt(d.hourly.cape[i])}</span></div>`;
    }).catch(() => { $('#pill-risk').textContent = 'Risque : indisponible'; });
  }

  async function capeGrid() {
    const KEY = 'wm-capegrid-v1', cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.t < 15 * 60000) return cached.pts;
    const pts = [];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) pts.push([SITE.lat + a * 0.5, SITE.lon + b * 0.7]);
    const q = new URLSearchParams({ latitude: pts.map(p => p[0].toFixed(3)).join(','), longitude: pts.map(p => p[1].toFixed(3)).join(','), current: 'cape,lifted_index', timezone: 'Europe/Paris' });
    const j = await getJson(`${OM}?${q}`, 'Open-Meteo (grille)');
    const out = j.map(o => ({ lat: o.latitude, lon: o.longitude, cape: o.current.cape, li: o.current.lifted_index }));
    sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), pts: out }));
    return out;
  }
  const capeColor = v => v < 100 ? '#6f8fbf' : v < 500 ? '#2ecc9a' : v < 1000 ? '#ffd600' : v < 2000 ? '#ff9800' : '#f44336';

  async function initCartes() {
    const nowMs = Date.now();
    const mp = makeMap('map-pluie', 7), mf = makeMap('map-foudre', 8), mc = makeMap('map-cape', 7);
    initCartes.maps = [mp, mf, mc];
    try {
      const r = await loadRadar(), f = r.frames.at(-1);
      L.tileLayer(radarUrl(r, f), RADAR_OPTS).addTo(mp);
      $('#hint-pluie').textContent = `Dernière image radar : ${hhmm(f.time * 1000)} (il y a ${Math.round((nowMs - f.time * 1000) / 60000)} min). Source : Rain Viewer.`;
    } catch (e) { $('#hint-pluie').textContent = `Radar indisponible : ${e.message}`; }

    const gF = L.layerGroup().addTo(mf), gC = L.layerGroup().addTo(mf);
    const { vis, cells } = drawStrikes(gF, gC, nowMs, nowMs, { radius: 3 });
    mf.fitBounds(L.latLngBounds([[SITE.lat, SITE.lon], ...vis.map(s => [s.lat, s.lon])]), { padding: [16, 16] });
    $('#hint-foudre').textContent = `${vis.length} impacts simulés sur 2 h, ${cells} cellules actives. Couleur = ancienneté (< 5 min violet, > 1 h bleu). Données simulées.`;

    try {
      const pts = await capeGrid();
      pts.forEach(p => L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="cape" style="background:${capeColor(p.cape)}">${Math.round(p.cape)}</span>`, iconSize: [40, 22] }) }).addTo(mc));
      mc.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lon])), { padding: [24, 16] });
      $('#hint-cape').textContent = `CAPE actuelle en J/kg sur ${pts.length} points (vert 100-500, jaune 500-1000, orange 1000-2000, rouge > 2000). 25 appels Open-Meteo, gardés 15 min.`;
    } catch (e) { $('#hint-cape').textContent = `Grille indisponible : ${e.message}`; }
  }

  // ---------- Navigation ----------
  const started = {};
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${b.dataset.view}`));
    const v = b.dataset.view;
    if (v === 'chasse' && !started.chasse) { started.chasse = true; initChasse(); }
    if (v === 'cartes' && !started.cartes) { started.cartes = true; initCartes(); }
    setTimeout(() => { (initChasse.map && v === 'chasse' ? [initChasse.map] : v === 'cartes' ? initCartes.maps || [] : []).forEach(m => m.invalidateSize()); }, 50);
    window.scrollTo(0, 0);
  });
})();
