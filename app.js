// =============================================================
// Athelio — single-file state + views
// =============================================================

const STORAGE_KEY = 'athelio:v1';

const defaultState = {
  badminton: { matches: [], tournaments: [] },
  weight: [],
  measurements: [],
  runs: [],
  lifts: [],
  photos: [],
  goals: [],
  recovery: [],
  videos: [],
  mobility: [],
  mobilityVideos: [],
  spa: [],
  sobriety: [],
  comparisons: [],
  settings: { liftWeeklyTarget: 3, haptics: true, reviewConfig: null, navConfig: null, theme: 'vintage' },
};

let state = load();
let currentView = 'dashboard';
let activeCharts = [];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    return migrate(JSON.parse(raw));
  } catch {
    return seed();
  }
}

// Normalise n'importe quelle sauvegarde (y compris l'ancienne structure
// « progression » qui regroupait poids/course/muscu/mensurations/photos)
// vers le nouveau modèle à modules distincts.
function migrate(parsed) {
  const s = { ...defaultState, ...parsed };
  const old = parsed.progression || {};
  s.weight = parsed.weight || old.weight || [];
  s.measurements = parsed.measurements || old.measurements || [];
  s.runs = parsed.runs || old.runs || [];
  s.lifts = parsed.lifts || old.lifts || [];
  s.photos = parsed.photos || old.photos || [];
  delete s.progression;
  s.badminton = { ...defaultState.badminton, ...(parsed.badminton || {}) };
  for (const k of ['weight', 'measurements', 'runs', 'lifts', 'photos', 'goals', 'recovery', 'videos', 'mobility', 'mobilityVideos', 'spa', 'sobriety', 'comparisons']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!Array.isArray(s.badminton.matches)) s.badminton.matches = [];
  if (!Array.isArray(s.badminton.tournaments)) s.badminton.tournaments = [];
  s.settings = { ...defaultState.settings, ...(parsed.settings || {}) };
  // Migration : matchs en 1 score → tableau de sets
  s.badminton.matches = s.badminton.matches.map(m => {
    if (Array.isArray(m.sets) && m.sets.length) return m;
    if (m.myScore != null && m.oppScore != null) {
      return { ...m, sets: [{ me: +m.myScore, opp: +m.oppScore }] };
    }
    return { ...m, sets: [] };
  });
  return s;
}

// Helpers de score sur sets ----------------------------------------------------
function matchSetsWon(m) {
  const sets = m.sets || [];
  const me = sets.filter(s => +s.me > +s.opp).length;
  const opp = sets.filter(s => +s.opp > +s.me).length;
  return { me, opp };
}
function matchResult(m) {
  const { me, opp } = matchSetsWon(m);
  if (me === opp) return 'draw';
  return me > opp ? 'win' : 'loss';
}
function matchScoreLabel(m) {
  const sets = m.sets || [];
  if (!sets.length) return '—';
  return sets.map(s => `${s.me}-${s.opp}`).join(' / ');
}
function isDoubles(m) { return m.type === 'double' || m.type === 'mixte'; }
function matchOpponentLabel(m) {
  if (isDoubles(m)) {
    const opps = [m.opponent, m.opponent2].map(x => (x || '').trim()).filter(Boolean);
    return opps.length ? opps.join(' + ') : '—';
  }
  return (m.opponent || '').trim() || '—';
}
function matchPartnerLabel(m) {
  if (isDoubles(m) && (m.partner || '').trim()) return `avec ${m.partner.trim()}`;
  return '';
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleAutoDriveBackup(); // backup Drive silencieux ~2 min après la dernière modif
    return true;
  } catch {
    toast('Stockage plein — préfère un lien plutôt qu’un fichier vidéo lourd.');
    return false;
  }
}

function seed() {
  return JSON.parse(JSON.stringify(defaultState));
}

function id() { return Math.random().toString(36).slice(2, 10); }

// =============================================================
// IndexedDB (vidéos volumineuses + snapshots de sauvegarde)
// =============================================================

const DB_NAME = 'athelio-db';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';      // vidéos uploadées
const STORE_SNAPSHOTS = 'snapshots'; // historiques d'auto-backup

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) db.createObjectStore(STORE_SNAPSHOTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(store, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(store, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll(store) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const out = [];
    tx.objectStore(store).openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); }
      else resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Cache d'URLs blob (révoquer pour libérer la RAM si besoin)
const blobUrlCache = new Map();
async function getVideoBlobUrl(key) {
  if (blobUrlCache.has(key)) return blobUrlCache.get(key);
  const blob = await idbGet(STORE_BLOBS, key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(key, url);
  return url;
}
function revokeAllBlobUrls() {
  blobUrlCache.forEach((u) => URL.revokeObjectURL(u));
  blobUrlCache.clear();
}

// =============================================================
// Crypto (PIN)
// =============================================================

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

const PIN_KEY = 'athelio:pin';
function getPinConfig() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY)) || null; } catch { return null; }
}
function setPinConfig(cfg) {
  if (cfg) localStorage.setItem(PIN_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(PIN_KEY);
}
async function checkPin(pin) {
  const cfg = getPinConfig();
  if (!cfg) return true;
  const h = await sha256(pin + cfg.salt);
  return h === cfg.hash;
}
async function savePin(pin) {
  const salt = randomSalt();
  const hash = await sha256(pin + salt);
  setPinConfig({ salt, hash });
}

// =============================================================
// Google Drive sync (JSON + vidéos)
// =============================================================

const DRIVE_CLIENT_KEY     = 'athelio:drive:clientId';
const DRIVE_FOLDER_KEY     = 'athelio:drive:folderId';
const DRIVE_LAST_BACKUP    = 'athelio:drive:lastBackup';
const DRIVE_TOKEN_KEY      = 'athelio:drive:token';
const DRIVE_HASH_KEY       = 'athelio:drive:lastHash';
const DRIVE_KEEP_BACKUPS   = 14; // rotation : on garde les 14 derniers JSON sur Drive
const DRIVE_SCOPE          = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME    = 'Athelio Backups';
// Client ID OAuth intégré par défaut (sûr à exposer : un Client ID web est public,
// seule la liste des origines autorisées protège l'accès). Évite d'avoir à le
// coller à la main sur chaque appareil. Reste surchargeable dans les réglages.
const DEFAULT_DRIVE_CLIENT_ID = '1037611827802-e4290ortbq1t565nal8d35undkmp1fsg.apps.googleusercontent.com';

let driveTokenClient = null;
let driveToken = loadDriveToken(); // { access_token, expires_at } — persiste entre rechargements

// Le token (valide ~1 h) survit aux rechargements de page : moins de reconnexions
function loadDriveToken() {
  try {
    const t = JSON.parse(localStorage.getItem(DRIVE_TOKEN_KEY));
    if (t && t.access_token && t.expires_at > Date.now()) return t;
  } catch {}
  return null;
}
function persistDriveToken(t) {
  try { localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify(t)); } catch {}
}

function driveClientId()   { return localStorage.getItem(DRIVE_CLIENT_KEY) || DEFAULT_DRIVE_CLIENT_ID; }
function setDriveClientId(v) {
  // Supprime TOUT espace/retour à la ligne/caractère invisible (copier-coller mobile)
  const clean = (v || '').replace(/[\s​-‍﻿]/g, '');
  clean ? localStorage.setItem(DRIVE_CLIENT_KEY, clean) : localStorage.removeItem(DRIVE_CLIENT_KEY);
}
function driveLastBackup() { return +localStorage.getItem(DRIVE_LAST_BACKUP) || 0; }

function initDriveClient() {
  if (driveTokenClient || !driveClientId() || !window.google?.accounts?.oauth2) return;
  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: driveClientId(),
    scope: DRIVE_SCOPE,
    callback: () => {}, // remplacé dynamiquement
  });
}

function driveConnected() {
  return !!(driveToken && driveToken.expires_at > Date.now());
}

function driveRequestToken({ silent = false } = {}) {
  initDriveClient();
  if (!driveTokenClient) return Promise.reject(new Error('Drive non configuré (Client ID manquant ou GSI non chargé).'));
  return new Promise((resolve, reject) => {
    driveTokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      driveToken = {
        access_token: resp.access_token,
        expires_at: Date.now() + (resp.expires_in - 60) * 1000,
      };
      persistDriveToken(driveToken);
      resolve(resp.access_token);
    };
    try { driveTokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' }); }
    catch (e) { reject(e); }
  });
}

async function driveAuth({ silent = false } = {}) {
  if (driveConnected()) return driveToken.access_token;
  return driveRequestToken({ silent });
}

function driveDisconnect() {
  if (driveToken?.access_token) {
    try { google.accounts.oauth2.revoke(driveToken.access_token, () => {}); } catch {}
  }
  driveToken = null;
  localStorage.removeItem(DRIVE_TOKEN_KEY);
  localStorage.removeItem(DRIVE_FOLDER_KEY);
  toast('Déconnecté de Google Drive');
}

async function driveApi(url, opts = {}, retried = false) {
  const token = await driveAuth({ silent: true });
  const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + token };
  const r = await fetch(url, { ...opts, headers });
  // Token révoqué/expiré en cours d'usage : on le jette et on retente une fois en silencieux
  if (r.status === 401 && !retried) {
    driveToken = null;
    localStorage.removeItem(DRIVE_TOKEN_KEY);
    return driveApi(url, opts, true);
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Drive ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r;
}

async function driveFolderId() {
  const cached = localStorage.getItem(DRIVE_FOLDER_KEY);
  if (cached) return cached;
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await driveApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await r.json();
  if (data.files?.length) {
    localStorage.setItem(DRIVE_FOLDER_KEY, data.files[0].id);
    return data.files[0].id;
  }
  const create = await driveApi('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const cd = await create.json();
  localStorage.setItem(DRIVE_FOLDER_KEY, cd.id);
  return cd.id;
}

// Upload simple (JSON) en multipart
async function driveUploadJson(name, jsonStr, parents) {
  const metadata = { name, mimeType: 'application/json', parents };
  const boundary = '----ATHELIO' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonStr}\r\n--${boundary}--`;
  const r = await driveApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

// Upload « resumable » (vidéos) — utilisé pour > quelques Mo
async function driveUploadBlob(name, blob, parents, onProgress) {
  // 1) initier la session resumable
  const init = await driveApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': blob.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify({ name, parents, mimeType: blob.type || 'application/octet-stream' }),
  });
  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) throw new Error('Pas d\'URL d\'upload resumable.');

  // 2) PUT du contenu en un coup avec XHR (pour la progression)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    if (onProgress) xhr.upload.onprogress = (ev) => onProgress(ev.loaded, ev.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
      } else reject(new Error('Upload échoué: ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('Erreur réseau pendant l\'upload.'));
    xhr.send(blob);
  });
}

async function driveListBackups() {
  const folderId = await driveFolderId();
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
  const r = await driveApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc&pageSize=50`);
  const d = await r.json();
  return d.files || [];
}

async function driveDownloadJson(fileId) {
  const r = await driveApi(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return r.json();
}

async function driveDownloadBlob(fileId) {
  const r = await driveApi(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return r.blob();
}

// Empreinte des données — sert à sauter le backup si rien n'a changé
async function driveStateHash() {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Backup complet : JSON + vidéos manquantes.
// Saute l'upload si les données n'ont pas changé depuis le dernier backup.
async function driveBackupNow(onStatus = () => {}, { silent = false } = {}) {
  await driveAuth({ silent });
  const folderId = await driveFolderId();

  // 1) Uploader les vidéos sans driveFileId, 2 à la fois (videos + mobilityVideos).
  // Chaque vidéo est isolée : un échec n'empêche ni les autres ni le backup JSON,
  // et les driveFileId déjà obtenus sont sauvegardés quoi qu'il arrive.
  const vids = [...state.videos, ...state.mobilityVideos].filter(v => v.blobKey && !v.driveFileId);
  let failedVids = 0;
  if (vids.length) {
    let done = 0;
    const queue = [...vids];
    const worker = async () => {
      let v;
      while ((v = queue.shift())) {
        try {
          const blob = await idbGet(STORE_BLOBS, v.blobKey).catch(() => null);
          if (!blob) { done++; continue; }
          const name = `video-${v.id}.${(v.mime || 'video/mp4').split('/')[1] || 'mp4'}`;
          const file = await driveUploadBlob(name, blob, [folderId], (loaded, total) => {
            onStatus(`📹 Vidéos ${done + 1}/${vids.length} — ${Math.round((loaded / total) * 100)} %`);
          });
          v.driveFileId = file.id;
          onStatus(`📹 Vidéo ${done + 1}/${vids.length} ✓`);
        } catch {
          failedVids++;
        }
        done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, vids.length) }, worker));
    save(); // mémorise les driveFileId obtenus, même en cas d'échec partiel
    if (failedVids) onStatus(`⚠️ ${failedVids} vidéo(s) non envoyée(s) — nouvel essai au prochain backup.`);
  }

  // 2) JSON complet — seulement si les données ont changé depuis le dernier backup
  const hash = await driveStateHash();
  if (!vids.length && hash === localStorage.getItem(DRIVE_HASH_KEY)) {
    localStorage.setItem(DRIVE_LAST_BACKUP, String(Date.now()));
    onStatus('✅ Déjà à jour — rien à sauvegarder.');
    return null;
  }
  onStatus('📦 Sauvegarde JSON…');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = await driveUploadJson(`athelio-${stamp}.json`, JSON.stringify(state), [folderId]);

  localStorage.setItem(DRIVE_LAST_BACKUP, String(Date.now()));
  localStorage.setItem(DRIVE_HASH_KEY, hash);
  onStatus(`✅ Sauvegarde terminée (${file.name})`);

  // 3) Rotation : on ne garde que les N derniers backups JSON sur Drive
  try {
    const files = await driveListBackups();
    for (const f of files.slice(DRIVE_KEEP_BACKUPS)) {
      await driveApi(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' });
    }
  } catch { /* la rotation est best-effort */ }

  return file;
}

// Restaurer depuis un backup JSON Drive (récupère aussi les vidéos manquantes)
async function driveRestoreFromFile(fileId, onStatus = () => {}) {
  await driveAuth({ silent: false });
  onStatus('📥 Téléchargement du backup…');
  const data = await driveDownloadJson(fileId);
  const restored = migrate(data);

  // Récupérer les blobs vidéo manquants depuis Drive (videos + mobilityVideos)
  const vids = [...(restored.videos || []), ...(restored.mobilityVideos || [])].filter(v => v.driveFileId && v.blobKey);
  for (let i = 0; i < vids.length; i++) {
    const v = vids[i];
    const present = await idbGet(STORE_BLOBS, v.blobKey).catch(() => null);
    if (present) continue;
    onStatus(`📹 Vidéo ${i + 1}/${vids.length}…`);
    try {
      const blob = await driveDownloadBlob(v.driveFileId);
      await idbPut(STORE_BLOBS, v.blobKey, blob);
    } catch (e) { /* on ignore une vidéo manquante */ }
  }

  state = restored;
  save();
  revokeAllBlobUrls();
  navigate('dashboard');
  onStatus('✅ Données restaurées depuis Google Drive');
  toast('Restauration terminée');
}

let driveBackupRunning = false;

async function maybeAutoDriveBackup() {
  if (!driveClientId() || driveBackupRunning) return;
  if (Date.now() - driveLastBackup() < 6 * 3600000) return; // au plus toutes les 6 h à l'ouverture
  // Tentative silencieuse — si on n'a pas de token actif, on n'embête pas l'utilisateur
  driveBackupRunning = true;
  try {
    await driveAuth({ silent: true });
    await driveBackupNow(() => {}, { silent: true });
  } catch { /* silencieux */ }
  finally { driveBackupRunning = false; }
}

// Backup déclenché par les modifications : ~2 min après la dernière saisie,
// silencieux, et quasi gratuit si rien n'a changé (empreinte comparée).
let autoBackupTimer = null;

function scheduleAutoDriveBackup() {
  if (!driveClientId()) return;
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    autoBackupTimer = null;
    if (driveBackupRunning) return;
    if (Date.now() - driveLastBackup() < 10 * 60000) return; // au plus 1 / 10 min
    driveBackupRunning = true;
    try {
      await driveAuth({ silent: true });
      await driveBackupNow(() => {}, { silent: true });
    } catch { /* silencieux — retentera à la prochaine modif */ }
    finally { driveBackupRunning = false; }
  }, 120000);
}

// =============================================================
// Helpers
// =============================================================

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shortDate(s) {
  const d = new Date(s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function today() { return new Date().toISOString().slice(0, 10); }

// YYYY-MM-DD à partir d'un objet Date (composantes locales)
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateDiffDays(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }

// Jours sans écart : nombre de jours depuis le dernier écart (ou depuis le 1er suivi)
function sobrietyStreak() {
  const entries = state.sobriety.map(s => s.date).sort();
  if (!entries.length) return 0;
  const slips = state.sobriety.filter(s => s.hasSlip).map(s => s.date).sort();
  const ref = slips.length ? slips[slips.length - 1] : entries[0];
  return Math.max(0, dateDiffDays(today(), ref));
}

// Série d'entraînement : jours consécutifs (jusqu'à aujourd'hui/hier) avec au moins une activité
function trainingStreak() {
  const set = new Set();
  state.runs.forEach(r => set.add(r.date));
  state.lifts.forEach(l => set.add(l.date));
  state.mobility.forEach(m => set.add(m.date));
  state.badminton.matches.forEach(m => set.add(m.date));
  if (!set.size) return 0;
  const day = 86400000;
  const iso = (d) => d.toISOString().slice(0, 10);
  let cursor = new Date(today());
  if (!set.has(iso(cursor))) cursor = new Date(cursor.getTime() - day); // tolère aujourd'hui non encore loggé
  let streak = 0;
  while (set.has(iso(cursor))) { streak++; cursor = new Date(cursor.getTime() - day); }
  return streak;
}

function toast(msg) {
  const t = el('div', { class: 'toast' }, msg);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// Toast avec bouton « Annuler » (~6 s). onExpire() est appelé si la fenêtre
// d'annulation se ferme sans annuler (utile pour finaliser une suppression de blob).
function toastUndo(msg, onUndo, onExpire) {
  let settled = false;
  const t = el('div', { class: 'toast toast-undo' },
    el('span', {}, msg),
    el('button', { class: 'toast-undo-btn', onClick: () => {
      if (settled) return; settled = true;
      clearTimeout(timer); t.remove();
      onUndo();
    } }, '↩ Annuler'),
  );
  $('#toast-root').appendChild(t);
  const timer = setTimeout(() => {
    if (settled) return; settled = true;
    t.remove();
    if (onExpire) onExpire();
  }, 6000);
}

// Suppression réversible : retire l'élément, sauvegarde, propose d'annuler.
// opts.removeBlobKey : clé IndexedDB d'un blob à supprimer seulement après expiration.
function deleteWithUndo({ arr, item, label, navView, removeBlobKey }) {
  const idx = arr.indexOf(item);
  if (idx === -1) return;
  arr.splice(idx, 1);
  save();
  if (navView) navigate(navView);
  toastUndo(
    `${label} supprimé`,
    () => { // annuler
      arr.splice(Math.min(idx, arr.length), 0, item);
      save();
      if (navView) navigate(navView);
    },
    () => { // expiré : on finalise (blob vidéo, etc.)
      if (removeBlobKey) idbDel(STORE_BLOBS, removeBlobKey).catch(() => {});
    },
  );
}

// Retour haptique léger (mobile). Réglable dans les paramètres.
function haptic(ms = 10) {
  if (state.settings?.haptics === false) return;
  try { navigator.vibrate?.(ms); } catch {}
}

function openModal(title, contentFactory) {
  const root = $('#modal-root');
  const close = () => root.innerHTML = '';
  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) close(); } },
    el('div', { class: 'modal' },
      el('h3', {}, title),
      contentFactory(close),
    )
  );
  root.innerHTML = '';
  root.appendChild(backdrop);
}

function confirmAction(msg, onYes) {
  openModal('Confirmation', (close) => el('div', {},
    el('p', { style: 'margin: 0 0 16px; color: var(--text-dim); font-size: 14px;' }, msg),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn secondary', onClick: close }, 'Annuler'),
      el('button', { class: 'btn', onClick: () => { onYes(); close(); } }, 'Confirmer'),
    ),
  ));
}

function destroyCharts() {
  activeCharts.forEach(c => { try { c.destroy(); } catch {} });
  activeCharts = [];
}

function chart(ctx, config) {
  const c = new Chart(ctx, config);
  activeCharts.push(c);
  return c;
}

const chartTheme = {
  text: '#d4a690',
  grid: 'rgba(251,233,215,0.06)',
  accent: '#f0a35f',
  accent2: '#fbe9d7',
  info: '#c8554f',
  success: '#6fcf97',
};

function baseScales(yLabel = '') {
  return {
    x: {
      ticks: { color: chartTheme.text, font: { size: 11 } },
      grid: { color: chartTheme.grid },
    },
    y: {
      ticks: { color: chartTheme.text, font: { size: 11 } },
      grid: { color: chartTheme.grid },
      title: yLabel ? { display: true, text: yLabel, color: chartTheme.text } : undefined,
    },
  };
}

function viewHeader(title, subtitle, ...actions) {
  return el('div', { class: 'view-header' },
    el('div', {}, el('h2', {}, title), el('p', {}, subtitle)),
    actions.length ? el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' }, ...actions) : null,
  );
}

// =============================================================
// Router
// =============================================================

function navigate(view) {
  currentView = view;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  destroyCharts();
  const main = $('#main');
  main.innerHTML = '';
  const renderer = views[view] || views.dashboard;
  main.appendChild(renderer());
  updateFab(view);
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

// =============================================================
// Thèmes
// =============================================================

const THEMES = [
  { key: 'vintage', label: 'Vintage', emoji: '🔥', bg: '#2a0708' },
  { key: 'nuit',    label: 'Bleu nuit', emoji: '🌌', bg: '#0a1828' },
  { key: 'nature',  label: 'Nature', emoji: '🌿', bg: '#16222e' },
  { key: 'foret',   label: 'Forêt', emoji: '🌲', bg: '#101d18' },
];

function applyTheme(key) {
  const theme = THEMES.find(t => t.key === key) ? key : 'vintage';
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = (THEMES.find(t => t.key === theme) || THEMES[0]).bg;
  refreshChartTheme();
}

// Recolore les graphiques selon les variables CSS du thème actif
function refreshChartTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
  chartTheme.text = v('--text-dim', '#d4a690');
  chartTheme.accent = v('--accent', '#f0a35f');
  chartTheme.accent2 = v('--text', '#fbe9d7');
  chartTheme.info = v('--info', '#c8554f');
  chartTheme.success = v('--success', '#6fcf97');
}

// =============================================================
// Navigation configurable (masquer / réordonner les catégories)
// =============================================================

// Sections (titres) de la barre latérale, dans l'ordre d'affichage.
// Un label vide => le groupe s'affiche sans titre (en haut).
const NAV_SECTIONS = [
  { key: 'general',    label: '' },
  { key: 'sport',      label: 'Sport' },
  { key: 'silhouette', label: 'Silhouette' },
  { key: 'bienetre',   label: 'Bien-être' },
  { key: 'divers',     label: 'Divers' },
];
const SECTION_ORDER = Object.fromEntries(NAV_SECTIONS.map((s, i) => [s.key, i]));
const SECTION_LABEL = Object.fromEntries(NAV_SECTIONS.map(s => [s.key, s.label]));

const NAV_ITEMS = [
  { key: 'dashboard',    emoji: '📊', label: 'Tableau de bord', section: 'general' },
  { key: 'sobriety',     emoji: '🥗', label: 'Sobriété',        section: 'general' },
  { key: 'badminton',    emoji: '🏸', label: 'Badminton',       section: 'sport' },
  { key: 'lifts',        emoji: '🏋️', label: 'Musculation',     section: 'sport' },
  { key: 'runs',         emoji: '🏃', label: 'Course',          section: 'sport' },
  { key: 'weight',       emoji: '⚖️', label: 'Poids',           section: 'silhouette' },
  { key: 'measurements', emoji: '📏', label: 'Mensurations',    section: 'silhouette' },
  { key: 'photos',       emoji: '📷', label: 'Photos',          section: 'silhouette' },
  { key: 'mobility',     emoji: '🧘', label: 'AntiFragile',     section: 'bienetre' },
  { key: 'recovery',     emoji: '🌙', label: 'Récupération',    section: 'bienetre' },
  { key: 'spa',          emoji: '🧖', label: 'Spa',             section: 'bienetre' },
  { key: 'goals',        emoji: '🎯', label: 'Objectifs',       section: 'divers' },
  { key: 'videos',       emoji: '🎥', label: 'Vidéos',          section: 'divers' },
];
const NAV_META = Object.fromEntries(NAV_ITEMS.map(i => [i.key, i]));
const sectionOf = (key) => SECTION_ORDER[NAV_META[key].section] ?? 0;

// Config [{key, visible}], complétée des entrées manquantes
function getNavConfig() {
  const saved = Array.isArray(state.settings?.navConfig) ? state.settings.navConfig : null;
  const base = saved || NAV_ITEMS.map(i => ({ key: i.key, visible: true }));
  const present = new Set(base.map(s => s.key));
  for (const i of NAV_ITEMS) if (!present.has(i.key)) base.push({ key: i.key, visible: true });
  return base.filter(s => NAV_META[s.key]);
}

function renderNav() {
  const host = $('#nav-items');
  if (!host) return;
  host.innerHTML = '';
  // On regroupe par section (tri stable : l'ordre choisi dans les réglages
  // est conservé à l'intérieur d'une même section).
  const items = getNavConfig()
    .filter(({ key, visible }) => visible || key === 'dashboard') // le tableau de bord reste toujours accessible
    .map((cfg, i) => ({ ...cfg, _i: i }))
    .sort((a, b) => (sectionOf(a.key) - sectionOf(b.key)) || (a._i - b._i));
  let lastSection;
  items.forEach(({ key }) => {
    const item = NAV_META[key];
    if (item.section !== lastSection) {
      lastSection = item.section;
      const label = SECTION_LABEL[item.section];
      if (label) host.appendChild(el('div', { class: 'nav-section' }, label));
    }
    host.appendChild(el('button', { class: `nav-btn${key === currentView ? ' active' : ''}`, 'data-view': key,
      onClick: () => { navigate(key); closeNav(); } },
      el('span', {}, item.emoji), ` ${item.label}`));
  });
}

// =============================================================
// Bouton d'ajout rapide (FAB)
// =============================================================

const FAB_ACTIONS = {
  dashboard:   () => openDailyReview(),
  sobriety:    () => openSobrietyDay(today()),
  badminton:   () => openMatchForm(),
  runs:        () => openRunForm(),
  lifts:       () => openLiftForm(),
  weight:      () => simpleEntryForm('weight', { label: 'Poids (kg)', field: 'value', type: 'number', step: '0.1' }),
  measurements:() => openMeasurementForm(),
  photos:      () => pickAndAddPhoto(),
  mobility:    () => openMobilityForm(),
  goals:       () => openGoalForm(),
  recovery:    () => openRecoveryForm(),
  spa:         () => openSpaForm(),
  videos:      () => openVideoForm(),
};

function updateFab(view) {
  const fab = $('#fab');
  if (!fab) return;
  const action = FAB_ACTIONS[view];
  fab.hidden = !action;
  fab.onclick = action ? () => { haptic(12); action(); } : null;
}

function pickAndAddPhoto() {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: '',
    onChange: (e) => { if (e.target.files[0]) addPhoto(e.target.files[0]); } });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

// =============================================================
// Views
// =============================================================

const views = {};

// ---------- Dashboard ----------

// Stats agrégées sur une période [start, endExclusive) (chaînes YYYY-MM-DD)
function periodStats(start, endExcl) {
  const inP = (d) => d >= start && d < endExcl;
  const matches = state.badminton.matches.filter(m => inP(m.date));
  const wMonth = state.weight.filter(w => inP(w.date)).sort((a, b) => a.date.localeCompare(b.date));
  const weightDelta = wMonth.length >= 2 ? +(wMonth.at(-1).value - wMonth[0].value).toFixed(1) : null;
  return {
    lifts: state.lifts.filter(l => inP(l.date)).length,
    km: state.runs.filter(r => inP(r.date)).reduce((s, r) => s + (r.distance || 0), 0),
    matches: matches.length,
    wins: matches.filter(m => m.result === 'win').length,
    cleanDays: state.sobriety.filter(s => inP(s.date) && !s.hasSlip).length,
    mobility: state.mobility.filter(m => inP(m.date)).length,
    weightDelta,
  };
}

function monthBounds(year, month) { // month 0-11
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${year}-${pad(month + 1)}-01`;
  const ny = month === 11 ? year + 1 : year;
  const nm = month === 11 ? 0 : month + 1;
  const endExcl = `${ny}-${pad(nm + 1)}-01`;
  return { start, endExcl };
}

// Construit la grille de stats avec comparaison optionnelle à une période précédente
function recapGrid(cur, prev) {
  const delta = (c, p, invert = false) => {
    if (prev == null || p == null) return null;
    const d = +(c - p).toFixed(1);
    if (d === 0) return el('span', { class: 'recap-delta flat' }, '=');
    const good = invert ? d < 0 : d > 0;
    return el('span', { class: `recap-delta ${good ? 'up' : 'down'}` }, `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`);
  };
  const items = [
    ['🏋️', cur.lifts, cur.lifts > 1 ? 'séances' : 'séance', delta(cur.lifts, prev?.lifts)],
    ['🏃', cur.km.toFixed(1), 'km courus', delta(cur.km, prev?.km)],
    ['🏸', `${cur.matches}`, cur.matches ? `${cur.wins}V-${cur.matches - cur.wins}D` : 'match', delta(cur.matches, prev?.matches)],
    ['🥗', cur.cleanDays, cur.cleanDays > 1 ? 'jours sains' : 'jour sain', delta(cur.cleanDays, prev?.cleanDays)],
    ['🧘', cur.mobility, 'mobilité', delta(cur.mobility, prev?.mobility)],
  ];
  if (cur.weightDelta != null) {
    items.push(['⚖️', `${cur.weightDelta > 0 ? '+' : ''}${cur.weightDelta}`, 'kg (mois)', null]);
  }
  const grid = el('div', { class: 'recap-grid' });
  items.forEach(([emoji, val, label, d]) => grid.appendChild(el('div', { class: 'recap-item' },
    el('div', { class: 'recap-emoji' }, emoji),
    el('div', { class: 'recap-val' }, String(val)),
    el('div', { class: 'recap-label' }, label),
    d || null,
  )));
  return grid;
}

// Récap du mois en cours, avec comparaison au mois précédent
function monthlyRecapCard() {
  const now = new Date();
  const { start, endExcl } = monthBounds(now.getFullYear(), now.getMonth());
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pb = monthBounds(prevDate.getFullYear(), prevDate.getMonth());

  const cur = periodStats(start, endExcl);
  const prev = periodStats(pb.start, pb.endExcl);
  const monthName = now.toLocaleDateString('fr-FR', { month: 'long' });

  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { style: 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px;' },
    el('h3', { style: 'margin: 0;' }, `📅 Ce mois — ${monthName}`),
    el('span', { style: 'font-size: 11px; color: var(--text-dim);' }, 'vs mois dernier'),
  ));
  card.appendChild(el('div', { style: 'height: 12px;' }));
  card.appendChild(recapGrid(cur, prev));
  return card;
}

// Carte de bilan affichée au début du mois suivant (récap du mois écoulé)
function endOfMonthRecapCard() {
  const now = new Date();
  if (now.getDate() > 5) return null; // visible les 5 premiers jours du mois
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = `athelio:recapSeen:${prevDate.getFullYear()}-${prevDate.getMonth() + 1}`;
  if (localStorage.getItem(key)) return null;

  const pb = monthBounds(prevDate.getFullYear(), prevDate.getMonth());
  const ppDate = new Date(prevDate.getFullYear(), prevDate.getMonth() - 1, 1);
  const ppb = monthBounds(ppDate.getFullYear(), ppDate.getMonth());
  const cur = periodStats(pb.start, pb.endExcl);
  const prev = periodStats(ppb.start, ppb.endExcl);

  const total = cur.lifts + cur.matches + Math.round(cur.km) + cur.mobility;
  if (total === 0 && cur.cleanDays === 0) return null; // mois vide : on n'affiche rien

  const monthName = prevDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  let note = 'Beau mois — continue sur ta lancée ! 💪';
  if (cur.lifts >= 12) note = 'Mois solide à la muscu, bravo ! 🏋️';
  else if (cur.cleanDays >= 25) note = 'Discipline impressionnante côté sobriété. 🥗';
  else if (cur.km >= 30) note = 'Belles distances ce mois-ci. 🏃';

  const card = el('div', { class: 'card', style: 'border-color: var(--accent);' });
  card.appendChild(el('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px;' },
    el('h3', { style: 'margin: 0; color: var(--accent);' }, `🎉 Bilan de ${monthName}`),
    el('button', { class: 'icon-btn', title: 'Masquer', onClick: () => { localStorage.setItem(key, '1'); navigate('dashboard'); } }, '✕'),
  ));
  card.appendChild(el('p', { style: 'margin: 6px 0 12px; font-size: 13px; color: var(--text-dim);' }, note));
  card.appendChild(recapGrid(cur, prev));
  return card;
}

views.dashboard = () => {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'view-header' },
    el('div', {},
      el('h2', {}, 'Tableau de bord'),
      el('p', {}, 'Une vue d\'ensemble de ta progression.'),
    ),
  ));

  const lastWeight = state.weight.at(-1);
  const firstWeight = state.weight[0];
  const weightDelta = lastWeight && firstWeight ? (lastWeight.value - firstWeight.value).toFixed(1) : null;
  const totalDistance = state.runs.reduce((s, r) => s + (r.distance || 0), 0);
  const recovery = state.recovery.at(-1);

  const kpis = el('div', { class: 'grid cols-2' });
  kpis.appendChild(kpiCard('⚖️ Poids actuel', lastWeight ? `${lastWeight.value} kg` : '—',
    weightDelta !== null ? `${weightDelta > 0 ? '+' : ''}${weightDelta} kg` : '', weightDelta < 0 ? 'success' : 'accent'));
  kpis.appendChild(kpiCard('🏃 Distance totale', `${totalDistance.toFixed(1)} km`, `${state.runs.length} sorties`));
  wrap.appendChild(kpis);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Séries / streaks
  const sStreak = sobrietyStreak();
  const tStreak = trainingStreak();
  const streaks = el('div', { class: 'grid cols-2' });
  streaks.appendChild(streakCard('🔥', sStreak, 'Série sans écart',
    sStreak >= 7 ? 'En feu, continue !' : (sStreak ? 'jours sans écart' : 'commence aujourd\'hui')));
  streaks.appendChild(streakCard('💪', tStreak, 'Série d\'entraînement',
    tStreak >= 3 ? 'belle régularité' : (tStreak ? 'jours d\'affilée' : 'bouge aujourd\'hui')));
  wrap.appendChild(streaks);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Bilan du mois écoulé (début de mois, dismissible)
  const eom = endOfMonthRecapCard();
  if (eom) { wrap.appendChild(eom); wrap.appendChild(el('div', { style: 'height: 16px;' })); }

  // Récap du mois en cours
  wrap.appendChild(monthlyRecapCard());
  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  wrap.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Évolution du poids'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-weight' }))));

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Goals + Recovery side by side
  const lower = el('div', { class: 'grid cols-2' });
  const goalsCard = el('div', { class: 'card' }, el('h3', {}, 'Objectifs en cours'));
  const activeGoals = state.goals.filter(g => !g.done).slice(0, 4);
  if (!activeGoals.length) {
    goalsCard.appendChild(emptyState('Aucun objectif', 'Ajoute ton premier objectif dans la section Objectifs.'));
  } else {
    activeGoals.forEach(g => goalsCard.appendChild(goalRow(g, false)));
  }
  lower.appendChild(goalsCard);

  const recCard = el('div', { class: 'card' }, el('h3', {}, 'Récupération récente'));
  if (!recovery) {
    recCard.appendChild(emptyState('Aucune entrée', 'Note ta fatigue et tes douleurs.'));
  } else {
    const rows = el('div', {});
    rows.appendChild(infoRow('Fatigue', `${recovery.fatigue}/5`));
    rows.appendChild(infoRow('Douleurs', `${recovery.pain}/5`));
    rows.appendChild(infoRow('Dernière entrée', fmtDate(recovery.date)));
    recCard.appendChild(rows);
  }
  lower.appendChild(recCard);
  wrap.appendChild(lower);

  // Charts deferred until in DOM
  setTimeout(() => {
    if (state.weight.length) {
      chart($('#dash-weight').getContext('2d'), {
        type: 'line',
        data: {
          labels: state.weight.map(w => shortDate(w.date)),
          datasets: [{
            label: 'Poids (kg)',
            data: state.weight.map(w => w.value),
            borderColor: chartTheme.accent,
            backgroundColor: 'rgba(240, 163, 95, 0.15)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: chartTheme.accent,
          }],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: baseScales() }
      });
    }
  }, 0);

  return wrap;
};

function kpiCard(label, value, sub = '', kind = '') {
  return el('div', { class: 'card kpi' },
    el('div', { class: 'label' }, label),
    el('div', { class: `value ${kind}` }, String(value)),
    sub ? el('div', { class: 'sub' }, sub) : null,
  );
}

function streakCard(emoji, days, label, sub = '') {
  return el('div', { class: `card streak ${days ? 'on' : ''}` },
    el('div', { class: 'streak-emoji' }, emoji),
    el('div', { class: 'streak-body' },
      el('div', { class: 'streak-value' }, String(days), el('span', { class: 'streak-unit' }, days > 1 ? ' jours' : ' jour')),
      el('div', { class: 'streak-label' }, label),
      sub ? el('div', { class: 'streak-sub' }, sub) : null,
    ),
  );
}

function infoRow(k, v) {
  return el('div', { class: 'list-item' },
    el('div', { class: 'title', style: 'font-weight: 500; color: var(--text-dim); font-size: 13px;' }, k),
    el('div', { style: 'font-weight: 600; font-size: 14px;' }, v),
  );
}

function emptyState(title, sub) {
  return el('div', { class: 'empty' }, el('strong', {}, title), sub);
}

// ---------- Badminton ----------

let badmintonTab = 'matches';

views.badminton = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Badminton', 'Suivi des matchs, tournois, et statistiques.',
    el('button', { class: 'btn', onClick: () => openMatchForm() }, '+ Nouveau match'),
    el('button', { class: 'btn secondary', onClick: () => openTournamentForm() }, '+ Tournoi'),
  ));

  // KPI per game type
  const matches = state.badminton.matches;
  const byType = (t) => matches.filter(m => m.type === t);
  const wr = (arr) => arr.length ? Math.round(arr.filter(m => m.result === 'win').length / arr.length * 100) : 0;

  const kpis = el('div', { class: 'grid cols-3' });
  ['simple', 'double', 'mixte'].forEach(type => {
    const arr = byType(type);
    kpis.appendChild(el('div', { class: 'card kpi' },
      el('div', { class: 'label' }, type.charAt(0).toUpperCase() + type.slice(1)),
      el('div', { class: 'value' }, String(arr.length)),
      el('div', { class: 'sub' }, `Taux de victoire : ${wr(arr)}%`),
    ));
  });
  wrap.appendChild(kpis);

  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Tabs
  const tabs = el('div', { class: 'tabs' },
    tabBtn('matches', 'Matchs', () => { badmintonTab = 'matches'; navigate('badminton'); }),
    tabBtn('tournaments', 'Tournois & interclubs', () => { badmintonTab = 'tournaments'; navigate('badminton'); }),
    tabBtn('stats', 'Statistiques', () => { badmintonTab = 'stats'; navigate('badminton'); }),
  );
  wrap.appendChild(tabs);

  if (badmintonTab === 'matches') {
    const card = el('div', { class: 'card' });
    if (!matches.length) {
      card.appendChild(emptyState('Aucun match', 'Ajoute ton premier match pour commencer.'));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {},
        ...['Date', 'Adversaire', 'Type', 'Sets', 'Score', 'Résultat', ''].map(h => el('th', {}, h)))));
      const tbody = el('tbody');
      [...matches].sort((a, b) => b.date.localeCompare(a.date)).forEach(m => {
        const hasNotes = (m.goodPoints || m.badPoints || m.workPoints || m.notes || '').trim().length > 0;
        const setsWon = matchSetsWon(m);
        const result = matchResult(m);
        const detailRow = el('tr', { class: 'match-notes-row', hidden: '' },
          el('td', { colspan: '7' },
            el('div', { class: 'match-notes' },
              noteBlock('✅ Bien fait', m.goodPoints),
              noteBlock('❌ Mal fait', m.badPoints),
              noteBlock('🎯 À travailler', m.workPoints),
              (m.notes && m.notes.trim()) ? noteBlock('📝 Notes', m.notes) : null,
            ),
          ),
        );
        const toggle = hasNotes ? el('button', { class: 'icon-btn', title: 'Voir les notes', onClick: (e) => {
          const open = detailRow.hasAttribute('hidden');
          if (open) detailRow.removeAttribute('hidden'); else detailRow.setAttribute('hidden', '');
          e.currentTarget.textContent = open ? '▴' : '▾';
        } }, '▾') : null;
        const resBadge = result === 'win' ? '<span class="badge win">Victoire</span>'
                       : result === 'loss' ? '<span class="badge loss">Défaite</span>'
                       : '<span class="badge neutral">Égalité</span>';
        const partnerLbl = matchPartnerLabel(m);
        const oppCell = el('td', {},
          el('div', {}, matchOpponentLabel(m)),
          partnerLbl ? el('div', { style: 'font-size: 11px; color: var(--text-dim); margin-top: 2px;' }, partnerLbl) : null,
        );
        tbody.appendChild(el('tr', {},
          el('td', {}, fmtDate(m.date)),
          oppCell,
          el('td', { html: `<span class="badge neutral">${m.type}</span>` }),
          el('td', { style: 'white-space: nowrap;' }, `${setsWon.me}–${setsWon.opp}`),
          el('td', { style: 'white-space: nowrap;' }, matchScoreLabel(m)),
          el('td', { html: resBadge }),
          el('td', { style: 'text-align: right; white-space: nowrap;' },
            toggle,
            el('button', { class: 'icon-btn', onClick: () => openMatchForm(m) }, '✎'),
            el('button', { class: 'icon-btn danger', onClick: () =>
              deleteWithUndo({ arr: state.badminton.matches, item: m, label: 'Match', navView: 'badminton' }) }, '✕'),
          ),
        ));
        tbody.appendChild(detailRow);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }
    wrap.appendChild(card);
  } else if (badmintonTab === 'tournaments') {
    const card = el('div', { class: 'card' });
    const list = state.badminton.tournaments;
    if (!list.length) {
      card.appendChild(emptyState('Aucun tournoi', 'Ajoute un tournoi ou un interclub.'));
    } else {
      list.forEach(t => card.appendChild(el('div', { class: 'list-item' },
        el('div', {},
          el('div', { class: 'title' }, t.name),
          el('div', { class: 'meta' }, `${fmtDate(t.date)} · ${t.location || '—'} · ${t.result || '—'}`),
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', onClick: () => openTournamentForm(t) }, '✎'),
          el('button', { class: 'icon-btn danger', onClick: () =>
            deleteWithUndo({ arr: state.badminton.tournaments, item: t, label: 'Tournoi', navView: 'badminton' }) }, '✕'),
        ),
      )));
    }
    wrap.appendChild(card);
  } else {
    // stats
    const grid = el('div', { class: 'grid cols-2' });
    grid.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Répartition par type'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'bad-types' }))));
    grid.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Victoires / Défaites par type'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'bad-results' }))));
    wrap.appendChild(grid);
    setTimeout(() => {
      const types = ['simple', 'double', 'mixte'];
      chart($('#bad-types').getContext('2d'), {
        type: 'bar',
        data: { labels: types, datasets: [{ label: 'Matchs', data: types.map(t => byType(t).length),
          backgroundColor: chartTheme.accent }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } }, scales: baseScales() }
      });
      chart($('#bad-results').getContext('2d'), {
        type: 'bar',
        data: {
          labels: types,
          datasets: [
            { label: 'Victoires', data: types.map(t => byType(t).filter(m => m.result === 'win').length), backgroundColor: chartTheme.success },
            { label: 'Défaites', data: types.map(t => byType(t).filter(m => m.result === 'loss').length), backgroundColor: chartTheme.accent },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
          scales: { ...baseScales(), x: { ...baseScales().x, stacked: true }, y: { ...baseScales().y, stacked: true } } }
      });
    }, 0);
  }

  return wrap;
};

function noteBlock(label, text) {
  return el('div', { class: 'note-block' },
    el('div', { class: 'note-label' }, label),
    el('div', { class: 'note-text' }, (text && text.trim()) ? text : '—'),
  );
}

function tabBtn(key, label, onClick) {
  return el('button', { class: `tab ${badmintonTab === key ? 'active' : ''}`, onClick }, label);
}

function openMatchForm(existing) {
  const initialSets = existing?.sets?.length ? existing.sets.map(s => ({ me: s.me, opp: s.opp })) : [{ me: 21, opp: 0 }];
  const m = existing || { date: today(), opponent: '', opponent2: '', partner: '', type: 'simple', goodPoints: '', badPoints: '', workPoints: '' };
  let sets = initialSets;

  openModal(existing ? 'Modifier le match' : 'Nouveau match', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      // Récupère les scores des sets depuis le DOM
      const setRows = form.querySelectorAll('.set-row');
      const cleanSets = [];
      setRows.forEach(row => {
        const me = +row.querySelector('input[data-side=me]').value;
        const opp = +row.querySelector('input[data-side=opp]').value;
        if (!isNaN(me) && !isNaN(opp) && (me > 0 || opp > 0)) cleanSets.push({ me, opp });
      });
      if (!cleanSets.length) { toast('Saisis au moins un set.'); return; }
      const isDbl = data.type === 'double' || data.type === 'mixte';
      const entry = {
        id: existing?.id || id(),
        date: data.date,
        opponent: data.opponent.trim(),
        opponent2: isDbl ? (data.opponent2 || '').trim() : '',
        partner: isDbl ? (data.partner || '').trim() : '',
        type: data.type,
        sets: cleanSets,
        goodPoints: data.goodPoints.trim(),
        badPoints: data.badPoints.trim(),
        workPoints: data.workPoints.trim(),
        notes: existing?.notes || '',
      };
      entry.result = matchResult(entry);
      // Compat : on garde myScore/oppScore = somme totale pour anciens calculs
      entry.myScore = cleanSets.reduce((s, x) => s + x.me, 0);
      entry.oppScore = cleanSets.reduce((s, x) => s + x.opp, 0);
      if (existing) {
        state.badminton.matches = state.badminton.matches.map(x => x.id === entry.id ? entry : x);
      } else {
        state.badminton.matches.push(entry);
      }
      save(); close(); navigate('badminton'); toast(existing ? 'Match mis à jour' : 'Match ajouté');
    } });

    function renderSets() {
      const container = form.querySelector('#sets-container');
      container.innerHTML = '';
      sets.forEach((s, i) => {
        const row = el('div', { class: 'set-row', style: 'display: grid; grid-template-columns: 28px 1fr 1fr auto; gap: 8px; align-items: center; margin-bottom: 6px;' },
          el('div', { style: 'font-size: 12px; color: var(--text-dim); font-weight: 600;' }, `Set ${i + 1}`),
          el('input', { type: 'number', min: '0', 'data-side': 'me', value: String(s.me), required: '', style: 'text-align: center;' }),
          el('input', { type: 'number', min: '0', 'data-side': 'opp', value: String(s.opp), required: '', style: 'text-align: center;' }),
          sets.length > 1 ? el('button', { type: 'button', class: 'icon-btn danger', onClick: () => {
            // Mémorise les valeurs courantes avant de re-render
            const rows = form.querySelectorAll('.set-row');
            sets = Array.from(rows).map(r => ({ me: +r.querySelector('input[data-side=me]').value, opp: +r.querySelector('input[data-side=opp]').value }));
            sets.splice(i, 1); renderSets();
          } }, '✕') : el('div'),
        );
        container.appendChild(row);
      });
    }

    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${m.date}" required></div>
        <div><label>Type</label><select name="type">
          <option value="simple" ${m.type === 'simple' ? 'selected' : ''}>Simple</option>
          <option value="double" ${m.type === 'double' ? 'selected' : ''}>Double</option>
          <option value="mixte" ${m.type === 'mixte' ? 'selected' : ''}>Mixte</option>
        </select></div>
      </div>
      <div class="dbl-partner-row"${isDoubles(m) ? '' : ' hidden'}>
        <label>Mon coéquipier</label>
        <input type="text" name="partner" value="${(m.partner || '').replace(/"/g, '&quot;')}" placeholder="Nom du partenaire">
      </div>
      <div class="opp-row">
        <label class="opp-label">${isDoubles(m) ? 'Adversaire 1' : 'Adversaire'}</label>
        <input type="text" name="opponent" value="${(m.opponent || '').replace(/"/g, '&quot;')}" placeholder="Nom de l'adversaire">
      </div>
      <div class="dbl-opp2-row"${isDoubles(m) ? '' : ' hidden'}>
        <label>Adversaire 2</label>
        <input type="text" name="opponent2" value="${(m.opponent2 || '').replace(/"/g, '&quot;')}" placeholder="Nom du 2e adversaire">
      </div>
      <div>
        <label>Scores par set</label>
        <div style="display: grid; grid-template-columns: 28px 1fr 1fr auto; gap: 8px; font-size: 11px; color: var(--text-dim); padding: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px;">
          <div></div><div style="text-align: center;">Moi</div><div style="text-align: center;">Adv.</div><div></div>
        </div>
        <div id="sets-container"></div>
        <button type="button" id="add-set-btn" class="btn small secondary" style="margin-top: 4px;">+ Ajouter un set</button>
      </div>
      <div><label>✅ Qu'est-ce que j'ai bien fait&nbsp;?</label><textarea name="goodPoints" placeholder="Points forts du match…">${m.goodPoints || ''}</textarea></div>
      <div><label>❌ Qu'est-ce que j'ai mal fait&nbsp;?</label><textarea name="badPoints" placeholder="Erreurs, points faibles…">${m.badPoints || ''}</textarea></div>
      <div><label>🎯 Sur quels points dois-je bosser&nbsp;?</label><textarea name="workPoints" placeholder="Axes de travail pour la prochaine fois…">${m.workPoints || ''}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    // Affichage conditionnel des champs partenaire / 2e adversaire selon le type
    const typeSel = form.querySelector('select[name=type]');
    const partnerRow = form.querySelector('.dbl-partner-row');
    const opp2Row = form.querySelector('.dbl-opp2-row');
    const oppLabel = form.querySelector('.opp-label');
    const syncDoublesFields = () => {
      const dbl = typeSel.value === 'double' || typeSel.value === 'mixte';
      partnerRow.hidden = !dbl;
      opp2Row.hidden = !dbl;
      oppLabel.textContent = dbl ? 'Adversaire 1' : 'Adversaire';
    };
    typeSel.addEventListener('change', syncDoublesFields);
    syncDoublesFields();

    // Render initial des sets
    renderSets();
    // Bouton "+ Ajouter un set"
    form.querySelector('#add-set-btn').addEventListener('click', () => {
      // Mémoriser les valeurs courantes avant le re-render
      const rows = form.querySelectorAll('.set-row');
      sets = Array.from(rows).map(r => ({ me: +r.querySelector('input[data-side=me]').value, opp: +r.querySelector('input[data-side=opp]').value }));
      sets.push({ me: 21, opp: 0 });
      renderSets();
    });
    // Bouton Annuler (le seul de .form-actions)
    form.querySelector('.form-actions button[type=button]').onclick = close;
    return form;
  });
}

function openTournamentForm(existing) {
  const t = existing || { date: today(), name: '', location: '', result: '' };
  openModal(existing ? 'Modifier le tournoi' : 'Nouveau tournoi', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const entry = { id: existing?.id || id(), ...data };
      if (existing) state.badminton.tournaments = state.badminton.tournaments.map(x => x.id === entry.id ? entry : x);
      else state.badminton.tournaments.push(entry);
      save(); close(); navigate('badminton'); toast(existing ? 'Tournoi mis à jour' : 'Tournoi ajouté');
    } });
    form.innerHTML = `
      <div><label>Nom</label><input type="text" name="name" value="${t.name || ''}" required></div>
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${t.date}" required></div>
        <div><label>Lieu</label><input type="text" name="location" value="${t.location || ''}"></div>
      </div>
      <div><label>Résultat</label><input type="text" name="result" value="${t.result || ''}" placeholder="ex : Demi-finale, Victoire 3-1"></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Poids ----------

views.weight = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Poids', 'Suis l’évolution de ton poids de forme.',
    el('button', { class: 'btn', onClick: () => simpleEntryForm('weight', { label: 'Poids (kg)', field: 'value', type: 'number', step: '0.1' }) }, '+ Nouvelle pesée')));

  const card = el('div', { class: 'card' }, el('h3', {}, 'Évolution du poids'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'w-chart' })));
  wrap.appendChild(card);

  const listCard = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  const arr = [...state.weight].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) listCard.appendChild(emptyState('Aucune pesée', 'Ajoute ta première pesée.'));
  arr.forEach(w => listCard.appendChild(el('div', { class: 'list-item' },
    el('div', {}, el('div', { class: 'title' }, `${w.value} kg`), el('div', { class: 'meta' }, fmtDate(w.date))),
    el('button', { class: 'icon-btn danger', onClick: () =>
      deleteWithUndo({ arr: state.weight, item: w, label: 'Pesée', navView: 'weight' }) }, '✕'),
  )));
  wrap.appendChild(listCard);

  setTimeout(() => {
    if (!state.weight.length) return;
    const sorted = [...state.weight].sort((a, b) => a.date.localeCompare(b.date));
    chart($('#w-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: sorted.map(w => shortDate(w.date)),
        datasets: [{ label: 'Poids', data: sorted.map(w => w.value),
          borderColor: chartTheme.accent, backgroundColor: 'rgba(240,163,95,0.15)', fill: true, tension: 0.35, pointRadius: 4 }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, scales: baseScales('kg') }
    });
  }, 0);
  return wrap;
};

// ---------- Course ----------

views.runs = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Course à pied', 'Distances, durées et allures de tes sorties.',
    el('button', { class: 'btn', onClick: () => openRunForm() }, '+ Nouvelle sortie')));

  const card = el('div', { class: 'card' }, el('h3', {}, 'Distances parcourues'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'r-chart' })));
  wrap.appendChild(card);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Sorties'));
  const arr = [...state.runs].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) list.appendChild(emptyState('Aucune sortie', 'Ajoute ta première sortie.'));
  arr.forEach(r => {
    const pace = r.distance ? (r.duration / r.distance).toFixed(2) : '—';
    list.appendChild(el('div', { class: 'list-item' },
      el('div', {},
        el('div', { class: 'title' }, `${r.distance} km en ${r.duration} min`),
        el('div', { class: 'meta' }, `${fmtDate(r.date)} · allure ${pace} min/km${r.notes ? ' · ' + r.notes : ''}`),
      ),
      el('button', { class: 'icon-btn danger', onClick: () =>
        deleteWithUndo({ arr: state.runs, item: r, label: 'Sortie', navView: 'runs' }) }, '✕'),
    ));
  });
  wrap.appendChild(list);

  setTimeout(() => {
    if (!state.runs.length) return;
    const sorted = [...state.runs].sort((a, b) => a.date.localeCompare(b.date));
    chart($('#r-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(r => shortDate(r.date)),
        datasets: [{ label: 'Distance (km)', data: sorted.map(r => r.distance), backgroundColor: chartTheme.info }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: baseScales('km') }
    });
  }, 0);
  return wrap;
};

function openRunForm() {
  openModal('Nouvelle sortie', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.runs.push({ id: id(), date: d.date, distance: +d.distance, duration: +d.duration, notes: d.notes.trim() });
      save(); close(); navigate('runs'); toast('Sortie ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Distance (km)</label><input type="number" step="0.1" name="distance" required></div>
      </div>
      <div><label>Durée (min)</label><input type="number" step="0.1" name="duration" required></div>
      <div><label>Notes</label><textarea name="notes" placeholder="ressenti, parcours…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Musculation ----------

const MUSCLE_GROUPS = [
  { key: 'chest', label: 'Pecs', emoji: '🫀' },
  { key: 'back', label: 'Dos', emoji: '🦾' },
  { key: 'shoulders', label: 'Épaules', emoji: '💪' },
  { key: 'arms', label: 'Bras', emoji: '💪' },
  { key: 'legs', label: 'Jambes', emoji: '🦵' },
  { key: 'glutes', label: 'Fessiers', emoji: '🍑' },
  { key: 'core', label: 'Abdos / Core', emoji: '🧘' },
  { key: 'cardio', label: 'Cardio', emoji: '🏃' },
  { key: 'fullbody', label: 'Full-body', emoji: '🔥' },
];

function muscleLabel(k) {
  const g = MUSCLE_GROUPS.find(x => x.key === k);
  return g ? `${g.emoji} ${g.label}` : k;
}

// Lundi de la semaine ISO d'une date donnée
function isoWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

// Groupes pertinents pour l'alerte de négligence (on saute cardio/fullbody : trop génériques)
const TRACKED_GROUPS_FOR_ALERT = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core'];

function neglectedGroups(allLifts, thresholdDays) {
  const todayMs = Date.now();
  const lastByGroup = {};
  allLifts.forEach(l => {
    const t = new Date(l.date).getTime();
    (l.groups || []).forEach(g => {
      if (l.groups.includes('fullbody')) {
        // une séance full-body compte pour tous les groupes principaux
        TRACKED_GROUPS_FOR_ALERT.forEach(k => { if (!lastByGroup[k] || t > lastByGroup[k]) lastByGroup[k] = t; });
      } else if (!lastByGroup[g] || t > lastByGroup[g]) {
        lastByGroup[g] = t;
      }
    });
  });
  // Sur les groupes suivis : on alerte ceux jamais travaillés OU pas travaillés depuis ≥ threshold j
  // (mais on n'alerte pas sur un groupe jamais touché si l'utilisateur n'a quasi pas de séances :
  //  inutile de râler dès la première semaine — d'où la condition sur le total de séances)
  const haveEnoughHistory = allLifts.length >= 4;
  const items = [];
  TRACKED_GROUPS_FOR_ALERT.forEach(g => {
    const last = lastByGroup[g];
    if (!last) {
      if (haveEnoughHistory) items.push({ key: g, days: null });
      return;
    }
    const days = Math.floor((todayMs - last) / 86400000);
    if (days >= thresholdDays) items.push({ key: g, days });
  });
  // Trie : jamais d'abord, puis du plus négligé au moins négligé
  items.sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));
  return items;
}

function neglectedGroupsCard(items) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, '⚠️ Groupes à reprendre'));
  card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 12px;' },
    items.length > 1 ? 'Ces groupes n\'ont pas été travaillés récemment.' : 'Ce groupe n\'a pas été travaillé récemment.'));
  const pills = el('div', { class: 'group-pills' });
  items.forEach(({ key, days }) => {
    const txt = days == null ? 'jamais' : `${days} j`;
    pills.appendChild(el('div', { class: 'group-pill neglected' },
      el('span', { class: 'group-pill-label' }, muscleLabel(key)),
      el('span', { class: 'group-pill-count' }, txt),
    ));
  });
  card.appendChild(pills);
  return card;
}

function weeklyTargetCard(done, target) {
  const pct = Math.min(100, Math.round((done / target) * 100));
  const reached = done >= target;
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { style: 'display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap;' },
    el('h3', { style: 'margin: 0;' }, '🎯 Objectif hebdo'),
    el('div', { style: 'font-size: 12px; color: var(--text-dim); display: flex; gap: 8px; align-items: center;' },
      el('span', {}, `${done} / ${target} séances`),
      el('button', { class: 'icon-btn', title: 'Modifier l\'objectif', onClick: () => openLiftTargetForm() }, '✎'),
    ),
  ));
  const bar = el('div', { class: 'progress', style: 'margin-top: 12px; height: 10px;' });
  const fill = el('div', { class: `progress-fill${reached ? ' full' : ''}`, style: `width: ${pct}%;` });
  bar.appendChild(fill);
  card.appendChild(bar);
  card.appendChild(el('p', { style: `margin: 8px 0 0; font-size: 12px; color: ${reached ? 'var(--success)' : 'var(--text-dim)'};` },
    reached ? `✅ Objectif atteint — ${done - target > 0 ? `+${done - target} bonus` : 'pile sur le rythme'}.`
            : `Encore ${target - done} séance${target - done > 1 ? 's' : ''} d'ici dimanche.`));
  return card;
}

function openLiftTargetForm() {
  openModal('Objectif hebdo', (close) => {
    const cur = +(state.settings?.liftWeeklyTarget) || 3;
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const n = Math.max(1, Math.min(14, +d.target || 3));
      state.settings = { ...(state.settings || {}), liftWeeklyTarget: n };
      save(); close(); navigate('lifts'); toast(`Objectif : ${n} séance${n > 1 ? 's' : ''}/sem`);
    } });
    form.innerHTML = `
      <div><label>Nombre de séances par semaine</label>
        <input type="number" name="target" min="1" max="14" step="1" value="${cur}" required></div>
      <p class="form-hint">La semaine commence le lundi.</p>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

views.lifts = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Musculation', 'Quel jour, quel groupe — pour te souvenir. Les détails de séries sont dans Hevy.',
    el('button', { class: 'btn', onClick: () => openLiftForm() }, '+ Nouvelle séance')));

  const all = [...state.lifts].sort((a, b) => b.date.localeCompare(a.date));

  // KPIs : cette semaine / semaine dernière / total / streak
  const todayStr = today();
  const thisWeekStart = isoWeekStart(todayStr);
  const lastWeekStart = (() => {
    const d = new Date(thisWeekStart); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const thisWeek = all.filter(l => l.date >= thisWeekStart);
  const lastWeek = all.filter(l => l.date >= lastWeekStart && l.date < thisWeekStart);
  const delta = thisWeek.length - lastWeek.length;

  const target = Math.max(1, +(state.settings?.liftWeeklyTarget) || 3);
  const kpis = el('div', { class: 'grid cols-3' });
  kpis.appendChild(kpiCard('🗓️ Cette semaine', String(thisWeek.length), thisWeek.length > 1 ? 'séances' : 'séance',
    thisWeek.length >= target ? 'success' : (thisWeek.length ? 'accent' : 'danger')));
  kpis.appendChild(kpiCard('⏪ Semaine dernière', String(lastWeek.length),
    delta === 0 ? '= même rythme' : (delta > 0 ? `+${delta} cette semaine` : `${delta} cette semaine`),
    delta >= 0 ? 'success' : 'danger'));
  kpis.appendChild(kpiCard('📊 Total séances', String(all.length), all.length ? `depuis ${fmtDate(all.at(-1).date)}` : ''));
  wrap.appendChild(kpis);
  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Objectif hebdo : jauge de progression
  wrap.appendChild(weeklyTargetCard(thisWeek.length, target));
  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Alerte : groupes négligés (pas travaillés depuis ≥ 10 jours)
  const neglected = neglectedGroups(all, 10);
  if (neglected.length) {
    wrap.appendChild(neglectedGroupsCard(neglected));
    wrap.appendChild(el('div', { style: 'height: 16px;' }));
  }

  // Graphique : séances par semaine (8 dernières)
  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Fréquence par semaine'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'lift-chart' })));
  wrap.appendChild(chartCard);

  // Répartition par groupe musculaire (4 dernières semaines)
  const groupCard = el('div', { class: 'card' }, el('h3', {}, 'Groupes travaillés (4 dernières semaines)'));
  const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString().slice(0, 10); })();
  const recent = all.filter(l => l.date >= cutoff);
  const groupCounts = {};
  recent.forEach(l => (l.groups || []).forEach(g => { groupCounts[g] = (groupCounts[g] || 0) + 1; }));
  if (!Object.keys(groupCounts).length) {
    groupCard.appendChild(emptyState('Aucune séance récente', 'Tes groupes apparaîtront ici dès la première séance.'));
  } else {
    const sorted = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
    const pills = el('div', { class: 'group-pills' });
    sorted.forEach(([k, count]) => pills.appendChild(el('div', { class: 'group-pill' },
      el('span', { class: 'group-pill-label' }, muscleLabel(k)),
      el('span', { class: 'group-pill-count' }, String(count)),
    )));
    groupCard.appendChild(pills);
  }

  // Répartition par salle (4 dernières semaines)
  const gymCard = el('div', { class: 'card' }, el('h3', {}, 'Salles (4 dernières semaines)'));
  const gymCounts = {};
  recent.forEach(l => { if (l.gym) gymCounts[l.gym] = (gymCounts[l.gym] || 0) + 1; });
  const noGymCount = recent.filter(l => !l.gym).length;
  const taggedCount = recent.length - noGymCount;
  if (!taggedCount) {
    gymCard.appendChild(emptyState('Aucune salle taguée', 'Choisis « On Air » ou « Fitness » en créant une séance pour voir ta répartition.'));
  } else {
    gymCard.appendChild(el('div', { class: 'chart-wrap', style: 'height: 170px;' }, el('canvas', { id: 'gym-chart' })));
    const favKey = Object.entries(gymCounts).sort((a, b) => b[1] - a[1])[0][0];
    const gymPills = el('div', { class: 'group-pills', style: 'margin-top: 12px; justify-content: center;' });
    GYMS.forEach(g => {
      if (!gymCounts[g.key]) return;
      const pct = Math.round((gymCounts[g.key] / taggedCount) * 100);
      gymPills.appendChild(el('div', { class: 'group-pill' },
        el('span', { class: 'group-pill-label' }, `${g.emoji} ${g.label}`),
        el('span', { class: 'group-pill-count' }, `${gymCounts[g.key]} · ${pct} %`),
      ));
    });
    if (noGymCount) gymPills.appendChild(el('div', { class: 'group-pill' },
      el('span', { class: 'group-pill-label' }, '🏠 Sans salle'),
      el('span', { class: 'group-pill-count', style: 'background: var(--panel-2); color: var(--text-dim);' }, String(noGymCount)),
    ));
    gymCard.appendChild(gymPills);
    gymCard.appendChild(el('p', { style: 'margin: 10px 0 0; text-align: center; font-size: 12px; color: var(--text-dim);' },
      `Salle favorite : ${gymLabel(favKey)} (${gymCounts[favKey]} séance${gymCounts[favKey] > 1 ? 's' : ''} sur ${taggedCount} taguée${taggedCount > 1 ? 's' : ''})`));
  }

  const statsGrid = el('div', { class: 'grid cols-2', style: 'margin-top: 16px;' });
  statsGrid.appendChild(groupCard);
  statsGrid.appendChild(gymCard);
  wrap.appendChild(statsGrid);

  // Historique
  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  if (!all.length) {
    list.appendChild(emptyState('Aucune séance', 'Ajoute ta première séance.'));
  } else {
    all.forEach(l => list.appendChild(el('div', { class: 'list-item' },
      el('div', {},
        el('div', { class: 'title' },
          (l.groups || []).map(muscleLabel).join(' · ') || (l.exercise ? l.exercise : '—'),
        ),
        el('div', { class: 'meta' },
          `${fmtDate(l.date)}${l.gym ? ' · ' + gymLabel(l.gym) : ''}${l.focus ? ' · ' + l.focus : ''}${l.notes ? ' · ' + l.notes : ''}`),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'icon-btn', onClick: () => openLiftForm(l) }, '✎'),
        el('button', { class: 'icon-btn danger', onClick: () =>
          deleteWithUndo({ arr: state.lifts, item: l, label: 'Séance', navView: 'lifts' }) }, '✕'),
      ),
    )));
  }
  wrap.appendChild(list);

  // Graphique séances/semaine
  setTimeout(() => {
    const buckets = {};
    all.forEach(l => { const k = isoWeekStart(l.date); buckets[k] = (buckets[k] || 0) + 1; });
    // 8 dernières semaines
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(thisWeekStart); d.setDate(d.getDate() - i * 7);
      weeks.push(d.toISOString().slice(0, 10));
    }
    chart($('#lift-chart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: weeks.map(w => 'sem ' + shortDate(w)),
        datasets: [{
          label: 'Séances',
          data: weeks.map(w => buckets[w] || 0),
          backgroundColor: weeks.map(w => w === thisWeekStart ? chartTheme.accent : chartTheme.info),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { ...baseScales(), y: { ...baseScales().y, ticks: { stepSize: 1, color: chartTheme.text }, beginAtZero: true } },
      },
    });

    // Doughnut répartition par salle
    const gymCanvas = $('#gym-chart');
    if (gymCanvas) {
      const labels = [], data = [], colors = [];
      const gymColors = { onair: chartTheme.accent, fitness: chartTheme.info };
      GYMS.forEach(g => {
        if (!gymCounts[g.key]) return;
        labels.push(g.label);
        data.push(gymCounts[g.key]);
        colors.push(gymColors[g.key] || chartTheme.success);
      });
      chart(gymCanvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'transparent' }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        },
      });
    }
  }, 0);

  return wrap;
};

const GYMS = [
  { key: 'onair', label: 'On Air', emoji: '🏟️' },
  { key: 'fitness', label: 'Fitness', emoji: '🏢' },
];

function gymLabel(k) {
  const g = GYMS.find(x => x.key === k);
  return g ? `${g.emoji} ${g.label}` : k;
}

// Sélecteur de salle : un seul choix, re-cliquer désélectionne
function gymPicker(initial) {
  let selected = initial || null;
  const wrap = el('div', { class: 'gym-picker' });
  GYMS.forEach(g => {
    const btn = el('button', {
      type: 'button',
      class: `gym-btn${selected === g.key ? ' active' : ''}`,
      onClick: () => {
        selected = selected === g.key ? null : g.key;
        wrap.querySelectorAll('.gym-btn').forEach(b => b.classList.remove('active'));
        if (selected === g.key) btn.classList.add('active');
      },
    }, `${g.emoji} ${g.label}`);
    wrap.appendChild(btn);
  });
  return { el: wrap, get value() { return selected; } };
}

function openLiftForm(existing) {
  const l = existing || { date: today(), groups: [], focus: '', notes: '', gym: null };
  let selectedGroups = new Set(l.groups || []);
  const gym = gymPicker(l.gym);

  openModal(existing ? 'Modifier la séance' : 'Nouvelle séance', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!selectedGroups.size) { toast('Sélectionne au moins un groupe musculaire.'); return; }
      const entry = {
        id: existing?.id || id(),
        date: d.date,
        groups: Array.from(selectedGroups),
        gym: gym.value,
        focus: (d.focus || '').trim(),
        notes: (d.notes || '').trim(),
      };
      if (existing) state.lifts = state.lifts.map(x => x.id === entry.id ? entry : x);
      else state.lifts.push(entry);
      save(); close(); navigate('lifts'); toast(existing ? 'Séance mise à jour' : 'Séance ajoutée');
    } });

    form.appendChild(el('div', {},
      el('label', {}, 'Date'),
      el('input', { type: 'date', name: 'date', value: l.date, required: '' }),
    ));

    const groupsField = el('div', {},
      el('label', {}, 'Groupe(s) musculaire(s) travaillé(s)'),
      el('div', { class: 'muscle-grid' }),
    );
    const grid = groupsField.querySelector('.muscle-grid');
    MUSCLE_GROUPS.forEach(g => {
      const btn = el('button', {
        type: 'button',
        class: `muscle-btn${selectedGroups.has(g.key) ? ' active' : ''}`,
        onClick: () => {
          if (selectedGroups.has(g.key)) selectedGroups.delete(g.key);
          else selectedGroups.add(g.key);
          btn.classList.toggle('active');
        },
      }, el('span', { class: 'muscle-emoji' }, g.emoji), el('span', {}, g.label));
      grid.appendChild(btn);
    });
    form.appendChild(groupsField);

    form.appendChild(el('div', {},
      el('label', {}, 'Salle (facultatif)'),
      gym.el,
    ));

    form.appendChild(el('div', {},
      el('label', {}, 'Focus de la séance (facultatif)'),
      el('input', { type: 'text', name: 'focus', value: l.focus || '', placeholder: 'Ex : Force / Hypertrophie / Power-up bench' }),
    ));

    form.appendChild(el('div', {},
      el('label', {}, 'Notes (facultatif)'),
      el('textarea', { name: 'notes', placeholder: 'Ressenti, exercices clés, axes pour la prochaine fois…' }, l.notes || ''),
    ));

    form.appendChild(el('p', { class: 'form-hint' },
      '💡 Tes détails (séries, reps, charges) restent dans Hevy. Athelio retient juste le rythme et les groupes travaillés.'));

    form.appendChild(el('div', { class: 'form-actions' },
      el('button', { type: 'button', class: 'btn secondary', onClick: close }, 'Annuler'),
      el('button', { type: 'submit', class: 'btn' }, 'Enregistrer'),
    ));

    return form;
  });
}

// ---------- Mensurations ----------

const BODY_SVG = `
<svg viewBox="0 0 320 500" role="img" aria-label="Schéma des points de mensuration">
  <defs>
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6b1220"/>
      <stop offset="1" stop-color="#3a0b10"/>
    </linearGradient>
  </defs>
  <g fill="url(#bodyGrad)">
    <circle cx="160" cy="46" r="26"/>
    <rect x="150" y="68" width="20" height="18" rx="8"/>
    <rect x="112" y="92" width="96" height="74" rx="30"/>
    <rect x="126" y="150" width="68" height="66" rx="24"/>
    <rect x="116" y="196" width="88" height="54" rx="26"/>
    <rect x="80" y="100" width="26" height="122" rx="13"/>
    <rect x="214" y="100" width="26" height="122" rx="13"/>
    <rect x="124" y="238" width="30" height="214" rx="15"/>
    <rect x="166" y="238" width="30" height="214" rx="15"/>
  </g>
  <g stroke="#f0a35f" stroke-width="2" fill="none" stroke-dasharray="5 4" stroke-linecap="round">
    <line x1="104" y1="120" x2="216" y2="120"/>
    <line x1="112" y1="182" x2="208" y2="182"/>
    <ellipse cx="93" cy="150" rx="20" ry="11"/>
    <ellipse cx="139" cy="300" rx="22" ry="12"/>
  </g>
  <g stroke="#f0a35f" stroke-width="1.5">
    <line x1="216" y1="120" x2="244" y2="120"/>
    <line x1="208" y1="182" x2="244" y2="182"/>
    <line x1="73" y1="150" x2="52" y2="150"/>
    <line x1="117" y1="300" x2="60" y2="300"/>
  </g>
  <g fill="#f0a35f">
    <circle cx="244" cy="120" r="2.5"/>
    <circle cx="244" cy="182" r="2.5"/>
    <circle cx="52" cy="150" r="2.5"/>
    <circle cx="60" cy="300" r="2.5"/>
  </g>
  <g fill="#fbe9d7" font-family="Inter, sans-serif" font-size="13" font-weight="600">
    <text x="250" y="124">Poitrine</text>
    <text x="250" y="186">Taille</text>
    <text x="46" y="154" text-anchor="end">Bras</text>
    <text x="54" y="304" text-anchor="end">Cuisse</text>
  </g>
</svg>`;

views.measurements = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Mensurations', 'Mesure-toi régulièrement aux bons endroits pour suivre ta transformation.',
    el('button', { class: 'btn', onClick: () => openMeasurementForm() }, '+ Nouvelle mesure')));

  const grid = el('div', { class: 'grid cols-2 measure-grid' });

  const diagram = el('div', { class: 'card body-diagram-card' },
    el('h3', {}, 'Où prendre les mesures'),
    el('div', { class: 'body-diagram', html: BODY_SVG }),
    el('p', { class: 'diagram-hint' },
      'Poitrine : au niveau le plus fort. Bras : biceps contracté. Taille : au plus étroit, au-dessus du nombril. Cuisse : au plus large. Mesure toujours au même endroit, le matin, sans serrer le mètre.'),
  );

  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution des mensurations (cm)'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'm-chart' })));

  grid.appendChild(diagram);
  grid.appendChild(chartCard);
  wrap.appendChild(grid);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Historique'));
  const arr = [...state.measurements].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) list.appendChild(emptyState('Aucune mesure', 'Ajoute ta première série de mesures.'));
  arr.forEach(m => list.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, fmtDate(m.date)),
      el('div', { class: 'meta' }, `Poitrine ${m.chest || '—'} cm · Bras ${m.arm || '—'} cm · Taille ${m.waist || '—'} cm · Cuisse ${m.thigh || '—'} cm`),
    ),
    el('button', { class: 'icon-btn danger', onClick: () =>
      deleteWithUndo({ arr: state.measurements, item: m, label: 'Mesure', navView: 'measurements' }) }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    const arr = [...state.measurements].sort((a, b) => a.date.localeCompare(b.date));
    if (!arr.length) return;
    const labels = arr.map(m => shortDate(m.date));
    const mkSet = (label, key, color) => ({ label, data: arr.map(m => m[key]), borderColor: color, backgroundColor: color, tension: 0.3, fill: false, pointRadius: 4, spanGaps: true });
    chart($('#m-chart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [
        mkSet('Poitrine', 'chest', chartTheme.accent2),
        mkSet('Bras', 'arm', chartTheme.info),
        mkSet('Taille', 'waist', chartTheme.accent),
        mkSet('Cuisse', 'thigh', chartTheme.success),
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        scales: baseScales('cm') }
    });
  }, 0);
  return wrap;
};

function openMeasurementForm() {
  openModal('Nouvelle mesure', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.measurements.push({
        id: id(), date: d.date,
        chest: d.chest ? +d.chest : null,
        arm: d.arm ? +d.arm : null,
        waist: d.waist ? +d.waist : null,
        thigh: d.thigh ? +d.thigh : null,
      });
      save(); close(); navigate('measurements'); toast('Mesure ajoutée');
    } });
    form.innerHTML = `
      <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
      <div class="form-row">
        <div><label>Poitrine (cm)</label><input type="number" step="0.5" name="chest"></div>
        <div><label>Bras (cm)</label><input type="number" step="0.5" name="arm"></div>
      </div>
      <div class="form-row">
        <div><label>Tour de taille (cm)</label><input type="number" step="0.5" name="waist"></div>
        <div><label>Cuisse (cm)</label><input type="number" step="0.5" name="thigh"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Photos ----------

let photosTab = 'all';

views.photos = () => {
  const wrap = el('div');
  const actions = photosTab === 'all'
    ? el('label', { class: 'btn', style: 'cursor: pointer;' }, '+ Ajouter une photo',
        el('input', { type: 'file', accept: 'image/*', hidden: '', onChange: (e) => addPhoto(e.target.files[0]) }))
    : el('button', { class: 'btn', onClick: () => openComparisonForm() }, '+ Nouvelle comparaison');

  wrap.appendChild(viewHeader('Photos', 'Documente ta transformation visuellement.', actions));

  const tabs = el('div', { class: 'tabs' },
    el('button', { class: `tab ${photosTab === 'all' ? 'active' : ''}`, onClick: () => { photosTab = 'all'; navigate('photos'); } }, 'Photos'),
    el('button', { class: `tab ${photosTab === 'compare' ? 'active' : ''}`, onClick: () => { photosTab = 'compare'; navigate('photos'); } }, `Avant / Après${state.comparisons.length ? ' (' + state.comparisons.length + ')' : ''}`),
  );
  wrap.appendChild(tabs);

  if (photosTab === 'all') {
    const card = el('div', { class: 'card' });
    const photos = [...state.photos].sort((a, b) => b.date.localeCompare(a.date));
    if (!photos.length) {
      card.appendChild(emptyState('Aucune photo', 'Ajoute une première photo pour démarrer ton suivi.'));
    } else {
      const grid = el('div', { class: 'photo-grid' });
      photos.forEach(p => {
        grid.appendChild(el('div', { class: 'photo-card' },
          el('img', { src: p.data, alt: p.label }),
          el('div', { class: 'photo-meta' },
            el('div', {},
              el('div', { style: 'font-weight: 600;' }, p.label || fmtDate(p.date)),
              el('div', { style: 'color: var(--text-dim); font-size: 11px;' }, fmtDate(p.date)),
            ),
            el('button', { class: 'icon-btn danger', onClick: () =>
              deleteWithUndo({ arr: state.photos, item: p, label: 'Photo', navView: 'photos' }) }, '✕'),
          ),
        ));
      });
      card.appendChild(grid);
    }
    wrap.appendChild(card);
  } else {
    // Onglet "Avant / Après"
    const comps = [...state.comparisons].sort((a, b) => b.date.localeCompare(a.date));
    if (!comps.length) {
      const card = el('div', { class: 'card' });
      card.appendChild(emptyState('Aucune comparaison', 'Crée ta première comparaison avant/après pour visualiser tes progrès côte à côte.'));
      wrap.appendChild(card);
    } else {
      comps.forEach(c => wrap.appendChild(comparisonCard(c)));
    }
  }

  return wrap;
};

function comparisonCard(c) {
  const card = el('div', { class: 'card compare-card' });
  let mode = 'side'; // 'side' = côte à côte, 'slider' = avant/après slider

  const head = el('div', { class: 'compare-head' },
    el('div', {},
      el('div', { class: 'compare-title' }, c.title || `Comparaison du ${fmtDate(c.date)}`),
      el('div', { class: 'compare-date' }, fmtDate(c.date)),
    ),
    el('div', { class: 'actions', style: 'display: flex; gap: 6px; align-items: center;' },
      el('div', { class: 'compare-mode-switch', role: 'tablist' },
        el('button', { class: 'mode-btn active', 'data-mode': 'side', title: 'Côte à côte' }, '⫶⫶'),
        el('button', { class: 'mode-btn', 'data-mode': 'slider', title: 'Slider avant/après' }, '◐'),
      ),
      el('button', { class: 'icon-btn', onClick: () => openComparisonForm(c) }, '✎'),
      el('button', { class: 'icon-btn danger', onClick: () =>
        deleteWithUndo({ arr: state.comparisons, item: c, label: 'Comparaison', navView: 'photos' }) }, '✕'),
    ),
  );

  const canvas = el('div', { class: 'compare-canvas' });
  const renderCanvas = () => {
    canvas.innerHTML = '';
    if (mode === 'side') {
      canvas.classList.remove('slider-mode');
      canvas.appendChild(el('div', { class: 'compare-side' },
        el('div', { class: 'compare-label' }, c.beforeLabel || 'Avant'),
        el('div', { class: 'compare-img-wrap' },
          el('img', { src: c.beforeData, alt: 'avant', loading: 'lazy', onClick: () => openImageZoom(c.beforeData) }),
        ),
      ));
      canvas.appendChild(el('div', { class: 'compare-side' },
        el('div', { class: 'compare-label after' }, c.afterLabel || 'Après'),
        el('div', { class: 'compare-img-wrap' },
          el('img', { src: c.afterData, alt: 'après', loading: 'lazy', onClick: () => openImageZoom(c.afterData) }),
        ),
      ));
    } else {
      canvas.classList.add('slider-mode');
      canvas.appendChild(buildSlider(c));
    }
  };

  head.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      head.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderCanvas();
    });
  });

  card.appendChild(head);
  card.appendChild(canvas);
  if (c.notes) card.appendChild(el('div', { class: 'compare-notes' }, c.notes));
  renderCanvas();
  return card;
}

// Slider interactif "before/after" : la photo "après" est révélée par une barre verticale
// que l'on glisse. Les deux images sont superposées en taille réelle ; on coupe l'après
// avec clip-path → alignement pixel-perfect garanti.
function buildSlider(c) {
  const wrap = el('div', { class: 'slider-wrap' });
  const beforeImg = el('img', { src: c.beforeData, alt: 'avant', class: 'slider-img slider-before', draggable: 'false' });
  const afterImg = el('img', { src: c.afterData, alt: 'après', class: 'slider-img slider-after', draggable: 'false' });
  const handle = el('div', { class: 'slider-handle' }, el('div', { class: 'slider-handle-knob' }, '⇆'));
  const beforeTag = el('div', { class: 'slider-tag slider-tag-before' }, c.beforeLabel || 'Avant');
  const afterTag = el('div', { class: 'slider-tag slider-tag-after' }, c.afterLabel || 'Après');

  wrap.appendChild(beforeImg);
  wrap.appendChild(afterImg);
  wrap.appendChild(handle);
  wrap.appendChild(beforeTag);
  wrap.appendChild(afterTag);

  const setPct = (v) => {
    const p = Math.max(0, Math.min(100, v));
    afterImg.style.clipPath = `inset(0 0 0 ${p}%)`;
    handle.style.left = p + '%';
  };
  setPct(50);

  let dragging = false;
  const moveTo = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    setPct(((clientX - rect.left) / rect.width) * 100);
  };
  const onDown = (e) => {
    dragging = true;
    wrap.classList.add('dragging');
    moveTo(e.touches ? e.touches[0].clientX : e.clientX);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    moveTo(e.touches ? e.touches[0].clientX : e.clientX);
  };
  const onUp = () => { dragging = false; wrap.classList.remove('dragging'); };

  wrap.addEventListener('mousedown', onDown);
  wrap.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);
  window.addEventListener('touchcancel', onUp);

  return wrap;
}

function openImageZoom(src) {
  const root = $('#modal-root');
  const overlay = el('div', { class: 'image-zoom', onClick: () => overlay.remove() },
    el('img', { src }),
  );
  root.appendChild(overlay);
}

// Compresse une image (max 1400px, JPEG 85 %) — économise ~95 % du localStorage
function compressImage(file, maxW = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(img.src); reject(e); };
    img.src = URL.createObjectURL(file);
  });
}

async function addPhoto(file) {
  if (!file) return;
  try {
    const data = await compressImage(file);
    const label = prompt('Légende (facultatif) :') || '';
    state.photos.push({ id: id(), date: today(), label, data });
    if (!save()) { state.photos.pop(); return; }
    navigate('photos'); toast('Photo ajoutée');
  } catch { toast('Impossible de charger cette image.'); }
}

function openComparisonForm(existing) {
  let beforeData = existing?.beforeData || null;
  let afterData  = existing?.afterData  || null;

  openModal(existing ? 'Modifier la comparaison' : 'Nouvelle comparaison avant/après', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!beforeData || !afterData) { toast('Sélectionne les deux photos.'); return; }
      const entry = {
        id: existing?.id || id(),
        date: d.date,
        title: (d.title || '').trim(),
        beforeLabel: (d.beforeLabel || '').trim() || 'Avant',
        afterLabel:  (d.afterLabel  || '').trim() || 'Après',
        beforeData, afterData,
        notes: (d.notes || '').trim(),
      };
      if (existing) state.comparisons = state.comparisons.map(x => x.id === entry.id ? entry : x);
      else state.comparisons.push(entry);
      if (!save()) {
        if (!existing) state.comparisons.pop();
        toast('Stockage saturé — supprime des photos pour libérer de la place.');
        return;
      }
      close(); navigate('photos'); toast(existing ? 'Comparaison mise à jour' : 'Comparaison créée');
    } });

    const previewBefore = el('div', { class: 'compare-thumb', id: 'thumb-before' },
      beforeData ? el('img', { src: beforeData }) : el('span', {}, '🖼️ Aucune photo'));
    const previewAfter = el('div', { class: 'compare-thumb', id: 'thumb-after' },
      afterData ? el('img', { src: afterData }) : el('span', {}, '🖼️ Aucune photo'));

    const pickAndCompress = (which, previewEl) => async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        previewEl.innerHTML = '<span>⏳ Compression…</span>';
        const data = await compressImage(f);
        if (which === 'before') beforeData = data; else afterData = data;
        previewEl.innerHTML = ''; previewEl.appendChild(el('img', { src: data }));
      } catch { toast('Image invalide.'); }
    };

    const dateVal = existing?.date || today();
    form.appendChild(el('div', { class: 'form-row' },
      el('div', {}, el('label', {}, 'Date'), el('input', { type: 'date', name: 'date', value: dateVal, required: '' })),
      el('div', {}, el('label', {}, 'Titre (facultatif)'), el('input', { type: 'text', name: 'title', value: existing?.title || '', placeholder: 'Ex : 3 mois de muscu' })),
    ));

    form.appendChild(el('div', { class: 'compare-picker' },
      el('div', {},
        el('label', {}, 'Photo « avant »'),
        previewBefore,
        el('label', { class: 'btn small secondary', style: 'cursor: pointer; display: block; text-align: center; margin-top: 6px;' },
          beforeData ? 'Remplacer' : 'Choisir depuis la galerie',
          el('input', { type: 'file', accept: 'image/*', hidden: '', onChange: pickAndCompress('before', previewBefore) }),
        ),
        el('input', { type: 'text', name: 'beforeLabel', value: existing?.beforeLabel || 'Avant', placeholder: 'Légende', style: 'margin-top: 6px;' }),
      ),
      el('div', {},
        el('label', {}, 'Photo « après »'),
        previewAfter,
        el('label', { class: 'btn small secondary', style: 'cursor: pointer; display: block; text-align: center; margin-top: 6px;' },
          afterData ? 'Remplacer' : 'Choisir depuis la galerie',
          el('input', { type: 'file', accept: 'image/*', hidden: '', onChange: pickAndCompress('after', previewAfter) }),
        ),
        el('input', { type: 'text', name: 'afterLabel', value: existing?.afterLabel || 'Après', placeholder: 'Légende', style: 'margin-top: 6px;' }),
      ),
    ));

    form.appendChild(el('div', {},
      el('label', {}, 'Notes'),
      el('textarea', { name: 'notes', placeholder: 'Ressenti, mesures, conditions de prise de vue…' }, existing?.notes || ''),
    ));

    form.appendChild(el('div', { class: 'form-actions' },
      el('button', { type: 'button', class: 'btn secondary', onClick: close }, 'Annuler'),
      el('button', { type: 'submit', class: 'btn' }, 'Enregistrer'),
    ));

    return form;
  });
}

// ---------- Vidéos ----------

function parseVideo(url) {
  if (!url) return { type: 'none', src: '' };
  if (url.startsWith('data:video') || url.startsWith('blob:')) return { type: 'file', src: url };
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { type: 'youtube', embed: `https://www.youtube.com/embed/${m[1]}` };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { type: 'vimeo', embed: `https://player.vimeo.com/video/${m[1]}` };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)) return { type: 'file', src: url };
  return { type: 'link', src: url };
}

// Génère une miniature JPEG (dataURL) + ratio largeur/hauteur à partir d'un
// fichier vidéo local. Capture une frame vers 1 s (ou mi-durée si plus court).
function makeVideoThumb(file, { width = 480 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (result) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      try {
        const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.round(width * ratio);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        done({ dataUrl: canvas.toDataURL('image/jpeg', 0.72), ratio: video.videoWidth / video.videoHeight || 16 / 9 });
      } catch { done(null); }
    };
    video.src = url;
    setTimeout(() => done(null), 8000); // garde-fou (codec non supporté, fichier corrompu…)
  });
}

// Capture la frame actuelle d'un élément <video> en miniature JPEG
function captureVideoFrame(video, width = 480) {
  const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width * ratio);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.72), ratio: video.videoWidth / video.videoHeight || 16 / 9 };
}

// Adapte le format de la carte au format réel de la vidéo (16:9, vertical…)
function adaptEmbedRatio(video, v) {
  video.addEventListener('loadedmetadata', () => {
    const r = video.videoWidth / video.videoHeight;
    if (!r || !isFinite(r)) return;
    if (video.parentElement) video.parentElement.style.aspectRatio = String(r);
    if (v && !v.ratio) v.ratio = r; // mémorisé, persisté au prochain save()
  });
}

function videoEmbed(v) {
  // Vidéo fichier dans IndexedDB : on insère un placeholder puis on injecte la vraie src
  if (v.blobKey) {
    const video = el('video', { controls: '', preload: 'metadata', poster: v.thumb || null });
    adaptEmbedRatio(video, v);
    getVideoBlobUrl(v.blobKey).then((url) => {
      if (url) video.src = url;
      else video.replaceWith(el('div', { class: 'video-fallback' }, 'Vidéo introuvable (cache vidé ?)'));
    });
    return video;
  }
  const p = parseVideo(v.data || v.url || '');
  if (p.type === 'youtube' || p.type === 'vimeo') {
    return el('iframe', { src: p.embed, loading: 'lazy',
      allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      allowfullscreen: '' });
  }
  if (p.type === 'file') {
    const video = el('video', { src: p.src, controls: '', preload: 'metadata' });
    adaptEmbedRatio(video, v);
    return video;
  }
  if (p.type === 'link') {
    return el('a', { class: 'video-fallback', href: p.src, target: '_blank', rel: 'noopener' }, '▶ Ouvrir la vidéo');
  }
  return el('div', { class: 'video-fallback' }, 'Vidéo indisponible');
}

let videoTagFilter = null;

views.videos = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Vidéos', 'Garde tes vidéos datées pour visionner ta progression dans le temps.',
    el('button', { class: 'btn', onClick: () => openVideoForm() }, '+ Ajouter une vidéo')));

  const all = [...state.videos].sort((a, b) => b.date.localeCompare(a.date));

  // Filtres par tag
  const tagCounts = {};
  all.forEach(v => (v.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
  if (videoTagFilter && !tagCounts[videoTagFilter]) videoTagFilter = null;

  if (tags.length) {
    const filterBar = el('div', { class: 'tag-filter' });
    filterBar.appendChild(el('button', {
      class: `tag-chip ${videoTagFilter == null ? 'active' : ''}`,
      onClick: () => { videoTagFilter = null; navigate('videos'); },
    }, `Tout · ${all.length}`));
    tags.forEach(t => {
      filterBar.appendChild(el('button', {
        class: `tag-chip ${videoTagFilter === t ? 'active' : ''}`,
        onClick: () => { videoTagFilter = t; navigate('videos'); },
      }, `${t} · ${tagCounts[t]}`));
    });
    wrap.appendChild(filterBar);
  }

  const arr = videoTagFilter ? all.filter(v => (v.tags || []).includes(videoTagFilter)) : all;

  const card = el('div', { class: 'card' });
  if (!arr.length) {
    if (!all.length) {
      card.appendChild(emptyState('Aucune vidéo', 'Ajoute un lien (YouTube, Vimeo, Drive…) ou un fichier court pour suivre ta progression.'));
    } else {
      card.appendChild(emptyState('Aucune vidéo pour ce tag', 'Essaie un autre filtre ou ajoute un tag à tes vidéos existantes.'));
    }
  } else {
    const grid = el('div', { class: 'video-grid' });
    arr.forEach(v => grid.appendChild(videoCard(v)));
    card.appendChild(grid);
  }
  wrap.appendChild(card);
  return wrap;
};

function videoCard(v, opts = {}) {
  const stateKey = opts.stateKey || 'videos';
  const navView = opts.navView || 'videos';
  return el('div', { class: 'video-card' },
    el('div', { class: 'video-embed', style: v.ratio ? `aspect-ratio: ${v.ratio};` : null }, videoEmbed(v)),
    el('div', { class: 'video-info' },
      el('div', { class: 'video-head' },
        el('div', {},
          el('div', { class: 'video-date' }, fmtDate(v.date)),
          v.title ? el('div', { class: 'video-title' }, v.title) : null,
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', title: 'Modifier', onClick: () => openVideoForm({ ...opts, existing: v }) }, '✎'),
          el('button', { class: 'icon-btn danger', onClick: () =>
            deleteWithUndo({ arr: state[stateKey], item: v, label: 'Vidéo', navView, removeBlobKey: v.blobKey }) }, '✕'),
        ),
      ),
      (v.tags && v.tags.length) ? el('div', { class: 'video-tags' },
        ...v.tags.map(t => el('span', { class: 'video-tag' }, t))
      ) : null,
      v.notes ? el('div', { class: 'video-notes' }, v.notes) : null,
    ),
  );
}

function openVideoForm(opts = {}) {
  const stateKey = opts.stateKey || 'videos';
  const navView = opts.navView || 'videos';
  const existing = opts.existing || null;
  // Suggestions de tags = ceux déjà utilisés dans la même catégorie
  const suggested = Array.from(new Set((state[stateKey] || []).flatMap(v => v.tags || []))).sort();

  openModal(existing ? 'Modifier la vidéo' : 'Ajouter une vidéo', (close) => {
    let pendingFile = null;
    let pendingThumb = null;
    let pendingRatio = null;
    let currentTags = new Set(existing?.tags || []);

    const form = el('form', { class: 'form', onSubmit: async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const url = (d.url || '').trim();
      if (!existing && !url && !pendingFile) { toast('Ajoute un lien ou un fichier vidéo.'); return; }
      const tags = Array.from(currentTags);
      if (existing) {
        const updated = { ...existing,
          date: d.date, title: (d.title || '').trim(),
          url: url || existing.url || '',
          notes: (d.notes || '').trim(), tags };
        if (pendingThumb) updated.thumb = pendingThumb;
        if (pendingRatio) updated.ratio = pendingRatio;
        state[stateKey] = state[stateKey].map(x => x.id === existing.id ? updated : x);
        if (!save()) return;
        close(); navigate(navView); toast('Vidéo mise à jour'); return;
      }
      const entry = { id: id(), date: d.date, title: (d.title || '').trim(), url, notes: (d.notes || '').trim(), tags };
      if (pendingFile) {
        const key = 'video-' + entry.id;
        try {
          await idbPut(STORE_BLOBS, key, pendingFile);
          entry.blobKey = key;
          entry.size = pendingFile.size;
          entry.mime = pendingFile.type;
          if (pendingThumb) entry.thumb = pendingThumb;
          if (pendingRatio) entry.ratio = pendingRatio;
        } catch (err) {
          toast('Stockage refusé par le navigateur : ' + (err?.message || err));
          return;
        }
      }
      state[stateKey].push(entry);
      if (!save()) {
        state[stateKey].pop();
        if (entry.blobKey) { try { await idbDel(STORE_BLOBS, entry.blobKey); } catch {} }
        return;
      }
      close(); navigate(navView); toast('Vidéo ajoutée');
    } });
    const dateVal = existing?.date || today();
    const titleVal = existing?.title || '';
    const urlVal = existing?.url || '';
    const notesVal = existing?.notes || '';
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${dateVal}" required></div>
        <div><label>Titre</label><input type="text" name="title" value="${titleVal.replace(/"/g, '&quot;')}" placeholder="ex : Service revers, semaine 3"></div>
      </div>
      ${existing ? '<div data-role="thumb-edit"></div>' : `
        <div><label>Lien vidéo</label><input type="url" name="url" value="${urlVal.replace(/"/g, '&quot;')}" placeholder="https://youtube.com/… ou Vimeo, Drive…"></div>
        <div><label>… ou importer un fichier vidéo</label><input type="file" accept="video/*" name="file"></div>
        <p class="form-hint file-hint">Stockage local jusqu'à ~500 Mo par fichier. Au-delà, préfère un lien (YouTube, Vimeo, Drive).</p>
        <img class="video-thumb-preview" alt="Aperçu de la vidéo" hidden>
      `}
      <div>
        <label>Tags <span style="color: var(--text-dim); font-weight: 400;">(ex : service, smash, footwork)</span></label>
        <div class="tag-input-wrap">
          <div class="tag-chips" data-role="chips"></div>
          <input type="text" class="tag-input" placeholder="Ajouter un tag puis Entrée…">
        </div>
        ${suggested.length ? `<div class="tag-suggest"><span class="tag-suggest-label">Récents :</span><div class="tag-suggest-list" data-role="suggest"></div></div>` : ''}
      </div>
      <div><label>Notes</label><textarea name="notes" placeholder="Ce que tu observes, axes de travail…">${notesVal.replace(/</g, '&lt;')}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;

    const chipsBox = form.querySelector('[data-role="chips"]');
    const tagInput = form.querySelector('.tag-input');
    const suggestBox = form.querySelector('[data-role="suggest"]');
    const renderChips = () => {
      chipsBox.innerHTML = '';
      currentTags.forEach(t => {
        const chip = el('span', { class: 'tag-chip-removable' }, t,
          el('button', { type: 'button', class: 'tag-remove', onClick: () => { currentTags.delete(t); renderChips(); renderSuggest(); } }, '×'));
        chipsBox.appendChild(chip);
      });
    };
    const addTag = (raw) => {
      const t = (raw || '').trim().toLowerCase();
      if (!t) return;
      currentTags.add(t);
      tagInput.value = '';
      renderChips(); renderSuggest();
    };
    const renderSuggest = () => {
      if (!suggestBox) return;
      suggestBox.innerHTML = '';
      suggested.filter(t => !currentTags.has(t)).forEach(t => {
        suggestBox.appendChild(el('button', { type: 'button', class: 'tag-chip-suggest', onClick: () => addTag(t) }, '+ ' + t));
      });
    };
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); }
      else if (e.key === 'Backspace' && !tagInput.value && currentTags.size) {
        const last = Array.from(currentTags).pop();
        currentTags.delete(last); renderChips(); renderSuggest();
      }
    });
    tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) addTag(tagInput.value); });
    renderChips(); renderSuggest();
    const fileInput = form.querySelector('input[type=file]');
    const hint = form.querySelector('.file-hint');
    const preview = form.querySelector('.video-thumb-preview');
    if (fileInput) fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      pendingThumb = null;
      preview.hidden = true;
      preview.removeAttribute('src');
      if (!f) { pendingFile = null; hint.textContent = 'Stockage local jusqu\'à ~500 Mo par fichier. Au-delà, préfère un lien.'; return; }
      if (f.size > 500_000_000) {
        toast('Fichier trop lourd (max 500 Mo). Préfère un lien.');
        fileInput.value = ''; pendingFile = null; return;
      }
      pendingFile = f;
      hint.textContent = `📦 ${f.name} — ${(f.size / 1_000_000).toFixed(1)} Mo, sera stocké dans IndexedDB (hors-ligne).`;
      makeVideoThumb(f).then((result) => {
        if (pendingFile !== f || !result) return; // fichier changé entre-temps ou capture impossible
        pendingThumb = result.dataUrl;
        pendingRatio = result.ratio;
        preview.src = result.dataUrl;
        preview.hidden = false;
      });
    });

    // Édition d'une vidéo locale : choisir le moment de la miniature au curseur
    const thumbEditBox = form.querySelector('[data-role="thumb-edit"]');
    if (thumbEditBox && existing?.blobKey) {
      const scrubVideo = el('video', { class: 'thumb-scrub-video', muted: '', playsinline: '', preload: 'metadata' });
      const range = el('input', { type: 'range', class: 'thumb-scrub', min: '0', max: '0', step: '0.1', value: '0' });
      const timeLabel = el('span', { class: 'thumb-scrub-time' }, '0:00');
      const capBtn = el('button', { type: 'button', class: 'btn secondary small' }, '📸 Utiliser cette image comme miniature');
      const curThumb = el('img', { class: 'video-thumb-preview', alt: 'Miniature actuelle' });
      if (existing.thumb) curThumb.src = existing.thumb; else curThumb.hidden = true;

      const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      scrubVideo.addEventListener('loadedmetadata', () => {
        range.max = String(scrubVideo.duration || 0);
        scrubVideo.currentTime = Math.min(1, (scrubVideo.duration || 2) / 2);
      });
      scrubVideo.addEventListener('timeupdate', () => {
        timeLabel.textContent = fmtTime(scrubVideo.currentTime);
        range.value = String(scrubVideo.currentTime);
      });
      range.addEventListener('input', () => {
        scrubVideo.currentTime = +range.value;
        timeLabel.textContent = fmtTime(+range.value);
      });
      capBtn.addEventListener('click', () => {
        try {
          const { dataUrl, ratio } = captureVideoFrame(scrubVideo);
          pendingThumb = dataUrl;
          pendingRatio = ratio;
          curThumb.src = dataUrl;
          curThumb.hidden = false;
          toast('Miniature capturée — clique sur Enregistrer pour valider');
        } catch { toast('Capture impossible sur cette vidéo.'); }
      });
      getVideoBlobUrl(existing.blobKey).then((u) => {
        if (!u) { thumbEditBox.remove(); return; }
        scrubVideo.src = u;
        thumbEditBox.appendChild(el('label', {}, 'Miniature — choisis le moment avec le curseur'));
        thumbEditBox.appendChild(scrubVideo);
        thumbEditBox.appendChild(el('div', { class: 'thumb-scrub-row' }, range, timeLabel));
        thumbEditBox.appendChild(capBtn);
        thumbEditBox.appendChild(curThumb);
      });
    }

    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Saisie simple générique ----------

function simpleEntryForm(category, opts) {
  openModal('Nouvelle entrée', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state[category].push({ id: id(), date: d.date, [opts.field]: +d[opts.field] });
      save(); close(); navigate(category); toast('Entrée ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>${opts.label}</label><input type="${opts.type}" step="${opts.step || '1'}" name="${opts.field}" required></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Goals ----------

views.goals = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Objectifs', 'Définis tes objectifs datés et suis ta progression.',
    el('button', { class: 'btn', onClick: () => openGoalForm() }, '+ Nouvel objectif')));

  const active = state.goals.filter(g => !g.done);
  const done = state.goals.filter(g => g.done);

  const card1 = el('div', { class: 'card' }, el('h3', {}, 'En cours'));
  if (!active.length) card1.appendChild(emptyState('Aucun objectif actif', ''));
  active.forEach(g => card1.appendChild(goalRow(g, true)));
  wrap.appendChild(card1);

  if (done.length) {
    const card2 = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Terminés'));
    done.forEach(g => card2.appendChild(goalRow(g, true)));
    wrap.appendChild(card2);
  }

  return wrap;
};

const GOAL_METRICS = {
  manual:   { label: 'Manuel (je gère le %)', unit: '' },
  weight:   { label: 'Poids cible', unit: 'kg', hint: 'La progression se calcule depuis ton poids de départ jusqu\'à la cible.' },
  distance: { label: 'Distance de course cumulée', unit: 'km', hint: 'Cumul des kilomètres courus à partir de la création de l\'objectif.' },
  lifts:    { label: 'Séances de muscu cumulées', unit: 'séances', hint: 'Nombre de séances de musculation enregistrées à partir de la création.' },
  sobriety: { label: 'Jours sains (sobriété)', unit: 'jours', hint: 'Nombre de jours sans écart enregistrés à partir de la création.' },
  mobility: { label: 'Séances de mobilité', unit: 'séances', hint: 'Nombre de séances de mobilité à partir de la création.' },
};

function clampPct(p) { return Math.max(0, Math.min(100, Math.round(p))); }

// Calcule la progression réelle d'un objectif à partir des données de l'app
function computeGoalProgress(g) {
  const metric = g.metric || 'manual';
  if (metric === 'manual') {
    const pct = clampPct(g.progress || 0);
    return { pct, detail: `${pct} %`, auto: false };
  }
  const start = g.start || g.deadline;
  const unit = GOAL_METRICS[metric]?.unit || '';
  const count = (current, target) => {
    const c = Math.round(current * 10) / 10;
    return { pct: target > 0 ? clampPct((current / target) * 100) : 0, detail: `${c} / ${target} ${unit}`, auto: true };
  };
  if (metric === 'weight') {
    if (!state.weight.length) return { pct: 0, detail: `— / ${g.target} kg`, auto: true };
    const current = state.weight.at(-1).value;
    const base = g.baseline ?? state.weight[0].value;
    const target = g.target;
    const pct = base === target ? 100 : clampPct(((base - current) / (base - target)) * 100);
    return { pct, detail: `${current} / ${target} kg`, auto: true };
  }
  if (metric === 'distance') return count(state.runs.filter(r => r.date >= start).reduce((s, r) => s + (r.distance || 0), 0), g.target);
  if (metric === 'lifts')    return count(state.lifts.filter(l => l.date >= start).length, g.target);
  if (metric === 'sobriety') return count(state.sobriety.filter(s => !s.hasSlip && s.date >= start).length, g.target);
  if (metric === 'mobility') return count(state.mobility.filter(m => m.date >= start).length, g.target);
  return { pct: 0, detail: '', auto: true };
}

function goalRow(g, withControls) {
  const daysLeft = Math.ceil((new Date(g.deadline) - new Date()) / 86400000);
  const prog = computeGoalProgress(g);
  const pct = g.done ? 100 : prog.pct;
  const reached = !g.done && pct >= 100;
  const wrap = el('div', { class: 'list-item', style: 'flex-direction: column; align-items: stretch; gap: 8px;' });
  const head = el('div', { style: 'display: flex; justify-content: space-between; gap: 12px; align-items: center;' },
    el('div', {},
      el('div', { class: 'title', style: g.done ? 'text-decoration: line-through; color: var(--text-dim);' : '' },
        g.title,
        prog.auto ? el('span', { class: 'goal-tag' }, GOAL_METRICS[g.metric]?.unit ? `auto · ${GOAL_METRICS[g.metric].label}` : 'auto') : null,
      ),
      el('div', { class: 'meta' },
        `Échéance : ${fmtDate(g.deadline)} · ${g.done ? 'Atteint ✓' : (reached ? 'Objectif atteint 🎉' : (daysLeft >= 0 ? `${daysLeft} jours restants` : `En retard de ${-daysLeft} jours`))}`),
    ),
    withControls ? el('div', { class: 'actions' },
      el('button', { class: 'icon-btn', title: 'Archiver / réactiver', onClick: () => {
        g.done = !g.done; if (g.done && (!g.metric || g.metric === 'manual')) g.progress = 100;
        save(); navigate('goals'); toast(g.done ? 'Objectif archivé !' : 'Objectif réactivé');
      } }, g.done ? '↺' : '✓'),
      el('button', { class: 'icon-btn', onClick: () => openGoalForm(g) }, '✎'),
      el('button', { class: 'icon-btn danger', onClick: () =>
        deleteWithUndo({ arr: state.goals, item: g, label: 'Objectif', navView: 'goals' }) }, '✕'),
    ) : null,
  );
  wrap.appendChild(head);
  const bar = el('div', { class: 'progress' }, el('div', { class: `progress-fill ${reached ? 'full' : ''}`, style: `width: ${pct}%` }));
  wrap.appendChild(bar);
  wrap.appendChild(el('div', { style: 'font-size: 11px; color: var(--text-dim); display: flex; justify-content: space-between;' },
    el('span', {}, `Progression : ${pct} %`),
    el('span', {}, prog.detail),
  ));
  return wrap;
}

function openGoalForm(existing) {
  const g = existing || { title: '', deadline: '', progress: 0, done: false, metric: 'manual', target: '', exercise: '' };
  openModal(existing ? 'Modifier l\'objectif' : 'Nouvel objectif', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const metric = d.metric || 'manual';
      const entry = { id: existing?.id || id(), title: d.title.trim(), deadline: d.deadline, done: existing?.done || false, metric };
      if (metric === 'manual') {
        entry.progress = +d.progress || 0;
      } else {
        entry.target = +d.target || 0;
        entry.start = existing?.start || today();
        if (metric === 'weight') entry.baseline = existing?.baseline ?? (state.weight.at(-1)?.value ?? entry.target);
      }
      if (existing) state.goals = state.goals.map(x => x.id === entry.id ? entry : x);
      else state.goals.push(entry);
      save(); close(); navigate('goals'); toast(existing ? 'Objectif mis à jour' : 'Objectif créé');
    } });
    const opts = Object.entries(GOAL_METRICS).map(([k, v]) =>
      `<option value="${k}"${(g.metric || 'manual') === k ? ' selected' : ''}>${v.label}</option>`).join('');
    form.innerHTML = `
      <div><label>Titre</label><input type="text" name="title" value="${(g.title || '').replace(/"/g, '&quot;')}" placeholder="Ex : Atteindre 75 kg" required></div>
      <div><label>Type de suivi</label><select name="metric">${opts}</select></div>
      <div class="goal-manual"${(g.metric || 'manual') !== 'manual' ? ' hidden' : ''}>
        <label>Progression (%)</label><input type="number" min="0" max="100" name="progress" value="${g.progress || 0}">
      </div>
      <div class="goal-auto"${(g.metric || 'manual') === 'manual' ? ' hidden' : ''}>
        <label>Cible</label><input type="number" step="0.1" name="target" value="${g.target ?? ''}" placeholder="Valeur à atteindre">
      </div>
      <p class="form-hint goal-hint"></p>
      <div><label>Échéance</label><input type="date" name="deadline" value="${g.deadline || ''}" required></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    const sel = form.querySelector('select[name=metric]');
    const manual = form.querySelector('.goal-manual');
    const auto = form.querySelector('.goal-auto');
    const hint = form.querySelector('.goal-hint');
    const targetInput = form.querySelector('input[name=target]');
    const sync = () => {
      const m = sel.value;
      manual.hidden = m !== 'manual';
      auto.hidden = m === 'manual';
      hint.textContent = GOAL_METRICS[m]?.hint || '';
      const u = GOAL_METRICS[m]?.unit;
      if (u) targetInput.placeholder = `Cible en ${u}`;
    };
    sel.addEventListener('change', sync);
    sync();
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Recovery ----------

views.recovery = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Récupération', 'Garde un œil sur ta fatigue et tes douleurs pour ne pas te cramer.',
    el('button', { class: 'btn', onClick: () => openRecoveryForm() }, '+ Nouvelle entrée')));

  const arr = [...state.recovery].sort((a, b) => a.date.localeCompare(b.date));
  const last = arr.at(-1);

  if (last) {
    const kpis = el('div', { class: 'grid cols-3' });
    kpis.appendChild(kpiCard('😮‍💨 Fatigue', `${last.fatigue}/5`, fmtDate(last.date), last.fatigue >= 4 ? 'danger' : 'success'));
    kpis.appendChild(kpiCard('💢 Douleurs', `${last.pain}/5`, fmtDate(last.date), last.pain >= 4 ? 'danger' : 'success'));
    kpis.appendChild(kpiCard('🗓️ Entrées', String(arr.length), 'au total'));
    wrap.appendChild(kpis);
    wrap.appendChild(el('div', { style: 'height: 16px;' }));
  }

  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution sur la durée'),
    el('div', { class: 'chart-wrap tall' }, el('canvas', { id: 'rec-chart' })));
  wrap.appendChild(chartCard);

  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Journal'));
  if (!arr.length) list.appendChild(emptyState('Aucune entrée', 'Commence ton journal de récupération.'));
  [...arr].reverse().forEach(r => list.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, fmtDate(r.date)),
      el('div', { class: 'meta' },
        `Fatigue ${r.fatigue}/5 · Douleurs ${r.pain}/5${r.notes ? ' · ' + r.notes : ''}`),
    ),
    el('button', { class: 'icon-btn danger', onClick: () =>
      deleteWithUndo({ arr: state.recovery, item: r, label: 'Entrée', navView: 'recovery' }) }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    if (!arr.length) return;
    chart($('#rec-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: arr.map(r => shortDate(r.date)),
        datasets: [
          { label: 'Fatigue', data: arr.map(r => r.fatigue), borderColor: chartTheme.accent, backgroundColor: 'rgba(240,163,95,0.15)', tension: 0.3, fill: true, pointRadius: 4 },
          { label: 'Douleurs', data: arr.map(r => r.pain), borderColor: chartTheme.accent2, backgroundColor: chartTheme.accent2, tension: 0.3, fill: false, pointRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        scales: {
          x: { ticks: { color: chartTheme.text }, grid: { color: chartTheme.grid } },
          y: { min: 0, max: 5, ticks: { color: chartTheme.text, stepSize: 1 }, grid: { color: chartTheme.grid }, title: { display: true, text: '/5', color: chartTheme.text } },
        },
      },
    });
  }, 0);

  return wrap;
};

function openRecoveryForm() {
  openModal('Nouvelle entrée de récupération', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.recovery.push({
        id: id(), date: d.date,
        fatigue: +d.fatigue, pain: +d.pain,
        notes: (d.notes || '').trim(),
      });
      save(); close(); navigate('recovery'); toast('Entrée ajoutée');
    } });
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Fatigue (/5)</label><input type="number" min="0" max="5" name="fatigue" value="2" required></div>
      </div>
      <div><label>Douleurs (/5)</label><input type="number" min="0" max="5" name="pain" value="1" required></div>
      <div><label>Notes</label><textarea name="notes" placeholder="Zones tendues, ressenti…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Mobilité ----------

views.mobility = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Mobilité', 'Travaille ta souplesse et ton amplitude pour rester en forme et prévenir les blessures.',
    el('button', { class: 'btn', onClick: () => openMobilityForm() }, '+ Nouvel exercice'),
    el('button', { class: 'btn secondary', onClick: () => openVideoForm({ stateKey: 'mobilityVideos', navView: 'mobility' }) }, '+ Ajouter une vidéo'),
  ));

  const arr = [...state.mobility].sort((a, b) => b.date.localeCompare(a.date));

  const list = el('div', { class: 'card' }, el('h3', {}, 'Exercices'));
  if (!arr.length) {
    list.appendChild(emptyState('Aucun exercice', 'Ajoute ton premier exercice de mobilité (étirements, foam roller, yoga…).'));
  } else {
    arr.forEach(m => {
      // Compat : anciennes entrées avaient { focus, notes, duration } — on les recompose.
      const title = m.title || m.focus || 'Mobilité';
      const description = m.description || m.notes || '';
      list.appendChild(el('div', { class: 'list-item' },
        el('div', { style: 'min-width: 0;' },
          el('div', { class: 'title' }, title),
          el('div', { class: 'meta' }, fmtDate(m.date)),
          description ? el('div', { class: 'video-notes', style: 'margin-top: 6px;' }, description) : null,
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', onClick: () => openMobilityForm(m) }, '✎'),
          el('button', { class: 'icon-btn danger', onClick: () =>
            deleteWithUndo({ arr: state.mobility, item: m, label: 'Exercice', navView: 'mobility' }) }, '✕'),
        ),
      ));
    });
  }
  wrap.appendChild(list);

  // Galerie vidéos de mobilité (même format que la section Vidéos : lien YT/Vimeo/Drive ou fichier local)
  const vidsCard = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, '🎥 Vidéos de mobilité'));
  const vids = [...state.mobilityVideos].sort((a, b) => b.date.localeCompare(a.date));
  if (!vids.length) {
    vidsCard.appendChild(emptyState('Aucune vidéo', 'Ajoute un lien ou un fichier vidéo (étirements, routines, démos…).'));
  } else {
    const grid = el('div', { class: 'video-grid' });
    vids.forEach(v => grid.appendChild(videoCard(v, { stateKey: 'mobilityVideos', navView: 'mobility' })));
    vidsCard.appendChild(grid);
  }
  wrap.appendChild(vidsCard);

  return wrap;
};

function openMobilityForm(existing) {
  const m = existing || { date: today(), title: '', description: '' };
  // Compat avec les anciennes entrées { focus, notes }
  const initialTitle = m.title || m.focus || '';
  const initialDesc = m.description || m.notes || '';

  openModal(existing ? 'Modifier l\'exercice' : 'Nouvel exercice de mobilité', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const entry = {
        id: existing?.id || id(),
        date: d.date,
        title: (d.title || '').trim(),
        description: (d.description || '').trim(),
      };
      if (existing) state.mobility = state.mobility.map(x => x.id === entry.id ? entry : x);
      else state.mobility.push(entry);
      save(); close(); navigate('mobility'); toast(existing ? 'Exercice mis à jour' : 'Exercice ajouté');
    } });
    form.innerHTML = `
      <div><label>Titre</label><input type="text" name="title" value="${initialTitle.replace(/"/g, '&quot;')}" placeholder="Ex : Étirement ischios, ouverture de hanches…" required></div>
      <div><label>Date</label><input type="date" name="date" value="${m.date || today()}" required></div>
      <div><label>Description</label><textarea name="description" placeholder="Comment exécuter l'exercice, ressenti, axes…">${initialDesc}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// ---------- Spa / Bien-être ----------

const SPA_SOINS = [
  { key: 'sauna',    emoji: '🧖', label: 'Sauna' },
  { key: 'hammam',   emoji: '♨️', label: 'Hammam' },
  { key: 'jacuzzi',  emoji: '🛁', label: 'Jacuzzi' },
  { key: 'massage',  emoji: '💆', label: 'Massage' },
  { key: 'coldbath', emoji: '🧊', label: 'Bain froid' },
  { key: 'cryo',     emoji: '❄️', label: 'Cryothérapie' },
  { key: 'facial',   emoji: '🧴', label: 'Soin visage' },
  { key: 'gommage',  emoji: '✨', label: 'Gommage' },
  { key: 'piscine',  emoji: '🏊', label: 'Piscine' },
];
const SPA_SOIN_META = Object.fromEntries(SPA_SOINS.map(s => [s.key, s]));
const soinLabel = (k) => SPA_SOIN_META[k]?.label || k;

views.spa = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Spa', 'Note tes passages au spa et les soins que tu as faits.',
    el('button', { class: 'btn', onClick: () => openSpaForm() }, '+ Nouvelle visite')));

  const arr = [...state.spa].sort((a, b) => a.date.localeCompare(b.date));
  const last = arr.at(-1);

  if (last) {
    const days = dateDiffDays(today(), last.date);
    const sinceTxt = days <= 0 ? 'Aujourd\'hui' : days === 1 ? 'Hier' : `il y a ${days} j`;
    const kpis = el('div', { class: 'grid cols-2' });
    kpis.appendChild(kpiCard('🧖 Dernière visite', sinceTxt, fmtDate(last.date)));
    kpis.appendChild(kpiCard('🗓️ Visites', String(arr.length), 'au total'));
    wrap.appendChild(kpis);
    wrap.appendChild(el('div', { style: 'height: 16px;' }));
  }

  const list = el('div', { class: 'card' }, el('h3', {}, 'Journal des visites'));
  if (!arr.length) {
    list.appendChild(emptyState('Aucune visite', 'Ajoute ta première visite au spa (sauna, hammam, massage…).'));
  } else {
    [...arr].reverse().forEach(v => {
      const soins = (v.soins || []).map(soinLabel).join(' · ');
      list.appendChild(el('div', { class: 'list-item' },
        el('div', { style: 'min-width: 0;' },
          el('div', { class: 'title' }, fmtDate(v.date)),
          soins ? el('div', { class: 'meta' }, soins) : null,
          v.notes ? el('div', { class: 'video-notes', style: 'margin-top: 6px;' }, v.notes) : null,
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', onClick: () => openSpaForm(v) }, '✎'),
          el('button', { class: 'icon-btn danger', onClick: () =>
            deleteWithUndo({ arr: state.spa, item: v, label: 'Visite', navView: 'spa' }) }, '✕'),
        ),
      ));
    });
  }
  wrap.appendChild(list);

  return wrap;
};

function openSpaForm(existing) {
  const v = existing || { date: today(), soins: [], notes: '' };
  const selectedSoins = new Set(v.soins || []);

  openModal(existing ? 'Modifier la visite' : 'Nouvelle visite au spa', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const entry = {
        id: existing?.id || id(),
        date: d.date,
        soins: Array.from(selectedSoins),
        notes: (d.notes || '').trim(),
      };
      if (existing) state.spa = state.spa.map(x => x.id === entry.id ? entry : x);
      else state.spa.push(entry);
      save(); close(); navigate('spa'); toast(existing ? 'Visite mise à jour' : 'Visite ajoutée');
    } });

    form.appendChild(el('div', {},
      el('label', {}, 'Date'),
      el('input', { type: 'date', name: 'date', value: v.date || today(), required: '' }),
    ));

    const soinsField = el('div', {},
      el('label', {}, 'Soins (sélectionne ce que tu as fait)'),
      el('div', { class: 'muscle-grid' }),
    );
    const grid = soinsField.querySelector('.muscle-grid');
    SPA_SOINS.forEach(s => {
      const btn = el('button', {
        type: 'button',
        class: `muscle-btn${selectedSoins.has(s.key) ? ' active' : ''}`,
        onClick: () => {
          if (selectedSoins.has(s.key)) selectedSoins.delete(s.key);
          else selectedSoins.add(s.key);
          btn.classList.toggle('active');
        },
      }, el('span', { class: 'muscle-emoji' }, s.emoji), el('span', {}, s.label));
      grid.appendChild(btn);
    });
    form.appendChild(soinsField);

    form.appendChild(el('div', {},
      el('label', {}, 'Notes (facultatif)'),
      el('textarea', { name: 'notes', placeholder: 'Établissement, ressenti, autres soins…' }, v.notes || ''),
    ));

    form.appendChild(el('div', { class: 'form-actions' },
      el('button', { type: 'button', class: 'btn secondary', onClick: close }, 'Annuler'),
      el('button', { type: 'submit', class: 'btn' }, 'Enregistrer'),
    ));

    return form;
  });
}

// ---------- Sobriété ----------

let sobrietyMonth = null;

views.sobriety = () => {
  const wrap = el('div');
  const now = new Date();
  if (!sobrietyMonth) sobrietyMonth = { y: now.getFullYear(), m: now.getMonth() };

  wrap.appendChild(viewHeader('Sobriété', 'Suis tes écarts au quotidien. Clique sur un jour pour saisir ton ressenti.'));

  const arr = state.sobriety;
  const clean = arr.filter(s => !s.hasSlip).length;
  const slips = arr.filter(s => s.hasSlip).length;
  const total = arr.length;
  const cleanRate = total ? Math.round((clean / total) * 100) : 0;

  const kpis = el('div', { class: 'grid cols-3' });
  kpis.appendChild(kpiCard('🥗 Jours sains', String(clean), 'sans écart', 'success'));
  kpis.appendChild(kpiCard('🍩 Écarts', String(slips), 'jours marqués', slips ? 'danger' : 'accent'));
  kpis.appendChild(kpiCard('📈 Taux de sobriété', `${cleanRate}%`, `${total} jours suivis`, cleanRate >= 70 ? 'success' : 'accent'));
  wrap.appendChild(kpis);
  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  wrap.appendChild(sobrietyCalendar());

  const slipList = state.sobriety.filter(s => s.hasSlip).sort((a, b) => b.date.localeCompare(a.date));
  const list = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Derniers écarts'));
  if (!slipList.length) {
    list.appendChild(emptyState('Aucun écart enregistré', 'Continue comme ça 💪'));
  } else {
    slipList.slice(0, 10).forEach(s => list.appendChild(el('div', { class: 'list-item' },
      el('div', {},
        el('div', { class: 'title' }, `${fmtDate(s.date)} · ${s.what || 'Écart'}`),
        s.why ? el('div', { class: 'meta' }, s.why) : null,
      ),
      el('button', { class: 'icon-btn danger', onClick: () =>
        deleteWithUndo({ arr: state.sobriety, item: s, label: 'Écart', navView: 'sobriety' }) }, '✕'),
    )));
  }
  wrap.appendChild(list);

  return wrap;
};

function sobrietyCalendar() {
  const { y, m } = sobrietyMonth;
  const card = el('div', { class: 'card sobriety-cal' });

  const monthLabel = new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const header = el('div', { class: 'cal-header' },
    el('button', { class: 'icon-btn', onClick: () => { sobrietyMonth = shiftMonth(y, m, -1); navigate('sobriety'); } }, '‹'),
    el('div', { class: 'cal-title' }, monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)),
    el('button', { class: 'icon-btn', onClick: () => { sobrietyMonth = shiftMonth(y, m, 1); navigate('sobriety'); } }, '›'),
  );
  card.appendChild(header);

  const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const dows = el('div', { class: 'cal-grid cal-dow' });
  weekdays.forEach(d => dows.appendChild(el('div', { class: 'cal-dow-cell' }, d)));
  card.appendChild(dows);

  const grid = el('div', { class: 'cal-grid' });
  const firstDay = new Date(y, m, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = today();

  for (let i = 0; i < startOffset; i++) grid.appendChild(el('div', { class: 'cal-cell empty' }));

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = state.sobriety.find(s => s.date === dateStr);
    const isFuture = dateStr > todayStr;
    const isToday = dateStr === todayStr;

    let cls = 'cal-cell';
    if (entry) cls += entry.hasSlip ? ' slip' : ' clean';
    if (isToday) cls += ' today';
    if (isFuture) cls += ' future';

    grid.appendChild(el('div', {
      class: cls,
      onClick: isFuture ? null : () => openSobrietyDay(dateStr),
    },
      el('div', { class: 'cal-day' }, String(day)),
      entry ? el('div', { class: 'cal-dot' }) : null,
    ));
  }
  card.appendChild(grid);

  card.appendChild(el('div', { class: 'cal-legend' },
    el('span', {}, el('span', { class: 'dot clean' }), 'Sain'),
    el('span', {}, el('span', { class: 'dot slip' }), 'Écart'),
    el('span', {}, el('span', { class: 'dot none' }), 'Non renseigné'),
  ));

  return card;
}

function shiftMonth(y, m, delta) {
  const d = new Date(y, m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

function openSobrietyDay(dateStr) {
  const existing = state.sobriety.find(s => s.date === dateStr);

  openModal(fmtDate(dateStr), (close) => {
    const wrap = el('div', { class: 'form' });
    wrap.appendChild(el('p', { style: 'margin: 0 0 8px; font-size: 14px;' },
      'As-tu fait un écart alimentaire ce jour ?'));

    const setEntry = (hasSlip, what, why) => {
      state.sobriety = state.sobriety.filter(s => s.date !== dateStr);
      state.sobriety.push({ id: id(), date: dateStr, hasSlip, what: what || '', why: why || '' });
      save(); close(); navigate('sobriety');
      toast(hasSlip ? 'Écart noté' : 'Journée saine enregistrée');
    };

    const actions = el('div', { style: 'display: flex; gap: 8px;' },
      el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #6fcf97, #4fb97f); color: #2a0708;',
        onClick: () => setEntry(false) }, '✅ Journée saine'),
      el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #ff6b5e, #e0524a); color: #2a0708;',
        onClick: () => {
          close();
          openSobrietySlipForm(dateStr, existing);
        } }, '⚠️ J\'ai fait un écart'),
    );
    wrap.appendChild(actions);

    if (existing) {
      wrap.appendChild(el('div', { class: 'form-hint' },
        existing.hasSlip
          ? `Déjà enregistré : écart — ${existing.what || '—'}${existing.why ? ' (' + existing.why + ')' : ''}`
          : 'Déjà enregistré : journée saine'));
      wrap.appendChild(el('button', { class: 'btn secondary', onClick: () => {
        state.sobriety = state.sobriety.filter(s => s.date !== dateStr);
        save(); close(); navigate('sobriety'); toast('Entrée supprimée');
      } }, 'Effacer l\'entrée'));
    }

    return wrap;
  });
}

function openSobrietySlipForm(dateStr, existing) {
  openModal(`Écart du ${fmtDate(dateStr)}`, (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      state.sobriety = state.sobriety.filter(s => s.date !== dateStr);
      state.sobriety.push({
        id: id(), date: dateStr, hasSlip: true,
        what: (d.what || '').trim(),
        why: (d.why || '').trim(),
      });
      save(); close(); navigate('sobriety'); toast('Écart enregistré');
    } });
    const prevWhat = existing && existing.hasSlip ? existing.what || '' : '';
    const prevWhy = existing && existing.hasSlip ? existing.why || '' : '';
    form.innerHTML = `
      <div><label>Quel écart ?</label><input type="text" name="what" value="${prevWhat.replace(/"/g, '&quot;')}" placeholder="Pizza, alcool, sucreries…" required></div>
      <div><label>Pourquoi ?</label><textarea name="why" placeholder="Stress, sortie entre amis, fatigue…">${prevWhy}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// =============================================================
// Import / Export / Reset
// =============================================================

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `athelio-${today()}.json`;
  a.click();
  localStorage.setItem('athelio:lastExport', String(Date.now()));
  toast('Données exportées');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      state = migrate(JSON.parse(e.target.result));
      save();
      navigate(currentView);
      toast('Données importées');
    } catch {
      toast('Fichier invalide');
    }
  };
  reader.readAsText(file);
}

function resetData() {
  confirmAction('Effacer toutes les données ? Cette action est irréversible.', () => {
    localStorage.removeItem(STORAGE_KEY);
    state = seed();
    save();
    navigate('dashboard');
    toast('Données réinitialisées');
  });
}

// =============================================================
// PIN — écran de verrouillage
// =============================================================

function showLockScreen() {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const overlay = el('div', { class: 'lock-screen' },
      el('div', { class: 'lock-card' },
        el('div', { class: 'lock-logo', 'aria-label': 'Athelio' }),
        el('h2', { class: 'lock-title' }, 'Athelio'),
        el('p', { class: 'lock-sub' }, 'Entre ton code PIN'),
        el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off',
          class: 'lock-input', id: 'lock-input', maxlength: '12', autofocus: '' }),
        el('div', { class: 'lock-err', id: 'lock-err' }),
        el('button', { class: 'btn', id: 'lock-submit' }, 'Déverrouiller'),
      ),
    );
    root.appendChild(overlay);

    const input = $('#lock-input');
    const err = $('#lock-err');
    const submit = async () => {
      const ok = await checkPin(input.value);
      if (ok) {
        // Zoom-out fondu de l'écran PIN, puis l'app se révèle dessous
        overlay.classList.add('unlocking');
        setTimeout(() => { overlay.remove(); resolve(); }, 380);
      }
      else { err.textContent = 'Code incorrect.'; input.value = ''; input.focus(); }
    };
    $('#lock-submit').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 50);
  });
}

// =============================================================
// Paramètres (PIN, backups, infos stockage)
// =============================================================

views.settings = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Paramètres', 'Sécurité, sauvegardes et stockage.'));

  // --- Sécurité ---
  const pinCfg = getPinConfig();
  const pinCard = el('div', { class: 'card' },
    el('h3', {}, '🔒 Code PIN au démarrage'),
    el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 12px;' },
      pinCfg ? 'Un code PIN est actuellement défini. L\'app demandera ce code à chaque ouverture.'
             : 'Aucun code PIN. Ajoute-en un pour verrouiller l\'app au démarrage.'),
    el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' },
      el('button', { class: 'btn', onClick: () => openPinForm(!!pinCfg) }, pinCfg ? 'Changer le PIN' : 'Définir un PIN'),
      pinCfg ? el('button', { class: 'btn secondary', onClick: () => confirmAction('Supprimer le code PIN ?', () => {
        setPinConfig(null); navigate('settings'); toast('PIN supprimé');
      }) }, 'Supprimer le PIN') : null,
    ),
  );
  wrap.appendChild(pinCard);

  // --- Sauvegardes auto ---
  const lastExport = localStorage.getItem('athelio:lastExport');
  const lastExportDate = lastExport ? new Date(+lastExport) : null;
  const daysSince = lastExportDate ? Math.floor((Date.now() - lastExportDate) / 86400000) : null;
  const backupCard = el('div', { class: 'card', style: 'margin-top: 16px;' },
    el('h3', {}, '💾 Sauvegardes'),
    el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 8px;' },
      lastExportDate ? `Dernier export : ${fmtDate(lastExportDate.toISOString().slice(0, 10))} (il y a ${daysSince} j)`
                     : 'Aucun export pour le moment.'),
    el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' },
      el('button', { class: 'btn', onClick: exportData }, '⤓ Exporter maintenant'),
      el('button', { class: 'btn secondary', onClick: () => $('#import-file').click() }, '⤒ Importer un export'),
      el('button', { class: 'btn secondary danger', onClick: resetData }, '⟲ Réinitialiser toutes les données'),
    ),
    el('h3', { style: 'margin-top: 18px;' }, 'Historique automatique'),
    el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 10px;' },
      'Un instantané est créé automatiquement à chaque ouverture, après 24 h. Les 7 derniers sont conservés sur ton appareil (hors vidéos).'),
    el('div', { id: 'snapshot-list' }, el('div', { class: 'empty' }, 'Chargement…')),
  );
  wrap.appendChild(backupCard);

  // Hydrater la liste des snapshots
  idbAll(STORE_SNAPSHOTS).then((snaps) => {
    const list = $('#snapshot-list');
    list.innerHTML = '';
    if (!snaps.length) { list.appendChild(emptyState('Aucun instantané', 'Le premier sera créé après 24 h d\'utilisation.')); return; }
    snaps.sort((a, b) => b.key - a.key).forEach((s) => {
      const date = new Date(s.key);
      list.appendChild(el('div', { class: 'list-item' },
        el('div', {},
          el('div', { class: 'title' }, date.toLocaleString('fr-FR')),
          el('div', { class: 'meta' }, `${Math.round(JSON.stringify(s.value).length / 1024)} Ko`),
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'icon-btn', title: 'Restaurer', onClick: () => confirmAction('Restaurer cet instantané ? Les données actuelles seront remplacées.', () => {
            state = migrate(s.value); save(); toast('Données restaurées'); navigate('dashboard');
          }) }, '↺'),
          el('button', { class: 'icon-btn danger', onClick: () => idbDel(STORE_SNAPSHOTS, s.key).then(() => navigate('settings')) }, '✕'),
        ),
      ));
    });
  });

  // --- Préférences (Review du jour, haptique) ---
  wrap.appendChild(preferencesCard());

  // --- Google Drive ---
  wrap.appendChild(driveSettingsCard());

  // --- Infos stockage ---
  const storageCard = el('div', { class: 'card', style: 'margin-top: 16px;' },
    el('h3', {}, '📊 Stockage'),
    el('div', { id: 'storage-info' }, 'Calcul…'),
  );
  wrap.appendChild(storageCard);
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((est) => {
      const used = (est.usage / 1_000_000).toFixed(1);
      const quota = (est.quota / 1_000_000).toFixed(0);
      $('#storage-info').textContent = `${used} Mo utilisés sur ~${quota} Mo disponibles.`;
    });
  }

  return wrap;
};

function preferencesCard() {
  const card = el('div', { class: 'card', style: 'margin-top: 16px;' });
  card.appendChild(el('h3', {}, '⚙️ Préférences'));

  // Thème
  card.appendChild(el('div', { class: 'title', style: 'font-weight: 600;' }, '🎨 Thème'));
  card.appendChild(el('div', { class: 'meta', style: 'margin-bottom: 8px;' }, 'Change l\'ambiance de couleurs de l\'app.'));
  const current = state.settings?.theme || 'vintage';
  const themeGrid = el('div', { class: 'theme-grid' });
  THEMES.forEach(t => {
    const btn = el('button', { class: `theme-swatch theme-${t.key}${current === t.key ? ' active' : ''}`, type: 'button',
      onClick: () => {
        state.settings = { ...(state.settings || {}), theme: t.key };
        save(); applyTheme(t.key); haptic(); navigate('settings');
      } },
      el('span', { class: 'theme-swatch-dot' }),
      el('span', {}, `${t.emoji} ${t.label}`),
    );
    themeGrid.appendChild(btn);
  });
  card.appendChild(themeGrid);

  // Retour haptique
  const hapticsOn = state.settings?.haptics !== false;
  const hapticBtn = el('button', { class: `notif-switch ${hapticsOn ? 'on' : ''}`, type: 'button',
    onClick: () => {
      const next = !hapticBtn.classList.contains('on');
      hapticBtn.classList.toggle('on', next);
      hapticBtn.textContent = next ? 'Activé' : 'Désactivé';
      state.settings = { ...(state.settings || {}), haptics: next };
      save();
      if (next) haptic(15);
    } }, hapticsOn ? 'Activé' : 'Désactivé');
  card.appendChild(el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, '📳 Retour haptique'),
      el('div', { class: 'meta' }, 'Légère vibration au toucher des boutons (mobile).'),
    ),
    hapticBtn,
  ));

  // Personnalisation de la Review du jour
  card.appendChild(el('div', { style: 'margin-top: 14px;' },
    el('div', { class: 'title', style: 'font-weight: 600;' }, '☀️ Étapes de la Review du jour'),
    el('div', { class: 'meta', style: 'margin-bottom: 8px;' }, 'Active/désactive et réordonne les étapes proposées chaque jour.'),
  ));

  const list = el('div', { class: 'review-config' });
  const cfg = getReviewConfig().map(s => ({ ...s })); // copie travaillée localement

  const persist = () => { state.settings = { ...(state.settings || {}), reviewConfig: cfg }; save(); };
  const render = () => {
    list.innerHTML = '';
    cfg.forEach((step, i) => {
      const meta = REVIEW_STEP_META[step.key];
      const row = el('div', { class: `review-config-row${step.enabled ? '' : ' off'}` },
        el('div', { class: 'review-config-arrows' },
          el('button', { class: 'icon-btn', title: 'Monter', disabled: i === 0 ? '' : null,
            onClick: () => { if (i > 0) { [cfg[i - 1], cfg[i]] = [cfg[i], cfg[i - 1]]; persist(); render(); haptic(); } } }, '▲'),
          el('button', { class: 'icon-btn', title: 'Descendre', disabled: i === cfg.length - 1 ? '' : null,
            onClick: () => { if (i < cfg.length - 1) { [cfg[i + 1], cfg[i]] = [cfg[i], cfg[i + 1]]; persist(); render(); haptic(); } } }, '▼'),
        ),
        el('div', { class: 'review-config-label' }, `${meta.emoji} ${meta.label}`),
        el('button', { class: `notif-switch ${step.enabled ? 'on' : ''}`, type: 'button',
          onClick: () => { step.enabled = !step.enabled; persist(); render(); haptic(); } },
          step.enabled ? 'Activé' : 'Désactivé'),
      );
      list.appendChild(row);
    });
  };
  render();
  card.appendChild(list);

  // Catégories du menu : activer/désactiver et réordonner (au sein de chaque section)
  card.appendChild(el('div', { style: 'margin-top: 16px;' },
    el('div', { class: 'title', style: 'font-weight: 600;' }, '📂 Catégories du menu'),
    el('div', { class: 'meta', style: 'margin-bottom: 8px;' }, 'Masque les catégories ou réordonne-les à l\'intérieur de leur section.'),
  ));
  const navList = el('div', { class: 'review-config' });
  const navCfg = getNavConfig().map(s => ({ ...s }));
  // Regroupe la config par section (tri stable) pour coller à l'affichage du menu.
  navCfg.sort((a, b) => sectionOf(a.key) - sectionOf(b.key));
  const persistNav = () => { state.settings = { ...(state.settings || {}), navConfig: navCfg }; save(); renderNav(); };
  const renderNavCfg = () => {
    navList.innerHTML = '';
    let lastSection;
    navCfg.forEach((item, i) => {
      const meta = NAV_META[item.key];
      if (meta.section !== lastSection) {
        lastSection = meta.section;
        const label = SECTION_LABEL[meta.section];
        if (label) navList.appendChild(el('div', { class: 'nav-section' }, label));
      }
      const isDash = item.key === 'dashboard';
      // Réordonnancement limité à la section : on désactive les flèches aux bords d'une section.
      const upOk = i > 0 && NAV_META[navCfg[i - 1].key].section === meta.section;
      const downOk = i < navCfg.length - 1 && NAV_META[navCfg[i + 1].key].section === meta.section;
      const row = el('div', { class: `review-config-row${item.visible ? '' : ' off'}` },
        el('div', { class: 'review-config-arrows' },
          el('button', { class: 'icon-btn', disabled: upOk ? null : '',
            onClick: () => { if (upOk) { [navCfg[i - 1], navCfg[i]] = [navCfg[i], navCfg[i - 1]]; persistNav(); renderNavCfg(); haptic(); } } }, '▲'),
          el('button', { class: 'icon-btn', disabled: downOk ? null : '',
            onClick: () => { if (downOk) { [navCfg[i + 1], navCfg[i]] = [navCfg[i], navCfg[i + 1]]; persistNav(); renderNavCfg(); haptic(); } } }, '▼'),
        ),
        el('div', { class: 'review-config-label' }, `${meta.emoji} ${meta.label}`),
        isDash
          ? el('span', { class: 'meta', style: 'font-size: 11px;' }, 'toujours visible')
          : el('button', { class: `notif-switch ${item.visible ? 'on' : ''}`, type: 'button',
              onClick: () => { item.visible = !item.visible; persistNav(); renderNavCfg(); haptic(); } },
              item.visible ? 'Visible' : 'Masqué'),
      );
      navList.appendChild(row);
    });
  };
  renderNavCfg();
  card.appendChild(navList);

  return card;
}

function driveSettingsCard() {
  const card = el('div', { class: 'card', style: 'margin-top: 16px;' });
  card.appendChild(el('h3', {}, '☁️ Google Drive'));

  const clientId = driveClientId();
  const usingCustom = !!localStorage.getItem(DRIVE_CLIENT_KEY);
  const last = driveLastBackup();
  const lastTxt = last ? `il y a ${Math.floor((Date.now() - last) / 3600000)} h` : 'jamais';

  card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 12px;' },
    driveConnected()
      ? `🟢 Connecté · dernière sauvegarde ${lastTxt}.`
      : 'Connecte-toi en un clic pour sauvegarder tes données et vidéos sur ton Google Drive. La sauvegarde se relance ensuite automatiquement 1 fois par jour.'));

  // Statut connexion
  const status = el('div', { id: 'drive-status', style: 'font-size: 12px; color: var(--text-dim); margin-top: 10px; min-height: 16px;' },
    driveConnected() ? '🟢 Connecté' : '⚪ Non connecté');

  // Bouton principal : se connecter (le Client ID intégré est déjà prêt)
  const actions = el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' },
    el('button', { class: 'btn', onClick: async () => {
      $('#drive-status').textContent = '⏳ Connexion…';
      try { await driveAuth(); $('#drive-status').textContent = '🟢 Connecté'; toast('Connecté à Google Drive'); navigate('settings'); }
      catch (e) { $('#drive-status').textContent = '🔴 ' + e.message; toast('Échec de la connexion'); }
    } }, driveConnected() ? '🔄 Rafraîchir la connexion' : '🔗 Se connecter à Google Drive'),
    driveConnected() ? el('button', { class: 'btn secondary', onClick: () => { driveDisconnect(); navigate('settings'); } }, 'Déconnecter') : null,
  );
  card.appendChild(actions);
  card.appendChild(status);

  // Réglage avancé : remplacer le Client ID intégré par le sien (replié par défaut)
  const idInput = el('input', { type: 'text', value: usingCustom ? clientId : '', placeholder: 'xxxxx.apps.googleusercontent.com',
    style: 'width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: var(--radius-sm); font-size: 13px; font-family: monospace;' });
  card.appendChild(el('details', { style: 'margin-top: 14px; font-size: 12px; color: var(--text-dim);' },
    el('summary', { style: 'cursor: pointer; color: var(--accent);' }, 'Avancé : utiliser mon propre Client ID'),
    el('p', { style: 'margin: 8px 0;' }, 'Un Client ID OAuth est déjà intégré à l\'app — laisse ce champ vide pour l\'utiliser. Pour passer par ton propre projet Google Cloud, colle ton Client ID ci-dessous.'),
    el('label', { style: 'font-size: 11px; display: block; margin-bottom: 4px;' }, 'Client ID OAuth personnalisé'),
    idInput,
    el('button', { class: 'btn secondary', style: 'margin-top: 8px;', onClick: () => {
      const v = idInput.value.replace(/[\s​-‍﻿]/g, '');
      if (v && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) {
        toast('⚠️ Format invalide — un Client ID finit par .apps.googleusercontent.com');
        return;
      }
      setDriveClientId(v);
      driveTokenClient = null; driveToken = null;
      localStorage.removeItem(DRIVE_FOLDER_KEY);
      navigate('settings');
      toast(v ? 'Client ID personnalisé enregistré' : 'Retour au Client ID intégré');
    } }, 'Enregistrer'),
  ));

  // Actions de sync
  const progress = el('div', { id: 'drive-progress', style: 'font-size: 13px; color: var(--accent); margin-top: 12px; min-height: 18px;' });
  const syncActions = el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;' },
    el('button', { class: 'btn', onClick: async () => {
      try { await driveBackupNow((m) => { $('#drive-progress').textContent = m; }); navigate('settings'); }
      catch (e) { $('#drive-progress').textContent = '❌ ' + e.message; }
    } }, '⬆️ Sauvegarder maintenant'),
    el('button', { class: 'btn secondary', onClick: () => openDriveRestore() }, '⬇️ Restaurer un backup'),
  );
  card.appendChild(el('h3', { style: 'margin-top: 18px;' }, 'Synchronisation'));
  card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 4px;' },
    'Automatique : ~2 min après chaque modification et à l\'ouverture. Seules les nouveautés sont envoyées (les sauvegardes identiques sont sautées).'));

  // État des vidéos : combien sont à l'abri sur Drive ?
  const allLocalVids = [...state.videos, ...state.mobilityVideos].filter(v => v.blobKey);
  if (allLocalVids.length) {
    const backed = allLocalVids.filter(v => v.driveFileId).length;
    const pending = allLocalVids.length - backed;
    card.appendChild(el('p', { style: `font-size: 13px; margin: 4px 0 0; color: ${pending ? 'var(--accent)' : 'var(--success)'};` },
      pending
        ? `🎥 Vidéos : ${backed}/${allLocalVids.length} sur Drive — ${pending} en attente d'envoi.`
        : `🎥 Vidéos : ${backed}/${allLocalVids.length} sauvegardées sur Drive ✓`));
  }
  card.appendChild(syncActions);
  card.appendChild(progress);

  return card;
}

async function openDriveRestore() {
  try {
    await driveAuth({ silent: false });
  } catch (e) { toast('Connexion requise : ' + e.message); return; }

  openModal('Restaurer depuis Google Drive', (close) => {
    const wrap = el('div');
    wrap.appendChild(el('p', { style: 'font-size: 13px; color: var(--text-dim);' }, 'Chargement des backups…'));

    driveListBackups().then((files) => {
      wrap.innerHTML = '';
      if (!files.length) {
        wrap.appendChild(emptyState('Aucun backup', 'Lance d\'abord une sauvegarde manuelle.'));
        return;
      }
      wrap.appendChild(el('p', { style: 'font-size: 12px; color: var(--text-dim); margin: 0 0 10px;' },
        `${files.length} backup(s) trouvé(s) :`));
      files.forEach((f) => {
        wrap.appendChild(el('div', { class: 'list-item' },
          el('div', {},
            el('div', { class: 'title' }, f.name),
            el('div', { class: 'meta' }, `${new Date(f.createdTime).toLocaleString('fr-FR')} · ${Math.round((f.size || 0) / 1024)} Ko`),
          ),
          el('button', { class: 'btn small', onClick: () => confirmAction('Restaurer ce backup ? Les données actuelles seront remplacées.', async () => {
            close();
            const p = el('div', { class: 'toast', style: 'border-left-color: var(--info);' }, 'Restauration…');
            $('#toast-root').appendChild(p);
            try {
              await driveRestoreFromFile(f.id, (m) => { p.textContent = m; });
              setTimeout(() => p.remove(), 1800);
            } catch (e) {
              p.textContent = '❌ ' + e.message;
              setTimeout(() => p.remove(), 4000);
            }
          }) }, 'Restaurer'),
        ));
      });
    }).catch((e) => {
      wrap.innerHTML = '';
      wrap.appendChild(el('p', { style: 'color: var(--danger);' }, '❌ ' + e.message));
    });

    return wrap;
  });
}

function openPinForm(isChange) {
  openModal(isChange ? 'Changer le PIN' : 'Définir un PIN', (close) => {
    const form = el('form', { class: 'form', onSubmit: async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (isChange) {
        const ok = await checkPin(d.current || '');
        if (!ok) { toast('Code actuel incorrect.'); return; }
      }
      if (!d.pin || d.pin.length < 4) { toast('Le PIN doit faire au moins 4 chiffres.'); return; }
      if (d.pin !== d.pin2) { toast('Les deux codes ne correspondent pas.'); return; }
      await savePin(d.pin);
      close(); navigate('settings'); toast('PIN enregistré');
    } });
    form.innerHTML = `
      ${isChange ? '<div><label>Code actuel</label><input type="password" inputmode="numeric" name="current" required></div>' : ''}
      <div><label>Nouveau code (4-12 chiffres)</label><input type="password" inputmode="numeric" name="pin" minlength="4" maxlength="12" required></div>
      <div><label>Confirmer</label><input type="password" inputmode="numeric" name="pin2" minlength="4" maxlength="12" required></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    form.querySelector('button[type=button]').onclick = close;
    return form;
  });
}

// =============================================================
// Backup auto (snapshots quotidiens)
// =============================================================

const SNAPSHOT_INTERVAL_MS = 86400000;     // 1 instantané / jour max
const SNAPSHOT_KEEP = 7;

async function maybeAutoSnapshot() {
  try {
    const last = +localStorage.getItem('athelio:lastSnapshot') || 0;
    if (Date.now() - last < SNAPSHOT_INTERVAL_MS) return;
    // Cloner sans les vidéos (data URL anciennes formes peuvent être lourdes)
    const snap = JSON.parse(JSON.stringify(state));
    snap.videos = (snap.videos || []).map(v => { const { data, ...rest } = v; return rest; });
    await idbPut(STORE_SNAPSHOTS, Date.now(), snap);
    localStorage.setItem('athelio:lastSnapshot', String(Date.now()));
    // Rotation : garder seulement les N plus récents
    const all = await idbAll(STORE_SNAPSHOTS);
    if (all.length > SNAPSHOT_KEEP) {
      all.sort((a, b) => b.key - a.key);
      for (const old of all.slice(SNAPSHOT_KEEP)) await idbDel(STORE_SNAPSHOTS, old.key);
    }
  } catch {}
}

// =============================================================
// Review du jour — passe chaque catégorie pour ne rien oublier.
// Les catégories déjà renseignées aujourd'hui sont sautées ;
// Vidéos et Objectifs sont exclus (pas de saisie quotidienne).
// =============================================================

// Toutes les étapes possibles de la review + leur ordre par défaut
const REVIEW_STEP_META = {
  sobriety:     { emoji: '🥗', label: 'Sobriété' },
  badminton:    { emoji: '🏸', label: 'Badminton' },
  runs:         { emoji: '🏃', label: 'Course' },
  lifts:        { emoji: '🏋️', label: 'Musculation' },
  weight:       { emoji: '⚖️', label: 'Poids' },
  mobility:     { emoji: '🧘', label: 'AntiFragile' },
  recovery:     { emoji: '🌙', label: 'Récupération' },
  measurements: { emoji: '📏', label: 'Mensurations' },
  photo:        { emoji: '📷', label: 'Photo' },
};
const DEFAULT_REVIEW_ORDER = ['sobriety', 'badminton', 'runs', 'lifts', 'weight', 'mobility', 'recovery'];

// Config ordonnée [{key, enabled}], complétée des étapes manquantes (désactivées)
function getReviewConfig() {
  const saved = Array.isArray(state.settings?.reviewConfig) ? state.settings.reviewConfig : null;
  const base = saved || [
    ...DEFAULT_REVIEW_ORDER.map(key => ({ key, enabled: true })),
    { key: 'measurements', enabled: false },
    { key: 'photo', enabled: false },
  ];
  // Forward-compat : ajoute toute étape connue absente de la config
  const present = new Set(base.map(s => s.key));
  for (const key of Object.keys(REVIEW_STEP_META)) {
    if (!present.has(key)) base.push({ key, enabled: false });
  }
  return base.filter(s => REVIEW_STEP_META[s.key]);
}

// Construit l'étape pour une clé, ou null si déjà renseignée aujourd'hui
function makeReviewStep(key, ctx, t) {
  const meta = REVIEW_STEP_META[key];
  const head = (extra) => ({ emoji: meta.emoji, title: meta.label, ...extra });

  if (key === 'sobriety') {
    if (state.sobriety.some(x => x.date === t)) return null;
    return head({ question: 'As-tu fait un écart aujourd\'hui ?', noSave: true, build() {
      const what = el('input', { type: 'text', placeholder: 'Pizza, alcool, sucreries…' });
      const why = el('textarea', { placeholder: 'Stress, sortie entre amis, fatigue…' });
      const slipFields = el('div', { class: 'form', style: 'display: none; margin-top: 12px;' },
        el('div', {}, el('label', {}, 'Quel écart ?'), what),
        el('div', {}, el('label', {}, 'Pourquoi ?'), why),
        el('button', { type: 'button', class: 'btn', onClick: () => {
          if (!what.value.trim()) { toast('Indique quel écart, ou clique sur Passer.'); return; }
          state.sobriety.push({ id: id(), date: t, hasSlip: true, what: what.value.trim(), why: why.value.trim() });
          save(); ctx.next(true);
        } }, 'Enregistrer l\'écart'),
      );
      const box = el('div', {},
        el('div', { style: 'display: flex; gap: 8px;' },
          el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #6fcf97, #4fb97f); color: #2a0708;',
            onClick: () => {
              state.sobriety.push({ id: id(), date: t, hasSlip: false, what: '', why: '' });
              save(); ctx.next(true);
            } }, '✅ Journée saine'),
          el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #ff6b5e, #e0524a); color: #2a0708;',
            onClick: () => { slipFields.style.display = 'grid'; what.focus(); } }, '⚠️ Écart'),
        ),
        slipFields,
      );
      return { el: box };
    } });
  }

  if (key === 'badminton') {
    if (state.badminton.matches.some(m => m.date === t)) return null;
    return head({ question: 'As-tu joué un match aujourd\'hui ?', noSave: true, build() {
      return { el: el('button', { class: 'btn', style: 'width: 100%;', onClick: () => {
        ctx.openMatchAtEnd = true; ctx.next(true);
      } }, '🏸 Oui — je saisirai le match à la fin de la review') };
    } });
  }

  if (key === 'runs') {
    if (state.runs.some(r => r.date === t)) return null;
    return head({ question: 'As-tu couru aujourd\'hui ?', build() {
      const dist = el('input', { type: 'number', step: '0.1', min: '0', placeholder: 'ex : 5.2' });
      const dur = el('input', { type: 'number', step: '0.1', min: '0', placeholder: 'ex : 31' });
      const notes = el('textarea', { placeholder: 'Ressenti, parcours…' });
      const box = el('div', { class: 'form' },
        el('div', { class: 'form-row' },
          el('div', {}, el('label', {}, 'Distance (km)'), dist),
          el('div', {}, el('label', {}, 'Durée (min)'), dur),
        ),
        el('div', {}, el('label', {}, 'Notes (facultatif)'), notes),
      );
      return { el: box, save() {
        const d = parseFloat(dist.value), du = parseFloat(dur.value);
        if (!d || !du) { toast('Distance et durée requises — ou clique sur Passer.'); return false; }
        state.runs.push({ id: id(), date: t, distance: d, duration: du, notes: notes.value.trim() });
        save(); return true;
      } };
    } });
  }

  if (key === 'lifts') {
    if (state.lifts.some(l => l.date === t)) return null;
    return head({ question: 'Séance aujourd\'hui ? Sélectionne les groupes travaillés.', build() {
      const selected = new Set();
      const grid = el('div', { class: 'muscle-grid' });
      MUSCLE_GROUPS.forEach(g => {
        const btn = el('button', { type: 'button', class: 'muscle-btn', onClick: () => {
          if (selected.has(g.key)) selected.delete(g.key); else selected.add(g.key);
          btn.classList.toggle('active');
        } }, el('span', { class: 'muscle-emoji' }, g.emoji), el('span', {}, g.label));
        grid.appendChild(btn);
      });
      const gym = gymPicker(null);
      const focus = el('input', { type: 'text', placeholder: 'Ex : Force / Hypertrophie' });
      const box = el('div', { class: 'form' },
        grid,
        el('div', { style: 'margin-top: 4px;' }, el('label', {}, 'Salle (facultatif)'), gym.el),
        el('div', {}, el('label', {}, 'Focus (facultatif)'), focus),
      );
      return { el: box, save() {
        if (!selected.size) { toast('Sélectionne au moins un groupe — ou clique sur Passer.'); return false; }
        state.lifts.push({ id: id(), date: t, groups: Array.from(selected), gym: gym.value, focus: focus.value.trim(), notes: '' });
        save(); return true;
      } };
    } });
  }

  if (key === 'weight') {
    if (state.weight.some(w => w.date === t)) return null;
    return head({ question: 'Tu t\'es pesé aujourd\'hui ?', build() {
      const input = el('input', { type: 'number', step: '0.1', min: '20', placeholder: 'ex : 78.4' });
      return {
        el: el('div', { class: 'form' }, el('div', {}, el('label', {}, 'Poids (kg)'), input)),
        save() {
          const v = parseFloat(input.value);
          if (!v) { toast('Entre ton poids — ou clique sur Passer.'); return false; }
          state.weight.push({ id: id(), date: t, value: v });
          save(); return true;
        },
      };
    } });
  }

  if (key === 'measurements') {
    if (state.measurements.some(m => m.date === t)) return null;
    return head({ question: 'Jour de mesures ? (1×/mois suffit)', build() {
      const mk = () => el('input', { type: 'number', step: '0.5', min: '0' });
      const chest = mk(), arm = mk(), waist = mk(), thigh = mk();
      const box = el('div', { class: 'form' },
        el('div', { class: 'form-row' },
          el('div', {}, el('label', {}, 'Poitrine (cm)'), chest),
          el('div', {}, el('label', {}, 'Bras (cm)'), arm),
        ),
        el('div', { class: 'form-row' },
          el('div', {}, el('label', {}, 'Taille (cm)'), waist),
          el('div', {}, el('label', {}, 'Cuisse (cm)'), thigh),
        ),
      );
      return { el: box, save() {
        const vals = [chest, arm, waist, thigh].map(i => i.value ? +i.value : null);
        if (vals.every(v => v == null)) { toast('Entre au moins une mesure — ou clique sur Passer.'); return false; }
        state.measurements.push({ id: id(), date: t, chest: vals[0], arm: vals[1], waist: vals[2], thigh: vals[3] });
        save(); return true;
      } };
    } });
  }

  if (key === 'photo') {
    if (state.photos.some(p => p.date === t)) return null;
    return head({ question: 'Une photo de progression aujourd\'hui ?', build() {
      let file = null;
      const label = el('input', { type: 'text', placeholder: 'Légende (facultatif)' });
      const fileBtn = el('label', { class: 'btn secondary', style: 'display: block; text-align: center; cursor: pointer;' },
        '📷 Choisir une photo',
        el('input', { type: 'file', accept: 'image/*', hidden: '', onChange: (e) => {
          file = e.target.files[0] || null;
          fileBtn.firstChild.textContent = file ? `📦 ${file.name}` : '📷 Choisir une photo';
        } }),
      );
      const box = el('div', { class: 'form' }, fileBtn, el('div', {}, el('label', {}, 'Légende'), label));
      return { el: box, async save() {
        if (!file) { toast('Choisis une photo — ou clique sur Passer.'); return false; }
        try {
          const data = await compressImage(file);
          state.photos.push({ id: id(), date: t, label: label.value.trim(), data });
          if (!save()) { state.photos.pop(); return false; }
          return true;
        } catch { toast('Impossible de charger cette image.'); return false; }
      } };
    } });
  }

  if (key === 'mobility') {
    if (state.mobility.some(m => m.date === t)) return null;
    return head({ question: 'Mobilité / étirements aujourd\'hui ?', build() {
      const title = el('input', { type: 'text', placeholder: 'Ex : Étirement ischios, ouverture de hanches…' });
      const desc = el('textarea', { placeholder: 'Exécution, ressenti, axes…' });
      const box = el('div', { class: 'form' },
        el('div', {}, el('label', {}, 'Titre'), title),
        el('div', {}, el('label', {}, 'Description (facultatif)'), desc),
      );
      return { el: box, save() {
        if (!title.value.trim()) { toast('Donne un titre — ou clique sur Passer.'); return false; }
        state.mobility.push({ id: id(), date: t, title: title.value.trim(), description: desc.value.trim() });
        save(); return true;
      } };
    } });
  }

  if (key === 'recovery') {
    if (state.recovery.some(r => r.date === t)) return null;
    return head({ question: 'Comment te sens-tu ce soir ?', build() {
      const mkScale = (current) => {
        const scale = el('div', { class: 'scale' });
        let value = current;
        for (let i = 0; i <= 5; i++) {
          const b = el('button', { type: 'button', class: `scale-btn${i === value ? ' active' : ''}`, onClick: () => {
            value = i;
            scale.querySelectorAll('.scale-btn').forEach((x, j) => x.classList.toggle('active', j === i));
            scale.dataset.value = String(i);
          } }, String(i));
          scale.appendChild(b);
        }
        scale.dataset.value = String(value);
        return scale;
      };
      const fatigue = mkScale(2);
      const pain = mkScale(1);
      const box = el('div', { class: 'form' },
        el('div', {}, el('label', {}, 'Fatigue (/5)'), fatigue),
        el('div', {}, el('label', {}, 'Douleurs (/5)'), pain),
      );
      return { el: box, save() {
        state.recovery.push({ id: id(), date: t, fatigue: +fatigue.dataset.value, pain: +pain.dataset.value, notes: '' });
        save(); return true;
      } };
    } });
  }

  return null;
}

function reviewSteps(ctx) {
  const t = today();
  const steps = [];
  for (const { key, enabled } of getReviewConfig()) {
    if (!enabled) continue;
    const step = makeReviewStep(key, ctx, t);
    if (step) steps.push(step);
  }
  return steps;
}

function openDailyReview() {
  const ctx = { openMatchAtEnd: false, next: null };
  const steps = reviewSteps(ctx);
  if (!steps.length) { toast('✅ Tout est déjà renseigné pour aujourd\'hui !'); return; }

  let idx = 0, savedCount = 0, skippedCount = 0;

  openModal('☀️ Review du jour', (close) => {
    const body = el('div');

    const render = () => {
      body.innerHTML = '';

      // Écran final
      if (idx >= steps.length) {
        body.appendChild(el('div', { style: 'text-align: center; padding: 8px 0;' },
          el('div', { style: 'font-size: 44px;' }, savedCount ? '🎉' : '👌'),
          el('p', { style: 'margin: 10px 0 4px; font-weight: 700; font-size: 16px;' }, 'Review terminée'),
          el('p', { style: 'margin: 0 0 18px; color: var(--text-dim); font-size: 13px;' },
            `${savedCount} saisie${savedCount > 1 ? 's' : ''} · ${skippedCount} passée${skippedCount > 1 ? 's' : ''}`),
          el('button', { class: 'btn', style: 'width: 100%;', onClick: () => {
            close();
            navigate(currentView); // rafraîchit la vue pour refléter les saisies
            if (ctx.openMatchAtEnd) openMatchForm();
          } }, ctx.openMatchAtEnd ? '🏸 Saisir mon match' : 'Fermer'),
        ));
        return;
      }

      const step = steps[idx];
      body.appendChild(el('div', { class: 'review-head' },
        el('span', { class: 'review-count' }, `${idx + 1} / ${steps.length}`),
        el('div', { class: 'progress', style: 'flex: 1; margin-top: 0;' },
          el('div', { class: 'progress-fill', style: `width: ${Math.round((idx / steps.length) * 100)}%;` })),
      ));
      body.appendChild(el('h4', { class: 'review-title' }, `${step.emoji} ${step.title}`));
      body.appendChild(el('p', { class: 'review-question' }, step.question));

      const built = step.build();
      body.appendChild(built.el);

      body.appendChild(el('div', { class: 'form-actions', style: 'margin-top: 18px;' },
        el('button', { class: 'btn secondary', onClick: () => ctx.next(false) }, 'Passer'),
        step.noSave ? null : el('button', { class: 'btn', onClick: async () => {
          if (await built.save()) ctx.next(true);
        } }, 'Enregistrer'),
      ));
    };

    ctx.next = (saved) => {
      if (saved) savedCount++; else skippedCount++;
      idx++;
      render();
    };

    render();
    return body;
  });
}

// =============================================================
// Boot
// =============================================================

function closeNav() { document.body.classList.remove('nav-open'); }

// Tiroir au doigt (côté droit) : glisser depuis le bord droit pour
// l'ouvrir, le repousser vers la droite pour le fermer — le panneau
// suit le doigt dans les deux sens, la transition CSS termine le mouvement.
function setupNavSwipe() {
  const sidebar = $('.sidebar');
  const backdrop = $('#nav-backdrop');
  if (!sidebar || !backdrop) return;

  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  const EDGE = 28; // zone de déclenchement au bord droit (px)

  let startX = 0, startY = 0, curX = 0, lastX = 0, lastT = 0, velocity = 0;
  let tracking = false, dragging = false, mode = null; // 'open' | 'close'

  // x = translateX du tiroir en px (+largeur = caché à droite, 0 = ouvert)
  const setDrawer = (x) => {
    const w = sidebar.offsetWidth;
    curX = Math.max(0, Math.min(w, x));
    sidebar.style.transform = `translateX(${curX}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - curX / w));
  };

  const onStart = (e) => {
    if (!isMobile()) return;
    const t = e.touches[0];
    const open = document.body.classList.contains('nav-open');
    if (open) mode = 'close';
    else if (t.clientX >= window.innerWidth - EDGE) mode = 'open';
    else { tracking = false; return; }
    startX = lastX = t.clientX;
    startY = t.clientY;
    lastT = e.timeStamp;
    curX = open ? 0 : sidebar.offsetWidth;
    velocity = 0;
    tracking = true;
    dragging = false;
  };

  const onMove = (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // Geste plutôt vertical : on laisse le scroll faire son travail
      if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return; }
      // Depuis le bord droit, seul un glissement vers la gauche ouvre
      if (mode === 'open' && dx > 0) { tracking = false; return; }
      dragging = true;
      sidebar.classList.add('dragging');
      backdrop.classList.add('dragging');
    }

    e.preventDefault();
    const dt = e.timeStamp - lastT || 1;
    velocity = (t.clientX - lastX) / dt; // px/ms — positif vers la droite
    lastX = t.clientX;
    lastT = e.timeStamp;

    setDrawer((mode === 'close' ? 0 : sidebar.offsetWidth) + dx);
  };

  const onEnd = () => {
    tracking = false;
    if (!dragging) return;
    dragging = false;
    const w = sidebar.offsetWidth;
    // On relâche le suivi du doigt : la transition CSS termine le mouvement
    sidebar.classList.remove('dragging');
    backdrop.classList.remove('dragging');
    sidebar.style.transform = '';
    backdrop.style.opacity = '';
    if (mode === 'close') {
      // Repoussé vers la droite au-delà du seuil (ou flick) → fermé
      if (curX > w * 0.35 || velocity > 0.35) closeNav();
    } else {
      // Tiré vers la gauche au-delà du seuil (ou flick) → ouvert
      const shouldOpen = curX < w * 0.65 || velocity < -0.35;
      document.body.classList.toggle('nav-open', shouldOpen);
    }
  };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('touchcancel', onEnd);
}

// Splash : reste affiché au moins ~650 ms puis fond en douceur
// (révèle l'écran PIN ou l'app qui attend dessous)
function hideSplash() {
  const splash = $('#splash');
  if (!splash) return;
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 500);
  }, 650);
}

// Animation d'entrée : topbar descend, contenu monte, sidebar glisse (desktop)
function playAppIntro() {
  document.body.classList.add('app-intro');
  setTimeout(() => document.body.classList.remove('app-intro'), 1000);
}

// Applique le thème dès que possible (le script est en fin de <body>, le DOM existe)
applyTheme(state.settings?.theme);

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.settings?.theme);
  // 1) Verrou PIN si configuré — l'écran PIN se révèle sous le splash
  if (getPinConfig()) {
    document.body.classList.add('locked');
    const unlocked = showLockScreen();
    hideSplash();
    await unlocked;
    document.body.classList.remove('locked');
  } else {
    hideSplash();
  }

  // 2) Demande au navigateur de ne pas évincer notre stockage (vidéos lourdes !)
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch {}
  }

  renderNav();
  const reviewBtn = $('#review-btn');
  if (reviewBtn) reviewBtn.addEventListener('click', () => { closeNav(); openDailyReview(); });
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
  const settingsBtn = $('#settings-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', () => { navigate('settings'); closeNav(); });

  // Menu mobile (drawer coulissant)
  const toggle = $('#menu-toggle');
  const backdrop = $('#nav-backdrop');
  if (toggle) toggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  if (backdrop) backdrop.addEventListener('click', closeNav);
  setupNavSwipe();

  // Retour haptique global : léger buzz au toucher des éléments interactifs
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn, .nav-btn, .icon-btn, .tab, .scale-btn, .muscle-btn, .review-btn, .gym-btn, .mode-btn, .notif-switch')) haptic(10);
  });

  navigate('dashboard');
  playAppIntro();

  // 3) Auto-snapshot quotidien (sauvegarde locale)
  maybeAutoSnapshot();

  // 4) Auto-backup Google Drive à l'ouverture (silencieux, max 1/6 h)
  setTimeout(() => maybeAutoDriveBackup(), 2000); // laisse GSI se charger
});
