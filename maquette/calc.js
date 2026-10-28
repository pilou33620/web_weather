// Fonctions pures de la maquette : navigateur (window.Calc) et Node (test_calc.js).
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

  // Heuristique de la maquette (pas un modèle validé) : CAPE, LI, CIN, rafales, probabilité de pluie.
  function riskScore({ cape = 0, li = 0, cin = 0, gust = 0, pop = 0 }) {
    let conv = clamp(cape / 2000, 0, 1) * 45 + clamp(-li / 6, 0, 1) * 25;
    if (cin > 150) conv *= 0.6; // forte inhibition : les orages démarrent plus difficilement
    return Math.round(clamp(conv + clamp((gust - 40) / 60, 0, 1) * 10 + clamp(pop, 0, 100) / 100 * 20, 0, 100));
  }
  function riskLevel(score) {
    if (score < 25) return { label: 'Faible', color: '#2ecc9a' };
    if (score < 50) return { label: 'Modéré', color: '#ffd600' };
    if (score < 75) return { label: 'Élevé', color: '#ff9800' };
    return { label: 'Très élevé', color: '#f44336' };
  }

  function runs(flags) {
    const out = []; let s = -1;
    flags.forEach((f, i) => { if (f && s < 0) s = i; if (!f && s >= 0) { out.push([s, i - 1]); s = -1; } });
    if (s >= 0) out.push([s, flags.length - 1]);
    return out;
  }
  // Fenêtres d'alerte « Surveillance » sur les heures [from, to) d'un bloc hourly Open-Meteo.
  function alertWindows(h, from, to) {
    const idx = []; for (let i = from; i < to; i++) idx.push(i);
    const rules = [
      ['Orage probable', i => h.cape[i] >= 500 && h.lifted_index[i] <= -1, i => h.cape[i],
        i => `CAPE ${Math.round(h.cape[i])} · LI ${h.lifted_index[i].toFixed(1)}`],
      ['Rafales fortes', i => h.wind_gusts_10m[i] >= 60, i => h.wind_gusts_10m[i],
        i => `Rafales ${Math.round(h.wind_gusts_10m[i])} km/h`],
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

  // ---- Foudre SIMULÉE (maquette) : trois cellules qui se déplacent vers le nord-est ----
  // x : km vers l'est, y : km vers le nord, par rapport au lieu ; v : km/min ; rate : impacts/min.
  const CELLS = [
    { x: -30, y: -14, vx: 0.45, vy: 0.30, rate: 1.2 },
    { x: -70, y: -55, vx: 0.40, vy: 0.35, rate: 0.8 },
    { x: 38, y: 42, vx: 0.30, vy: 0.10, rate: 0.4 },
  ];
  const cellPos = (c, ageMin) => ({ x: c.x - c.vx * ageMin, y: c.y - c.vy * ageMin });
  const offset = (lat, lon, dx, dy) => [lat + dy / 111.32, lon + dx / (111.32 * Math.cos(lat * RAD))];
  function rng(seed) { // mulberry32 : résultats identiques à chaque chargement
    let a = seed;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function simulateStrikes(lat, lon, nowMs) {
    const rand = rng(33), out = [];
    CELLS.forEach((c, cell) => {
      for (let i = 0, n = Math.round(c.rate * 120); i < n; i++) {
        const age = rand() * 120, p = cellPos(c, age);
        const [la, lo] = offset(lat, lon, p.x + (rand() - 0.5) * 12, p.y + (rand() - 0.5) * 12);
        out.push({ lat: la, lon: lo, t: nowMs - age * 60000, cell });
      }
    });
    return out;
  }
  const visibleAt = (strikes, tMs, windowMin = 120) => strikes
    .filter(s => s.t <= tMs && tMs - s.t < windowMin * 60000)
    .map(s => ({ ...s, age: (tMs - s.t) / 60000 }));
  function nearest(list, lat, lon, minAge, maxAge) {
    let best = null;
    for (const s of list) {
      if (s.age < minAge || s.age > maxAge) continue;
      const km = haversineKm(lat, lon, s.lat, s.lon);
      if (!best || km < best.km) best = { km, bearing: bearingDeg(lat, lon, s.lat, s.lon) };
    }
    return best;
  }

  const api = { clamp, haversineKm, bearingDeg, compass, AGE_BANDS, ageColor, riskScore, riskLevel,
    alertWindows, weatherLabel, CELLS, cellPos, offset, simulateStrikes, visibleAt, nearest };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
