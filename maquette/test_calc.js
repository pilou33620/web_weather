// Contrôle rapide de calc.js : node test_calc.js (affiche un bilan court).
const assert = require('node:assert/strict');
const C = require('./calc.js');
let n = 0;
const ok = (fn) => { fn(); n++; };

ok(() => assert.ok(Math.abs(C.haversineKm(0, 0, 1, 0) - 111.19) < 0.1));
ok(() => assert.equal(C.compass(C.bearingDeg(44.8, -0.63, 45.8, -0.63)), 'N'));
ok(() => assert.equal(C.ageColor(3), '#e040fb'));
ok(() => assert.equal(C.ageColor(500), '#9e9e9e'));

ok(() => assert.equal(C.riskScore({}), 0));
ok(() => assert.equal(C.riskScore({ cape: 5000, li: -10, gust: 120, pop: 100 }), 100));
ok(() => assert.ok(C.riskScore({ cape: 2000, li: -4, cin: 300 }) < C.riskScore({ cape: 2000, li: -4, cin: 0 })));
ok(() => assert.equal(C.riskLevel(10).label, 'Faible'));
ok(() => assert.equal(C.riskLevel(80).label, 'Très élevé'));

// 6 heures : orage de l'heure 1 à 2, rafales à l'heure 4 seulement.
const h = {
  cape: [0, 900, 1200, 100, 0, 0], lifted_index: [5, -2, -3, 0, 4, 4],
  wind_gusts_10m: [20, 30, 30, 30, 70, 20],
};
ok(() => {
  const w = C.alertWindows(h, 0, 6);
  assert.equal(w.length, 2);
  assert.deepEqual([w[0].label, w[0].start, w[0].end, w[0].peak], ['Orage probable', 1, 2, 2]);
  assert.deepEqual([w[1].label, w[1].start, w[1].end], ['Rafales fortes', 4, 4]);
});
ok(() => assert.equal(C.alertWindows(h, 3, 6).length, 1)); // la fenêtre d'orage est exclue

const now = Date.UTC(2026, 9, 28, 12, 0, 0);
const s = C.simulateStrikes(44.80565, -0.6324, now);
ok(() => assert.equal(s.length, 144 + 96 + 48));
ok(() => assert.deepEqual(s, C.simulateStrikes(44.80565, -0.6324, now))); // déterministe
ok(() => assert.equal(C.visibleAt(s, now).length, s.length));
ok(() => assert.ok(C.visibleAt(s, now - 60 * 60000).length < s.length)); // moins d'impacts une heure plus tôt
ok(() => {
  const v = C.visibleAt(s, now);
  const proche = C.nearest(v, 44.80565, -0.6324, 0, 10), avant = C.nearest(v, 44.80565, -0.6324, 20, 40);
  assert.ok(proche && avant && proche.km < avant.km, 'la cellule simulée doit se rapprocher');
});
console.log(`OK : ${n} contrôles`);
