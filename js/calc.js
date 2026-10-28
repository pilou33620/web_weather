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
  const SEUILS = { cape: 500, li: -1, rafales: 60, lpi: 2, approche: 60 };

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
      ['Orage probable', i => h.cape[i] >= seuils.cape && h.lifted_index[i] <= seuils.li, i => h.cape[i],
        i => `CAPE ${Math.round(h.cape[i])} · LI ${h.lifted_index[i].toFixed(1)}`],
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

  const api = { clamp, haversineKm, bearingDeg, compass, AGE_BANDS, ageColor, SEUILS, riskScore, riskLevel,
    alignLpi, hourRisk, alertWindows, VIGI, vigilance, quantile, bands, rainProb, visibleAt, nearest, cells,
    approach, weatherLabel };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
