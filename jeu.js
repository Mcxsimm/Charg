/* =========================================================================
   ChargéPro — Mode carte : l'agence en vue isométrique
   Option activable (bouton « Mode carte » de la barre du haut) : l'application
   se présente comme le plan 3D d'une agence. Chaque écran est une salle,
   meublée selon son métier et rangée par espace (= groupes du menu). On s'y
   promène au clavier (flèches / ZQSD) ou au clic, on zoome à la molette et on
   déplace la vue en glissant. Les chiffres clés forment le bandeau du haut
   (niveau = CA vs objectif) et les actions prioritaires deviennent des
   « missions » signalées au-dessus des salles.
   Chargé avant le script principal : n'utilise DB, go, collectActions… qu'à
   l'exécution, une fois l'application démarrée.
   ========================================================================= */
'use strict';
(function () {
  /* ---------- Projection isométrique ---------- */
  const S = 24;                                  // pixels par mètre
  const CX = Math.cos(Math.PI / 6) * S, CY = 0.5 * S;
  const P = (x, y, z = 0) => [(x - y) * CX, (x + y) * CY - z * S];
  const pts = l => l.map(([x, y, z]) => P(x, y, z).map(v => v.toFixed(1)).join(',')).join(' ');
  const versMonde = (sx, sy) => { const a = sx / CX, b = sy / CY; return { x: (a + b) / 2, y: (b - a) / 2 }; };

  const BAT = { w: 50, d: 30 };                  // emprise du bâtiment (m)
  const MONDE = { x0: -9, y0: -7, x1: 64, y1: 46 };
  const VITESSE = 7;                             // m/s
  const SALLE = 10;                              // salles de 10 × 10 m

  /* Couleurs des espaces (= groupes du menu) */
  const ESPACES = {
    Pilotage: '#2a6fc4', Commercial: '#e8590c', Exploitation: '#1d7a52',
    'Exécution': '#6941c6', Entretien: '#0e7490', Finances: '#c27c0e',
  };
  /* Une salle par écran : position sur la grille (colonne, rangée) et mobilier */
  const SALLES = [
    { route: 'prospection', c: 0, r: 0, nom: 'Plateau prospection', type: 'prospection' },
    { route: 'devis',       c: 1, r: 0, nom: 'Bureau des devis',    type: 'devis' },
    { route: 'otps',        c: 2, r: 0, nom: 'Archives OTP',        type: 'archives' },
    { route: 'clients',     c: 3, r: 0, nom: 'Salle clients',       type: 'reunion' },
    { route: 'docs',        c: 4, r: 0, nom: 'Documentation',       type: 'biblio' },
    { route: 'chantiers',   c: 0, r: 1, nom: 'Salle chantiers',     type: 'maquette' },
    { route: 'planning',    c: 1, r: 1, nom: 'Salle planning',      type: 'planning' },
    { route: 'dashboard',   c: 2, r: 1, nom: "Hall d'accueil",      type: 'hall' },
    { route: 'cadences',    c: 3, r: 1, nom: 'Atelier cadences',    type: 'atelier' },
    { route: 'bte',         c: 4, r: 1, nom: "Bureau d'études",     type: 'etudes' },
    { route: 'achats',      c: 0, r: 2, nom: 'Magasin achats',      type: 'magasin' },
    { route: 'entretien',   c: 1, r: 2, nom: 'Atelier entretien',   type: 'entretien' },
    { route: 'ca',          c: 2, r: 2, nom: 'Direction',           type: 'direction' },
    { route: 'factures',    c: 3, r: 2, nom: 'Comptabilité',        type: 'compta' },
    { route: 'raf',         c: 4, r: 2, nom: 'Salle des coffres',   type: 'coffres' },
  ].map(s => ({ ...s, x: s.c * SALLE, y: s.r * SALLE }));
  const HALL = SALLES.find(s => s.route === 'dashboard');
  const RANGS = ['Stagiaire', 'Assistant', "Chargé d'affaires junior", "Chargé d'affaires", "Chargé d'affaires confirmé",
    "Chargé d'affaires senior", "Responsable d'affaires", "Chef d'agence", 'Directeur régional', "Légende de l'étanchéité"];

  /* ---------- Utilitaires ---------- */
  const reduit = () => !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nuit = () => typeof UI !== 'undefined' && UI.isDark();
  const sur = (fn, def) => { try { const v = fn(); return v === undefined ? def : v; } catch (_e) { return def; } };
  function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const kEur = n => Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' M€'
    : Math.abs(n) >= 1e3 ? Math.round(n / 1e3).toLocaleString('fr-FR') + ' k€' : Math.round(n).toLocaleString('fr-FR') + ' €';
  const plur = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const ombre = (h, f) => h[0] === '#' ? hex(rgb(h).map(v => v * (1 - f))) : h;
  const melange = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const espaceDe = route => sur(() => groupOf(route).label, 'Pilotage');
  const labelDe = route => sur(() => ROUTES[route].label, route);

  /* ---------- Palette (jour / nuit) ---------- */
  let C = null;
  function palette() {
    const n = nuit();
    C = n ? {
      sol: '#262b35', herbe: '#2c4330', herbe2: '#263b2a', allee: '#3a3f4a', dalle: '#1d222b', mur: '#3a4150', murHaut: '#2a303c', vitre: '#2b4a6e',
      bois: '#6b5440', hall: '#454650', bureau: '#cfd5dd', siege: '#2a303a', ecran: '#5fb3ff', bitume: '#30343c', nuit: true,
    } : {
      sol: '#efe6d6', herbe: '#cfe3a4', herbe2: '#bcd88c', allee: '#f6efe2', dalle: '#ddd3c2', mur: '#f7f3ec', murHaut: '#d9cdb8', vitre: '#bfe0f5',
      bois: '#e6c69c', hall: '#f3ece0', bureau: '#f4ede2', siege: '#3d4655', ecran: '#9fd3ff', bitume: '#cfd2d6', nuit: false,
    };
  }

  /* ---------- Primitives : boîtes, sols, personnages ---------- */
  let items = [];                                // objets triés en profondeur
  const add = (k, s) => items.push({ k, s });
  function boite(x, y, z, w, d, h, col, o = {}) {
    const haut = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
    const droite = [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]];
    const face = [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]];
    const op = o.op != null ? ` fill-opacity="${o.op}"` : '';
    const tr = o.trait ? ` stroke="${o.trait}" stroke-width=".6"` : '';
    const s = `<polygon points="${pts(face)}" fill="${o.face || ombre(col, .2)}"${op}${tr}/><polygon points="${pts(droite)}" fill="${o.droite || ombre(col, .1)}"${op}${tr}/><polygon points="${pts(haut)}" fill="${o.haut || col}"${op}${tr}/>` + (o.extra || '');
    if (o.brut) return s;
    add(o.k != null ? o.k : x + w / 2 + y + d / 2 + z, s);
    return s;
  }
  const solPoly = (x, y, w, d, col, z = 0, attr = '') => `<polygon points="${pts([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]])}" fill="${col}" ${attr}/>`;
  function disque(x, y, z, r, col, attr = '') { const [sx, sy] = P(x, y, z); return `<ellipse cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${(r * S * 1.15).toFixed(1)}" ry="${(r * S * 0.66).toFixed(1)}" fill="${col}" ${attr}/>`; }
  function boule(x, y, z, r, col, attr = '') { const [sx, sy] = P(x, y, z); return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(r * S).toFixed(1)}" fill="${col}" ${attr}/>`; }

  const TEINTS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const CHEMISES = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316'];
  let rnd = Math.random;
  /* Personnage : assis (devant un bureau, tourné vers -y) ou debout */
  function perso(x, y, o = {}) {
    const ch = o.chemise || CHEMISES[Math.floor(rnd() * CHEMISES.length)], peau = TEINTS[Math.floor(rnd() * TEINTS.length)];
    const z0 = o.assis ? 0.45 : 0;
    let s = '';
    if (!o.assis) s += boite(x - 0.16, y - 0.1, 0, 0.32, 0.2, 0.5, '#2f3b52', { brut: true });
    s += boite(x - 0.2, y - 0.13, z0 + (o.assis ? 0 : 0.5), 0.4, 0.26, 0.52, ch, { brut: true });
    const zt = z0 + (o.assis ? 0.52 : 1.02) + 0.17;
    s += boule(x, y, zt, 0.17, peau);
    if (o.casque) s += `<path d="${(() => { const [sx, sy] = P(x, y, zt + 0.06); return `M${(sx - 5).toFixed(1)} ${(sy + 1).toFixed(1)} a5 5 0 0 1 10 0 h2 v1.6 h-14 v-1.6z`; })()}" fill="#ffd43b" stroke="#e8a400" stroke-width=".6"/>`;
    else s += boule(x, y - 0.03, zt + 0.07, 0.13, o.cheveux || ['#3b2a20', '#1f1a17', '#8a5a2b', '#d6b370'][Math.floor(rnd() * 4)]);
    if (o.brut) return s;
    add(x + y + (o.assis ? 0.6 : 0.4), `<g class="${o.bouge ? 'jx-tape' : ''}">${s}</g>`);
    return s;
  }
  /* Poste de travail : bureau + écran + clavier + chaise (+ occupant) */
  function poste(x, y, o = {}) {
    boite(x, y, 0, 1.4, 0.7, 0.74, C.bureau);
    boite(x + 0.42, y + 0.08, 0.74, 0.56, 0.05, 0.36, '#2b2f36', { face: C.ecran, k: x + y + 1.5 });
    if (o.double) boite(x + 0.02, y + 0.12, 0.74, 0.38, 0.05, 0.3, '#2b2f36', { face: C.ecran, k: x + y + 1.3 });
    boite(x + 0.48, y + 0.36, 0.74, 0.44, 0.14, 0.02, '#cfd4da', { k: x + y + 1.4 });
    boite(x + 0.45, y + 0.92, 0, 0.5, 0.48, 0.45, C.siege);
    if (o.vide !== true) perso(x + 0.7, y + 1.15, { assis: true, bouge: rnd() < 0.5, chemise: o.chemise, casque: o.casque });
    boite(x + 0.45, y + 1.36, 0.45, 0.5, 0.08, 0.32, C.siege, { k: x + y + 2.7 });
  }
  const plante = (x, y, t = 1) => add(x + y + 0.3, boite(x - 0.2 * t, y - 0.2 * t, 0, 0.4 * t, 0.4 * t, 0.4 * t, '#c9a27a', { brut: true }) + boule(x, y, 0.4 * t + 0.35 * t, 0.4 * t, '#4caf50') + boule(x - 0.1, y - 0.1, 0.4 * t + 0.48 * t, 0.22 * t, '#66c46a'));
  function arbre(x, y, t = 1, sapin = false) {
    let s = boite(x - 0.12, y - 0.12, 0, 0.24, 0.24, 1.3 * t, '#8b6b4a', { brut: true });
    if (sapin) {
      const [sx, sy] = P(x, y, 1.0 * t), [, top] = P(x, y, 3.4 * t);
      s += `<polygon points="${(sx - 18 * t).toFixed(1)},${sy.toFixed(1)} ${sx.toFixed(1)},${top.toFixed(1)} ${(sx + 18 * t).toFixed(1)},${sy.toFixed(1)}" fill="#5aa65d"/><polygon points="${sx.toFixed(1)},${top.toFixed(1)} ${(sx + 18 * t).toFixed(1)},${sy.toFixed(1)} ${sx.toFixed(1)},${sy.toFixed(1)}" fill="#000" opacity=".1"/>`;
    } else {
      s += boule(x, y, 2.1 * t, 0.95 * t, C.nuit ? '#3f7d45' : '#7fc97f') + boule(x - 0.25, y - 0.25, 2.45 * t, 0.5 * t, C.nuit ? '#4b8f52' : '#98d698');
    }
    add(x + y + 0.5, `<ellipse cx="${P(x, y)[0].toFixed(1)}" cy="${P(x, y)[1].toFixed(1)}" rx="${(22 * t).toFixed(1)}" ry="${(11 * t).toFixed(1)}" fill="#000" opacity=".1"/>` + s);
  }
  function etagere(x, y, w, h = 2.1, sens = 'x') {
    const d = 0.4, cols = ['#e8590c', '#1c7ed6', '#2f9e44', '#f59f00', '#7048e8', '#e64980', '#495057'];
    if (sens === 'x') {
      boite(x, y, 0, w, d, h, C.bois);
      for (let n = 0; n < 3; n++) for (let i = 0; i < w * 4 - 1; i++) {
        if (rnd() < 0.2) continue;
        const hh = 0.32 + rnd() * 0.12;
        boite(x + 0.1 + i * 0.25, y + d, 0.15 + n * 0.65, 0.18, 0.04, hh, cols[Math.floor(rnd() * cols.length)], { k: x + y + w / 2 + d + 1 + n * .01 });
      }
    } else {
      boite(x, y, 0, d, w, h, C.bois);
      for (let n = 0; n < 3; n++) for (let i = 0; i < w * 4 - 1; i++) {
        if (rnd() < 0.2) continue;
        boite(x + d, y + 0.1 + i * 0.25, 0.15 + n * 0.65, 0.04, 0.18, 0.32 + rnd() * 0.12, cols[Math.floor(rnd() * cols.length)], { k: x + y + w / 2 + d + 1 + n * .01 });
      }
    }
  }
  function carton(x, y, z, t = 0.6) { boite(x, y, z, t, t, t * 0.8, '#d4a373', { extra: '' }); }

  /* ---------- Mobilier de chaque salle (coordonnées locales 0..10) ---------- */
  const MEUBLES = {
    prospection(X, Y) {
      [[1, 1.5], [4, 1.5], [1, 5], [4, 5]].forEach(([a, b]) => poste(X + a, Y + b));
      boite(X + 7.2, Y + 1.2, 0, 1.8, 1.8, 2.2, C.vitre, { op: .45, trait: '#8fb3cc' });
      perso(X + 8.1, Y + 2.2, { chemise: '#e8590c' });
      boite(X + 7, Y + 6, 0, 2, 0.9, 0.42, '#f08c4a'); boite(X + 7, Y + 6.8, 0.42, 2, 0.2, 0.45, '#e8590c');
      plante(X + 9.2, Y + 8.8);
    },
    devis(X, Y) {
      [[1, 1.5], [4, 1.5], [1, 5], [4, 5]].forEach(([a, b]) => poste(X + a, Y + b, { double: true }));
      etagere(X + 6.6, Y + 0.3, 3);
      boite(X + 7.4, Y + 3, 0, 0.9, 0.7, 0.9, '#c8ccd2'); boite(X + 7.5, Y + 3.05, 0.9, 0.7, 0.5, 0.12, '#f8f9fa');
      plante(X + 8.8, Y + 8.6);
    },
    archives(X, Y) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        boite(X + 0.8 + c * 2.1, Y + 1 + r * 2.4, 0, 1.6, 0.6, 1.35, '#a7b0ba');
        [0.3, 0.7, 1.1].forEach(z => boite(X + 0.85 + c * 2.1, Y + 1.6 + r * 2.4, z, 1.5, 0.02, 0.06, '#6c7681', { k: X + Y + c * 2.1 + r * 2.4 + 3 }));
      }
      poste(X + 6, Y + 7.6);
    },
    reunion(X, Y) {
      boite(X + 2.5, Y + 0.2, 0.9, 4, 0.08, 1.9, '#2b2f36', { face: C.ecran });
      boite(X + 2, Y + 3.5, 0, 5, 2, 0.75, C.bureau);
      [3, 4.5, 6].forEach((a, i) => { boite(X + a - 0.25, Y + 2.7, 0, 0.5, 0.5, 0.45, C.siege); if (i !== 1) perso(X + a, Y + 2.95, { assis: true }); });
      [3, 4.5, 6].forEach((a, i) => { boite(X + a - 0.25, Y + 5.7, 0, 0.5, 0.5, 0.45, C.siege); if (i === 1) perso(X + a, Y + 5.95, { assis: true }); });
      plante(X + 0.8, Y + 0.8); plante(X + 9, Y + 8.8);
      boite(X + 1, Y + 8, 0, 2.4, 0.9, 0.42, '#7aa6c2'); boite(X + 1, Y + 8.7, 0.42, 2.4, 0.2, 0.45, '#5b8db0');
    },
    biblio(X, Y) {
      etagere(X + 0.3, Y + 0.3, 9.2, 2.4);
      etagere(X + 1.2, Y + 3.4, 3.2, 1.6); etagere(X + 5.6, Y + 3.4, 3.2, 1.6);
      boite(X + 3, Y + 6.6, 0, 3, 1.2, 0.74, C.bois);
      perso(X + 3.8, Y + 8.1, { assis: true }); boite(X + 3.55, Y + 7.9, 0, 0.5, 0.5, 0.45, C.siege);
      boite(X + 3.9, Y + 6.8, 0.74, 0.5, 0.35, 0.05, '#fff');
      plante(X + 9, Y + 8.8);
    },
    maquette(X, Y) {
      boite(X + 2, Y + 2.2, 0, 4.6, 3, 0.85, '#e9ecef');
      boite(X + 2.4, Y + 2.6, 0.85, 1.6, 1.2, 0.8, '#ced4da'); boite(X + 2.4, Y + 2.6, 1.65, 1.6, 1.2, 0.05, '#495057');
      boite(X + 4.4, Y + 2.7, 0.85, 1.6, 2, 0.5, '#dee2e6'); boite(X + 4.4, Y + 2.7, 1.35, 1.6, 2, 0.05, '#2f9e44');
      boite(X + 6, Y + 2.5, 0.85, 0.08, 0.08, 1.6, '#fab005'); boite(X + 5, Y + 2.5, 2.4, 1.6, 0.08, 0.08, '#fab005');
      perso(X + 3, Y + 6, { casque: true, chemise: '#ff922b' }); perso(X + 5.5, Y + 6.2, { chemise: '#1c7ed6' });
      etagere(X + 0.3, Y + 0.3, 3.5, 1.4);
      [0, 1, 2, 3].forEach(i => boite(X + 6.5 + i * 0.6, Y + 0.4, 1.2, 0.4, 0.3, 0.2, '#ffd43b'));
      boite(X + 6.4, Y + 0.3, 0, 2.6, 0.4, 1.2, C.bois);
      poste(X + 6.8, Y + 7.2);
    },
    planning(X, Y) {
      [1.4, 5.6].forEach(a => boite(X + a, Y + 0.6, 0, 0.08, 0.08, 0.7, '#868e96'));
      boite(X + 1.2, Y + 0.6, 0.7, 4.6, 0.08, 1.3, '#ffffff', { face: '#ffffff', k: X + Y + 4 });
      const cols = ['#ffd43b', '#74c0fc', '#8ce99a', '#ffa8a8', '#d0bfff'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) if (rnd() < 0.75) boite(X + 1.4 + c * 0.6, Y + 0.69, 0.85 + r * 0.38, 0.42, 0.02, 0.26, cols[(r + c) % 5], { k: X + Y + 4.2 + c * .01 });
      boite(X + 3, Y + 3.5, 0, 2.2, 1, 1.05, C.bois);
      perso(X + 3.4, Y + 5, { chemise: '#7048e8' }); perso(X + 4.9, Y + 5.1, { casque: true, chemise: '#ff922b' });
      [[1, 6.5], [5, 6.5]].forEach(([a, b]) => poste(X + a, Y + b));
      plante(X + 9, Y + 1);
    },
    hall(X, Y) {
      // Comptoir d'accueil en L
      boite(X + 2.2, Y + 6.2, 0, 3.4, 0.7, 1.05, '#ffffff', { haut: C.bois });
      boite(X + 5.6, Y + 4.6, 0, 0.7, 2.3, 1.05, '#ffffff', { haut: C.bois });
      perso(X + 4, Y + 5.6, { chemise: '#2a6fc4' });
      // Écran géant des chiffres clés
      boite(X + 1.2, Y + 1.4, 0, 0.3, 0.3, 1.2, '#495057');
      boite(X + 0.4, Y + 1.5, 1.2, 2, 0.08, 1.3, '#1f2937', { face: C.nuit ? '#0f172a' : '#111827', k: X + Y + 3 });
      const prog = Math.min(1, Etat.ca / (Etat.obj || 1));
      [0.35, 0.55, 0.4, 0.75, 0.6, prog].forEach((v, i) => boite(X + 0.6 + i * 0.28, Y + 1.6, 1.35, 0.16, 0.01, 0.9 * Math.max(0.08, v), i === 5 ? '#4ade80' : '#60a5fa', { k: X + Y + 3.2 }));
      // Salon d'attente
      boite(X + 7, Y + 1, 0, 2.4, 0.9, 0.42, '#5b8db0'); boite(X + 7, Y + 1, 0.42, 2.4, 0.2, 0.45, '#4a7a9c', { k: X + Y + 9 });
      boite(X + 7.6, Y + 2.4, 0, 1.2, 0.7, 0.4, C.bois);
      perso(X + 8.4, Y + 1.5, { assis: true });
      plante(X + 0.8, Y + 8.8, 1.3); plante(X + 9.2, Y + 8.8, 1.3); plante(X + 9.3, Y + 4.2);
    },
    atelier(X, Y) {
      boite(X + 0.8, Y + 0.4, 0, 4, 0.9, 0.9, '#8d6e63', { haut: '#a1887f' });
      [[1.1, '#e03131'], [2.1, '#1c7ed6'], [3.3, '#fab005']].forEach(([a, c]) => boite(X + a, Y + 0.5, 0.9, 0.4, 0.3, 0.2, c));
      for (let i = 0; i < 6; i++) boite(X + 6 + (i % 3) * 0.7, Y + 0.6 + Math.floor(i / 3) * 0.7, 0, 0.5, 0.5, 1.1, '#343a40', { haut: '#495057' });
      boite(X + 2, Y + 3.8, 0, 2.8, 1.2, 0.9, C.bureau);
      boite(X + 2.3, Y + 4, 0.9, 1.4, 0.8, 0.05, '#fff');
      perso(X + 2.8, Y + 5.6, { casque: true, chemise: '#ff922b' }); perso(X + 4.2, Y + 5.7, { chemise: '#2f9e44' });
      [[1, 7], [4.5, 7]].forEach(([a, b]) => poste(X + a, Y + b));
      plante(X + 9, Y + 8.8);
    },
    etudes(X, Y) {
      [[1, 1.2], [4.5, 1.2]].forEach(([a, b]) => { boite(X + a, Y + b, 0, 2.2, 1.4, 0.9, C.bureau); boite(X + a + 0.2, Y + b + 0.2, 0.9, 1.8, 1, 0.03, '#a5d8ff'); perso(X + a + 1.1, Y + b + 1.9, {}); });
      [[1, 5.2], [4.5, 5.2]].forEach(([a, b]) => poste(X + a, Y + b, { double: true }));
      boite(X + 8, Y + 0.4, 0, 1.4, 0.6, 1.3, '#ced4da');
      plante(X + 9, Y + 8.6);
    },
    magasin(X, Y) {
      for (let r = 0; r < 3; r++) {
        boite(X + 0.8, Y + 1 + r * 2.6, 0, 6, 0.8, 0.06, '#868e96');
        boite(X + 0.8, Y + 1 + r * 2.6, 1, 6, 0.8, 0.06, '#868e96');
        [0.8, 3.8, 6.74].forEach(a => boite(X + a, Y + 1.7 + r * 2.6, 0, 0.06, 0.1, 2, '#495057', { k: X + Y + a + r * 2.6 + 3 }));
        for (let i = 0; i < 8; i++) if (rnd() < 0.8) carton(X + 0.9 + i * 0.72, Y + 1.08 + r * 2.6, rnd() < 0.5 ? 0.06 : 1.06, 0.62);
      }
      boite(X + 7.6, Y + 6, 0, 1.4, 1.2, 0.15, '#c9a27a');
      carton(X + 7.7, Y + 6.1, 0.15, 0.6); carton(X + 8.3, Y + 6.1, 0.15, 0.6); carton(X + 7.7, Y + 6.6, 0.15, 0.6); carton(X + 8, Y + 6.3, 0.65, 0.6);
      perso(X + 8, Y + 8.4, { casque: true, chemise: '#ff922b' });
    },
    entretien(X, Y) {
      boite(X + 0.6, Y + 0.4, 0, 1.2, 0.6, 1.8, '#e03131');
      boite(X + 2, Y + 0.4, 0, 1.2, 0.6, 1.8, '#e03131');
      boite(X + 3.6, Y + 0.4, 0, 3.4, 0.9, 0.9, '#8d6e63', { haut: '#a1887f' });
      boite(X + 7.6, Y + 0.6, 0, 0.1, 0.1, 2.6, '#adb5bd'); boite(X + 8.4, Y + 0.6, 0, 0.1, 0.1, 2.6, '#adb5bd');
      [0.5, 1.1, 1.7, 2.3].forEach(z => boite(X + 7.6, Y + 0.6, z, 0.9, 0.08, 0.06, '#adb5bd', { k: X + Y + 8.6 + z * .01 }));
      for (let i = 0; i < 3; i++) boite(X + 1 + i * 1.6, Y + 4.4, 0, 1, 0.6, 1.2, '#495057', { haut: '#ffd43b' });
      perso(X + 5.8, Y + 5, { casque: true, chemise: '#0e7490' });
      poste(X + 1, Y + 7); poste(X + 4.5, Y + 7);
    },
    direction(X, Y) {
      etagere(X + 0.4, Y + 0.3, 4.2, 2.2);
      boite(X + 2.2, Y + 3.2, 0, 3, 1.2, 0.76, '#7b5a3c');
      boite(X + 3.2, Y + 3.3, 0.76, 1, 0.06, 0.55, '#2b2f36', { face: C.ecran, k: X + Y + 6.8 });
      boite(X + 3.4, Y + 4.6, 0, 0.6, 0.6, 0.5, '#2b2f36'); perso(X + 3.7, Y + 4.85, { assis: true, chemise: '#343a40' });
      boite(X + 3.4, Y + 5.1, 0.5, 0.6, 0.12, 0.6, '#2b2f36', { k: X + Y + 9.2 });
      boite(X + 6.4, Y + 6.6, 0, 2.6, 1, 0.42, '#495057'); boite(X + 6.4, Y + 7.4, 0.42, 2.6, 0.2, 0.45, '#343a40');
      boite(X + 7, Y + 5.2, 0, 1.4, 0.8, 0.4, C.bois);
      boite(X + 6.5, Y + 0.3, 1, 2.6, 0.08, 1.4, '#1f2937', { face: '#111827' });
      [0.4, 0.6, 0.5, 0.9].forEach((v, i) => boite(X + 6.8 + i * 0.55, Y + 0.4, 1.15, 0.3, 0.01, 1.1 * v, '#fab005', { k: X + Y + 8 }));
      plante(X + 9.2, Y + 9.2, 1.2); plante(X + 0.8, Y + 9.2, 1.2);
    },
    compta(X, Y) {
      [[1, 1.5], [4, 1.5], [1, 5], [4, 5]].forEach(([a, b]) => poste(X + a, Y + b));
      for (let i = 0; i < 3; i++) boite(X + 7.2 + (i % 2) * 0.9, Y + 1 + i * 1.6, 0, 0.8, 0.6, 1.3, '#a7b0ba');
      boite(X + 7.2, Y + 6.2, 0, 1.2, 0.8, 0.9, '#ced4da'); boite(X + 7.3, Y + 6.3, 0.9, 1, 0.5, 0.15, '#f8f9fa');
      plante(X + 9, Y + 9);
    },
    coffres(X, Y) {
      [[1, 0.6], [4, 0.6], [7, 0.6]].forEach(([a, b]) => {
        boite(X + a, Y + b, 0, 2.2, 1.4, 2.2, '#5f6b77', { haut: '#7a8794' });
        add(X + Y + a + b + 3, disque(X + a + 1.1, Y + b + 1.42, 1.1, 0.35, '#c9a227') + disque(X + a + 1.1, Y + b + 1.43, 1.1, 0.18, '#7a5c00'));
      });
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3 - (i % 2); j++) boite(X + 2 + i * 0.6, Y + 4.6 + j * 0.35, (i % 2) * 0.12, 0.5, 0.3, 0.12, '#fcc419', { haut: '#ffe066' });
      boite(X + 5.2, Y + 4.4, 0, 1.2, 1.2, 0.15, '#c9a27a');
      carton(X + 5.3, Y + 4.5, 0.15, 0.8);
      perso(X + 4.2, Y + 7.2, { chemise: '#343a40' });
      poste(X + 6.5, Y + 7);
    },
  };

  /* ---------- Données (calculées depuis le profil courant) ---------- */
  let Etat = { ca: 0, obj: 1 };
  function etat() {
    const d = DB.data, o = d.objectifs, yr = new Date().getFullYear();
    const ca = sur(() => d.ca.filter(r => r.annee === yr && otpCompte(r.otp)).reduce((s, r) => s + (+r.prixVente || 0), 0), 0);
    const marge = ca ? (ca - sur(() => coutsReels(yr).tot, 0)) / ca : 0;
    const actions = sur(() => collectActions(), []);
    const obj = +o.caAnnuel || 1;
    const palier = obj / 10;
    const niv = Math.min(RANGS.length, Math.floor(ca / palier) + 1);
    const xp = niv >= RANGS.length ? 1 : (ca - (niv - 1) * palier) / palier;
    const critiques = actions.filter(a => a.tone === 'bad').length;
    const actifs = sur(() => d.chantiers.filter(c => ['commande', 'en_cours'].includes(c.statut)).length, 0);
    return { ca, obj, marge, cible: +o.margeCible || 0, actions, niv, xp, rang: RANGS[niv - 1], resteNiv: Math.max(0, niv * palier - ca), critiques, actifs };
  }
  /* Ce que l'on lit dans chaque salle : lignes de statistiques + pastille */
  function infos(route, E) {
    const d = DB.data, t = todayISO();
    const L = (...l) => l.filter(Boolean);
    switch (route) {
      case 'dashboard': return { badge: E.actions.length || null, lignes: L(['CA annuel', eur(E.ca) + ' / ' + eur(E.obj)], ['Marge brute', pct(E.marge)], ['Missions ouvertes', E.actions.length]),
        texte: "L'accueil de l'agence : l'écran géant affiche vos chiffres clés, la to-do list vous attend au comptoir." };
      case 'prospection': {
        const rel = d.prospection.filter(p => p.prochaine && p.prochaine <= t && !['gagne', 'sans_suite'].includes(p.statut)).length;
        return { badge: rel || null, lignes: L(['RDV nouveaux ce mois', sur(rdvNouveauxMois, 0) + ' / ' + d.objectifs.rdvMois], ['Relances dues', rel], ['Contacts suivis', d.prospection.length]),
          texte: 'Casques sur les oreilles, on décroche son téléphone : les prochains clients se trouvent ici.' };
      }
      case 'devis': {
        const att = d.devis.filter(x => x.statut === 'attente').length, env = d.devis.filter(x => ['envoye', 'relance'].includes(x.statut)).length;
        return { badge: att || null, lignes: L(["En attente d'envoi", att], ['Envoyés / relancés', env], ['Acceptés', d.devis.filter(x => x.statut === 'accepte').length]),
          texte: 'Double écran et métrés : plus vite un devis part, plus vite il se signe.' };
      }
      case 'otps': return { badge: null, lignes: L(['Comptes OTP', sur(() => otpDistinct().filter(c => c.trim()).length, d.otps.length)]), texte: 'Un tiroir par affaire : chaque compte OTP y est classé.' };
      case 'clients': return { badge: null, lignes: L(['Clients', d.clients.length], ['Grands comptes', d.clients.filter(c => c.type === 'Grand compte').length]), texte: 'La salle de réunion où l’on reçoit syndics, grands comptes et collectivités.' };
      case 'chantiers': {
        const act = d.chantiers.filter(c => ['commande', 'en_cours'].includes(c.statut)).length;
        return { badge: act || null, lignes: L(['Chantiers actifs', act], ['Carnet de commandes', eur(sur(carnetCommandes, 0))], ['Réceptionnés', d.chantiers.filter(c => c.statut === 'receptionne').length]),
          texte: 'Autour de la maquette, on suit chaque chantier de la commande à la réception.' };
      }
      case 'planning': {
        const sem = sur(() => mondayISO(), ''), h = d.pointages.filter(p => p.semaine === sem).reduce((s, p) => s + (p.h || []).reduce((a, b) => a + (+b || 0), 0), 0);
        return { badge: null, lignes: L(['Équipes', d.equipes.length], ['Heures pointées (semaine)', num(h) + ' h']), texte: 'Le grand tableau à post-it : qui est où, cette semaine.' };
      }
      case 'cadences': return { badge: null, lignes: L(['Études de cadence', d.cadEtudes.length], ['Ouvrages perso', d.cadBase.perso.length]), texte: 'Rouleaux de membrane et chronomètre : on chiffre au rythme des compagnons.' };
      case 'bte': {
        const val = d.bte.filter(b => b.statut === 'valide').length;
        return { badge: null, lignes: L(['Budgets chantier', d.bte.length], ['Validés', val], ['En étude', d.bte.length - val]), texte: 'Tables à dessin et tableurs : le budget de chaque chantier, poste par poste.' };
      }
      case 'achats': {
        const att = d.commandes.filter(c => c.statut === 'commande').length;
        return { badge: att || null, lignes: L(['Commandes en attente de livraison', att], ['Commandes totales', d.commandes.length]), texte: 'Membranes, isolants et accessoires : tout ce qui est commandé arrive ici.' };
      }
      case 'docs': return { badge: null, lignes: L(["Dossiers d'exécution", d.dossiers.length]), texte: 'PPSPS, DOE, fiches techniques : la documentation n’oublie rien.' };
      case 'entretien': {
        const prog = sur(() => d.contrats.filter(contratAProgrammer).length, 0), rap = sur(() => rapportsEnRetard().length, 0);
        return { badge: (prog + rap) || null, lignes: L(['Contrats', d.contrats.length], ['Visites à programmer', prog], ['Rapports en retard', rap]), texte: 'Échelles et caisses à outils : le départ des visites d’entretien.' };
      }
      case 'ca': return { badge: null, lignes: L(['CA réalisé', eur(E.ca)], ['Objectif', eur(E.obj)], ['Marge brute', pct(E.marge) + ' (cible ' + pct(E.cible) + ')']), texte: 'Le bureau de la direction : l’année de l’agence en un coup d’œil.' };
      case 'factures': {
        const aem = d.factures.filter(f => f.statut === 'a_emettre').length, ret = sur(() => d.factures.filter(f => factureFlags(f).retardPaiement).length, 0);
        const enc = d.factures.filter(f => f.statut === 'emise').reduce((s, f) => s + (+f.montantHT || 0), 0);
        return { badge: (aem + ret) || null, lignes: L(['À émettre', aem], ['Encours facturé', eur(enc)], ['Impayés en retard', ret]), texte: 'Les factures partent d’ici. Gare aux impayés !' };
      }
      case 'raf': {
        const coffre = sur(() => otpDistinct().filter(c => c.trim() && !otpHorsPerimetre(c)).reduce((s, c) => s + (+rafFinance(c).coffre || 0), 0), null);
        return { badge: null, lignes: L(coffre !== null && ['Boîte à affaires', eur(coffre)]), texte: 'Ce qui est commandé mais pas encore facturé dort dans ces coffres.' };
      }
    }
    return { badge: null, lignes: [], texte: '' };
  }

  /* ---------- Construction de la scène ---------- */
  function scene(E) {
    palette(); items = []; rnd = prng(20240917);
    const W = BAT.w, D = BAT.d;
    let fond = '', sols = '', zones = '', murs = '';

    // Terrain, jardin, parking
    fond += solPoly(MONDE.x0, MONDE.y0, MONDE.x1 - MONDE.x0, MONDE.y1 - MONDE.y0, C.sol);
    fond += solPoly(-1, 31.5, W + 2, 12, C.herbe);
    fond += solPoly(MONDE.x0, -6, 7, 37, C.herbe2) + solPoly(-1, MONDE.y0, W + 2, 6, C.herbe2);
    fond += solPoly(52, -2, 10, 33, C.bitume);
    for (let i = 0; i < 6; i++) fond += solPoly(52.3, 1 + i * 4.6, 7, 0.12, '#ffffff', 0, 'opacity=".8"');
    fond += solPoly(16, 31.5, 18, 8, C.nuit ? '#5a4632' : '#e2c294');                       // terrasse bois
    for (let i = 0; i < 18; i++) fond += solPoly(16 + i, 31.5, 0.05, 8, '#000', 0, 'opacity=".06"');
    fond += solPoly(23, 39.5, 4, 6.5, C.allee) + solPoly(50, 13, 2, 4, C.allee);
    // Dalle du bâtiment
    fond += boite(0, 0, -0.35, W, D, 0.35, C.dalle, { brut: true });

    // Sols des salles (teinte de l'espace) + zones survolables
    SALLES.forEach(s => {
      const coul = ESPACES[espaceDe(s.route)] || ESPACES.Pilotage;
      const base = s.type === 'hall' ? C.hall : C.bois;
      sols += solPoly(s.x, s.y, SALLE, SALLE, melange(base, coul, C.nuit ? .18 : .1));
      if (s.type === 'hall') {
        sols += disque(s.x + 5, s.y + 5, 0.01, 2.6, melange(C.hall, coul, .25));
        const [lx, ly] = P(s.x + 5, s.y + 5);
        sols += `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="middle" class="jx-logo" fill="${coul}">CP</text>`;
      } else if (['devis', 'prospection', 'compta', 'etudes'].includes(s.type)) {
        sols += solPoly(s.x + 0.6, s.y + 1, 6.2, 7.2, '#000', 0.005, 'opacity=".035"');
      }
      zones += `<polygon class="jx-zone" data-route="${s.route}" points="${pts([[s.x + .15, s.y + .15, .02], [s.x + SALLE - .15, s.y + .15, .02], [s.x + SALLE - .15, s.y + SALLE - .15, .02], [s.x + .15, s.y + SALLE - .15, .02]])}" style="--c:${coul}"/>`;
    });

    // Murs du fond (avec fenêtres) — dessinés avant tout le reste
    murs += boite(-0.3, -0.3, 0, W + 0.3, 0.3, 3, C.mur, { brut: true, haut: C.murHaut });
    murs += boite(-0.3, 0, 0, 0.3, D, 3, C.mur, { brut: true, haut: C.murHaut });
    for (let i = 0; i < 12; i++) murs += `<polygon points="${pts([[1 + i * 4, 0, 1], [3.6 + i * 4, 0, 1], [3.6 + i * 4, 0, 2.5], [1 + i * 4, 0, 2.5]])}" fill="${C.vitre}" opacity=".85"/>`;
    for (let i = 0; i < 7; i++) murs += `<polygon points="${pts([[0, 1 + i * 4, 1], [0, 3.6 + i * 4, 1], [0, 3.6 + i * 4, 2.5], [0, 1 + i * 4, 2.5]])}" fill="${C.vitre}" opacity=".85"/>`;

    // Cloisons vitrées basses entre salles (en tronçons d'1 m pour la profondeur), portes au milieu
    const cloison = (x, y, w, d) => boite(x, y, 0, w, d, 1.15, C.vitre, { op: C.nuit ? .3 : .45, haut: '#b08a5a' });
    const ouvert = (a, b) => a.type === 'hall' || b.type === 'hall';
    const salleEn = (c, r) => SALLES.find(s => s.c === c && s.r === r);
    for (let c = 1; c < 5; c++) for (let r = 0; r < 3; r++) {
      if (ouvert(salleEn(c - 1, r), salleEn(c, r))) continue;
      for (let i = 0; i < SALLE; i++) if (i < 4 || i > 5) cloison(c * SALLE - 0.04, r * SALLE + i, 0.08, 1);
    }
    for (let r = 1; r < 3; r++) for (let c = 0; c < 5; c++) {
      if (ouvert(salleEn(c, r - 1), salleEn(c, r))) continue;
      for (let i = 0; i < SALLE; i++) if (i < 4 || i > 5) cloison(c * SALLE + i, r * SALLE - 0.04, 1, 0.08);
    }
    // Bordure basse côté façade (vue dégagée)
    for (let i = 0; i < W; i++) if (i < 22 || i > 27) boite(i, D - 0.12, 0, 1, 0.12, 0.25, C.mur);
    for (let i = 0; i < D; i++) if (i < 13 || i > 16) boite(W - 0.12, i, 0, 0.12, 1, 0.25, C.mur);

    // Mobilier
    SALLES.forEach(s => { const f = MEUBLES[s.type]; if (f) f(s.x, s.y); });

    // Extérieur : haies, terrasse, arbres, camionnettes (= chantiers actifs)
    for (let i = 0; i < 4; i++) boite(1 + i * 3.6, 32.4, 0, 3, 0.6, 0.7, '#7cc26b', { haut: '#93d482' });
    for (let i = 0; i < 4; i++) boite(35 + i * 3.6, 32.4, 0, 3, 0.6, 0.7, '#7cc26b', { haut: '#93d482' });
    [[19, 34.5], [24.5, 35.5], [30, 34.5]].forEach(([x, y]) => {
      boite(x - 0.5, y - 0.5, 0, 1, 1, 0.72, '#ffffff', { haut: C.bois });
      [[-1.1, 0], [0.7, 0]].forEach(([a]) => boite(x + a, y - 0.25, 0, 0.45, 0.45, 0.45, '#5b8db0'));
      boite(x - 0.04, y - 0.04, 0.72, 0.08, 0.08, 1.6, '#868e96', { k: x + y + 0.9 });
      const [sx, sy] = P(x, y, 2.35);
      add(x + y + 2, `<path d="M${(sx - 34).toFixed(1)} ${(sy + 8).toFixed(1)} Q${sx.toFixed(1)} ${(sy - 22).toFixed(1)} ${(sx + 34).toFixed(1)} ${(sy + 8).toFixed(1)} Q${sx.toFixed(1)} ${(sy + 16).toFixed(1)} ${(sx - 34).toFixed(1)} ${(sy + 8).toFixed(1)}z" fill="#2f6fd6"/><path d="M${sx.toFixed(1)} ${(sy - 7).toFixed(1)} L${(sx + 34).toFixed(1)} ${(sy + 8).toFixed(1)} Q${sx.toFixed(1)} ${(sy + 16).toFixed(1)} ${sx.toFixed(1)} ${(sy + 12).toFixed(1)}z" fill="#000" opacity=".12"/>`);
    });
    perso(21.5, 37, { chemise: '#e64980' }); perso(28.5, 38, { chemise: '#12b886' });
    const vans = Math.max(1, Math.min(6, E.actifs || 0));
    for (let i = 0; i < vans; i++) {
      const y = 1.4 + i * 4.6;
      boite(53.2, y, 0.3, 4.2, 1.9, 1.6, '#ffffff', { extra: '' });
      boite(52.2, y, 0.3, 1, 1.9, 1.1, '#f1f3f5');
      boite(53.4, y + 1.9, 0.9, 3.8, 0.01, 0.25, '#1c7ed6', { k: 53 + y + 4 });
      boite(52.25, y + 0.15, 1.05, 0.05, 1.6, 0.35, C.ecran, { k: 52 + y + 3 });
      [[52.6, y + 1.9], [56.4, y + 1.9]].forEach(([a, b]) => add(a + b + 1, disque(a, b, 0.3, 0.32, '#212529')));
    }
    const r2 = prng(7);
    const arbres = [];
    for (let i = 0; i < 9; i++) arbres.push([2 + i * 5.6 + r2() * 2, -4.2 - r2() * 1.5]);
    for (let i = 0; i < 6; i++) arbres.push([-4 - r2() * 3, 2 + i * 5 + r2() * 2]);
    [[3, 37], [8, 40], [12.5, 36.5], [37, 37], [42, 40], [47, 36.5], [-3, 38], [52, 38], [57, 41], [61, 6], [61, 22], [-6, 43], [14.5, 43], [36, 43]].forEach(a => arbres.push(a));
    arbres.forEach(([x, y], i) => arbre(x, y, 0.9 + (i % 3) * 0.15, i % 4 === 1));

    items.sort((a, b) => a.k - b.k);

    // Étiquettes des salles (toujours au-dessus) : nom, pastille, mission
    const etiq = SALLES.map(s => {
      const coul = ESPACES[espaceDe(s.route)] || ESPACES.Pilotage, I = infos(s.route, E);
      const q = E.actions.filter(a => a.route === s.route), urg = q.some(a => a.tone === 'bad') ? 'bad' : q.length ? 'warn' : '';
      const [x, y] = P(s.x + 5, s.y + 5, 3.3), txt = labelDe(s.route).replace(/ — .*/, ''), w = txt.length * 7.1 + 32 + (I.badge ? 22 : 0);
      return `<g class="jx-etiq" data-route="${s.route}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <line x1="0" y1="0" x2="0" y2="${(3.3 * S - 4).toFixed(0)}" class="jx-fil"/><g class="jx-ech">
        <rect x="${-w / 2}" y="-12" width="${w}" height="24" rx="12" class="jx-pill"/>
        <circle cx="${-w / 2 + 13}" cy="0" r="4.5" fill="${coul}"/>
        <text x="${-w / 2 + 23}" y="4">${esc(txt)}</text>
        ${I.badge ? `<circle cx="${w / 2 - 13}" cy="0" r="9" fill="${urg === 'bad' ? '#e03131' : coul}"/><text class="jx-nb" x="${w / 2 - 13}" y="3.5" text-anchor="middle">${I.badge > 99 ? '99+' : I.badge}</text>` : ''}
        ${urg ? `<g class="jx-mission ${urg}" transform="translate(0 -26)"><g class="jx-saut"><circle r="10" /><text y="4.5" text-anchor="middle">!</text></g></g>` : ''}
      </g></g>`;
    }).join('');

    // Éclairage de nuit : halos chauds dans les salles
    const halos = C.nuit ? SALLES.map(s => disque(s.x + 5, s.y + 5, 0, 4.2, 'url(#jx-lampe)')).join('') : '';

    return `<g class="jx-fond">${fond}</g><g class="jx-sols">${sols}</g><g class="jx-zones">${zones}</g><g>${halos}</g><g>${murs}</g>
      <g class="jx-objets">${items.map(o => o.s).join('')}</g><g id="jx-heros"></g><g class="jx-etiquettes">${etiq}</g>`;
  }

  /* ---------- Caméra (viewBox) ---------- */
  const cam = { x: 0, y: 0, w: 100, h: 100 };
  let vueTotale = null;
  function bornesMonde() {
    const c = [[MONDE.x0, MONDE.y0], [MONDE.x1, MONDE.y0], [MONDE.x1, MONDE.y1], [MONDE.x0, MONDE.y1]].map(([x, y]) => P(x, y));
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys) - 80, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + 80 };
  }
  function cadrer(zoom = 1) {
    const b = vueTotale, r = (monde.clientWidth || 1) / (monde.clientHeight || 1);
    // Cadrage initial : le bâtiment et ses abords, au format de l'écran
    const c = [[-4, -4], [BAT.w + 12, -4], [BAT.w + 12, BAT.d + 12], [-4, BAT.d + 12]].map(([x, y]) => P(x, y));
    const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
    let w = (Math.max(...xs) - Math.min(...xs)) / zoom, h = (Math.max(...ys) - Math.min(...ys) + 90) / zoom;
    if (w / h > r) h = w / r; else w = h * r;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2 - 20;
    Object.assign(cam, { x: cx - w / 2, y: cy - h / 2, w, h });
    void b; appliquerCam();
  }
  function appliquerCam() {
    const b = vueTotale, r = cam.w / cam.h;
    cam.w = Math.max(320, Math.min(b.w * 1.15, cam.w)); cam.h = cam.w / r;
    cam.x = Math.max(b.x - cam.w * 0.3, Math.min(b.x + b.w - cam.w * 0.7, cam.x));
    cam.y = Math.max(b.y - cam.h * 0.3, Math.min(b.y + b.h - cam.h * 0.7, cam.y));
    svg.setAttribute('viewBox', `${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.w.toFixed(1)} ${cam.h.toFixed(1)}`);
    echelleEtiquettes();
  }
  /* Étiquettes à taille constante à l'écran, quel que soit le zoom */
  let echelle = 0;
  function echelleEtiquettes() {
    const k = Math.max(0.8, cam.w / (svg.clientWidth || cam.w));
    if (Math.abs(k - echelle) < 0.005 && svg.querySelector('.jx-ech[transform]')) return;
    echelle = k;
    svg.querySelectorAll('.jx-ech').forEach(g => g.setAttribute('transform', `scale(${k.toFixed(3)})`));
  }
  function zoomer(f, sx, sy) {
    if (sx == null) { sx = cam.x + cam.w / 2; sy = cam.y + cam.h / 2; }
    const nw = Math.max(320, Math.min(vueTotale.w * 1.15, cam.w * f)), k = nw / cam.w;
    cam.x = sx - (sx - cam.x) * k; cam.y = sy - (sy - cam.y) * k; cam.w = nw; cam.h *= k;
    appliquerCam();
  }
  function versVue(cx, cy) { const m = svg.getScreenCTM(); if (!m) return null; const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(m.inverse()); }

  /* ---------- État du héros ---------- */
  let racine = null, svg = null, monde = null, heros = null, bulle = null, invite = null;
  let ouverte = false, dernier = 'dashboard';
  const J = { x: HALL.x + 5, y: HALL.y + 7, cible: null, salleCible: null, touches: new Set(), t: 0, salle: null, raf: 0, t0: 0, suivre: false };
  const centreSalle = s => [s.x + 5, s.y + 6.6];
  const salleEn = (x, y) => SALLES.find(s => x >= s.x && x < s.x + SALLE && y >= s.y && y < s.y + SALLE) || null;

  function dessinerHeros(bob) {
    if (!heros) return;
    const [sx, sy] = P(J.x, J.y);
    heros.setAttribute('transform', `translate(${sx.toFixed(1)} ${(sy - (bob || 0)).toFixed(1)})`);
  }
  function corpsHeros() {
    rnd = prng(3);
    heros.innerHTML = `<ellipse class="jx-anneau" cx="0" cy="0" rx="20" ry="11"/><ellipse cx="0" cy="0" rx="9" ry="5" fill="#000" opacity=".25"/>`
      + `<g>${perso(0, 0, { casque: true, chemise: '#ff6b00', brut: true })}</g>`
      + `<g class="jx-moi" transform="translate(0 -${(2.15 * S).toFixed(0)})"><g class="jx-ech"><rect x="-16" y="-14" width="32" height="17" rx="8.5"/><text y="-1.5" text-anchor="middle">Moi</text></g></g>`;
    echelleEtiquettes();
  }

  /* ---------- Interface (bandeau, dock, dialogues) ---------- */
  function hud(E) {
    const p = (DB.currentProfile && DB.currentProfile()) || { nom: 'Moi' };
    const ic = n => sur(() => icon(n), '');
    return `<div class="jx-hud">
      <div class="jx-carte jx-perso">
        <div class="jx-avatar">${esc(sur(() => initiales(p.nom), 'CP'))}</div>
        <div class="jx-perso-txt">
          <div class="jx-nom">${esc(p.nom)} <span class="jx-niv">Niv. ${E.niv}</span></div>
          <div class="jx-rang">${esc(E.rang)}</div>
          <div class="jx-xp" title="CA annuel : ${esc(eur(E.ca))} sur ${esc(eur(E.obj))}"><i style="width:${Math.round(E.xp * 100)}%"></i></div>
          <div class="jx-xp-txt">${E.niv >= RANGS.length ? 'Niveau maximum atteint' : 'Niveau suivant dans ' + esc(kEur(E.resteNiv)) + ' de CA'}</div>
        </div>
      </div>
      <div class="jx-carte jx-stats">
        <div class="jx-stat" title="CA annuel réalisé"><span class="jx-si" style="--c:#2a6fc4">${ic('euro')}</span><div><small>CA</small><b>${esc(kEur(E.ca))}</b></div></div>
        <div class="jx-stat" title="Marge brute moyenne"><span class="jx-si" style="--c:#1d7a52">${ic('trend')}</span><div><small>Marge</small><b>${esc(pct(E.marge))}</b></div></div>
        <div class="jx-stat" title="Chantiers en commande ou en cours (= camionnettes sur le parking)"><span class="jx-si" style="--c:#c27c0e">${ic('building')}</span><div><small>Chantiers</small><b>${E.actifs}</b></div></div>
        <button class="jx-stat jx-btn-quetes" title="Missions en cours (J)"><span class="jx-si" style="--c:${E.critiques ? '#e03131' : '#e8590c'}">${ic('bell')}</span><div><small>Missions</small><b>${E.actions.length}${E.critiques ? ` <em>${E.critiques} urgente${E.critiques > 1 ? 's' : ''}</em>` : ''}</b></div></button>
      </div>
      <div class="jx-carte jx-sortie">
        <button class="jx-ibtn" data-jx-aide title="Aide">?</button>
        <button class="jx-btn" data-jx-quitter title="Quitter la carte (Échap)">${ic('x')}<span>Quitter</span></button>
      </div>
    </div>
    <div class="jx-dock">
      <div class="jx-carte jx-espaces">${sur(() => NAV_GROUPS, []).map(g => `<button class="jx-chip" data-jx-espace="${esc(g.label)}"><i style="background:${ESPACES[g.label] || '#888'}"></i>${esc(g.label)}</button>`).join('')}</div>
      <div class="jx-carte jx-zoom"><button class="jx-ibtn" data-jx-zoom="out" title="Dézoomer">−</button><button class="jx-ibtn" data-jx-zoom="fit" title="Vue d'ensemble">⤢</button><button class="jx-ibtn" data-jx-zoom="in" title="Zoomer">+</button></div>
    </div>`;
  }

  function construire() {
    const E = etat(); Etat = E;
    racine.innerHTML = `<div class="jx-monde"><svg class="jx-svg" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="jx-lampe"><stop offset="0" stop-color="#ffd27a" stop-opacity=".28"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>
        ${scene(E)}</svg></div>${hud(E)}
      <div class="jx-invite" hidden></div>
      <div class="jx-aide-bas">${'ontouchstart' in window ? 'Touchez une salle pour y aller · glissez pour déplacer la vue' : 'Flèches / ZQSD : marcher · Clic : aller · Molette : zoom · Glisser : déplacer · Entrée : ouvrir · J : missions · Échap : quitter'}</div>
      <div class="jx-bulle-root"></div>`;
    monde = racine.querySelector('.jx-monde');
    svg = racine.querySelector('.jx-svg');
    heros = svg.querySelector('#jx-heros');
    invite = racine.querySelector('.jx-invite');
    bulle = racine.querySelector('.jx-bulle-root');
    vueTotale = bornesMonde();
    corpsHeros(); dessinerHeros();
    cadrer(1);
    brancher(E);
  }

  function brancher(E) {
    let drag = null;
    svg.addEventListener('pointerdown', e => { if (e.button) return; drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, bouge: false, id: e.pointerId }; });
    svg.addEventListener('pointermove', e => {
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.bouge && Math.hypot(dx, dy) > 5) { drag.bouge = true; try { svg.setPointerCapture(e.pointerId); } catch (_e) { /* */ } svg.classList.add('glisse'); }
        if (drag.bouge) { const k = cam.w / svg.clientWidth; cam.x = drag.cx - dx * k; cam.y = drag.cy - dy * k; appliquerCam(); }
        return;
      }
      const p = versVue(e.clientX, e.clientY); if (!p) return;
      const w = versMonde(p.x, p.y), s = salleEn(w.x, w.y), r = s ? s.route : '';
      if (svg.dataset.survol !== r) {
        svg.dataset.survol = r;
        svg.querySelectorAll('.jx-zone').forEach(z => z.classList.toggle('survol', z.dataset.route === r));
        svg.querySelectorAll('.jx-etiq').forEach(z => z.classList.toggle('survol', z.dataset.route === r));
      }
    });
    const fin = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null; svg.classList.remove('glisse');
      if (d.bouge || e.type === 'pointercancel') return;
      if (bulle.innerHTML) { fermerBulle(); return; }
      const et = e.target.closest && e.target.closest('.jx-etiq');
      if (et) { aller(SALLES.find(s => s.route === et.dataset.route)); return; }
      const p = versVue(e.clientX, e.clientY); if (!p) return;
      const w = versMonde(p.x, p.y), s = salleEn(w.x, w.y);
      if (s) aller(s);
      else { J.cible = [Math.max(MONDE.x0 + 2, Math.min(MONDE.x1 - 2, w.x)), Math.max(MONDE.y0 + 2, Math.min(MONDE.y1 - 2, w.y))]; J.salleCible = null; J.suivre = true; }
    };
    svg.addEventListener('pointerup', fin); svg.addEventListener('pointercancel', fin);
    svg.addEventListener('wheel', e => { e.preventDefault(); const p = versVue(e.clientX, e.clientY); zoomer(Math.exp(e.deltaY * 0.0015), p && p.x, p && p.y); }, { passive: false });
    racine.querySelector('[data-jx-quitter]').onclick = () => fermer();
    racine.querySelector('[data-jx-aide]').onclick = aide;
    racine.querySelector('.jx-btn-quetes').onclick = () => journal(E);
    racine.querySelectorAll('[data-jx-zoom]').forEach(b => b.onclick = () => { const z = b.dataset.jxZoom; if (z === 'fit') { if (cam.w < vueTotale.w * 0.6) cadrer(1); else centrerSurHeros(); } else zoomer(z === 'in' ? 0.75 : 1.33); });
    racine.querySelectorAll('[data-jx-espace]').forEach(b => b.onclick = () => {
      const g = sur(() => NAV_GROUPS.find(x => x.label === b.dataset.jxEspace), null); if (!g) return;
      const cur = J.salle ? g.routes.indexOf(J.salle.route) : -1;
      aller(SALLES.find(s => s.route === g.routes[(cur + 1) % g.routes.length]));
    });
  }

  function aller(s) {
    if (!s) return;
    fermerBulle();
    J.salleCible = s; J.cible = centreSalle(s); J.suivre = true;
    if (reduit()) { [J.x, J.y] = J.cible; J.cible = null; J.salleCible = null; dessinerHeros(); recentrer(true); dialogue(s); }
  }
  /* Sur petit écran, on démarre zoomé sur la salle du héros ; sinon vue d'ensemble */
  function centrerSurHeros() {
    if (monde.clientWidth >= 760) { recentrer(true); return; }
    cadrer(monde.clientWidth < 480 ? 3.4 : 2.2);
    const [sx, sy] = P(J.x, J.y);
    cam.x = sx - cam.w / 2; cam.y = sy - cam.h * 0.55; appliquerCam();
  }
  /* La caméra suit le héros quand il sort du cadre central */
  function recentrer(immediat) {
    const [sx, sy] = P(J.x, J.y), mx = cam.w * 0.22, my = cam.h * 0.22;
    let tx = cam.x, ty = cam.y;
    if (sx < cam.x + mx) tx = sx - mx; else if (sx > cam.x + cam.w - mx) tx = sx - cam.w + mx;
    if (sy < cam.y + my) ty = sy - my; else if (sy > cam.y + cam.h - my) ty = sy - cam.h + my;
    if (tx === cam.x && ty === cam.y) return;
    const k = immediat ? 1 : 0.08;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; appliquerCam();
  }

  function boucle(ts) {
    if (!ouverte) return;
    const dt = Math.min(0.05, (ts - (J.t0 || ts)) / 1000); J.t0 = ts;
    let ex = 0, ey = 0;                              // direction à l'écran
    const T = J.touches;
    if (T.has('ArrowLeft') || T.has('q') || T.has('a')) ex -= 1;
    if (T.has('ArrowRight') || T.has('d')) ex += 1;
    if (T.has('ArrowUp') || T.has('z') || T.has('w')) ey -= 1;
    if (T.has('ArrowDown') || T.has('s')) ey += 1;
    let bouge = false;
    if (ex || ey) {
      // écran → monde : droite = (+x, −y), bas = (+x, +y)
      let vx = ex + ey, vy = -ex + ey; const l = Math.hypot(vx, vy) || 1; vx /= l; vy /= l;
      J.cible = null; J.salleCible = null; J.suivre = true;
      J.x += vx * VITESSE * dt; J.y += vy * VITESSE * dt; bouge = true;
    } else if (J.cible) {
      const dx = J.cible[0] - J.x, dy = J.cible[1] - J.y, d = Math.hypot(dx, dy), pas = VITESSE * 1.8 * dt;
      if (d <= pas) {
        [J.x, J.y] = J.cible; J.cible = null;
        if (J.salleCible) { const s = J.salleCible; J.salleCible = null; dialogue(s); }
      } else { J.x += dx / d * pas; J.y += dy / d * pas; bouge = true; }
    }
    J.x = Math.max(MONDE.x0 + 1, Math.min(MONDE.x1 - 1, J.x)); J.y = Math.max(MONDE.y0 + 1, Math.min(MONDE.y1 - 1, J.y));
    if (bouge) { J.t += dt; dessinerHeros(reduit() ? 0 : Math.abs(Math.sin(J.t * 14)) * 3); }
    else if (J.t) { J.t = 0; dessinerHeros(); }
    if (J.suivre) { recentrer(false); if (!bouge && !J.cible) J.suivre = false; }
    majSalle();
    J.raf = requestAnimationFrame(boucle);
  }
  function majSalle() {
    const s = salleEn(J.x, J.y);
    if (s === J.salle) return;
    J.salle = s;
    svg.querySelectorAll('.jx-zone').forEach(z => z.classList.toggle('ici', !!s && z.dataset.route === s.route));
    if (s && !bulle.innerHTML) {
      invite.hidden = false;
      invite.innerHTML = `<i style="background:${ESPACES[espaceDe(s.route)] || '#888'}"></i><b>${esc(s.nom)}</b><span>Entrée pour ouvrir</span>`;
    } else invite.hidden = true;
  }

  /* ---------- Dialogues ---------- */
  function fermerBulle() { if (bulle) bulle.innerHTML = ''; if (invite && J.salle) invite.hidden = false; }
  function boite2(html, large) {
    invite.hidden = true;
    bulle.innerHTML = `<div class="jx-dialogue ${large ? 'large' : ''}" role="dialog">${html}</div>`;
    const d = bulle.firstElementChild;
    d.addEventListener('pointerup', e => e.stopPropagation());
    bulle.onclick = e => { if (e.target === bulle) fermerBulle(); };
    d.querySelectorAll('[data-jx-fermer]').forEach(b => b.onclick = fermerBulle);
    d.querySelectorAll('[data-jx-go]').forEach(b => b.onclick = () => entrer(b.dataset.jxGo));
    const f = d.querySelector('[data-jx-entrer]') || d.querySelector('button'); if (f) f.focus({ preventScroll: true });
    return d;
  }
  function dialogue(s) {
    if (!s) return;
    const E = etat(), I = infos(s.route, E), q = E.actions.filter(a => a.route === s.route), esp = espaceDe(s.route);
    boite2(`<div class="jx-d-tete"><span class="jx-d-zone" style="--c:${ESPACES[esp] || '#888'}">${esc(esp)}</span><h3>${esc(s.nom)}</h3><div class="jx-d-sous">${esc(labelDe(s.route))}</div></div>
      <p class="jx-d-texte">${esc(I.texte)}</p>
      ${I.lignes.length ? `<dl class="jx-d-stats">${I.lignes.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(String(b))}</dd></div>`).join('')}</dl>` : ''}
      ${q.length ? `<div class="jx-d-quetes"><div class="jx-d-qt">${plur(q.length, 'mission')} dans cette salle</div>${q.slice(0, 4).map(a => `<div class="jx-q ${a.tone}"><span>${a.title}</span><em>${esc(a.badge)}</em></div>`).join('')}${q.length > 4 ? `<div class="jx-q-plus">+ ${q.length - 4} autre(s)</div>` : ''}</div>` : ''}
      <div class="jx-d-act"><button class="jx-btn" data-jx-fermer>Rester sur la carte</button><button class="jx-btn primaire" data-jx-entrer data-jx-go="${s.route}">Ouvrir ${esc(labelDe(s.route).replace(/ — .*/, ''))} →</button></div>`);
  }
  function journal(E) {
    E = E || etat();
    const nomSalle = r => (SALLES.find(s => s.route === r) || {}).nom || r;
    boite2(`<div class="jx-d-tete"><span class="jx-d-zone" style="--c:#e8590c">Missions</span><h3>Ce qui vous attend</h3><div class="jx-d-sous">${E.actions.length ? plur(E.actions.length, 'mission') + ' · les plus urgentes en premier' : 'Rien en retard'}</div></div>
      ${E.actions.length ? `<div class="jx-d-quetes jx-journal">${E.actions.map(a => `<button class="jx-q ${a.tone}" data-jx-voir="${a.route}"><span>${a.title}</span><em>${esc(a.badge)}</em><small>${esc(nomSalle(a.route))} — y aller</small></button>`).join('')}</div>`
        : `<p class="jx-d-texte">Aucune action en retard. Profitez-en pour passer au plateau prospection !</p>`}
      <div class="jx-d-act"><button class="jx-btn" data-jx-fermer>Fermer</button></div>`, true)
      .querySelectorAll('[data-jx-voir]').forEach(b => b.onclick = () => aller(SALLES.find(s => s.route === b.dataset.jxVoir)));
  }
  function aide() {
    boite2(`<div class="jx-d-tete"><span class="jx-d-zone" style="--c:#2a6fc4">Aide</span><h3>Bienvenue dans votre agence</h3></div>
      <p class="jx-d-texte">Chaque salle est un écran de ChargéPro, regroupée par espace comme dans le menu. Les chiffres et le mobilier viennent de vos données, en direct.</p>
      <dl class="jx-d-stats">
        <div><dt>Marcher</dt><dd>Flèches ou ZQSD · clic sur le sol</dd></div>
        <div><dt>Aller dans une salle</dt><dd>Clic sur la salle ou son étiquette</dd></div>
        <div><dt>Ouvrir l'écran</dt><dd>Entrée</dd></div>
        <div><dt>Zoom / vue</dt><dd>Molette · glisser · boutons en bas</dd></div>
        <div><dt>Missions</dt><dd>« ! » au-dessus des salles · touche J</dd></div>
        <div><dt>Niveau</dt><dd>CA réalisé vs objectif annuel</dd></div>
        <div><dt>Camionnettes du parking</dt><dd>Une par chantier actif</dd></div>
        <div><dt>Revenir à la carte</dt><dd>Bouton « Carte » en bas à droite</dd></div>
      </dl>
      <div class="jx-d-act"><button class="jx-btn primaire" data-jx-fermer>C'est parti</button></div>`);
  }

  /* ---------- Entrée / sortie ---------- */
  function entrer(route) { dernier = route; fermer(); if (typeof go === 'function') go(route); }
  function clavier(e) {
    if (!ouverte) return;
    if (document.querySelector('#modal-root .modal-back')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape') { e.preventDefault(); if (bulle.innerHTML) fermerBulle(); else fermer(); return; }
    if (bulle.innerHTML) {
      if (key === 'Enter' && document.activeElement && bulle.contains(document.activeElement)) return; // bouton focalisé
      if (key === 'Enter') { const b = bulle.querySelector('[data-jx-entrer]'); if (b) { e.preventDefault(); b.click(); } }
      return;
    }
    if (key === 'j') { e.preventDefault(); journal(); return; }
    if (key === '+' || key === '=') { zoomer(0.8); return; }
    if (key === '-') { zoomer(1.25); return; }
    if ((key === 'Enter' || key === ' ' || key === 'e') && J.salle) { e.preventDefault(); dialogue(J.salle); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z', 'q', 's', 'd', 'w', 'a'].includes(key)) { e.preventDefault(); J.touches.add(key); }
  }
  function relache(e) { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; J.touches.delete(key); }

  function ouvrir() {
    if (typeof DB === 'undefined' || !DB.data || !DB.currentProfile()) return;
    if (!racine) {
      racine = document.createElement('div');
      racine.id = 'jeu-root';
      document.body.appendChild(racine);
      document.addEventListener('keydown', clavier);
      document.addEventListener('keyup', relache);
      window.addEventListener('blur', () => J.touches.clear());
      window.addEventListener('resize', () => { if (ouverte && svg) { const r = monde.clientWidth / monde.clientHeight; cam.h = cam.w / r; appliquerCam(); } });
    }
    const depart = SALLES.find(s => s.route === dernier) || HALL;
    [J.x, J.y] = centreSalle(depart); J.cible = null; J.salleCible = null; J.salle = null; J.touches.clear();
    ouverte = true;
    document.documentElement.classList.add('jeu-ouvert');
    racine.hidden = false;
    construire();
    centrerSurHeros();
    cancelAnimationFrame(J.raf); J.t0 = 0; J.raf = requestAnimationFrame(boucle);
  }
  function fermer() {
    ouverte = false;
    cancelAnimationFrame(J.raf);
    J.touches.clear();
    document.documentElement.classList.remove('jeu-ouvert');
    if (racine) { racine.hidden = true; racine.innerHTML = ''; }
  }
  /* Bouton flottant « Carte » (affiché quand le mode est actif, hors carte) */
  function fab() {
    let b = document.getElementById('jeu-fab');
    if (!b) {
      b = document.createElement('button');
      b.id = 'jeu-fab'; b.type = 'button'; b.title = "Revenir à la carte de l'agence";
      b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg><span>Carte</span>`;
      b.onclick = () => { if (typeof current !== 'undefined') dernier = current; ouvrir(); };
      document.body.appendChild(b);
    }
    return b;
  }
  function actif() { return typeof UI !== 'undefined' && UI.prefs.game === 'on'; }
  function majBouton() {
    const b = document.getElementById('game-btn');
    if (b) { b.classList.toggle('on', actif()); b.setAttribute('aria-pressed', actif() ? 'true' : 'false'); b.title = actif() ? 'Mode carte activé — cliquer pour revenir au mode classique' : 'Activer le mode carte (vue 3D de l’agence)'; }
    fab();
  }

  window.CPJeu = {
    /* Appelé au démarrage de l'application */
    init() { majBouton(); if (actif()) { dernier = typeof current !== 'undefined' ? current : 'dashboard'; ouvrir(); } },
    basculer() {
      UI.set('game', actif() ? 'off' : 'on');
      majBouton();
      if (actif()) { dernier = typeof current !== 'undefined' ? current : 'dashboard'; ouvrir(); toast('Mode carte activé — bienvenue dans votre agence'); }
      else { fermer(); toast('Mode classique rétabli'); }
    },
    /* Données modifiées (changement de profil, synchro Drive…) : redessiner si la carte est affichée */
    rafraichir() { if (ouverte) { const c = { ...cam }; construire(); Object.assign(cam, c); appliquerCam(); } },
    ouvrir, fermer,
    get ouverte() { return ouverte; },
  };
})();
