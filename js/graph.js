// Graphiques SVG sans bibliothèque : courbes, aires, barres, bande, axes à droite (style des captures).
(function (root) {
  let uid = 0;
  const f = (v, d = 1) => Number(v).toFixed(d);

  // opts : { times, series: [{ vals, color, type: 'line' | 'area' | 'bar' | 'band', lo, hi }], min, max,
  //          ticks: nombre de graduations, label: (t, k) => texte ou null, height }
  function chart(opts) {
    const W = 340, H = opts.height || 170, pr = 30, pb = 22, pt = 6, iw = W - pr, ih = H - pb - pt;
    const n = opts.times.length;
    if (n < 2) return '<div class="vide">Pas de données</div>';
    const all = opts.series.flatMap(s => (s.type === 'band' ? [...s.lo, ...s.hi] : s.vals)).filter(v => v != null && isFinite(v));
    let min = opts.min ?? Math.min(...all), max = opts.max ?? Math.max(...all);
    if (!isFinite(min)) { min = 0; max = 1; }
    if (max - min < 1e-9) max = min + 1;
    const x = k => (k / (n - 1)) * iw, y = v => pt + ih - ((v - min) / (max - min)) * ih;
    const id = `g${++uid}`, out = [];
    // grille horizontale et valeurs à droite
    const nt = opts.ticks || 4;
    for (let t = 0; t <= nt; t++) {
      const v = min + (max - min) * t / nt, yy = y(v);
      out.push(`<line x1="0" x2="${iw}" y1="${f(yy)}" y2="${f(yy)}" class="gl"/><text x="${W - 2}" y="${f(yy + 4)}" text-anchor="end" class="gt">${Math.round(v)}</text>`);
    }
    // repères verticaux et étiquettes de temps
    opts.times.forEach((t, k) => {
      const l = opts.label && opts.label(t, k);
      if (l) out.push(`<line x1="${f(x(k))}" x2="${f(x(k))}" y1="${pt}" y2="${pt + ih}" class="gl gv"/><text x="${f(x(k) + 3)}" y="${H - 6}" class="gt">${l}</text>`);
    });
    const pts = vals => vals.map((v, k) => (v == null || !isFinite(v) ? null : [x(k), y(v)]));
    const path = p => { let d = '', up = false; p.forEach(q => { if (!q) { up = false; return; } d += `${up ? 'L' : 'M'}${f(q[0])},${f(q[1])}`; up = true; }); return d; };
    opts.series.forEach((s, si) => {
      if (s.type === 'bar') {
        const bw = Math.max(1.5, iw / n * 0.6);
        s.vals.forEach((v, k) => { if (v != null && v > min) out.push(`<rect x="${f(x(k) - bw / 2)}" y="${f(y(v))}" width="${f(bw)}" height="${f(y(min) - y(v))}" rx="1.5" fill="${s.color}" opacity="${s.opacity ?? 0.45}"/>`); });
      } else if (s.type === 'band') {
        const hi = pts(s.hi), lo = pts(s.lo), ok = hi.map((q, k) => q && lo[k]);
        const d = ok.map((q, k) => (q ? hi[k] : null)).filter(Boolean).map(q => `${f(q[0])},${f(q[1])}`)
          .concat(ok.map((q, k) => (q ? lo[k] : null)).filter(Boolean).reverse().map(q => `${f(q[0])},${f(q[1])}`));
        if (d.length) out.push(`<polygon points="${d.join(' ')}" fill="${s.color}" opacity=".22"/>`);
      } else if (s.type === 'area') {
        const p = pts(s.vals), d = path(p), first = p.find(Boolean), last = [...p].reverse().find(Boolean);
        if (first) {
          out.push(`<defs><linearGradient id="${id}a${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff3b30" stop-opacity=".75"/>` +
            `<stop offset=".5" stop-color="#ff9500" stop-opacity=".45"/><stop offset="1" stop-color="#34c759" stop-opacity=".35"/></linearGradient></defs>`);
          out.push(`<path d="${d}L${f(last[0])},${f(y(min))}L${f(first[0])},${f(y(min))}Z" fill="url(#${id}a${si})"/>`);
          out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`);
        }
      } else {
        out.push(`<path d="${path(pts(s.vals))}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.title || 'graphique'}">${out.join('')}</svg>`;
  }

  // Jauge en anneau (0-100 %), couleur du niveau.
  function anneau(pc, color, texte, sous) {
    const r = 46, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pc));
    return `<svg class="anneau" viewBox="0 0 120 120" role="img" aria-label="${texte}"><circle cx="60" cy="60" r="${r}" class="anneau-fond"/>` +
      `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${f(c * v / 100)} ${f(c)}" transform="rotate(-90 60 60)"/>` +
      `<text x="60" y="62" text-anchor="middle" class="anneau-v">${texte}</text><text x="60" y="80" text-anchor="middle" class="anneau-s" fill="${color}">${sous}</text></svg>`;
  }

  const api = { chart, anneau };
  if (typeof module !== 'undefined') module.exports = api; else root.Graph = api;
})(typeof window !== 'undefined' ? window : globalThis);
