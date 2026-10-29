// Fonctions pures de la page : navigateur (window.Calc) et Node (test/test_calc.js).
(function (root) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const RAD = Math.PI / 180;

  function haversineKm(lat1, lon1, lat2, lon2) {
    const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(d / 45) % 8];

  // Couleurs par ancienneté des impacts, comme la légende de la capture.
  const AGE_BANDS = [[5, '#e040fb', '< 5 min'], [15, '#f44336', '5-15 min'], [30, '#ff9800', '15-30 min'],
    [60, '#ffd600', '30-60 min'], [120, '#2196f3', '1-2 h'], [Infinity, '#9e9e9e', '> 2 h']];
  const ageColor = min => AGE_BANDS.find(b => min < b[0])[1];

  // Seuils par défaut (SPEC §4 bis), modifiables dans Réglages.
  // rayon : orage « actif proche » et alerte d'approche (km) ; pluie : pluies fortes (mm/h).
  const SEUILS = { cape: 500, li: -1, rafales: 60, lpi: 2, pluie: 10, rayon: 30 };

  // Heuristique (pas un modèle validé). Avec LPI : CAPE 36, LI 20, pluie 16, rafales 8, LPI 20.
  function riskScore({ cape = 0, li = 0, cin = 0, gust = 0, pop = 0, lpi = null }) {
    const k = lpi == null ? 1 : 0.8;
    let conv = (clamp(cape / 2000, 0, 1) * 45 + clamp(-li / 6, 0, 1) * 25) * k;
    if (cin > 150) conv *= 0.6; // forte inhibition : les orages démarrent plus difficilement
    const reste = (clamp((gust - 40) / 60, 0, 1) * 10 + clamp(pop, 0, 100) / 100 * 20) * k;
    return Math.round(clamp(conv + reste + (lpi == null ? 0 : clamp(lpi / 5, 0, 1) * 20), 0, 100));
  }
  function riskLevel(score) {
    if (score < 25) return { label: 'Faible', color: '#2ecc9a' };
    if (score < 50) return { label: 'Modéré', color: '#ffd600' };
    if (score < 75) return { label: 'Élevé', color: '#ff9800' };
    return { label: 'Très élevé', color: '#f44336' };
  }
  // LPI (heures ICON-D2) aligné sur les heures de la prévision : null là où il manque.
  function alignLpi(times, lpi) {
    if (!lpi) return times.map(() => null);
    const m = new Map(lpi.time.map((t, k) => [t, lpi.valeurs[k]]));
    return times.map(t => (m.has(t) ? m.get(t) : null));
  }
  const hourRisk = (h, lpi, i) => ({ cape: h.cape[i] ?? 0, li: h.lifted_index[i] ?? 0, cin: h.convective_inhibition[i] ?? 0,
    gust: h.wind_gusts_10m[i] ?? 0, pop: h.precipitation_probability[i] ?? 0, lpi: lpi[i] });

  function runs(flags) {
    const out = []; let s = -1;
    flags.forEach((f, i) => { if (f && s < 0) s = i; if (!f && s >= 0) { out.push([s, i - 1]); s = -1; } });
    if (s >= 0) out.push([s, flags.length - 1]);
    return out;
  }
  // Fenêtres d'alerte « Surveillance » sur les heures [from, to) d'un bloc hourly Open-Meteo.
  function alertWindows(h, lpi, from, to, seuils = SEUILS) {
    const idx = []; for (let i = from; i < to; i++) idx.push(i);
    const rules = [
      ['Orage probable', i => h.cape[i] >= seuils.cape && h.lifted_index[i] != null && h.lifted_index[i] <= seuils.li, i => h.cape[i],
        i => [`CAPE ${Math.round(h.cape[i])}`, `LI ${h.lifted_index[i].toFixed(1)}`,
          h.dew_point_2m?.[i] != null && `Td ${Math.round(h.dew_point_2m[i])}°`,
          h.precipitation_probability?.[i] != null && `pluie ${Math.round(h.precipitation_probability[i])} %`].filter(Boolean).join(' · ')],
      ['Pluies fortes', i => (h.precipitation?.[i] ?? 0) >= seuils.pluie, i => h.precipitation[i],
        i => `${h.precipitation[i].toFixed(1)} mm/h prévu`],
      ['Rafales fortes', i => h.wind_gusts_10m[i] >= seuils.rafales, i => h.wind_gusts_10m[i],
        i => `Rafales ${Math.round(h.wind_gusts_10m[i])} km/h`],
      ['Foudre probable', i => lpi[i] != null && lpi[i] >= seuils.lpi, i => lpi[i],
        i => `LPI ${lpi[i].toFixed(1)} J/kg (ICON-D2)`],
    ];
    const out = [];
    for (const [label, test, score, detail] of rules) {
      for (const [a, b] of runs(idx.map(test))) {
        let p = a; for (let k = a; k <= b; k++) if (score(idx[k]) > score(idx[p])) p = k;
        out.push({ label, start: idx[a], end: idx[b], peak: idx[p], detail: detail(idx[p]) });
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }

  // Vigilance INDICATIVE par jour (0 vert, 1 jaune, 2 orange, 3 rouge). Pas la vigilance officielle.
  const VIGI = { orages: [25, 50, 75], vent: [70, 90, 110], pluie: [20, 40, 80] };
  const niveau = (v, s) => (v >= s[2] ? 3 : v >= s[1] ? 2 : v >= s[0] ? 1 : 0);
  function vigilance(h, lpi, d) {
    return d.time.map((jour, k) => {
      let orage = 0;
      h.time.forEach((t, i) => { if (t.startsWith(jour)) orage = Math.max(orage, riskScore(hourRisk(h, lpi, i))); });
      const vent = d.wind_gusts_10m_max[k] ?? 0, pluie = d.precipitation_sum[k] ?? 0;
      return { jour, orages: [niveau(orage, VIGI.orages), orage], vent: [niveau(vent, VIGI.vent), vent],
        pluie: [niveau(pluie, VIGI.pluie), pluie] };
    });
  }

  // Ensemble : quantile des membres, heure par heure.
  function quantile(vals, q) {
    const v = vals.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const p = (v.length - 1) * q, lo = Math.floor(p);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (p - lo);
  }
  function members(hourly, name) {
    return Object.keys(hourly).filter(k => k === name || k.startsWith(name + '_member')).map(k => hourly[k]);
  }
  function bands(hourly, name) {
    const m = members(hourly, name);
    return hourly.time.map((_, i) => { const col = m.map(s => s[i]); return [quantile(col, 0.1), quantile(col, 0.5), quantile(col, 0.9)]; });
  }
  function rainProb(hourly, seuil = 0.1) {
    const m = members(hourly, 'precipitation');
    return hourly.time.map((_, i) => { const col = m.map(s => s[i]).filter(x => x != null); return col.length ? col.filter(x => x >= seuil).length / col.length : null; });
  }

  // Impacts [[t ms, lat, lon]] vus à l'instant tMs (fenêtre de 2 h), avec leur âge en minutes.
  const visibleAt = (strikes, tMs, windowMin = 120) => strikes
    .filter(s => s[0] <= tMs && tMs - s[0] < windowMin * 60000)
    .map(s => ({ t: s[0], lat: s[1], lon: s[2], age: (tMs - s[0]) / 60000 }));
  function nearest(list, lat, lon, minAge, maxAge) {
    let best = null;
    for (const s of list) {
      if (s.age < minAge || s.age > maxAge) continue;
      const km = haversineKm(lat, lon, s.lat, s.lon);
      if (!best || km < best.km) best = { km, bearing: bearingDeg(lat, lon, s.lat, s.lon) };
    }
    return best;
  }
  // Cellules actives : impacts de moins de maxAge min regroupés par carreaux d'environ 20 km.
  function cells(vis, maxAge = 30, min = 3) {
    const g = new Map();
    for (const s of vis) {
      if (s.age >= maxAge) continue;
      const k = `${Math.floor(s.lat / 0.2)}:${Math.floor(s.lon / 0.27)}`;
      const c = g.get(k) || { lat: 0, lon: 0, n: 0, age: Infinity };
      c.lat += s.lat; c.lon += s.lon; c.n++; c.age = Math.min(c.age, s.age); g.set(k, c);
    }
    return [...g.values()].filter(c => c.n >= min).map(c => ({ lat: c.lat / c.n, lon: c.lon / c.n, n: c.n, age: c.age }));
  }
  // Orage qui approche : impact récent (0-10 min) plus proche que ceux d'avant (20-40 min).
  function approach(vis, lat, lon, rayonKm) {
    const now = nearest(vis, lat, lon, 0, 10), before = nearest(vis, lat, lon, 20, 40);
    return now && before && now.km < rayonKm && now.km < before.km - 2 ? now : null;
  }

  function weatherLabel(code) {
    if (code === 0) return ['☀️', 'Ciel dégagé'];
    if (code === 1) return ['🌤️', 'Peu nuageux'];
    if (code === 2) return ['⛅', 'Partiellement nuageux'];
    if (code === 3) return ['☁️', 'Couvert'];
    if (code === 45 || code === 48) return ['🌫️', 'Brouillard'];
    if (code >= 51 && code <= 57) return ['🌦️', 'Bruine'];
    if (code >= 61 && code <= 67) return ['🌧️', 'Pluie'];
    if (code >= 71 && code <= 77) return ['🌨️', 'Neige'];
    if (code >= 80 && code <= 82) return ['🌦️', 'Averses'];
    if (code === 85 || code === 86) return ['🌨️', 'Averses de neige'];
    if (code === 95) return ['⛈️', 'Orage'];
    if (code === 96 || code === 99) return ['⛈️', 'Orage avec grêle'];
    return ['❔', 'Inconnu'];
  }

  // « dans 10 heures » ; « en cours » si c'est commencé.
  function dans(ms) {
    if (ms <= 0) return 'en cours';
    const m = Math.round(ms / 60000);
    if (m < 60) return `dans ${m} minute${m > 1 ? 's' : ''}`;
    const h = Math.round(m / 60);
    if (h < 24) return `dans ${h} heure${h > 1 ? 's' : ''}`;
    const j = Math.round(h / 24);
    return `dans ${j} jour${j > 1 ? 's' : ''}`;
  }

  // Activité électrique réelle autour du lieu sur la dernière heure : « actif » sous le rayon, « régional » sous 150 km.
  function activite(vis, lat, lon, rayon) {
    let proche = 0, region = 0, best = null;
    for (const s of vis) {
      if (s.age > 60) continue;
      const km = haversineKm(lat, lon, s.lat, s.lon);
      if (km <= rayon) proche++;
      if (km <= 150) { region++; if (!best || km < best) best = km; }
    }
    if (proche) return { niveau: 'actif', n: proche, km: best, rayon };
    if (region) return { niveau: 'regional', n: region, km: best, rayon: 150 };
    return null;
  }

  // ---- Indices d'orage à partir des niveaux de pression (approximations, voir SPEC §4 bis) ----
  // Niveaux : 10 m, 925 hPa (~0,8 km), 850 (~1,5 km), 700 (~3 km), 500 hPa (~5,5 km, pris pour 6 km).
  const NIV = [['wind_speed_10m', 'wind_direction_10m'], ['wind_speed_925hPa', 'wind_direction_925hPa'],
    ['wind_speed_850hPa', 'wind_direction_850hPa'], ['wind_speed_700hPa', 'wind_direction_700hPa'],
    ['wind_speed_500hPa', 'wind_direction_500hPa']];
  // Vent qui VIENT de dir (météo) -> composantes u, v en m/s
  const vec = (kmh, dir) => [-kmh / 3.6 * Math.sin(dir * RAD), -kmh / 3.6 * Math.cos(dir * RAD)];
  function indices(h, i) {
    const g = k => h[k]?.[i];
    const T850 = g('temperature_850hPa'), Td850 = g('dew_point_850hPa'), T700 = g('temperature_700hPa'),
      Td700 = g('dew_point_700hPa'), T500 = g('temperature_500hPa'), T2 = g('temperature_2m'), Td2 = g('dew_point_2m');
    const lv = NIV.map(([s, d]) => (g(s) == null || g(d) == null ? null : vec(g(s), g(d))));
    if ([T850, Td850, T700, Td700, T500, T2, Td2].some(v => v == null) || lv.includes(null)) return null;
    const ecart = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sh1 = ecart(lv[0], lv[1]), sh3 = ecart(lv[0], lv[3]), sh6 = ecart(lv[0], lv[4]);
    // Mouvement de la cellule (Bunkers, cellule droite) : vent moyen 0-6 km + 7,5 m/s à droite du cisaillement
    const moy = [0, 1].map(c => lv.reduce((s, v) => s + v[c], 0) / lv.length);
    const sx = lv[4][0] - lv[0][0], sy = lv[4][1] - lv[0][1], n = Math.hypot(sx, sy) || 1;
    const cm = [moy[0] + 7.5 * sy / n, moy[1] - 7.5 * sx / n];
    const srh = l => { let s = 0; for (let k = 0; k < l.length - 1; k++) { const a = l[k], b = l[k + 1];
      s += (b[0] - cm[0]) * (a[1] - cm[1]) - (a[0] - cm[0]) * (b[1] - cm[1]); } return s; };
    const SRH1 = srh(lv.slice(0, 2)), SRH3 = srh(lv.slice(0, 4));
    const cape = g('cape') ?? 0, cin = g('convective_inhibition') ?? 0, LCL = Math.max(0, 125 * (T2 - Td2));
    return {
      K: T850 - T500 + Td850 - (T700 - Td700), TT: T850 + Td850 - 2 * T500, LCL,
      sh1: sh1 * 3.6, sh3: sh3 * 3.6, sh6: sh6 * 3.6, SRH1, SRH3, cape, cin, li: g('lifted_index'),
      iso0: g('freezing_level_height'), rafales: g('wind_gusts_10m'),
      SCP: cape / 1000 * Math.max(0, SRH3) / 50 * (sh6 < 10 ? 0 : Math.min(sh6 / 20, 1)),
      STP: cape / 1500 * clamp((2000 - LCL) / 1000, 0, 1) * Math.max(0, SRH1) / 150 *
        (sh6 < 12.5 ? 0 : Math.min(sh6 / 20, 1.5)) * clamp((200 - cin) / 150, 0, 1),
      EHI: cape * Math.max(0, SRH3) / 160000,
    };
  }
  const LECTURE = {
    K: v => (v >= 40 ? 'Orages violents très probables' : v >= 35 ? 'Orages forts probables' : v >= 30 ? 'Orages probables' : v >= 25 ? 'Orages isolés possibles' : 'Orages peu probables'),
    TT: v => (v >= 55 ? 'Orages forts' : v >= 50 ? 'Orages probables' : v >= 44 ? 'Orages isolés possibles' : 'Peu favorable'),
    SCP: v => (v >= 1 ? 'Supercellule possible' : 'Pas supercellulaire'),
    STP: v => (v >= 1 ? 'Tornade significative possible' : 'Pas tornadique'),
    EHI: v => (v >= 1 ? 'Favorable aux tornades' : 'Pas favorable'),
    LCL: v => (v < 1000 ? 'Très bas (tornadique)' : v < 1500 ? 'Bas' : 'Élevé'),
  };
  function typeOrage(x) {
    if (!x || x.cape < 300) return ['Pas d\'orage organisé', 'Énergie trop faible pour des orages notables.'];
    const s = x.sh6 / 3.6;
    if (s < 10) return ['Unicellulaire', 'Orages isolés de courte durée, peu organisés.'];
    if (s < 18) return ['Multicellulaire', 'Groupes de cellules se régénérant, durée prolongée.'];
    if (x.SCP >= 1) return ['Supercellulaire possible', 'Cisaillement et hélicité suffisants pour des cellules tournantes.'];
    return ['Orage organisé', 'Convection bien structurée, cisaillement modéré.'];
  }
  // Probabilités heuristiques (pas un modèle validé), en %.
  function risques(x, lpi) {
    const p = v => Math.round(clamp(v, 0, 1) * 100), conv = clamp(x.cape / 1500, 0, 1), s6 = x.sh6 / 3.6;
    return [
      ['Grêle', p(conv * (0.4 + 0.4 * clamp((s6 - 10) / 15, 0, 1) + (x.iso0 != null && x.iso0 < 3500 ? 0.2 : 0)))],
      ['Vents violents', p(Math.max(clamp(((x.rafales ?? 0) - 60) / 50, 0, 1), conv * clamp((s6 - 12) / 15, 0, 1)))],
      ['Tornade', p(clamp(x.STP / 2, 0, 1) * 0.6 + conv * clamp((1200 - x.LCL) / 1000, 0, 1) * clamp(x.SRH1 / 150, 0, 1) * 0.4)],
      ['Foudre', p(lpi != null ? lpi / 3 : conv * clamp(-(x.li ?? 0) / 4, 0, 1))],
    ];
  }
  const niveauRisque = pc => (pc < 15 ? 'Faible' : pc < 40 ? 'Modéré' : pc < 70 ? 'Élevé' : 'Très élevé');

  // ---- Isobares : lignes de niveau sur la grille (carrés marchants) ----
  // vals[i * n + j] (i : latitude, j : longitude) -> segments [[lat, lon], [lat, lon]] au niveau donné.
  function isolignes(vals, lats, lons, niveau) {
    const n = lons.length, segs = [], V = (i, j) => vals[i * n + j];
    for (let i = 0; i < lats.length - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const coins = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], pts = [];
        for (let e = 0; e < 4; e++) {
          const [ia, ja] = coins[e], [ib, jb] = coins[(e + 1) % 4], a = V(ia, ja), b = V(ib, jb);
          if (a == null || b == null || (a < niveau) === (b < niveau)) continue;
          const t = (niveau - a) / (b - a);
          pts.push([lats[ia] + (lats[ib] - lats[ia]) * t, lons[ja] + (lons[jb] - lons[ja]) * t]);
        }
        if (pts.length === 2) segs.push(pts);
        else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);   // col : coupe arbitraire
      }
    }
    return segs;
  }
  // Niveaux ronds : tous les 1 hPa sur une petite zone calme, 2 ou 4 hPa si la pression varie plus.
  function niveauxIso(vals) {
    const v = vals.filter(x => x != null);
    if (!v.length) return [];
    const mn = Math.min(...v), mx = Math.max(...v), pas = mx - mn <= 4 ? 1 : mx - mn <= 12 ? 2 : 4, out = [];
    for (let x = Math.ceil(mn / pas) * pas; x <= mx; x += pas) out.push(x);
    return out;
  }

  const api = { clamp, haversineKm, bearingDeg, compass, AGE_BANDS, ageColor, SEUILS, riskScore, riskLevel,
    alignLpi, hourRisk, alertWindows, VIGI, vigilance, quantile, bands, rainProb, visibleAt, nearest, cells,
    approach, weatherLabel, dans, activite, indices, LECTURE, typeOrage, risques, niveauRisque, isolignes, niveauxIso };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
