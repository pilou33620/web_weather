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
  wind_gusts_10m: [20, 30, 30, 30, 70, 20],
};
const lpi = [null, 0.5, 3, 1, null, null];
ok(() => {
  const w = C.alertWindows(h, lpi, 0, 6);
  assert.deepEqual(w.map(a => [a.label, a.start, a.end, a.peak]),
    [['Orage probable', 1, 2, 2], ['Foudre probable', 2, 2, 2], ['Rafales fortes', 4, 4, 4]]);
});
ok(() => assert.equal(C.alertWindows(h, lpi, 3, 6).length, 1)); // orage et foudre exclus
ok(() => assert.equal(C.alertWindows(h, lpi, 0, 6, { ...C.SEUILS, rafales: 80, lpi: 5 }).length, 1)); // seuils réglés

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
console.log(`OK : ${n} contrôles`);
