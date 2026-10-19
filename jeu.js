/* =========================================================================
   ChargéPro — Mode carte (jeu vidéo)
   Option activable (bouton manette de la barre du haut) : l'application se
   présente comme une carte de jeu en pixel art. Chaque écran est un bâtiment
   du royaume, regroupé par quartier (= groupes du menu). Le héros se déplace
   au clavier (flèches / ZQSD) ou au clic ; les chiffres clés deviennent un
   HUD (niveau = CA vs objectif, or, marge, santé) et les actions prioritaires
   deviennent des quêtes.
   Chargé avant le script principal : n'utilise DB, go, collectActions… qu'à
   l'exécution, une fois l'application démarrée.
   ========================================================================= */
'use strict';
(function () {
  const W = 1600, H = 1000;           // repère de la carte (unités SVG)
  const VITESSE = 340;                // unités / seconde
  const PROCHE = 88;                  // distance d'interaction avec un bâtiment
  const NS = 'http://www.w3.org/2000/svg';

  /* Quartiers = groupes du menu. Couleur de toit + position de la pancarte */
  const ZONES = {
    Pilotage:     { toit: '#c92a2a', sx: 800, sy: 300 },
    Commercial:   { toit: '#e8590c', sx: 235, sy: 480 },
    Exploitation: { toit: '#1c7ed6', sx: 1320, sy: 110 },
    'Exécution':  { toit: '#7048e8', sx: 150, sy: 815 },
    Entretien:    { toit: '#2f9e44', sx: 395, sy: 930 },
    Finances:     { toit: '#f08c00', sx: 1080, sy: 590 },
  };
  /* Bâtiments : un par écran de l'application. (x, y) = pied du bâtiment */
  const LIEUX = [
    { route: 'dashboard',   nom: 'Le Quartier Général',        type: 'chateau',   x: 800,  y: 500 },
    { route: 'prospection', nom: 'La Taverne des Rencontres',  type: 'taverne',   x: 200,  y: 300 },
    { route: 'devis',       nom: 'La Guilde des Scribes',      type: 'guilde',    x: 395,  y: 200 },
    { route: 'otps',        nom: 'La Tour des Comptes',        type: 'tour',      x: 590,  y: 270 },
    { route: 'clients',     nom: "L'Auberge des Clients",      type: 'maison',    x: 400,  y: 420 },
    { route: 'chantiers',   nom: 'Le Grand Chantier',          type: 'chantier',  x: 1010, y: 250 },
    { route: 'planning',    nom: "La Tour de l'Horloge",       type: 'horloge',   x: 1215, y: 175 },
    { route: 'cadences',    nom: 'La Forge des Cadences',      type: 'forge',     x: 1410, y: 260 },
    { route: 'bte',         nom: "L'Atelier des Plans",        type: 'maison',    x: 1210, y: 400 },
    { route: 'achats',      nom: 'Le Marché aux Fournisseurs', type: 'marche',    x: 1420, y: 470 },
    { route: 'docs',        nom: 'La Bibliothèque',            type: 'biblio',    x: 220,  y: 720 },
    { route: 'entretien',   nom: 'Le Moulin des Visites',      type: 'moulin',    x: 545,  y: 860 },
    { route: 'ca',          nom: 'La Banque Royale',           type: 'banque',    x: 1040, y: 760 },
    { route: 'factures',    nom: "L'Hôtel des Monnaies",       type: 'guilde',    x: 1265, y: 880 },
    { route: 'raf',         nom: 'Le Coffre au Trésor',        type: 'coffre',    x: 1440, y: 690 },
  ];
  /* Hauteur de chaque type de bâtiment (pour placer pastilles et « ! ») */
  const HAUT = { chateau: 172, taverne: 108, guilde: 112, tour: 176, maison: 100, chantier: 158, horloge: 196, forge: 120, marche: 56, biblio: 122, moulin: 168, banque: 116, coffre: 104 };
  const PIED = 94;                    // le héros se tient sous l'étiquette du bâtiment
  const etiquette = label => label.replace(/ — .*/, '');
  const largeurPlaque = txt => Math.max(96, txt.length * 9 + 22);
  const RANGS = ['Apprenti', 'Compagnon', "Chef d'équipe", 'Chef de chantier', 'Conducteur de travaux',
    "Chargé d'affaires", "Chargé d'affaires confirmé", 'Maître bâtisseur', 'Grand architecte', 'Légende du BTP'];

  /* ---------- Utilitaires ---------- */
  const reduit = () => !!window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nuit = () => typeof UI !== 'undefined' && UI.isDark();
  const sur = (fn, def) => { try { const v = fn(); return v === undefined ? def : v; } catch (_e) { return def; } };
  const hache = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const k = n => Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' M€'
    : Math.abs(n) >= 1e3 ? Math.round(n / 1e3).toLocaleString('fr-FR') + ' k€' : Math.round(n).toLocaleString('fr-FR') + ' €';
  const plur = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);

  /* Pixel art : chaque ligne est une chaîne, chaque lettre une couleur de la palette */
  function pixels(rows, pal, t = 1, ox = 0, oy = 0) {
    let out = '';
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length;) {
        const c = r[x]; let n = 1;
        while (r[x + n] === c) n++;
        if (pal[c]) out += `<rect x="${ox + x * t}" y="${oy + y * t}" width="${n * t}" height="${t}" fill="${pal[c]}"/>`;
        x += n;
      }
    });
    return out;
  }
  const PAL_HEROS = { y: '#ffd43b', Y: '#f59f00', s: '#f1c27d', K: '#212529', o: '#ff6b00', O: '#ffe066', b: '#1c4e80', k: '#3b2f2f' };
  const HEROS_TETE = [
    '...yyyy...',
    '..yyyyyy..',
    '.YYYYYYYY.',
    '..ssssss..',
    '..sKssKs..',
    '..ssssss..',
    '...ssss...',
    '..oOooOo..',
    '.ooOooOoo.',
    's.oOooOo.s',
    '..bbbbbb..',
  ];
  const HEROS_PAS = [
    ['..bb..bb..', '..bb..bb..', '.kkk..kkk.'],
    ['..bb...bb.', '.bb....bb.', '.kkk...kkk'],
    ['.bb...bb..', '.bb....bb.', 'kkk...kkk.'],
  ];
  const ICO = {
    coeur: [['.rr.rr.', 'rRrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: '#e03131', R: '#ffa8a8' }],
    vide:  [['.gg.gg.', 'g..g..g', 'g.....g', '.g...g.', '..g.g..', '...g...'], { g: '#868e96' }],
    piece: [['.ooo.', 'oOyoo', 'oyOyo', 'ooyOo', '.ooo.'], { o: '#f59f00', O: '#fff3bf', y: '#e67700' }],
    gemme: [['.bbb.', 'bBbbb', 'bbbbb', '.bbb.', '..b..'], { b: '#15aabf', B: '#c5f6fa' }],
    parch: [['pppppp', 'pkkkkp', 'pppppp', 'pkkkpp', 'pppppp'], { p: '#f4e3b5', k: '#8d6e63' }],
  };
  const icoPx = (n, t = 3) => { const [r, p] = ICO[n]; return `<svg class="jx-px" viewBox="0 0 ${r[0].length * t} ${r.length * t}" width="${r[0].length * t}" height="${r.length * t}" aria-hidden="true">${pixels(r, p, t)}</svg>`; };

  /* ---------- Données du royaume (calculées depuis le profil courant) ---------- */
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
    return { ca, obj, marge, cible: +o.margeCible || 0, actions, niv, xp, rang: RANGS[niv - 1], resteNiv: Math.max(0, niv * palier - ca), critiques, vies: Math.max(0, 5 - critiques) };
  }
  /* Ce que l'on lit sur chaque bâtiment : lignes de statistiques + pastille */
  function infos(route, E) {
    const d = DB.data, t = todayISO();
    const L = (...l) => l.filter(Boolean);
    switch (route) {
      case 'dashboard': return { badge: E.actions.length || null, lignes: L(['CA annuel', eur(E.ca) + ' / ' + eur(E.obj)], ['Marge brute', pct(E.marge)], ['Quêtes ouvertes', E.actions.length]),
        texte: 'Le cœur du royaume : vos chiffres clés et votre to-do list.' };
      case 'prospection': {
        const rel = d.prospection.filter(p => p.prochaine && p.prochaine <= t && !['gagne', 'sans_suite'].includes(p.statut)).length;
        return { badge: rel || null, lignes: L(['RDV nouveaux ce mois', sur(rdvNouveauxMois, 0) + ' / ' + d.objectifs.rdvMois], ['Relances dues', rel], ['Contacts suivis', d.prospection.length]),
          texte: 'On y croise de futurs clients. Les meilleurs contrats naissent autour d’une table.' };
      }
      case 'devis': {
        const att = d.devis.filter(x => x.statut === 'attente').length, env = d.devis.filter(x => ['envoye', 'relance'].includes(x.statut)).length;
        return { badge: att || null, lignes: L(["En attente d'envoi", att], ['Envoyés / relancés', env], ['Acceptés', d.devis.filter(x => x.statut === 'accepte').length]),
          texte: 'Les scribes rédigent vos devis. Plus vite ils partent, plus vite on signe.' };
      }
      case 'otps': return { badge: null, lignes: L(['Comptes OTP', sur(() => otpDistinct().filter(c => c.trim()).length, d.otps.length)]), texte: 'Chaque affaire a son compte. La tour garde la mémoire de tous.' };
      case 'clients': return { badge: null, lignes: L(['Clients', d.clients.length], ['Grands comptes', d.clients.filter(c => c.type === 'Grand compte').length]), texte: 'Les habitués de l’auberge : syndics, grands comptes, collectivités.' };
      case 'chantiers': {
        const act = d.chantiers.filter(c => ['commande', 'en_cours'].includes(c.statut)).length;
        return { badge: act || null, lignes: L(['Chantiers actifs', act], ['Carnet de commandes', eur(sur(carnetCommandes, 0))], ['Réceptionnés', d.chantiers.filter(c => c.statut === 'receptionne').length]),
          texte: 'Grues, échafaudages et rouleaux de membrane : c’est ici que tout se construit.' };
      }
      case 'planning': {
        const sem = sur(() => mondayISO(), ''), h = d.pointages.filter(p => p.semaine === sem).reduce((s, p) => s + (p.h || []).reduce((a, b) => a + (+b || 0), 0), 0);
        return { badge: null, lignes: L(['Équipes', d.equipes.length], ['Heures pointées (semaine)', num(h) + ' h']), texte: 'La grande horloge règle le pas des équipes.' };
      }
      case 'cadences': return { badge: null, lignes: L(['Études de cadence', d.cadEtudes.length], ['Ouvrages perso', d.cadBase.perso.length]), texte: 'Le forgeron chiffre chaque ouvrage au rythme des compagnons.' };
      case 'bte': {
        const val = d.bte.filter(b => b.statut === 'valide').length;
        return { badge: null, lignes: L(['Budgets chantier', d.bte.length], ['Validés', val], ['En étude', d.bte.length - val]), texte: 'Les plans de bataille de chaque chantier, poste par poste.' };
      }
      case 'achats': {
        const att = d.commandes.filter(c => c.statut === 'commande').length;
        return { badge: att || null, lignes: L(['Commandes en attente de livraison', att], ['Commandes totales', d.commandes.length]), texte: 'Les marchands livrent membranes, isolants et accessoires.' };
      }
      case 'docs': return { badge: null, lignes: L(["Dossiers d'exécution", d.dossiers.length]), texte: 'PPSPS, DOE, fiches techniques : la bibliothèque n’oublie rien.' };
      case 'entretien': {
        const prog = sur(() => d.contrats.filter(contratAProgrammer).length, 0), rap = sur(() => rapportsEnRetard().length, 0);
        return { badge: (prog + rap) || null, lignes: L(['Contrats', d.contrats.length], ['Visites à programmer', prog], ['Rapports en retard', rap]), texte: 'Le moulin tourne au rythme des visites d’entretien.' };
      }
      case 'ca': return { badge: null, lignes: L(['CA réalisé', eur(E.ca)], ['Objectif', eur(E.obj)], ['Marge brute', pct(E.marge) + ' (cible ' + pct(E.cible) + ')']), texte: 'Les coffres de la banque reflètent l’année du royaume.' };
      case 'factures': {
        const aem = d.factures.filter(f => f.statut === 'a_emettre').length, ret = sur(() => d.factures.filter(f => factureFlags(f).retardPaiement).length, 0);
        const enc = d.factures.filter(f => f.statut === 'emise').reduce((s, f) => s + (+f.montantHT || 0), 0);
        return { badge: (aem + ret) || null, lignes: L(['À émettre', aem], ['Encours facturé', eur(enc)], ['Impayés en retard', ret]), texte: 'On y frappe les factures. Gare aux impayés !' };
      }
      case 'raf': {
        const coffre = sur(() => otpDistinct().filter(c => c.trim() && !otpHorsPerimetre(c)).reduce((s, c) => s + (+rafFinance(c).coffre || 0), 0), null);
        return { badge: null, lignes: L(coffre !== null && ['Boîte à affaires', eur(coffre)]), texte: 'Le trésor qui reste à facturer : commandé, mais pas encore encaissé.' };
      }
    }
    return { badge: null, lignes: [], texte: '' };
  }

  /* ---------- Dessin des bâtiments (pixel art en SVG) ---------- */
  function fen(x, y, w = 10, h = 12) { return `<rect class="jx-fen" x="${x}" y="${y}" width="${w}" height="${h}"/><rect x="${x}" y="${y + h / 2 - 1}" width="${w}" height="2" fill="#5c3d2e" opacity=".6"/>`; }
  function porte(x, y, w = 16, h = 22) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#5c3d2e"/><rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 2}" fill="#8d5b3c"/><rect x="${x + w - 6}" y="${y + h / 2}" width="2" height="2" fill="#ffd43b"/>`; }
  function toitPointe(x, y, w, h, c) { return `<polygon points="${x - 6},${y} ${x + w / 2},${y - h} ${x + w + 6},${y}" fill="${c}"/><polygon points="${x + w / 2},${y - h} ${x + w + 6},${y} ${x + w / 2},${y}" fill="#000" opacity=".15"/>`; }
  function murs(x, y, w, h, c = '#e9dcc0') { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/><rect x="${x + w - 8}" y="${y}" width="8" height="${h}" fill="#000" opacity=".1"/>`; }
  function pierre(x, y, w, h) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#adb5bd"/><rect x="${x + w - 8}" y="${y}" width="8" height="${h}" fill="#000" opacity=".12"/>`
    + Array.from({ length: Math.floor(h / 10) }, (_, i) => `<rect x="${x + (i % 2 ? 6 : 14)}" y="${y + 4 + i * 10}" width="12" height="3" fill="#868e96"/>`).join(''); }

  function dessin(type, c) {
    switch (type) {
      case 'chateau': return pierre(-80, -70, 160, 70)
        + pierre(-100, -110, 40, 110) + pierre(60, -110, 40, 110) + pierre(-22, -130, 44, 70)
        + [-100, -88, -76, 60, 72, 84].map(x => `<rect x="${x}" y="-118" width="8" height="8" fill="#adb5bd"/>`).join('')
        + [-22, -10, 2, 14].map(x => `<rect x="${x}" y="-138" width="6" height="8" fill="#adb5bd"/>`).join('')
        + `<rect x="-1" y="-170" width="3" height="40" fill="#495057"/><path class="jx-drapeau" d="M2 -170 h26 l-6 7 l6 7 h-26z" fill="${c}"/>`
        + `<path d="M-16 0 v-26 a16 16 0 0 1 32 0 v26z" fill="#5c3d2e"/><path d="M-12 0 v-24 a12 12 0 0 1 24 0 v24z" fill="#8d5b3c"/>`
        + fen(-88, -90, 10, 14) + fen(74, -90, 10, 14) + fen(-6, -112, 12, 14) + fen(-60, -50) + fen(44, -50)
        + `<rect x="-70" y="-74" width="140" height="4" fill="${c}" opacity=".85"/>`;
      case 'taverne': return murs(-55, -60, 110, 60, '#d9b98c') + toitPointe(-55, -60, 110, 40, c) + porte(-8, -22)
        + fen(-42, -44) + fen(30, -44) + `<rect x="58" y="-58" width="3" height="30" fill="#5c3d2e"/><rect x="50" y="-54" width="22" height="16" fill="#f4e3b5" stroke="#5c3d2e" stroke-width="2"/><rect x="56" y="-50" width="10" height="8" fill="#e67700"/>`
        + `<rect x="-30" y="-108" width="10" height="22" fill="#868e96"/>`;
      case 'guilde': return murs(-60, -70, 120, 70) + `<polygon points="-68,-70 0,-112 68,-70" fill="${c}"/><polygon points="0,-112 68,-70 0,-70" fill="#000" opacity=".15"/>`
        + `<circle cx="0" cy="-86" r="8" class="jx-fen"/>` + porte(-9, -24, 18, 24) + fen(-46, -52) + fen(-28, -52) + fen(18, -52) + fen(36, -52)
        + `<rect x="-60" y="-8" width="120" height="8" fill="#ced4da"/>`;
      case 'tour': return pierre(-26, -130, 52, 130) + `<polygon points="-34,-130 0,-176 34,-130" fill="${c}"/><polygon points="0,-176 34,-130 0,-130" fill="#000" opacity=".15"/>`
        + fen(-6, -112, 12, 16) + fen(-6, -78, 12, 16) + porte(-8, -24);
      case 'maison': return murs(-48, -56, 96, 56) + toitPointe(-48, -56, 96, 36, c) + `<rect x="22" y="-100" width="10" height="24" fill="#a61e4d"/>`
        + porte(-8, -22) + fen(-36, -42) + fen(24, -42);
      case 'chantier': return `<rect x="-70" y="-42" width="80" height="42" fill="#ced4da"/><rect x="-70" y="-42" width="80" height="4" fill="#868e96"/>`
        + Array.from({ length: 4 }, (_, i) => `<rect x="${-66 + i * 20}" y="-36" width="12" height="10" class="jx-fen"/>`).join('')
        + `<g stroke="#8d5b3c" stroke-width="3">${[-70, -50, -30, -10, 10].map(x => `<line x1="${x}" y1="0" x2="${x}" y2="-74"/>`).join('')}<line x1="-72" y1="-58" x2="12" y2="-58"/><line x1="-72" y1="-74" x2="12" y2="-74"/></g>`
        + `<rect x="34" y="-150" width="8" height="150" fill="#fab005"/>${Array.from({ length: 14 }, (_, i) => `<line x1="34" y1="${-6 - i * 10}" x2="42" y2="${-14 - i * 10}" stroke="#e67700" stroke-width="2"/>`).join('')}`
        + `<rect x="-40" y="-158" width="120" height="7" fill="#fab005"/><rect x="66" y="-150" width="14" height="12" fill="#495057"/>`
        + `<g class="jx-crochet"><line x1="-24" y1="-151" x2="-24" y2="-110" stroke="#343a40" stroke-width="2"/><rect x="-34" y="-110" width="20" height="12" fill="${c}"/></g>`
        + `<polygon points="50,0 62,-18 74,0" fill="#ff922b"/><rect x="54" y="-9" width="16" height="3" fill="#fff"/>`;
      case 'horloge': return pierre(-28, -150, 56, 150) + `<polygon points="-36,-150 0,-196 36,-150" fill="${c}"/>`
        + `<circle cx="0" cy="-118" r="18" fill="#fff9db" stroke="#5c3d2e" stroke-width="4"/><g class="jx-aiguille"><line x1="0" y1="-118" x2="0" y2="-132" stroke="#212529" stroke-width="3"/></g><line x1="0" y1="-118" x2="9" y2="-118" stroke="#212529" stroke-width="3"/>`
        + fen(-6, -78, 12, 16) + porte(-9, -26, 18, 26);
      case 'forge': return `<rect x="-60" y="-56" width="120" height="56" fill="#868e96"/><rect x="52" y="-56" width="8" height="56" fill="#000" opacity=".12"/>`
        + `<polygon points="-66,-56 0,-86 66,-56" fill="${c}"/><rect x="28" y="-112" width="18" height="46" fill="#495057"/>`
        + `<g class="jx-fumee">${[0, 1, 2].map(i => `<circle cx="37" cy="-120" r="${7 + i * 2}" fill="#dee2e6" style="animation-delay:${i * .9}s"/>`).join('')}</g>`
        + `<rect x="-44" y="-36" width="34" height="36" fill="#212529"/><rect x="-40" y="-20" width="26" height="20" class="jx-feu"/>`
        + `<rect x="10" y="-14" width="30" height="8" fill="#343a40"/><rect x="18" y="-6" width="14" height="6" fill="#343a40"/>`;
      case 'marche': return [-62, -2].map((x, i) => `<rect x="${x + 4}" y="-40" width="4" height="40" fill="#5c3d2e"/><rect x="${x + 52}" y="-40" width="4" height="40" fill="#5c3d2e"/>`
        + `<rect x="${x}" y="-18" width="60" height="18" fill="#8d5b3c"/>`
        + Array.from({ length: 6 }, (_, j) => `<rect x="${x + j * 10}" y="-56" width="10" height="16" fill="${j % 2 ? '#fff' : (i ? '#2f9e44' : c)}"/>`).join('')
        + `<rect x="${x + 8}" y="-26" width="10" height="8" fill="#fab005"/><rect x="${x + 22}" y="-26" width="12" height="8" fill="#e03131"/><rect x="${x + 38}" y="-26" width="10" height="8" fill="#74c0fc"/>`).join('')
        + `<rect x="64" y="-22" width="18" height="22" fill="#8d5b3c"/><rect x="64" y="-22" width="18" height="4" fill="#5c3d2e"/>`;
      case 'biblio': return murs(-66, -80, 132, 80, '#dee2e6') + `<rect x="-74" y="-92" width="148" height="12" fill="${c}"/><polygon points="-74,-92 0,-122 74,-92" fill="${c}"/><polygon points="0,-122 74,-92 0,-92" fill="#000" opacity=".15"/>`
        + [-56, -30, 18, 44].map(x => `<rect x="${x}" y="-80" width="10" height="80" fill="#f8f9fa"/><rect x="${x - 2}" y="-80" width="14" height="4" fill="#ced4da"/>`).join('')
        + porte(-10, -30, 20, 30) + `<rect x="-6" y="-112" width="12" height="10" fill="#fff9db"/>`;
      case 'moulin': return `<polygon points="-34,0 -24,-96 24,-96 34,0" fill="#e9dcc0"/><polygon points="12,-96 24,-96 34,0 18,0" fill="#000" opacity=".1"/>`
        + `<polygon points="-30,-96 0,-124 30,-96" fill="${c}"/>` + porte(-8, -24) + fen(-6, -66)
        + `<g class="jx-pales">${[0, 90, 180, 270].map(a => `<g transform="rotate(${a} 0 -98)"><rect x="-3" y="-168" width="6" height="70" fill="#5c3d2e"/><rect x="3" y="-164" width="16" height="56" fill="#f8f9fa" stroke="#adb5bd" stroke-width="1"/></g>`).join('')}<circle cx="0" cy="-98" r="6" fill="#343a40"/></g>`;
      case 'banque': return `<rect x="-70" y="-12" width="140" height="12" fill="#ced4da"/><rect x="-62" y="-80" width="124" height="68" fill="#f1f3f5"/>`
        + [-54, -30, -6, 18, 42].map(x => `<rect x="${x}" y="-76" width="12" height="64" fill="#dee2e6"/><rect x="${x - 2}" y="-80" width="16" height="4" fill="#adb5bd"/>`).join('')
        + `<polygon points="-74,-80 0,-116 74,-80" fill="${c}"/><polygon points="0,-116 74,-80 0,-80" fill="#000" opacity=".15"/><circle cx="0" cy="-94" r="9" fill="#ffd43b" stroke="#e67700" stroke-width="2"/><text x="0" y="-90" text-anchor="middle" font-size="11" font-weight="700" fill="#e67700">€</text>`;
      case 'coffre': return `<rect x="-54" y="-50" width="108" height="50" fill="#8d5b3c"/><rect x="-54" y="-50" width="108" height="50" fill="none" stroke="#5c3d2e" stroke-width="4"/>`
        + `<path d="M-54 -50 v-14 a54 26 0 0 1 108 0 v14z" fill="#a0673f" stroke="#5c3d2e" stroke-width="4"/>`
        + `<rect x="-60" y="-56" width="120" height="8" fill="${c}"/><rect x="-14" y="-62" width="28" height="28" fill="#ffd43b" stroke="#e67700" stroke-width="3"/><rect x="-3" y="-52" width="6" height="10" fill="#5c3d2e"/>`
        + `<g class="jx-eclat">${[[-40, -82], [44, -86], [0, -104]].map(([x, y]) => `<path d="M${x} ${y - 7} l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fff3bf"/>`).join('')}</g>`
        + [-46, 34].map(x => `<rect x="${x}" y="-12" width="12" height="12" fill="#ffd43b" stroke="#e67700"/>`).join('');
    }
    return '';
  }

  /* ---------- Décor : rivière, chemins, arbres, montagnes ---------- */
  function catmull(pts, n = 14) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      for (let j = 0; j < n; j++) {
        const t = j / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(a => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  const RIVIERE = catmull([[-20, 540], [180, 560], [430, 560], [640, 610], [740, 720], [760, 860], [720, 1020]]);
  function rubanRiviere(larg) {
    const g = [], d = [];
    RIVIERE.forEach((p, i) => {
      const a = RIVIERE[Math.max(0, i - 1)], b = RIVIERE[Math.min(RIVIERE.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const w = larg * (0.85 + 0.15 * Math.sin(i / 5));
      g.push([p[0] + nx * w, p[1] + ny * w]); d.push([p[0] - nx * w, p[1] - ny * w]);
    });
    return g.concat(d.reverse()).map(p => p.map(Math.round).join(',')).join(' ');
  }
  const centre = LIEUX[0];
  function chemin(l) {
    const ax = centre.x, ay = centre.y + 14, bx = l.x, by = l.y + 12;
    const mx = (ax + bx) / 2 + (by - ay) * 0.18, my = (ay + by) / 2 - (bx - ax) * 0.12;
    return `M${ax} ${ay} Q${Math.round(mx)} ${Math.round(my)} ${bx} ${by}`;
  }
  function distSeg(p, pts) { let m = 1e9; for (const q of pts) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1])); return m; }
  function echantillonChemin(l) {
    const ax = centre.x, ay = centre.y + 14, bx = l.x, by = l.y + 12;
    const mx = (ax + bx) / 2 + (by - ay) * 0.18, my = (ay + by) / 2 - (bx - ax) * 0.12;
    return Array.from({ length: 30 }, (_, i) => { const t = i / 29, u = 1 - t; return [u * u * ax + 2 * u * t * mx + t * t * bx, u * u * ay + 2 * u * t * my + t * t * by]; });
  }
  function arbres() {
    const r = prng(hache('chargepro')), out = [], routes = LIEUX.slice(1).flatMap(echantillonChemin);
    for (let i = 0; out.length < 150 && i < 4000; i++) {
      const p = [30 + r() * (W - 60), 70 + r() * (H - 100)];
      if (LIEUX.some(l => Math.hypot(p[0] - l.x, (p[1] - l.y) * 1.3 + 50) < 120 || (Math.abs(p[0] - l.x) < 115 && p[1] - l.y > -10 && p[1] - l.y < 80))) continue;
      if (distSeg(p, routes) < 34 || distSeg(p, RIVIERE) < 52) continue;
      if (Object.values(ZONES).some(z => Math.hypot(p[0] - z.sx, p[1] - z.sy) < 70)) continue;
      if (out.some(q => Math.hypot(p[0] - q.x, p[1] - q.y) < 26)) continue;
      out.push({ x: Math.round(p[0]), y: Math.round(p[1]), sapin: r() < 0.4, t: 0.8 + r() * 0.5 });
    }
    return out;
  }
  function arbre(a) {
    const s = a.t;
    if (a.sapin) return `<g transform="translate(${a.x} ${a.y}) scale(${s.toFixed(2)})"><ellipse cx="0" cy="0" rx="14" ry="5" fill="#000" opacity=".18"/><rect x="-3" y="-12" width="6" height="12" fill="#6d4c41"/>`
      + `<polygon points="-16,-12 0,-38 16,-12" fill="#2b8a3e"/><polygon points="-13,-26 0,-50 13,-26" fill="#37b24d"/><polygon points="0,-50 13,-26 0,-26" fill="#000" opacity=".12"/></g>`;
    return `<g transform="translate(${a.x} ${a.y}) scale(${s.toFixed(2)})"><ellipse cx="0" cy="0" rx="15" ry="5" fill="#000" opacity=".18"/><rect x="-3" y="-14" width="6" height="14" fill="#6d4c41"/>`
      + `<rect x="-16" y="-38" width="32" height="26" rx="8" fill="#40c057"/><rect x="-11" y="-46" width="22" height="14" rx="6" fill="#51cf66"/><rect x="4" y="-36" width="12" height="22" rx="6" fill="#000" opacity=".1"/></g>`;
  }
  function montagnes() {
    const r = prng(7), out = [];
    for (let x = -40; x < W + 40; x += 70 + r() * 40) {
      const h = 50 + r() * 50, w = 70 + r() * 50;
      out.push(`<polygon points="${x - w / 2},70 ${x},${70 - h} ${x + w / 2},70" fill="#7b8794"/><polygon points="${x},${70 - h} ${x + w / 2},70 ${x},70" fill="#000" opacity=".15"/><polygon points="${x - w * .14},${70 - h * .72} ${x},${70 - h} ${x + w * .14},${70 - h * .72} ${x + 4},${70 - h * .64}" fill="#f8f9fa"/>`);
    }
    return out.join('');
  }
  function fleurs() {
    const r = prng(42), cols = ['#ffd43b', '#ff8787', '#ffffff', '#da77f2'];
    let s = '';
    for (let i = 0; i < 220; i++) { const x = Math.round(r() * W), y = Math.round(80 + r() * (H - 80)); s += `<rect x="${x}" y="${y}" width="3" height="3" fill="${r() < 0.7 ? '#2f9e44' : cols[i % 4]}" opacity=".7"/>`; }
    return s;
  }

  /* ---------- Construction de la carte ---------- */
  let racine = null, svg = null, monde = null, heros = null, bulle = null, invite = null;
  let ouverte = false, dernier = 'dashboard';
  const J = { x: centre.x, y: centre.y + PIED, cible: null, lieuCible: null, touches: new Set(), dir: 1, pas: 0, tPas: 0, proche: null, raf: 0, t0: 0 };

  function carteSVG(E) {
    const sombre = nuit();
    const lieux = LIEUX.map(l => ({ ...l, info: infos(l.route, E), quetes: E.actions.filter(a => a.route === l.route), nav: (typeof ROUTES !== 'undefined' && ROUTES[l.route]) || { label: l.route } }));
    const zoneDe = route => (typeof groupOf === 'function' ? groupOf(route).label : 'Pilotage');
    const objets = [
      ...arbres().map(a => ({ y: a.y, svg: arbre(a) })),
      ...lieux.map(l => ({ y: l.y, svg: `<g class="jx-lieu" data-route="${l.route}" transform="translate(${l.x} ${l.y})" tabindex="0" role="button" aria-label="${esc(l.nom)} — ${esc(l.nav.label)}">
          <ellipse cx="0" cy="2" rx="82" ry="16" fill="#000" opacity=".16"/>
          <ellipse class="jx-halo" cx="0" cy="2" rx="92" ry="20"/>
          <g class="jx-bat">${dessin(l.type, (ZONES[zoneDe(l.route)] || ZONES.Pilotage).toit)}</g>
        </g>` })),
    ].sort((a, b) => a.y - b.y);

    // Étiquettes, pastilles et « ! » au-dessus de tout (jamais cachés par un arbre)
    const etiquettes = lieux.map(l => {
      const urg = l.quetes.some(q => q.tone === 'bad') ? 'bad' : l.quetes.length ? 'warn' : '';
      const b = l.info.badge, h = HAUT[l.type] || 110, txt = etiquette(l.nav.label), lw = largeurPlaque(txt);
      return `<g class="jx-etiq" data-route="${l.route}" transform="translate(${l.x} ${l.y})">
        <g class="jx-plaque" transform="translate(0 26)"><rect x="${-lw / 2}" y="-11" width="${lw}" height="22" rx="3" fill="#3b2f2f" opacity=".88"/><text x="0" y="4" text-anchor="middle">${esc(txt)}</text></g>
        ${b ? `<g class="jx-badge" transform="translate(52 ${-Math.max(46, h - 34)})"><circle r="14" fill="${urg === 'bad' ? '#e03131' : '#1c7ed6'}" stroke="#fff" stroke-width="3"/><text y="5" text-anchor="middle">${b > 99 ? '99+' : b}</text></g>` : ''}
        ${urg ? `<g class="jx-quete" transform="translate(0 ${-h - 10})"><g class="jx-saut"><rect x="-9" y="-30" width="18" height="30" rx="3" fill="${urg === 'bad' ? '#e03131' : '#fab005'}" stroke="#3b2f2f" stroke-width="3"/><rect x="-3" y="-25" width="6" height="14" fill="#fff"/><rect x="-3" y="-8" width="6" height="5" fill="#fff"/></g></g>` : ''}
      </g>`;
    }).join('');
    const panneaux = Object.entries(ZONES).map(([nom, z]) => `<g class="jx-panneau" transform="translate(${z.sx} ${z.sy})">
      <rect x="-3" y="0" width="6" height="26" fill="#5c3d2e"/>
      <rect x="${-(nom.length * 6 + 20) / 2}" y="-22" width="${nom.length * 6 + 20}" height="24" fill="#a0673f" stroke="#5c3d2e" stroke-width="3"/>
      <rect x="${-(nom.length * 6 + 20) / 2}" y="-22" width="6" height="24" fill="${z.toit}"/>
      <text x="3" y="-6" text-anchor="middle">${esc(nom.toUpperCase())}</text></g>`).join('');

    const riv = rubanRiviere(26), rivBerge = rubanRiviere(34);
    return `<svg class="jx-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="${NS}">
      <defs>
        <pattern id="jx-herbe" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="${sombre ? '#2f6b3a' : '#69c46b'}"/>
          <rect x="4" y="6" width="3" height="3" fill="${sombre ? '#285c32' : '#5bb85f'}"/><rect x="20" y="14" width="3" height="3" fill="${sombre ? '#285c32' : '#5bb85f'}"/>
          <rect x="12" y="24" width="3" height="3" fill="${sombre ? '#36793f' : '#78cf7a'}"/><rect x="26" y="28" width="2" height="2" fill="${sombre ? '#36793f' : '#78cf7a'}"/>
        </pattern>
        <clipPath id="jx-eau"><polygon points="${riv}"/></clipPath>
        <radialGradient id="jx-vignette" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${sombre ? .55 : .22}"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#jx-herbe)"/>
      <rect width="${W}" height="72" fill="${sombre ? '#3d4a57' : '#8fa3b5'}"/>
      ${montagnes()}
      ${fleurs()}
      <polygon points="${rivBerge}" fill="${sombre ? '#7a6a4a' : '#e3c98f'}"/>
      <polygon points="${riv}" fill="${sombre ? '#1c4f82' : '#4dabf7'}"/>
      <polyline class="jx-vague" points="${RIVIERE.map(p => p.map(Math.round).join(',')).join(' ')}" fill="none" stroke="#d0ebff" stroke-width="3" stroke-dasharray="10 26" opacity=".7"/>
      <g class="jx-chemins" fill="none" stroke-linecap="round">
        ${LIEUX.slice(1).map(l => `<path d="${chemin(l)}" stroke="${sombre ? '#5f5136' : '#b08a52'}" stroke-width="26"/>`).join('')}
        ${LIEUX.slice(1).map(l => `<path d="${chemin(l)}" stroke="${sombre ? '#8a7650' : '#e8cf96'}" stroke-width="18"/>`).join('')}
        <g clip-path="url(#jx-eau)">${LIEUX.slice(1).map(l => `<path d="${chemin(l)}" stroke="#8d5b3c" stroke-width="34"/><path d="${chemin(l)}" stroke="#c08552" stroke-width="26" stroke-dasharray="5 3" stroke-linecap="butt"/>`).join('')}</g>
        <circle cx="${centre.x}" cy="${centre.y + 20}" r="60" fill="${sombre ? '#8a7650' : '#e8cf96'}" stroke="${sombre ? '#5f5136' : '#b08a52'}" stroke-width="4"/>
      </g>
      ${panneaux}
      <g class="jx-objets">${objets.map(o => o.svg).join('')}</g>
      <g class="jx-etiquettes">${etiquettes}</g>
      <g id="jx-heros"></g>
      ${sombre ? `<rect width="${W}" height="${H}" fill="#0b1a3a" opacity=".28" pointer-events="none"/>` : ''}
      <rect width="${W}" height="${H}" fill="url(#jx-vignette)" pointer-events="none"/>
    </svg>`;
  }

  function hud(E) {
    const p = (DB.currentProfile && DB.currentProfile()) || { nom: 'Héros' };
    const coeurs = Array.from({ length: 5 }, (_, i) => icoPx(i < E.vies ? 'coeur' : 'vide')).join('');
    return `<div class="jx-hud">
      <div class="jx-carte jx-perso">
        <div class="jx-avatar">${esc(sur(() => initiales(p.nom), 'CP'))}</div>
        <div class="jx-perso-txt">
          <div class="jx-nom">${esc(p.nom)} <span class="jx-niv">NIV ${E.niv}</span></div>
          <div class="jx-rang">${esc(E.rang)}</div>
          <div class="jx-xp" title="CA annuel : ${esc(eur(E.ca))} sur ${esc(eur(E.obj))}"><i style="width:${Math.round(E.xp * 100)}%"></i></div>
          <div class="jx-xp-txt">${E.niv >= RANGS.length ? 'Niveau maximum atteint !' : 'Prochain niveau dans ' + esc(k(E.resteNiv))}</div>
        </div>
      </div>
      <div class="jx-carte jx-stats">
        <div class="jx-vies" title="Santé du royaume : ${E.critiques ? plur(E.critiques, 'alerte critique', 'alertes critiques') : 'aucune alerte critique'}">${coeurs}</div>
        <div class="jx-stat" title="Or : CA annuel réalisé">${icoPx('piece')}<b>${esc(k(E.ca))}</b></div>
        <div class="jx-stat" title="Gemmes : marge brute moyenne">${icoPx('gemme')}<b>${esc(pct(E.marge))}</b></div>
        <button class="jx-stat jx-btn-quetes" title="Journal de quêtes (J)">${icoPx('parch')}<b>${E.actions.length}</b><span>quêtes</span></button>
      </div>
      <div class="jx-carte jx-sortie">
        <button class="jx-btn" data-jx-aide title="Commandes">?</button>
        <button class="jx-btn" data-jx-quitter title="Quitter la carte (Échap)">✕ <span>Quitter la carte</span></button>
      </div>
    </div>`;
  }

  function dessinerHeros() {
    if (!heros) return;
    const t = 4, w = 10 * t, h = 14 * t;
    const corps = pixels(HEROS_TETE.concat(HEROS_PAS[J.pas]), PAL_HEROS, t, -w / 2, -h);
    heros.innerHTML = `<ellipse cx="0" cy="0" rx="18" ry="6" fill="#000" opacity=".25"/><g transform="scale(${J.dir} 1)">${corps}</g>`;
  }
  function placerHeros() {
    if (heros) heros.setAttribute('transform', `translate(${Math.round(J.x)} ${Math.round(J.y)})`);
  }

  function construire() {
    const E = etat();
    racine.innerHTML = `<div class="jx-monde">${carteSVG(E)}</div>${hud(E)}
      <div class="jx-invite" hidden></div>
      <div class="jx-aide-bas">${'ontouchstart' in window ? 'Touchez un bâtiment pour y voyager' : 'Flèches / ZQSD : se déplacer · Clic : voyager · Entrée : entrer · J : quêtes · Échap : quitter'}</div>
      <div class="jx-bulle-root"></div>`;
    monde = racine.querySelector('.jx-monde');
    svg = racine.querySelector('.jx-svg');
    heros = svg.querySelector('#jx-heros');
    invite = racine.querySelector('.jx-invite');
    bulle = racine.querySelector('.jx-bulle-root');
    dessinerHeros(); placerHeros();

    svg.querySelectorAll('.jx-etiq').forEach(g => g.addEventListener('click', e => { e.stopPropagation(); voyager(LIEUX.find(l => l.route === g.dataset.route)); }));
    svg.querySelectorAll('.jx-lieu').forEach(g => {
      g.addEventListener('click', e => { e.stopPropagation(); voyager(LIEUX.find(l => l.route === g.dataset.route)); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); dialogue(LIEUX.find(l => l.route === g.dataset.route)); } });
    });
    svg.addEventListener('click', e => {
      if (bulle.innerHTML) { fermerBulle(); return; }
      const pt = versCarte(e.clientX, e.clientY); if (!pt) return;
      J.cible = [Math.max(20, Math.min(W - 20, pt.x)), Math.max(90, Math.min(H - 10, pt.y))]; J.lieuCible = null;
    });
    racine.querySelector('[data-jx-quitter]').onclick = () => fermer();
    racine.querySelector('[data-jx-aide]').onclick = aide;
    racine.querySelector('.jx-btn-quetes').onclick = () => journal(E);
    suivreCamera(true);
  }
  function versCarte(cx, cy) {
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    return p.matrixTransform(m.inverse());
  }
  /* Sur petit écran, la carte déborde : on garde le héros au centre de la vue */
  function suivreCamera(immediat) {
    if (!monde || monde.scrollWidth <= monde.clientWidth + 2 && monde.scrollHeight <= monde.clientHeight + 2) return;
    const sx = monde.scrollWidth / W, sy = monde.scrollHeight / H;
    const x = J.x * sx - monde.clientWidth / 2, y = (J.y - 40) * sy - monde.clientHeight / 2;
    if (immediat) { monde.scrollLeft = x; monde.scrollTop = y; return; }
    monde.scrollLeft += (x - monde.scrollLeft) * 0.12; monde.scrollTop += (y - monde.scrollTop) * 0.12;
  }

  function voyager(l) {
    if (!l) return;
    fermerBulle();
    J.lieuCible = l; J.cible = [l.x, l.y + PIED];
    if (reduit()) { J.x = l.x; J.y = l.y + PIED; J.cible = null; J.lieuCible = null; placerHeros(); dialogue(l); }
  }

  function boucle(ts) {
    if (!ouverte) return;
    const dt = Math.min(0.05, (ts - (J.t0 || ts)) / 1000); J.t0 = ts;
    let vx = 0, vy = 0;
    const T = J.touches;
    if (T.has('ArrowLeft') || T.has('q') || T.has('a')) vx -= 1;
    if (T.has('ArrowRight') || T.has('d')) vx += 1;
    if (T.has('ArrowUp') || T.has('z') || T.has('w')) vy -= 1;
    if (T.has('ArrowDown') || T.has('s')) vy += 1;
    let bouge = false;
    if (vx || vy) {
      const l = Math.hypot(vx, vy); J.cible = null; J.lieuCible = null;
      J.x += vx / l * VITESSE * dt; J.y += vy / l * VITESSE * dt; bouge = true;
      if (vx) J.dir = vx < 0 ? -1 : 1;
    } else if (J.cible) {
      const dx = J.cible[0] - J.x, dy = J.cible[1] - J.y, d = Math.hypot(dx, dy), pas = VITESSE * 1.6 * dt;
      if (d <= pas) {
        J.x = J.cible[0]; J.y = J.cible[1]; J.cible = null;
        if (J.lieuCible) { const l = J.lieuCible; J.lieuCible = null; dialogue(l); }
      } else { J.x += dx / d * pas; J.y += dy / d * pas; bouge = true; if (Math.abs(dx) > 2) J.dir = dx < 0 ? -1 : 1; }
    }
    J.x = Math.max(20, Math.min(W - 20, J.x)); J.y = Math.max(90, Math.min(H - 6, J.y));
    if (bouge) {
      J.tPas += dt; if (J.tPas > 0.12) { J.tPas = 0; J.pas = J.pas === 1 ? 2 : 1; dessinerHeros(); }
      placerHeros(); suivreCamera(false);
    } else if (J.pas) { J.pas = 0; dessinerHeros(); }
    majProche();
    J.raf = requestAnimationFrame(boucle);
  }
  function majProche() {
    let best = null, bd = PROCHE;
    LIEUX.forEach(l => { const d = Math.hypot(J.x - l.x, J.y - (l.y + PIED - 10)); if (d < bd) { bd = d; best = l; } });
    if (best === J.proche) return;
    J.proche = best;
    svg.querySelectorAll('.jx-lieu,.jx-etiq').forEach(g => g.classList.toggle('proche', !!best && g.dataset.route === best.route));
    if (best && !bulle.innerHTML) {
      invite.hidden = false;
      invite.innerHTML = `<b>${esc(best.nom)}</b><span>Entrée — parler au gardien</span>`;
    } else invite.hidden = true;
  }

  /* ---------- Boîtes de dialogue (style RPG) ---------- */
  function fermerBulle() { if (bulle) bulle.innerHTML = ''; if (invite && J.proche) invite.hidden = false; }
  function boite(html, large) {
    invite.hidden = true;
    bulle.innerHTML = `<div class="jx-dialogue ${large ? 'large' : ''}" role="dialog">${html}</div>`;
    const d = bulle.firstElementChild;
    d.addEventListener('click', e => e.stopPropagation());
    d.querySelectorAll('[data-jx-fermer]').forEach(b => b.onclick = fermerBulle);
    d.querySelectorAll('[data-jx-go]').forEach(b => b.onclick = () => entrer(b.dataset.jxGo));
    const f = d.querySelector('[data-jx-entrer]') || d.querySelector('button'); if (f) f.focus({ preventScroll: true });
    return d;
  }
  function dialogue(l) {
    if (!l) return;
    const E = etat(), I = infos(l.route, E), q = E.actions.filter(a => a.route === l.route);
    const label = (typeof ROUTES !== 'undefined' && ROUTES[l.route]) ? ROUTES[l.route].label : l.route;
    boite(`<div class="jx-d-tete"><span class="jx-d-zone">${esc(sur(() => groupOf(l.route).label, ''))}</span><h3>${esc(l.nom)}</h3><div class="jx-d-sous">${esc(label)}</div></div>
      <p class="jx-d-texte">« ${esc(I.texte)} »</p>
      ${I.lignes.length ? `<dl class="jx-d-stats">${I.lignes.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(String(b))}</dd></div>`).join('')}</dl>` : ''}
      ${q.length ? `<div class="jx-d-quetes"><div class="jx-d-qt">${icoPx('parch', 2)} ${plur(q.length, 'quête')} ici</div>${q.slice(0, 4).map(a => `<div class="jx-q ${a.tone}"><span>${a.title}</span><em>${esc(a.badge)}</em></div>`).join('')}${q.length > 4 ? `<div class="jx-q-plus">+ ${q.length - 4} autre(s)</div>` : ''}</div>` : ''}
      <div class="jx-d-act"><button class="jx-btn" data-jx-fermer>Rester dehors</button><button class="jx-btn primaire" data-jx-entrer data-jx-go="${l.route}">▶ Entrer</button></div>`);
  }
  function journal(E) {
    E = E || etat();
    const nomLieu = r => (LIEUX.find(l => l.route === r) || {}).nom || r;
    boite(`<div class="jx-d-tete"><span class="jx-d-zone">Journal</span><h3>Quêtes en cours</h3><div class="jx-d-sous">${E.actions.length ? plur(E.actions.length, 'quête') + ' · les plus urgentes en premier' : 'Le royaume est en paix'}</div></div>
      ${E.actions.length ? `<div class="jx-d-quetes jx-journal">${E.actions.map(a => `<button class="jx-q ${a.tone}" data-jx-voir="${a.route}"><span>${a.title}</span><em>${esc(a.badge)}</em><small>${esc(nomLieu(a.route))}</small></button>`).join('')}</div>`
        : `<p class="jx-d-texte">Aucune quête en retard. Profitez-en pour aller prospecter à la taverne !</p>`}
      <div class="jx-d-act"><button class="jx-btn" data-jx-fermer>Fermer</button></div>`, true)
      .querySelectorAll('[data-jx-voir]').forEach(b => b.onclick = () => voyager(LIEUX.find(l => l.route === b.dataset.jxVoir)));
  }
  function aide() {
    boite(`<div class="jx-d-tete"><span class="jx-d-zone">Aide</span><h3>Bienvenue dans le royaume</h3></div>
      <p class="jx-d-texte">Chaque bâtiment est un écran de ChargéPro, rangé par quartier comme dans le menu. Les chiffres viennent de vos données, en direct.</p>
      <dl class="jx-d-stats">
        <div><dt>Se déplacer</dt><dd>Flèches ou ZQSD · clic sur la carte</dd></div>
        <div><dt>Entrer</dt><dd>Entrée près d'un bâtiment</dd></div>
        <div><dt>Journal de quêtes</dt><dd>J</dd></div>
        <div><dt>Niveau & XP</dt><dd>CA réalisé vs objectif annuel</dd></div>
        <div><dt>Cœurs</dt><dd>5 moins les alertes critiques</dd></div>
        <div><dt>« ! » sur un bâtiment</dt><dd>Une action prioritaire vous y attend</dd></div>
        <div><dt>Revenir à la carte</dt><dd>Bouton « Carte » en bas à droite</dd></div>
      </dl>
      <div class="jx-d-act"><button class="jx-btn primaire" data-jx-fermer>Compris !</button></div>`);
  }

  /* ---------- Entrée / sortie ---------- */
  function entrer(route) {
    dernier = route;
    fermer();
    if (typeof go === 'function') go(route);
  }
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
    if ((key === 'Enter' || key === ' ' || key === 'e') && J.proche) { e.preventDefault(); dialogue(J.proche); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z', 'q', 's', 'd', 'w', 'a'].includes(key)) { e.preventDefault(); J.touches.add(key); }
  }
  function relache(e) { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; J.touches.delete(key); }

  function ouvrir() {
    if (!DB || !DB.data || !DB.currentProfile()) return;
    if (!racine) {
      // Polices pixel chargées seulement à la première ouverture (repli monospace hors ligne)
      const f = document.createElement('link');
      f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap';
      document.head.appendChild(f);
      racine = document.createElement('div');
      racine.id = 'jeu-root';
      document.body.appendChild(racine);
      document.addEventListener('keydown', clavier);
      document.addEventListener('keyup', relache);
      window.addEventListener('blur', () => J.touches.clear());
    }
    const depart = LIEUX.find(l => l.route === dernier) || centre;
    J.x = depart.x; J.y = depart.y + PIED; J.cible = null; J.lieuCible = null; J.proche = null; J.touches.clear();
    ouverte = true;
    document.documentElement.classList.add('jeu-ouvert');
    racine.hidden = false;
    construire();
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
      b.id = 'jeu-fab'; b.type = 'button'; b.title = 'Revenir à la carte du royaume';
      b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg><span>Carte</span>`;
      b.onclick = () => { if (typeof current !== 'undefined') dernier = current; ouvrir(); };
      document.body.appendChild(b);
    }
    return b;
  }
  function actif() { return typeof UI !== 'undefined' && UI.prefs.game === 'on'; }
  function majBouton() {
    const b = document.getElementById('game-btn');
    if (b) { b.classList.toggle('on', actif()); b.setAttribute('aria-pressed', actif() ? 'true' : 'false'); b.title = actif() ? 'Mode carte activé — cliquer pour revenir au mode classique' : 'Activer le mode carte (jeu vidéo)'; }
    fab();
  }

  window.CPJeu = {
    /* Appelé au démarrage de l'application */
    init() { majBouton(); if (actif()) { dernier = typeof current !== 'undefined' ? current : 'dashboard'; ouvrir(); } },
    basculer() {
      UI.set('game', actif() ? 'off' : 'on');
      majBouton();
      if (actif()) { dernier = typeof current !== 'undefined' ? current : 'dashboard'; ouvrir(); toast('Mode carte activé — bienvenue dans le royaume !'); }
      else { fermer(); toast('Mode classique rétabli'); }
    },
    /* Données modifiées (changement de profil, synchro Drive…) : redessiner si la carte est affichée */
    rafraichir() { if (ouverte) construire(); },
    ouvrir, fermer,
    get ouverte() { return ouverte; },
  };
})();
