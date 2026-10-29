// Contrôle de js/calc.js : node test/test_calc.js (affiche un bilan court).
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
let n = 0;
const ok = (fn) => { fn(); n++; };

ok(() => assert.ok(Math.abs(C.haversineKm(0, 0, 1, 0) - 111.19) < 0.1));
ok(() => assert.equal(C.compass(C.bearingDeg(44.8, -0.63, 45.8, -0.63)), 'N'));
ok(() => assert.equal(C.ageColor(3), '#e040fb'));
ok(() => assert.equal(C.ageColor(500), '#9e9e9e'));

// Score : sans LPI (formule de la maquette), avec LPI (poids ramenés à 80 + LPI 20).
ok(() => assert.equal(C.riskScore({}), 0));
ok(() => assert.equal(C.riskScore({ cape: 5000, li: -10, gust: 120, pop: 100 }), 100));
ok(() => assert.equal(C.riskScore({ cape: 5000, li: -10, gust: 120, pop: 100, lpi: 0 }), 80));
ok(() => assert.equal(C.riskScore({ cape: 5000, li: -10, gust: 120, pop: 100, lpi: 9 }), 100));
ok(() => assert.equal(C.riskScore({ lpi: 2.5 }), 10));
ok(() => assert.ok(C.riskScore({ cape: 2000, li: -4, cin: 300 }) < C.riskScore({ cape: 2000, li: -4, cin: 0 })));
ok(() => assert.equal(C.riskLevel(10).label, 'Faible'));
ok(() => assert.equal(C.riskLevel(80).label, 'Très élevé'));
ok(() => assert.deepEqual(C.alignLpi(['a', 'b', 'c'], { time: ['b', 'c', 'd'], valeurs: [1, 2, 3] }), [null, 1, 2]));
ok(() => assert.deepEqual(C.alignLpi(['a'], null), [null]));

// 6 heures : orage de l'heure 1 à 2, rafales à l'heure 4, LPI ≥ 2 à l'heure 2.
const h = {
  cape: [0, 900, 1200, 100, 0, 0], lifted_index: [5, -2, -3, 0, 4, 4],
  wind_gusts_10m: [20, 30, 30, 30, 70, 20], precipitation: [0, 2, 12, 0, 0, 0],
};
const lpi = [null, 0.5, 3, 1, null, null];
ok(() => {
  const w = C.alertWindows(h, lpi, 0, 6);
  assert.deepEqual(w.map(a => [a.label, a.start, a.end, a.peak]),
    [['Orage probable', 1, 2, 2], ['Pluies fortes', 2, 2, 2], ['Foudre probable', 2, 2, 2], ['Rafales fortes', 4, 4, 4]]);
});
ok(() => assert.equal(C.alertWindows(h, lpi, 3, 6).length, 1)); // orage, pluie et foudre exclus
ok(() => assert.equal(C.alertWindows(h, lpi, 0, 6, { ...C.SEUILS, rafales: 80, lpi: 5, pluie: 20 }).length, 1)); // seuils réglés
ok(() => assert.equal(C.alertWindows({ ...h, lifted_index: [5, null, null, 0, 4, 4] }, lpi, 0, 6, { ...C.SEUILS, li: 0 })
  .filter(a => a.label === 'Orage probable').length, 0)); // LI manquant : pas d'alerte, pas de plantage
ok(() => assert.equal(C.alertWindows(h, lpi, 0, 6)[0].detail, 'CAPE 1200 · LI -3.0'));

// « dans N heures »
ok(() => assert.deepEqual([C.dans(-1), C.dans(60000), C.dans(30 * 60000), C.dans(10 * 3600000), C.dans(50 * 3600000)],
  ['en cours', 'dans 1 minute', 'dans 30 minutes', 'dans 10 heures', 'dans 2 jours']));

// Indices d'orage : profil classique (vent qui tourne à droite et forcit avec l'altitude).
const PROFIL = { temperature_2m: [25], dew_point_2m: [19], temperature_850hPa: [16], dew_point_850hPa: [12],
  temperature_700hPa: [6], dew_point_700hPa: [0], temperature_500hPa: [-14], cape: [2000], convective_inhibition: [20],
  lifted_index: [-5], freezing_level_height: [3600], wind_gusts_10m: [50],
  wind_speed_10m: [15], wind_direction_10m: [150], wind_speed_925hPa: [40], wind_direction_925hPa: [190],
  wind_speed_850hPa: [50], wind_direction_850hPa: [210], wind_speed_700hPa: [70], wind_direction_700hPa: [240],
  wind_speed_500hPa: [100], wind_direction_500hPa: [250] };
ok(() => {
  const x = C.indices(PROFIL, 0);
  assert.equal(x.K, 16 + 14 + 12 - 6); assert.equal(x.TT, 16 + 12 + 28); assert.equal(x.LCL, 750);
  assert.ok(x.sh6 > 90 && x.sh6 < 110, 'cisaillement 0-6 km ~100 km/h');
  assert.ok(x.SRH3 > 100, 'vent qui tourne à droite : hélicité positive');
  assert.ok(x.SCP > 1 && x.STP > 0 && x.EHI > 0);
  assert.equal(C.typeOrage(x)[0], 'Supercellulaire possible');
  assert.equal(C.LECTURE.K(x.K), 'Orages forts probables');
  assert.equal(C.LECTURE.LCL(x.LCL), 'Très bas (tornadique)');
  const r = Object.fromEntries(C.risques(x, null));
  assert.ok(r['Grêle'] > 50 && r['Tornade'] > 0 && r['Foudre'] > 50);
});
ok(() => assert.equal(C.indices({ ...PROFIL, temperature_500hPa: [null] }, 0), null)); // niveau manquant
ok(() => assert.equal(C.typeOrage({ cape: 100 })[0], "Pas d'orage organisé"));
ok(() => assert.equal(C.typeOrage({ ...C.indices(PROFIL, 0), sh6: 50 })[0], 'Multicellulaire'));

// Vigilance indicative : un jour calme, un jour venteux et pluvieux.
ok(() => {
  const hh = { time: ['2026-10-28T12:00', '2026-10-29T12:00'], cape: [0, 3000], lifted_index: [5, -8],
    convective_inhibition: [0, 0], wind_gusts_10m: [10, 50], precipitation_probability: [0, 100] };
  const d = { time: ['2026-10-28', '2026-10-29'], wind_gusts_10m_max: [30, 95], precipitation_sum: [0, 45] };
  const v = C.vigilance(hh, [null, null], d);
  assert.deepEqual(v.map(j => [j.orages[0], j.vent[0], j.pluie[0]]), [[0, 0, 0], [3, 2, 2]]);
});

// Ensemble : quantiles et probabilité de pluie sur 4 membres.
ok(() => assert.equal(C.quantile([3, 1, 2, null], 0.5), 2));
ok(() => assert.equal(C.quantile([], 0.5), null));
ok(() => {
  const e = { time: ['t0'], precipitation: [0], precipitation_member01: [0.2], precipitation_member02: [1], precipitation_member03: [0] };
  assert.deepEqual(C.rainProb(e), [0.5]);
  assert.deepEqual(C.bands({ time: ['t0'], temperature_2m: [10], temperature_2m_member01: [20] }, 'temperature_2m'), [[11, 15, 19]]);
});

// Impacts réels [[t, lat, lon]] : fenêtre de 2 h, cellules, approche.
const now = Date.UTC(2026, 9, 28, 12, 0, 0), min = 60000, P = [44.80565, -0.6324];
const S = [
  [now - 2 * min, 44.95, -0.63], [now - 3 * min, 44.96, -0.62], [now - 4 * min, 44.95, -0.64], // ~16 km au nord
  [now - 30 * min, 45.2, -0.63], [now - 35 * min, 45.21, -0.62],                                  // ~44 km, plus tôt
  [now - 200 * min, 44.8, -0.63],                                                                    // trop vieux
];
ok(() => assert.equal(C.visibleAt(S, now).length, 5));
ok(() => assert.equal(C.visibleAt(S, now - 20 * min).length, 2)); // le curseur remonte le temps
ok(() => {
  const c = C.cells(C.visibleAt(S, now));
  assert.equal(c.length, 1); assert.equal(c[0].n, 3); assert.ok(c[0].age >= 2 && c[0].age < 2.01);
});
ok(() => {
  const a = C.approach(C.visibleAt(S, now), ...P, 60);
  assert.ok(a && a.km > 15 && a.km < 18); assert.equal(C.compass(a.bearing), 'N');
});
ok(() => assert.equal(C.approach(C.visibleAt(S, now), ...P, 10), null)); // hors rayon
ok(() => {
  const v = C.visibleAt(S, now);
  assert.deepEqual(['niveau', 'n'].map(k => C.activite(v, ...P, 30)[k]), ['actif', 3]);
  assert.deepEqual(['niveau', 'n'].map(k => C.activite(v, ...P, 10)[k]), ['regional', 5]);
  assert.equal(C.activite([], ...P, 30), null);
});

// Isobares : pression qui monte vers l'est (0, 1, 2 sur chaque ligne), niveau 0,5 entre les deux premières colonnes.
ok(() => {
  const segs = C.isolignes([0, 1, 2, 0, 1, 2, 0, 1, 2], [44, 45, 46], [0, 1, 2], 0.5);
  assert.equal(segs.length, 2);
  assert.ok(segs.flat().every(([la, lo]) => lo === 0.5 && la >= 44 && la <= 46));
  assert.equal(C.isolignes([0, 1, 2, 0, null, 2, 0, 1, 2], [44, 45, 46], [0, 1, 2], 0.5).length, 0); // trou : rien d'inventé autour
});
ok(() => assert.deepEqual(C.niveauxIso([1012.2, 1014.9]), [1013, 1014]));
ok(() => assert.deepEqual(C.niveauxIso([1000, 1009]), [1000, 1002, 1004, 1006, 1008]));
ok(() => assert.deepEqual(C.niveauxIso([null]), []));
console.log(`OK : ${n} contrôles (avec isobares)`);

// Graphiques : SVG produit, trous (null) tolérés, cas vide.
const G = require('../js/graph.js');
const svg = G.chart({ times: ['a', 'b', 'c'], series: [{ vals: [1, null, 3], color: '#000' }, { vals: [0, 2, 1], type: 'bar', color: '#00f' },
  { type: 'band', lo: [0, 1, 1], hi: [2, 3, 2], color: '#f00' }, { vals: [1, 2, 3], type: 'area', color: '#f90' }], label: (t, k) => (k ? null : t) });
assert.ok(svg.startsWith('<svg') && svg.includes('<rect') && svg.includes('<polygon') && !svg.includes('NaN'), 'graphique');
assert.ok(G.chart({ times: ['a'], series: [] }).includes('Pas de données'), 'graphique vide');
assert.ok(G.anneau(23, '#0c0', '23 %', 'Faible').includes('stroke-dasharray'), 'anneau');
console.log('OK : graphiques');
