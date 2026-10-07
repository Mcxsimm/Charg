/* ==========================================================================
   ChargéPro — sauvegarde commune sur Google Drive (même principe qu'OmSmK)

   - Les données restent d'abord sur l'appareil (localStorage) : l'outil
     fonctionne sans réseau.
   - Une fois Google Drive connecté, tous les profils sont enregistrés dans le
     dossier « ChargéPro » du Drive (fichier chargepro_donnees.json), avec une
     copie datée par jour conservée 30 jours (ChargéPro/Sauvegardes).
     Le PC et le téléphone connectés au même compte retrouvent les mêmes données.
   - Fusion à trois voies : chaque objet (devis, chantier, tâche…) est comparé
     à son état lors de la dernière synchronisation. Ce qui n'a changé que d'un
     côté est repris ; si un objet a changé des deux côtés, la version de
     l'appareil est conservée (conflit signalé).
   - Autorisation « drive.file » uniquement : l'outil ne voit que les fichiers
     qu'il a créés. L'identifiant client OAuth est celui d'OmSmK (même adresse
     mcxsimm.github.io) : il est repris automatiquement s'il y est déjà saisi.
   Partagé par index.html (version complète) et mobile.html.
   ========================================================================== */
'use strict';
(function () {
const META_KEY = 'chargepro.v2.meta';
const dataKey = id => 'chargepro.v2.data.' + id;
const CFG_KEY = 'chargepro.drive';
const FICHIER = 'chargepro_donnees.json';
const DOSSIER = 'ChargéPro';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/* ------------------------------------------------------------ partie pure */
function empreinte(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + str.length;
}
const hash = o => o === undefined ? null : empreinte(JSON.stringify(o));
const estListeObjets = v => Array.isArray(v) && v.every(o => o && typeof o === 'object' && o.id !== undefined && o.id !== '');

// Objets d'une base { profils:[…], donnees:{ <profil>: { collection: […] | valeur } } }
// Clés : « P|<profil> » (fiche profil), « <profil>/<col>|<id> » (élément de liste), « <profil>/@<col> » (autre valeur)
function objets(store) {
  const m = new Map();
  ((store && store.profils) || []).forEach(p => m.set('P|' + p.id, p));
  Object.entries((store && store.donnees) || {}).forEach(([pid, d]) => {
    Object.entries(d || {}).forEach(([col, v]) => {
      if (estListeObjets(v)) v.forEach(o => m.set(pid + '/' + col + '|' + o.id, o));
      else m.set(pid + '/@' + col, v);
    });
  });
  return m;
}
function empreintes(store) { const out = {}; objets(store).forEach((o, k) => { out[k] = hash(o); }); return out; }

function fusionner(local, distant, snap) {
  snap = snap || {};
  const L = objets(local), D = objets(distant), garder = new Map();
  let conflits = 0, recus = 0, envoyes = 0;
  new Set([...L.keys(), ...D.keys()]).forEach(k => {
    const l = L.get(k), d = D.get(k), hl = hash(l), hd = hash(d), hs = snap[k];
    if (hl === hd) { if (l !== undefined) garder.set(k, l); return; }
    const changeL = hs === undefined ? l !== undefined : hl !== hs;
    const changeD = hs === undefined ? d !== undefined : hd !== hs;
    if (changeD && !changeL) { recus++; if (d !== undefined) garder.set(k, d); return; }
    if (changeD && changeL) {
      // Modifié des deux côtés : la version de l'appareil l'emporte ; supprimé ici mais modifié ailleurs : il revient
      if (l !== undefined) { if (d !== undefined) conflits++; envoyes++; garder.set(k, l); } else { recus++; garder.set(k, d); }
      return;
    }
    envoyes++;
    if (l !== undefined) garder.set(k, l);
  });
  // Reconstruction : ordre de l'appareil, puis ce qui vient du Drive
  const out = { v: 1, profils: [], donnees: {} };
  [...((local && local.profils) || []), ...((distant && distant.profils) || [])].forEach(p => {
    if (garder.has('P|' + p.id) && !out.profils.some(x => x.id === p.id)) out.profils.push(garder.get('P|' + p.id));
  });
  out.profils.forEach(({ id: pid }) => {
    const dl = (local && local.donnees && local.donnees[pid]) || {}, dd = (distant && distant.donnees && distant.donnees[pid]) || {};
    const d = out.donnees[pid] = {};
    new Set([...Object.keys(dl), ...Object.keys(dd)]).forEach(col => {
      const vl = dl[col], vd = dd[col];
      if (estListeObjets(vl) || estListeObjets(vd)) {
        const vus = new Set(); d[col] = [];
        [...(Array.isArray(vl) ? vl : []), ...(Array.isArray(vd) ? vd : [])].forEach(o => {
          const k = pid + '/' + col + '|' + (o && o.id);
          if (!o || vus.has(k) || !garder.has(k)) return;
          vus.add(k); d[col].push(garder.get(k));
        });
      } else if (garder.has(pid + '/@' + col)) d[col] = garder.get(pid + '/@' + col);
    });
  });
  return { store: out, snap: empreintes(out), conflits, recus, envoyes };
}

// Premier branchement d'un appareil : un profil local inconnu du Drive mais portant le même nom
// qu'un profil du Drive est rattaché à ce dernier (ex. sauvegarde importée sur le téléphone).
function rattacherProfils(local, distant) {
  const ids = new Set(distant.profils.map(p => p.id));
  local.profils.forEach(p => {
    if (ids.has(p.id)) return;
    const twin = distant.profils.find(x => String(x.nom || '').trim().toLowerCase() === String(p.nom || '').trim().toLowerCase() && !local.profils.some(y => y.id === x.id));
    if (!twin) return;
    local.donnees[twin.id] = local.donnees[p.id]; delete local.donnees[p.id];
    p.id = twin.id;
  });
}

/* --------------------------------------------------- stockage de l'appareil */
function lireLocal() {
  let meta = null; try { meta = JSON.parse(localStorage.getItem(META_KEY)); } catch (_e) { /* vide */ }
  const profils = (meta && Array.isArray(meta.profiles) ? meta.profiles : []).map(p => ({ id: p.id, nom: p.nom || '', agence: p.agence || '' }));
  const donnees = {};
  profils.forEach(p => { let d = null; try { d = JSON.parse(localStorage.getItem(dataKey(p.id))); } catch (_e) { /* vide */ } donnees[p.id] = d || {}; });
  return { v: 1, profils, donnees, currentId: meta && meta.currentId };
}
function ecrireLocal(store, currentId) {
  const avant = lireLocal();
  store.profils.forEach(p => localStorage.setItem(dataKey(p.id), JSON.stringify(store.donnees[p.id] || {})));
  avant.profils.forEach(p => { if (!store.profils.some(x => x.id === p.id)) localStorage.removeItem(dataKey(p.id)); });
  const cur = store.profils.some(p => p.id === currentId) ? currentId : (store.profils[0] ? store.profils[0].id : null);
  localStorage.setItem(META_KEY, JSON.stringify({ profiles: store.profils, currentId: cur }));
}

/* ------------------------------------------------------------ Google Drive */
const Drive = {
  etat: 'off',            // off | ok | encours | erreur | reconnexion
  erreur: '',
  _cfg: {}, _jeton: null, _expire: 0, _timer: null, _enCours: false, _relancer: false, _ecoute: false,
  onChange: null,         // (recus, conflits) => void : les données de l'appareil ont été mises à jour
  onStatut: null,         // () => void
  occupe: null,           // () => bool : saisie en cours, on repousse la synchronisation

  init() {
    try { this._cfg = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (_e) { this._cfg = {}; }
    try { const j = JSON.parse(sessionStorage.getItem(CFG_KEY + '.jeton')); if (j && j.expire > Date.now()) { this._jeton = j.jeton; this._expire = j.expire; } } catch (_e) { /* aucun jeton */ }
    if (!this.connecte()) return;
    this.etat = this.jetonValide() ? 'ok' : 'reconnexion';
    this.planifier(500);
    if (this._ecoute) return;
    this._ecoute = true;
    setInterval(() => { if (document.visibilityState === 'visible') this.planifier(0); }, 3 * 60000);
    addEventListener('online', () => this.planifier(0));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.planifier(0); else this.synchroniser(); });
  },
  // Identifiant client OAuth : celui saisi ici, sinon celui d'OmSmK (même origine), sinon celui de config
  clientId() {
    if (this._cfg.clientId) return this._cfg.clientId;
    try { const o = JSON.parse(localStorage.getItem('omsmk_drive')); if (o && o.clientId) return o.clientId; } catch (_e) { /* absent */ }
    return (window.CHARGEPRO_GOOGLE_CLIENT_ID || '');
  },
  definirClientId(id) { this._cfg.clientId = String(id || '').trim(); this._sauver(); },
  connecte() { return !!this._cfg.connecte; },
  email() { return this._cfg.email || ''; },
  derniere() { return this._cfg.derniere ? new Date(this._cfg.derniere) : null; },
  jetonValide() { return !!this._jeton && Date.now() < this._expire; },
  _sauver() { try { localStorage.setItem(CFG_KEY, JSON.stringify(this._cfg)); } catch (_e) { /* quota */ } },
  _statut(etat, erreur = '') { this.etat = etat; this.erreur = erreur; if (this.onStatut) this.onStatut(); },
  libelle() {
    if (!this.connecte()) return 'Drive non connecté';
    if (this.etat === 'encours') return 'Synchronisation…';
    if (this.etat === 'reconnexion') return 'Reconnecter Drive';
    if (this.etat === 'erreur') return 'Erreur Drive';
    const d = this.derniere();
    return d ? 'Drive · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Drive connecté';
  },

  _chargerGIS() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => ko(new Error('Service Google injoignable (connexion Internet ?)'));
      document.head.appendChild(s);
    });
  },
  async _demanderJeton() {
    if (!this.clientId()) throw new Error('Identifiant client Google non renseigné');
    await this._chargerGIS();
    return new Promise((ok, ko) => {
      google.accounts.oauth2.initTokenClient({
        client_id: this.clientId(),
        scope: 'https://www.googleapis.com/auth/drive.file',
        prompt: this._cfg.email ? '' : 'consent',
        hint: this._cfg.email || undefined,
        callback: r => {
          if (r.error) return ko(new Error(r.error_description || r.error));
          this._jeton = r.access_token;
          this._expire = Date.now() + (+r.expires_in || 3600) * 1000 - 60000;
          try { sessionStorage.setItem(CFG_KEY + '.jeton', JSON.stringify({ jeton: this._jeton, expire: this._expire })); } catch (_e) { /* ignoré */ }
          ok(this._jeton);
        },
        error_callback: e => ko(new Error(e && e.type === 'popup_closed' ? 'Fenêtre Google fermée' : (e && e.message) || 'Autorisation Google refusée'))
      }).requestAccessToken();
    });
  },
  async _api(url, opts = {}) {
    if (!this.jetonValide()) { const e = new Error('Reconnexion à Google nécessaire'); e.reconnexion = true; throw e; }
    const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + this._jeton }, opts.headers || {}) }));
    if (r.status === 401) { this._jeton = null; const e = new Error('Reconnexion à Google nécessaire'); e.reconnexion = true; throw e; }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch (_e) { /* ignoré */ } const e = new Error('Google Drive : ' + (m || r.status)); e.status = r.status; throw e; }
    return r;
  },
  async _chercher(q) {
    const r = await this._api(`${API}/files?q=${encodeURIComponent(q + ' and trashed=false')}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100&spaces=drive`);
    return (await r.json()).files || [];
  },
  async _creer(meta, contenu) {
    if (contenu === undefined) return (await (await this._api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })).json()).id;
    const b = 'chargepro' + Date.now();
    const corps = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${contenu}\r\n--${b}--`;
    return (await (await this._api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: corps })).json()).id;
  },
  async _dossier() {
    if (this._cfg.dossierId) return this._cfg.dossierId;
    const f = await this._chercher(`name='${DOSSIER}' and mimeType='application/vnd.google-apps.folder'`);
    this._cfg.dossierId = f[0] ? f[0].id : await this._creer({ name: DOSSIER, mimeType: 'application/vnd.google-apps.folder' });
    this._sauver();
    return this._cfg.dossierId;
  },
  async _fichier() {
    if (this._cfg.fichierId) return this._cfg.fichierId;
    const f = await this._chercher(`name='${FICHIER}' and '${await this._dossier()}' in parents`);
    if (f[0]) { this._cfg.fichierId = f[0].id; this._sauver(); }
    return this._cfg.fichierId || null;
  },

  // Connexion ou reconnexion (depuis un clic : la fenêtre Google s'ouvre)
  async connecter() {
    await this._demanderJeton();
    try {
      const email = (((await (await this._api(`${API}/about?fields=user(emailAddress)`)).json()).user) || {}).emailAddress || '';
      if (this._cfg.email && email && email !== this._cfg.email) { this._cfg.dossierId = this._cfg.fichierId = this._cfg.sauvegardesId = null; this._cfg.snap = null; }
      this._cfg.email = email;
    } catch (_e) { /* l'adresse n'est qu'indicative */ }
    this._cfg.connecte = true; this._sauver();
    this.init();
    this._statut('ok');
    await this.synchroniser(true);
  },
  deconnecter() {
    if (this._jeton && window.google && google.accounts) { try { google.accounts.oauth2.revoke(this._jeton, () => { /* ignoré */ }); } catch (_e) { /* ignoré */ } }
    this._jeton = null; this._expire = 0;
    try { sessionStorage.removeItem(CFG_KEY + '.jeton'); } catch (_e) { /* ignoré */ }
    this._cfg = { clientId: this._cfg.clientId };
    this._sauver();
    this._statut('off');
  },
  planifier(delai = 5000) {
    if (!this.connecte()) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.synchroniser().catch(() => { /* état déjà affiché */ }), delai);
  },

  async synchroniser(force) {
    if (!this.connecte() || !navigator.onLine) return;
    if (this._enCours) { this._relancer = true; return; }
    if (!this.jetonValide()) { this._statut('reconnexion', 'Session Google expirée : reconnectez-vous'); return; }
    if (!force && this.occupe && this.occupe()) { this.planifier(10000); return; }
    this._enCours = true;
    this._statut('encours');
    try {
      const id = await this._fichier();
      let distant = null;
      if (id) {
        const r = await this._api(`${API}/files/${id}?alt=media`).catch(e => { if (e.status === 404) { this._cfg.fichierId = null; return null; } throw e; });
        distant = r ? await r.json() : null;
      }
      // Lecture de l'appareil APRÈS le téléchargement, puis fusion et écriture sans attente : aucune saisie perdue
      if (this.occupe && this.occupe() && !force) { this._enCours = false; this._statut('ok'); this.planifier(10000); return; }
      const local = lireLocal(), cur = local.currentId, premier = !this._cfg.snap;
      let f;
      if (distant && Array.isArray(distant.profils)) {
        if (!this._cfg.snap) rattacherProfils(local, distant);
        f = fusionner(local, distant, this._cfg.snap || {});
      } else f = { store: { v: 1, profils: local.profils, donnees: local.donnees }, snap: null, conflits: 0, recus: 0, envoyes: 1 };
      const contenu = JSON.stringify(f.store);
      // L'écran recharge ses données tout de suite (avant l'envoi) : une saisie faite pendant l'envoi
      // ne peut pas réécrire l'ancienne version par-dessus ce qui vient d'arriver.
      if (f.recus || premier) { ecrireLocal(f.store, cur); if (this.onChange) this.onChange(f.recus, f.conflits); }
      f.snap = empreintes(f.store);
      if (!distant || contenu !== JSON.stringify(distant)) {
        if (this._cfg.fichierId) await this._api(`${UPLOAD}/files/${this._cfg.fichierId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: contenu });
        else this._cfg.fichierId = await this._creer({ name: FICHIER, parents: [await this._dossier()], mimeType: 'application/json' }, contenu);
      }
      this._cfg.snap = f.snap;
      this._cfg.derniere = new Date().toISOString();
      this._sauver();
      await this._copieDuJour(contenu).catch(() => { /* sans gravité */ });
      this._statut('ok');
    } catch (e) {
      console.error(e);
      this._statut(e.reconnexion ? 'reconnexion' : 'erreur', e.message || String(e));
    } finally {
      this._enCours = false;
      if (this._relancer) { this._relancer = false; this.planifier(1000); }
    }
  },

  // Une copie datée par jour dans ChargéPro/Sauvegardes, conservée 30 jours
  async _copieDuJour(contenu) {
    const d = new Date(), auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (this._cfg.copie === auj) return;
    const dossier = await this._dossier();
    let sauv = this._cfg.sauvegardesId;
    if (!sauv) {
      const f = await this._chercher(`name='Sauvegardes' and mimeType='application/vnd.google-apps.folder' and '${dossier}' in parents`);
      sauv = this._cfg.sauvegardesId = f[0] ? f[0].id : await this._creer({ name: 'Sauvegardes', mimeType: 'application/vnd.google-apps.folder', parents: [dossier] });
    }
    // Une seule copie par jour, tous appareils confondus : on remplace celle du jour si elle existe
    const deja = (await this._chercher(`name='chargepro_${auj}.json' and '${sauv}' in parents`))[0];
    if (deja) await this._api(`${UPLOAD}/files/${deja.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: contenu });
    else await this._creer({ name: `chargepro_${auj}.json`, parents: [sauv], mimeType: 'application/json' }, contenu);
    const lim = new Date(d); lim.setDate(lim.getDate() - 30);
    const limite = `${lim.getFullYear()}-${String(lim.getMonth() + 1).padStart(2, '0')}-${String(lim.getDate()).padStart(2, '0')}`;
    for (const c of await this._chercher(`'${sauv}' in parents`)) {
      const m = /^chargepro_(\d{4}-\d{2}-\d{2})\.json$/.exec(c.name);
      if (m && m[1] < limite) await this._api(`${API}/files/${c.id}`, { method: 'DELETE' }).catch(() => { /* sans gravité */ });
    }
    this._cfg.copie = auj; this._sauver();
  },
  async listerCopies() {
    if (!this._cfg.sauvegardesId) return [];
    return (await this._chercher(`'${this._cfg.sauvegardesId}' in parents`)).sort((a, b) => b.name.localeCompare(a.name));
  },
  // Reprendre une copie datée : remplace les données de l'appareil, puis repart sur le Drive
  async restaurerCopie(id) {
    const store = await (await this._api(`${API}/files/${id}?alt=media`)).json();
    if (!store || !Array.isArray(store.profils)) throw new Error('Copie illisible');
    const contenu = JSON.stringify(store);
    const fid = await this._fichier();
    if (fid) await this._api(`${UPLOAD}/files/${fid}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: contenu });
    else this._cfg.fichierId = await this._creer({ name: FICHIER, parents: [await this._dossier()], mimeType: 'application/json' }, contenu);
    ecrireLocal(store, lireLocal().currentId);
    this._cfg.snap = empreintes(store); this._cfg.derniere = new Date().toISOString(); this._sauver();
    if (this.onChange) this.onChange(1, 0);
    this._statut('ok');
  },
};

window.CPDrive = Drive;
window.CPDriveTest = { fusionner, empreintes, rattacherProfils };
})();
