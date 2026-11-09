/* =========================================================================
   ChargéPro — passerelle IA (fonction serveur Vercel)
   -------------------------------------------------------------------------
   Les clés API restent côté serveur, dans les variables d'environnement du
   projet Vercel (Settings › Environment Variables). Elles ne sont jamais
   envoyées au navigateur ni écrites dans le code publié.

   Variables reconnues (renseigner au moins une clé) :
     ANTHROPIC_API_KEY   → Claude
     OPENAI_API_KEY      → OpenAI
     MISTRAL_API_KEY     → Mistral
     GEMINI_API_KEY      → Google Gemini
     GROQ_API_KEY        → Groq (modèles ouverts, offre gratuite limitée)
     OPENROUTER_API_KEY  → OpenRouter (modèles « :free » gratuits)
     IA_ORDRE            → ordre d'essai, ex. "gemini,groq,openrouter"
                           (si un fournisseur échoue, le suivant prend le relais)
     IA_MODELE_CLAUDE, IA_MODELE_OPENAI, IA_MODELE_MISTRAL, IA_MODELE_GEMINI,
     IA_MODELE_GROQ, IA_MODELE_OPENROUTER
                         → pour changer de modèle sans toucher au code
     CHARGEPRO_CODE      → code d'accès (fortement conseillé) : sans lui,
                           n'importe qui connaissant l'adresse du site peut
                           consommer vos crédits IA.

   GET  /api/ia  → état : fournisseurs disponibles (sans les clés), code requis ou non
   POST /api/ia  → { system, messages:[{role,content}], schema?, effort?, max_tokens?, fournisseur? }
                 ← { texte, fournisseur, modele }
   ========================================================================= */
const crypto = require('crypto');

const FOURNISSEURS = {
  claude: { nom: 'Claude', env: 'ANTHROPIC_API_KEY', modele: 'claude-opus-5-5' },
  openai: { nom: 'OpenAI', env: 'OPENAI_API_KEY', modele: 'gpt-5' },
  mistral: { nom: 'Mistral', env: 'MISTRAL_API_KEY', modele: 'mistral-large-latest' },
  gemini: { nom: 'Gemini', env: 'GEMINI_API_KEY', modele: 'gemini-3.8-flash' },
  groq: { nom: 'Groq', env: 'GROQ_API_KEY', modele: 'llama-3.3-70b-versatile' },
  openrouter: { nom: 'OpenRouter', env: 'OPENROUTER_API_KEY', modele: 'meta-llama/llama-3.3-70b-instruct:free' },
};
const ORDRE_DEFAUT = ['claude', 'openai', 'gemini', 'mistral', 'groq', 'openrouter'];
const MAX_CARACTERES = 400000; // garde-fou sur la taille d'une demande
const DELAI_MS = 110000;       // par appel
const PAUSES_MS = [2000, 5000]; // attente avant chaque nouvelle tentative en cas de surcharge

const cle = id => (process.env[FOURNISSEURS[id].env] || '').trim();
const modele = id => (process.env['IA_MODELE_' + id.toUpperCase()] || '').trim() || FOURNISSEURS[id].modele;
function ordre() {
  const o = (process.env.IA_ORDRE || '').split(',').map(s => s.trim().toLowerCase()).filter(s => FOURNISSEURS[s]);
  return [...new Set(o.length ? o : ORDRE_DEFAUT)].filter(id => cle(id));
}
function codeValide(recu) {
  const attendu = (process.env.CHARGEPRO_CODE || '').trim();
  if (!attendu) return true;
  const a = crypto.createHash('sha256').update(String(recu || '')).digest();
  const b = crypto.createHash('sha256').update(attendu).digest();
  return crypto.timingSafeEqual(a, b);
}

class ErreurFournisseur extends Error {
  constructor(msg, statut) { super(msg); this.statut = statut || 0; }
}

async function appelHttp(url, headers, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal }); }
  catch (e) { throw new ErreurFournisseur(e.name === 'AbortError' ? 'délai dépassé' : 'injoignable'); }
  finally { clearTimeout(t); }
  let j = null; try { j = await r.json(); } catch { /* corps non JSON */ }
  if (!r.ok) {
    const det = j && ((j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) || j.message) || '';
    throw new ErreurFournisseur(`erreur ${r.status}${det ? ' : ' + String(det).slice(0, 160) : ''}`, r.status);
  }
  return j || {};
}

/* Consigne JSON ajoutée pour les fournisseurs sans contrainte de schéma stricte. */
const consigneJson = schema => `\n\nRéponds uniquement avec un objet JSON valide, sans texte autour ni bloc de code, conforme à ce schéma JSON :\n${JSON.stringify(schema)}`;

/* Fournisseurs à l'API « compatible OpenAI » (Mistral, Groq, OpenRouter). */
async function compatibleOpenAI(id, url, { system, messages, schema, maxTokens }, m, modeJson, entetes) {
  const body = { model: m, messages: [{ role: 'system', content: system + (schema ? consigneJson(schema) : '') }, ...messages], max_tokens: maxTokens };
  if (schema && modeJson) body.response_format = { type: 'json_object' };
  const j = await appelHttp(url, { authorization: 'Bearer ' + cle(id), ...(entetes || {}) }, body);
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';
}

const APPELS = {
  async claude({ system, messages, schema, effort, maxTokens }, m) {
    const body = { model: m, max_tokens: maxTokens, system, messages };
    const oc = {};
    if (['low', 'medium', 'high'].includes(effort)) oc.effort = effort;
    if (schema) oc.format = { type: 'json_schema', schema };
    if (Object.keys(oc).length) body.output_config = oc;
    const headers = { 'x-api-key': cle('claude'), 'anthropic-version': '2026-10-21' };
    // Modèles Claude 5 (Opus, Sonnet, Fable) : si une demande est déclinée, relance automatique sur le modèle de secours
    if (/^claude-(opus|sonnet|fable)-5/.test(m)) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
    const j = await appelHttp('https://api.anthropic.com/v1/messages', headers, body);
    if (j.stop_reason === 'refusal') throw new ErreurFournisseur('demande déclinée');
    if (j.stop_reason === 'max_tokens') throw new ErreurFournisseur('réponse tronquée (trop longue)');
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
  async openai({ system, messages, schema, maxTokens }, m) {
    const body = { model: m, messages: [{ role: 'system', content: system + (schema ? consigneJson(schema) : '') }, ...messages], max_completion_tokens: maxTokens };
    if (schema) body.response_format = { type: 'json_object' };
    const j = await appelHttp('https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + cle('openai') }, body);
    return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';
  },
  mistral: (d, m) => compatibleOpenAI('mistral', 'https://api.mistral.ai/v1/chat/completions', d, m, true),
  groq: (d, m) => compatibleOpenAI('groq', 'https://api.groq.com/openai/v1/chat/completions', d, m, true),
  // OpenRouter : le mode JSON n'existe pas sur tous les modèles, la consigne JSON passe par le texte
  openrouter: (d, m) => compatibleOpenAI('openrouter', 'https://openrouter.ai/api/v1/chat/completions', d, m, false, { 'x-title': 'ChargePro' }),
  async gemini({ system, messages, schema, maxTokens }, m) {
    const body = {
      systemInstruction: { parts: [{ text: system + (schema ? consigneJson(schema) : '') }] },
      contents: messages.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json' } : {}) },
    };
    const j = await appelHttp(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { 'x-goog-api-key': cle('gemini') }, body);
    const c = j.candidates && j.candidates[0];
    return c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
  },
};

function lireDemande(b) {
  if (!b || typeof b !== 'object') return null;
  const system = String(b.system || '').slice(0, MAX_CARACTERES);
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .map(x => ({ role: x && x.role === 'assistant' ? 'assistant' : 'user', content: String(x && x.content || '') }))
    .filter(x => x.content.trim());
  if (!messages.length || messages[0].role !== 'user') return null;
  const total = system.length + messages.reduce((s, x) => s + x.content.length, 0);
  if (total > MAX_CARACTERES) return { tropLong: true };
  return {
    system, messages,
    schema: b.schema && typeof b.schema === 'object' ? b.schema : null,
    effort: typeof b.effort === 'string' ? b.effort : '',
    maxTokens: Math.max(256, Math.min(32000, +b.max_tokens || 8000)),
    fournisseur: FOURNISSEURS[b.fournisseur] ? b.fournisseur : '',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const dispo = ordre();

  if (req.method === 'GET') {
    return res.status(200).json({
      fournisseurs: dispo.map(id => ({ id, nom: FOURNISSEURS[id].nom, modele: modele(id) })),
      codeRequis: !!(process.env.CHARGEPRO_CODE || '').trim(),
      codeOk: codeValide(req.headers['x-chargepro-code']),
    });
  }
  if (req.method !== 'POST') { res.setHeader('allow', 'GET, POST'); return res.status(405).json({ erreur: 'Méthode non prise en charge.' }); }

  if (!codeValide(req.headers['x-chargepro-code'])) return res.status(401).json({ erreur: 'Code d\'accès IA manquant ou incorrect. Saisissez-le dans Paramètres › Intelligence artificielle.', code: 'code' });
  if (!dispo.length) return res.status(503).json({ erreur: 'Aucune clé d\'IA n\'est configurée sur le serveur. Ajoutez au moins une clé (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY) dans les variables d\'environnement Vercel, puis redéployez.', code: 'config' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const d = lireDemande(b);
  if (!d) return res.status(400).json({ erreur: 'Demande incomplète : aucun message à traiter.' });
  if (d.tropLong) return res.status(413).json({ erreur: 'Demande trop volumineuse. Raccourcissez le texte, puis réessayez.' });

  // Fournisseur demandé en premier s'il est disponible, puis les autres dans l'ordre configuré
  const essais = d.fournisseur && dispo.includes(d.fournisseur) ? [d.fournisseur, ...dispo.filter(x => x !== d.fournisseur)] : dispo;
  const echecs = [];
  for (const id of essais) {
    const m = modele(id);
    // Surcharge passagère (429, 5xx, 529) : jusqu'à 2 nouvelles tentatives sur le même fournisseur avant de passer au suivant
    for (let tentative = 0; tentative <= PAUSES_MS.length; tentative++) {
      try {
        const texte = String(await APPELS[id](d, m)).trim();
        if (!texte) throw new ErreurFournisseur('réponse vide');
        return res.status(200).json({ texte, fournisseur: id, nom: FOURNISSEURS[id].nom, modele: m, echecs });
      } catch (e) {
        const passager = e.statut === 429 || e.statut >= 500;
        if (passager && tentative < PAUSES_MS.length) { await new Promise(r => setTimeout(r, PAUSES_MS[tentative])); continue; }
        echecs.push(`${FOURNISSEURS[id].nom} (${m}) : ${e.message}`);
        break;
      }
    }
  }
  const surcharge = echecs.length && echecs.every(x => / : erreur (429|5\d\d)/.test(x));
  return res.status(502).json({ erreur: (surcharge ? 'L\'IA est momentanément surchargée. Réessayez dans une minute. ' : 'Aucune IA n\'a pu répondre. ') + echecs.join(' · '), code: 'fournisseurs', echecs });
};
