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
  sobriety: [],
  comparisons: [],
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
  for (const k of ['weight', 'measurements', 'runs', 'lifts', 'photos', 'goals', 'recovery', 'videos', 'mobility', 'mobilityVideos', 'sobriety', 'comparisons']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!Array.isArray(s.badminton.matches)) s.badminton.matches = [];
  if (!Array.isArray(s.badminton.tournaments)) s.badminton.tournaments = [];
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

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
const DRIVE_SCOPE          = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME    = 'Athelio Backups';

let driveTokenClient = null;
let driveToken = null; // { access_token, expires_at }

function driveClientId()   { return localStorage.getItem(DRIVE_CLIENT_KEY) || ''; }
function setDriveClientId(v) { v ? localStorage.setItem(DRIVE_CLIENT_KEY, v.trim()) : localStorage.removeItem(DRIVE_CLIENT_KEY); }
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
  localStorage.removeItem(DRIVE_FOLDER_KEY);
  toast('Déconnecté de Google Drive');
}

async function driveApi(url, opts = {}) {
  const token = await driveAuth({ silent: true });
  const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + token };
  const r = await fetch(url, { ...opts, headers });
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

// Backup complet : JSON + vidéos manquantes
async function driveBackupNow(onStatus = () => {}) {
  await driveAuth({ silent: false });
  const folderId = await driveFolderId();

  // 1) Uploader les vidéos qui n'ont pas encore de driveFileId (videos + mobilityVideos)
  const vids = [...state.videos, ...state.mobilityVideos].filter(v => v.blobKey && !v.driveFileId);
  for (let i = 0; i < vids.length; i++) {
    const v = vids[i];
    onStatus(`📹 Vidéo ${i + 1}/${vids.length}…`);
    const blob = await idbGet(STORE_BLOBS, v.blobKey);
    if (!blob) continue;
    const name = `video-${v.id}.${(v.mime || 'video/mp4').split('/')[1] || 'mp4'}`;
    const file = await driveUploadBlob(name, blob, [folderId], (loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      onStatus(`📹 Vidéo ${i + 1}/${vids.length} — ${pct} %`);
    });
    v.driveFileId = file.id;
  }
  save();

  // 2) JSON complet (les vidéos contiennent désormais leur driveFileId)
  onStatus('📦 Sauvegarde JSON…');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = await driveUploadJson(`athelio-${stamp}.json`, JSON.stringify(state, null, 2), [folderId]);

  localStorage.setItem(DRIVE_LAST_BACKUP, String(Date.now()));
  onStatus(`✅ Sauvegarde terminée (${file.name})`);
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

async function maybeAutoDriveBackup() {
  if (!driveClientId()) return;
  if (Date.now() - driveLastBackup() < 86400000) return; // 1/jour max
  // Tentative silencieuse — si on n'a pas de token actif, on n'embête pas l'utilisateur
  try {
    await driveAuth({ silent: true });
    await driveBackupNow();
  } catch { /* silencieux */ }
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
  text: '#8a9aae',
  grid: 'rgba(255,255,255,0.05)',
  accent: '#ff5b2e',
  accent2: '#ffb547',
  info: '#3aa8ff',
  success: '#2ecc71',
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
}

// =============================================================
// Views
// =============================================================

const views = {};

// ---------- Dashboard ----------

views.dashboard = () => {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'view-header' },
    el('div', {},
      el('h2', {}, 'Tableau de bord'),
      el('p', {}, 'Une vue d\'ensemble de ta progression.'),
    ),
  ));

  const matches = state.badminton.matches;
  const wins = matches.filter(m => m.result === 'win').length;
  const winRate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const lastWeight = state.weight.at(-1);
  const firstWeight = state.weight[0];
  const weightDelta = lastWeight && firstWeight ? (lastWeight.value - firstWeight.value).toFixed(1) : null;
  const totalDistance = state.runs.reduce((s, r) => s + (r.distance || 0), 0);
  const recovery = state.recovery.at(-1);

  const kpis = el('div', { class: 'grid cols-4' });
  kpis.appendChild(kpiCard('🏸 Matchs joués', matches.length, `${wins} V — ${matches.length - wins} D`));
  kpis.appendChild(kpiCard('🏆 Taux de victoire', `${winRate}%`, '', winRate >= 50 ? 'success' : 'danger'));
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

  const charts = el('div', { class: 'grid cols-2' });

  const weightCard = el('div', { class: 'card' }, el('h3', {}, 'Évolution du poids'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-weight' })));
  const matchCard = el('div', { class: 'card' }, el('h3', {}, 'Résultats badminton'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-matches' })));
  charts.appendChild(weightCard);
  charts.appendChild(matchCard);
  wrap.appendChild(charts);

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
            backgroundColor: 'rgba(255, 91, 46, 0.15)',
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
    const wins = state.badminton.matches.filter(m => m.result === 'win').length;
    const losses = state.badminton.matches.filter(m => m.result === 'loss').length;
    chart($('#dash-matches').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Victoires', 'Défaites'],
        datasets: [{
          data: [wins, losses],
          backgroundColor: [chartTheme.success, chartTheme.accent],
          borderColor: 'transparent',
        }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: chartTheme.text } } },
        cutout: '65%' }
    });
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
        tbody.appendChild(el('tr', {},
          el('td', {}, fmtDate(m.date)),
          el('td', {}, m.opponent || '—'),
          el('td', { html: `<span class="badge neutral">${m.type}</span>` }),
          el('td', { style: 'white-space: nowrap;' }, `${setsWon.me}–${setsWon.opp}`),
          el('td', { style: 'white-space: nowrap;' }, matchScoreLabel(m)),
          el('td', { html: resBadge }),
          el('td', { style: 'text-align: right; white-space: nowrap;' },
            toggle,
            el('button', { class: 'icon-btn', onClick: () => openMatchForm(m) }, '✎'),
            el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer ce match ?', () => {
              state.badminton.matches = state.badminton.matches.filter(x => x.id !== m.id);
              save(); navigate('badminton'); toast('Match supprimé');
            }) }, '✕'),
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
          el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer ce tournoi ?', () => {
            state.badminton.tournaments = state.badminton.tournaments.filter(x => x.id !== t.id);
            save(); navigate('badminton'); toast('Tournoi supprimé');
          }) }, '✕'),
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
  const m = existing || { date: today(), opponent: '', type: 'simple', goodPoints: '', badPoints: '', workPoints: '' };
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
      const entry = {
        id: existing?.id || id(),
        date: data.date,
        opponent: data.opponent.trim(),
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
      <div><label>Adversaire</label><input type="text" name="opponent" value="${m.opponent || ''}" placeholder="Nom ou équipe"></div>
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
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.weight = state.weight.filter(x => x.id !== w.id);
      save(); navigate('weight'); toast('Entrée supprimée');
    } }, '✕'),
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
          borderColor: chartTheme.accent, backgroundColor: 'rgba(255,91,46,0.15)', fill: true, tension: 0.35, pointRadius: 4 }],
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
      el('button', { class: 'icon-btn danger', onClick: () => {
        state.runs = state.runs.filter(x => x.id !== r.id);
        save(); navigate('runs');
      } }, '✕'),
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

  const kpis = el('div', { class: 'grid cols-3' });
  kpis.appendChild(kpiCard('🗓️ Cette semaine', String(thisWeek.length), thisWeek.length > 1 ? 'séances' : 'séance',
    thisWeek.length >= 3 ? 'success' : (thisWeek.length ? 'accent' : 'danger')));
  kpis.appendChild(kpiCard('⏪ Semaine dernière', String(lastWeek.length),
    delta === 0 ? '= même rythme' : (delta > 0 ? `+${delta} cette semaine` : `${delta} cette semaine`),
    delta >= 0 ? 'success' : 'danger'));
  kpis.appendChild(kpiCard('📊 Total séances', String(all.length), all.length ? `depuis ${fmtDate(all.at(-1).date)}` : ''));
  wrap.appendChild(kpis);
  wrap.appendChild(el('div', { style: 'height: 16px;' }));

  // Graphique : séances par semaine (8 dernières)
  const chartCard = el('div', { class: 'card' }, el('h3', {}, 'Fréquence par semaine'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'lift-chart' })));
  wrap.appendChild(chartCard);

  // Répartition par groupe musculaire (4 dernières semaines)
  const groupCard = el('div', { class: 'card', style: 'margin-top: 16px;' }, el('h3', {}, 'Groupes travaillés (4 dernières semaines)'));
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
  wrap.appendChild(groupCard);

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
          `${fmtDate(l.date)}${l.focus ? ' · ' + l.focus : ''}${l.notes ? ' · ' + l.notes : ''}`),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'icon-btn', onClick: () => openLiftForm(l) }, '✎'),
        el('button', { class: 'icon-btn danger', onClick: () => {
          state.lifts = state.lifts.filter(x => x.id !== l.id);
          save(); navigate('lifts');
        } }, '✕'),
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
  }, 0);

  return wrap;
};

function openLiftForm(existing) {
  const l = existing || { date: today(), groups: [], focus: '', notes: '' };
  let selectedGroups = new Set(l.groups || []);

  openModal(existing ? 'Modifier la séance' : 'Nouvelle séance', (close) => {
    const form = el('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!selectedGroups.size) { toast('Sélectionne au moins un groupe musculaire.'); return; }
      const entry = {
        id: existing?.id || id(),
        date: d.date,
        groups: Array.from(selectedGroups),
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
      <stop offset="0" stop-color="#26303f"/>
      <stop offset="1" stop-color="#1b2330"/>
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
  <g stroke="#ff5b2e" stroke-width="2" fill="none" stroke-dasharray="5 4" stroke-linecap="round">
    <line x1="104" y1="120" x2="216" y2="120"/>
    <line x1="112" y1="182" x2="208" y2="182"/>
    <ellipse cx="93" cy="150" rx="20" ry="11"/>
    <ellipse cx="139" cy="300" rx="22" ry="12"/>
  </g>
  <g stroke="#ff5b2e" stroke-width="1.5">
    <line x1="216" y1="120" x2="244" y2="120"/>
    <line x1="208" y1="182" x2="244" y2="182"/>
    <line x1="73" y1="150" x2="52" y2="150"/>
    <line x1="117" y1="300" x2="60" y2="300"/>
  </g>
  <g fill="#ff5b2e">
    <circle cx="244" cy="120" r="2.5"/>
    <circle cx="244" cy="182" r="2.5"/>
    <circle cx="52" cy="150" r="2.5"/>
    <circle cx="60" cy="300" r="2.5"/>
  </g>
  <g fill="#e6edf6" font-family="Inter, sans-serif" font-size="13" font-weight="600">
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
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.measurements = state.measurements.filter(x => x.id !== m.id);
      save(); navigate('measurements');
    } }, '✕'),
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
            el('button', { class: 'icon-btn danger', onClick: () => {
              state.photos = state.photos.filter(x => x.id !== p.id);
              save(); navigate('photos');
            } }, '✕'),
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
  return el('div', { class: 'card compare-card' },
    el('div', { class: 'compare-head' },
      el('div', {},
        el('div', { class: 'compare-title' }, c.title || `Comparaison du ${fmtDate(c.date)}`),
        el('div', { class: 'compare-date' }, fmtDate(c.date)),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'icon-btn', onClick: () => openComparisonForm(c) }, '✎'),
        el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer cette comparaison ?', () => {
          state.comparisons = state.comparisons.filter(x => x.id !== c.id);
          save(); navigate('photos'); toast('Comparaison supprimée');
        }) }, '✕'),
      ),
    ),
    el('div', { class: 'compare-canvas' },
      el('div', { class: 'compare-side' },
        el('div', { class: 'compare-label' }, c.beforeLabel || 'Avant'),
        el('div', { class: 'compare-img-wrap' },
          el('img', { src: c.beforeData, alt: 'avant', loading: 'lazy', onClick: () => openImageZoom(c.beforeData) }),
        ),
      ),
      el('div', { class: 'compare-side' },
        el('div', { class: 'compare-label after' }, c.afterLabel || 'Après'),
        el('div', { class: 'compare-img-wrap' },
          el('img', { src: c.afterData, alt: 'après', loading: 'lazy', onClick: () => openImageZoom(c.afterData) }),
        ),
      ),
    ),
    c.notes ? el('div', { class: 'compare-notes' }, c.notes) : null,
  );
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

function videoEmbed(v) {
  // Vidéo fichier dans IndexedDB : on insère un placeholder puis on injecte la vraie src
  if (v.blobKey) {
    const video = el('video', { controls: '', preload: 'metadata' });
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
    return el('video', { src: p.src, controls: '', preload: 'metadata' });
  }
  if (p.type === 'link') {
    return el('a', { class: 'video-fallback', href: p.src, target: '_blank', rel: 'noopener' }, '▶ Ouvrir la vidéo');
  }
  return el('div', { class: 'video-fallback' }, 'Vidéo indisponible');
}

views.videos = () => {
  const wrap = el('div');
  wrap.appendChild(viewHeader('Vidéos', 'Garde tes vidéos datées pour visionner ta progression dans le temps.',
    el('button', { class: 'btn', onClick: () => openVideoForm() }, '+ Ajouter une vidéo')));

  const card = el('div', { class: 'card' });
  const arr = [...state.videos].sort((a, b) => b.date.localeCompare(a.date));
  if (!arr.length) {
    card.appendChild(emptyState('Aucune vidéo', 'Ajoute un lien (YouTube, Vimeo, Drive…) ou un fichier court pour suivre ta progression.'));
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
    el('div', { class: 'video-embed' }, videoEmbed(v)),
    el('div', { class: 'video-info' },
      el('div', { class: 'video-head' },
        el('div', {},
          el('div', { class: 'video-date' }, fmtDate(v.date)),
          v.title ? el('div', { class: 'video-title' }, v.title) : null,
        ),
        el('button', { class: 'icon-btn danger', onClick: async () => {
          if (v.blobKey) { try { await idbDel(STORE_BLOBS, v.blobKey); } catch {} }
          state[stateKey] = state[stateKey].filter(x => x.id !== v.id); save(); navigate(navView); toast('Vidéo supprimée');
        } }, '✕'),
      ),
      v.notes ? el('div', { class: 'video-notes' }, v.notes) : null,
    ),
  );
}

function openVideoForm(opts = {}) {
  const stateKey = opts.stateKey || 'videos';
  const navView = opts.navView || 'videos';
  openModal('Ajouter une vidéo', (close) => {
    let pendingFile = null;
    const form = el('form', { class: 'form', onSubmit: async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const url = (d.url || '').trim();
      if (!url && !pendingFile) { toast('Ajoute un lien ou un fichier vidéo.'); return; }
      const entry = { id: id(), date: d.date, title: (d.title || '').trim(), url, notes: (d.notes || '').trim() };
      if (pendingFile) {
        const key = 'video-' + entry.id;
        try {
          await idbPut(STORE_BLOBS, key, pendingFile);
          entry.blobKey = key;
          entry.size = pendingFile.size;
          entry.mime = pendingFile.type;
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
    form.innerHTML = `
      <div class="form-row">
        <div><label>Date</label><input type="date" name="date" value="${today()}" required></div>
        <div><label>Titre</label><input type="text" name="title" placeholder="ex : Service revers, semaine 3"></div>
      </div>
      <div><label>Lien vidéo</label><input type="url" name="url" placeholder="https://youtube.com/… ou Vimeo, Drive…"></div>
      <div><label>… ou importer un fichier vidéo</label><input type="file" accept="video/*" name="file"></div>
      <p class="form-hint file-hint">Stockage local jusqu'à ~500 Mo par fichier. Au-delà, préfère un lien (YouTube, Vimeo, Drive).</p>
      <div><label>Notes</label><textarea name="notes" placeholder="Ce que tu observes, axes de travail…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn secondary">Annuler</button>
        <button type="submit" class="btn">Enregistrer</button>
      </div>
    `;
    const fileInput = form.querySelector('input[type=file]');
    const hint = form.querySelector('.file-hint');
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) { pendingFile = null; hint.textContent = 'Stockage local jusqu\'à ~500 Mo par fichier. Au-delà, préfère un lien.'; return; }
      if (f.size > 500_000_000) {
        toast('Fichier trop lourd (max 500 Mo). Préfère un lien.');
        fileInput.value = ''; pendingFile = null; return;
      }
      pendingFile = f;
      hint.textContent = `📦 ${f.name} — ${(f.size / 1_000_000).toFixed(1)} Mo, sera stocké dans IndexedDB (hors-ligne).`;
    });
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
      el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer cet objectif ?', () => {
        state.goals = state.goals.filter(x => x.id !== g.id); save(); navigate('goals');
      }) }, '✕'),
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
    el('button', { class: 'icon-btn danger', onClick: () => {
      state.recovery = state.recovery.filter(x => x.id !== r.id); save(); navigate('recovery');
    } }, '✕'),
  )));
  wrap.appendChild(list);

  setTimeout(() => {
    if (!arr.length) return;
    chart($('#rec-chart').getContext('2d'), {
      type: 'line',
      data: {
        labels: arr.map(r => shortDate(r.date)),
        datasets: [
          { label: 'Fatigue', data: arr.map(r => r.fatigue), borderColor: chartTheme.accent, backgroundColor: 'rgba(255,91,46,0.15)', tension: 0.3, fill: true, pointRadius: 4 },
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
          el('button', { class: 'icon-btn danger', onClick: () => confirmAction('Supprimer cet exercice ?', () => {
            state.mobility = state.mobility.filter(x => x.id !== m.id); save(); navigate('mobility');
          }) }, '✕'),
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
      el('button', { class: 'icon-btn danger', onClick: () => {
        state.sobriety = state.sobriety.filter(x => x.id !== s.id); save(); navigate('sobriety');
      } }, '✕'),
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
      el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #2ecc71, #27ae60); color: #0a1a0e;',
        onClick: () => setEntry(false) }, '✅ Journée saine'),
      el('button', { class: 'btn', style: 'flex:1; background: linear-gradient(135deg, #e74c3c, #c0392b); color: #1a0a0a;',
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
        el('div', { class: 'lock-logo' }, 'A'),
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
      if (ok) { overlay.remove(); resolve(); }
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

  // --- Rappels ---
  wrap.appendChild(notifSettingsCard());

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

function notifSettingsCard() {
  const s = getNotifSettings();
  const perm = notifPermission();
  const card = el('div', { class: 'card', style: 'margin-top: 16px;' });
  card.appendChild(el('h3', {}, '🔔 Rappels'));

  const permTxt = perm === 'granted' ? '🟢 Notifications système autorisées'
    : perm === 'denied' ? '🔴 Notifications bloquées (à débloquer dans le navigateur)'
    : perm === 'unsupported' ? '⚠️ Notifications système non supportées ici (la bannière in-app fonctionne quand même)'
    : '⚪ Permission non demandée — clique sur « Activer » pour autoriser';
  card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 12px;' }, permTxt));

  // Toggle global
  card.appendChild(notifToggleRow(
    'Activer les rappels',
    'Bannière in-app + notification système si autorisé.',
    s.enabled,
    async (val) => {
      if (val) await requestNotifPermission(); // on n'échoue pas si refusé : bannière in-app suffit
      const cur = getNotifSettings();
      cur.enabled = val;
      setNotifSettings(cur);
      if (val) startNotifLoop();
      else if (notifTickInterval) { clearInterval(notifTickInterval); notifTickInterval = null; }
      navigate('settings');
    },
  ));

  if (!s.enabled) return card;

  const items = [
    ['weighIn',           '⚖️ Pesée du lundi',         'Lundi à 7h00'],
    ['recoveryEvening',   '🌙 Récupération du soir',   'Tous les soirs à 21h30'],
    ['sobrietyEvening',   '🥗 Sobriété',                'Tous les soirs à 21h00 — « as-tu fait un écart ? »'],
    ['monthlyBody',       '📏 Suivi mensuel',           '1er du mois à 9h00 (mensurations + photo)'],
    ['goalDeadline',      '🎯 Échéances d\'objectif',   'À J-7 et J-1'],
    ['streakCelebration', '🔥 Séries (motivation)',     '1 semaine sobriété · 10 jours de suivi récup'],
  ];
  items.forEach(([key, title, sub]) => {
    card.appendChild(notifToggleRow(title, sub, s[key], (val) => {
      const cur = getNotifSettings();
      cur[key] = val;
      setNotifSettings(cur);
    }));
  });

  card.appendChild(el('div', { style: 'margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;' },
    el('button', { class: 'btn secondary', onClick: () => {
      fireNotification('🔔 Notification de test', 'Si tu vois ça, les rappels fonctionnent.', { tag: 'test', view: 'dashboard' });
    } }, 'Tester une notification'),
    el('button', { class: 'btn secondary', onClick: () => confirmAction('Réinitialiser l\'historique d\'envoi ? Les rappels du jour pourront se redéclencher.', () => {
      setNotifSent({}); toast('Historique remis à zéro');
    }) }, 'Réinitialiser l\'historique'),
  ));

  return card;
}

function notifToggleRow(title, sub, value, onChange) {
  const btn = el('button', {
    class: `notif-switch ${value ? 'on' : ''}`,
    type: 'button',
    onClick: () => {
      const next = !btn.classList.contains('on');
      btn.classList.toggle('on', next);
      btn.textContent = next ? 'Activé' : 'Désactivé';
      onChange(next);
    },
  }, value ? 'Activé' : 'Désactivé');
  return el('div', { class: 'list-item' },
    el('div', {},
      el('div', { class: 'title' }, title),
      el('div', { class: 'meta' }, sub),
    ),
    btn,
  );
}

function driveSettingsCard() {
  const card = el('div', { class: 'card', style: 'margin-top: 16px;' });
  card.appendChild(el('h3', {}, '☁️ Google Drive'));

  const clientId = driveClientId();
  const last = driveLastBackup();
  const lastTxt = last ? `il y a ${Math.floor((Date.now() - last) / 3600000)} h` : 'jamais';

  if (!clientId) {
    card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 8px;' },
      'Configure un Client ID OAuth pour synchroniser tes données et vidéos avec ton Google Drive personnel.'));
    card.appendChild(el('details', { style: 'margin: 8px 0 12px; font-size: 12px; color: var(--text-dim);' },
      el('summary', { style: 'cursor: pointer; color: var(--accent);' }, 'Voir les étapes de configuration'),
      el('ol', { style: 'padding-left: 18px; line-height: 1.7;' },
        el('li', {}, 'Va sur ', el('a', { href: 'https://console.cloud.google.com/', target: '_blank', rel: 'noopener', style: 'color: var(--info);' }, 'console.cloud.google.com'), ' et crée un projet.'),
        el('li', {}, 'Active l\'API Google Drive (APIs et services → Bibliothèque).'),
        el('li', {}, 'Configure l\'écran de consentement OAuth en mode External + Testing, ajoute ton email comme testeur.'),
        el('li', {}, 'Crée des identifiants OAuth 2.0 → Application Web.'),
        el('li', {}, 'Ajoute l\'URL où tu héberges Athelio dans « Origines JavaScript autorisées » (ex: https://ton-app.netlify.app).'),
        el('li', {}, 'Copie le Client ID (format: 123456789-abcdef.apps.googleusercontent.com) et colle-le ci-dessous.'),
      ),
    ));
  } else {
    card.appendChild(el('p', { style: 'color: var(--text-dim); font-size: 13px; margin: 0 0 12px;' },
      `Dernière sauvegarde Drive : ${lastTxt}.`));
  }

  // Champ Client ID
  const idInput = el('input', { type: 'text', value: clientId, placeholder: 'xxxxx.apps.googleusercontent.com',
    style: 'width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: var(--radius-sm); font-size: 13px; font-family: monospace;' });
  card.appendChild(el('label', { style: 'font-size: 11px; color: var(--text-dim); display: block; margin-bottom: 4px;' }, 'Client ID OAuth'));
  card.appendChild(idInput);

  // Statut connexion
  const status = el('div', { id: 'drive-status', style: 'font-size: 12px; color: var(--text-dim); margin-top: 10px; min-height: 16px;' },
    driveConnected() ? '🟢 Connecté' : (clientId ? '⚪ Non connecté' : ''));

  // Boutons
  const actions = el('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;' },
    el('button', { class: 'btn secondary', onClick: () => {
      const v = idInput.value.trim();
      setDriveClientId(v);
      driveTokenClient = null; driveToken = null;
      localStorage.removeItem(DRIVE_FOLDER_KEY);
      navigate('settings');
      toast(v ? 'Client ID enregistré' : 'Client ID supprimé');
    } }, 'Enregistrer le Client ID'),
    clientId ? el('button', { class: 'btn', onClick: async () => {
      try { await driveAuth(); $('#drive-status').textContent = '🟢 Connecté'; toast('Connecté à Google Drive'); }
      catch (e) { $('#drive-status').textContent = '🔴 ' + e.message; toast('Échec de la connexion'); }
    } }, driveConnected() ? 'Rafraîchir le token' : 'Se connecter') : null,
    driveConnected() ? el('button', { class: 'btn secondary', onClick: () => { driveDisconnect(); navigate('settings'); } }, 'Déconnecter') : null,
  );
  card.appendChild(actions);
  card.appendChild(status);

  if (!clientId) return card;

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
    'Sauvegarde JSON + vidéos non encore envoyées. Lancé automatiquement 1 fois/jour si tu es connecté.'));
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
// Backup auto (snapshots quotidiens + rappel d'export)
// =============================================================

const SNAPSHOT_INTERVAL_MS = 86400000;     // 1 instantané / jour max
const SNAPSHOT_KEEP = 7;
const EXPORT_REMINDER_DAYS = 14;

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

function showBackupReminderIfNeeded() {
  const last = +localStorage.getItem('athelio:lastExport') || 0;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : Infinity;
  if (days < EXPORT_REMINDER_DAYS) return;
  const banner = el('div', { class: 'backup-banner' },
    el('span', {}, last
      ? `💾 Dernier export il y a ${days} jours — pense à sauvegarder.`
      : '💾 Pense à exporter ta première sauvegarde.'),
    el('div', { style: 'display: flex; gap: 6px;' },
      el('button', { class: 'btn small', onClick: () => { exportData(); banner.remove(); } }, 'Exporter'),
      el('button', { class: 'icon-btn', onClick: () => banner.remove() }, '✕'),
    ),
  );
  document.body.appendChild(banner);
}

// =============================================================
// Notifications (rappels de saisie)
// =============================================================

const NOTIF_KEY = 'athelio:notifs';
const NOTIF_SENT_KEY = 'athelio:notifs:sent';

const defaultNotifSettings = {
  enabled: false,
  weighIn: true,           // lundi 7h
  recoveryEvening: true,   // tous les soirs 21h30
  sobrietyEvening: true,   // tous les soirs 21h
  monthlyBody: true,       // 1er du mois 9h
  goalDeadline: true,      // J-7 et J-1
  streakCelebration: true, // 7 j sobriété, 10 j récup
};

function getNotifSettings() {
  try { return { ...defaultNotifSettings, ...(JSON.parse(localStorage.getItem(NOTIF_KEY)) || {}) }; }
  catch { return { ...defaultNotifSettings }; }
}
function setNotifSettings(s) { localStorage.setItem(NOTIF_KEY, JSON.stringify(s)); }

function getNotifSent() {
  try { return JSON.parse(localStorage.getItem(NOTIF_SENT_KEY)) || {}; }
  catch { return {}; }
}
function setNotifSent(map) { localStorage.setItem(NOTIF_SENT_KEY, JSON.stringify(map)); }

function notifPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    toast('Ton navigateur ne supporte pas les notifications système.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    toast('Notifications bloquées — autorise-les dans les réglages du navigateur.');
    return false;
  }
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function fireNotification(title, body, { tag, view } = {}) {
  // 1) Bannière in-app (toujours, même sans permission système)
  showNotifBanner(title, body, view);
  // 2) Notification système via SW si dispo
  if (notifPermission() === 'granted') {
    try {
      const reg = await (navigator.serviceWorker?.ready);
      const opts = { body, tag, icon: 'icon-192.png', badge: 'icon-192.png',
        data: { view: view || 'dashboard', ts: Date.now() } };
      if (reg && reg.showNotification) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch {}
  }
}

function showNotifBanner(title, body, view) {
  // Évite d'empiler plusieurs bannières identiques
  const existing = document.querySelector(`.notif-banner[data-tag="${title}"]`);
  if (existing) existing.remove();
  const banner = el('div', { class: 'notif-banner', 'data-tag': title },
    el('div', { class: 'notif-banner-body' },
      el('strong', {}, title),
      el('div', { class: 'notif-banner-text' }, body),
    ),
    el('div', { class: 'notif-banner-actions' },
      view ? el('button', { class: 'btn small', onClick: () => { banner.remove(); navigate(view); } }, 'Ouvrir') : null,
      el('button', { class: 'icon-btn', onClick: () => banner.remove() }, '✕'),
    ),
  );
  document.body.appendChild(banner);
  setTimeout(() => { if (banner.isConnected) banner.remove(); }, 30000);
}

function ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastWeekdayAt(now, weekday, hour, minute) {
  // Dernier occurrence (≤ now) du jour de semaine donné à hh:mm
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  while (d.getDay() !== weekday || d > now) d.setDate(d.getDate() - 1);
  return d;
}

function todayAt(hour, minute) {
  const d = new Date(); d.setHours(hour, minute, 0, 0); return d;
}

function recoveryStreakDays() {
  const set = new Set(state.recovery.map(r => r.date));
  if (!set.size) return 0;
  const day = 86400000;
  let cur = new Date(); cur.setHours(0,0,0,0);
  if (!set.has(ymd(cur))) cur = new Date(cur.getTime() - day);
  let n = 0;
  while (set.has(ymd(cur))) { n++; cur = new Date(cur.getTime() - day); }
  return n;
}

// Construit la liste des rappels à déclencher maintenant.
function buildScheduledRules(now) {
  const rules = [];
  const sent = getNotifSent();
  const s = getNotifSettings();
  const todayStr = ymd(now);

  // 1) Lundi 7h — pesée (skip si déjà pesé aujourd'hui)
  if (s.weighIn) {
    const target = lastWeekdayAt(now, 1, 7, 0);
    const key = `weighIn:${ymd(target)}`;
    const already = state.weight.some(w => w.date === todayStr);
    if (now >= target && !sent[key] && !already) {
      rules.push({ key, title: '⚖️ Pesée du lundi', body: '1 min pour rester sur la courbe.', view: 'weight' });
    }
  }

  // 2) 21h30 — récupération (skip si déjà saisie aujourd'hui)
  if (s.recoveryEvening) {
    const target = todayAt(21, 30);
    const key = `recovery:${todayStr}`;
    const already = state.recovery.some(r => r.date === todayStr);
    if (now >= target && !sent[key] && !already) {
      rules.push({ key, title: '🌙 Récupération du soir', body: 'Note ta fatigue et tes douleurs.', view: 'recovery' });
    }
  }

  // 3) 21h — sobriété (skip si déjà saisie aujourd'hui)
  if (s.sobrietyEvening) {
    const target = todayAt(21, 0);
    const key = `sobriety:${todayStr}`;
    const already = state.sobriety.some(x => x.date === todayStr);
    if (now >= target && !sent[key] && !already) {
      rules.push({ key, title: '🥗 Sobriété', body: 'As-tu fait un écart aujourd\'hui ?', view: 'sobriety' });
    }
  }

  // 4) 1er du mois 9h — mensurations + photo
  if (s.monthlyBody) {
    const target = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0, 0);
    const key = `monthlyBody:${now.getFullYear()}-${now.getMonth() + 1}`;
    if (now >= target && !sent[key]) {
      rules.push({ key, title: '📏 Suivi mensuel', body: 'Mensurations + photo du mois.', view: 'measurements' });
    }
  }

  // 5) Objectifs : J-7 et J-1
  if (s.goalDeadline) {
    state.goals.filter(g => !g.done && g.deadline).forEach(g => {
      const deadline = new Date(g.deadline + 'T09:00:00');
      const days = Math.ceil((deadline - now) / 86400000);
      if (days === 7 || days === 1) {
        const key = `goalDeadline:${g.id}:${days}`;
        if (!sent[key]) {
          rules.push({ key, title: '🎯 Objectif', body: `« ${g.title} » — plus que ${days} jour${days > 1 ? 's' : ''}.`, view: 'goals' });
        }
      }
    });
  }

  // 6) Streaks (motivation)
  if (s.streakCelebration) {
    const sStreak = sobrietyStreak();
    if (sStreak >= 7) {
      const key = `streak:sobriety7:${todayStr}`;
      if (!sent[key]) {
        rules.push({ key, title: '🔥 1 semaine sans écart', body: `${sStreak} jours sains d'affilée — continue !`, view: 'sobriety' });
      }
    }
    const rStreak = recoveryStreakDays();
    if (rStreak >= 10) {
      const key = `streak:recovery10:${todayStr}`;
      if (!sent[key]) {
        rules.push({ key, title: '🌙 10 jours de suivi récup', body: `${rStreak} jours d'affilée — belle régularité.`, view: 'recovery' });
      }
    }
  }

  return rules;
}

let notifTickInterval = null;

function tickNotifications() {
  const s = getNotifSettings();
  if (!s.enabled) return;
  const now = new Date();
  const rules = buildScheduledRules(now);
  if (!rules.length) return;
  const sent = getNotifSent();
  rules.forEach(r => {
    fireNotification(r.title, r.body, { tag: r.key, view: r.view });
    sent[r.key] = true;
  });
  // Garde les 300 dernières clés pour éviter la croissance infinie
  const keys = Object.keys(sent);
  if (keys.length > 300) {
    const trimmed = {};
    keys.slice(-300).forEach(k => trimmed[k] = sent[k]);
    setNotifSent(trimmed);
  } else {
    setNotifSent(sent);
  }
}

function startNotifLoop() {
  if (notifTickInterval) clearInterval(notifTickInterval);
  tickNotifications();
  notifTickInterval = setInterval(tickNotifications, 60000);
}

// =============================================================
// Boot
// =============================================================

function closeNav() { document.body.classList.remove('nav-open'); }

document.addEventListener('DOMContentLoaded', async () => {
  // 1) Verrou PIN si configuré
  if (getPinConfig()) {
    document.body.classList.add('locked');
    await showLockScreen();
    document.body.classList.remove('locked');
  }

  // 2) Demande au navigateur de ne pas évincer notre stockage (vidéos lourdes !)
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch {}
  }

  $$('.nav-btn').forEach(b => b.addEventListener('click', () => { navigate(b.dataset.view); closeNav(); }));
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
  const settingsBtn = $('#settings-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', () => { navigate('settings'); closeNav(); });

  // Menu mobile (drawer coulissant)
  const toggle = $('#menu-toggle');
  const backdrop = $('#nav-backdrop');
  if (toggle) toggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  if (backdrop) backdrop.addEventListener('click', closeNav);

  navigate('dashboard');

  // 3) Auto-snapshot quotidien + rappel d'export tous les 14 jours
  maybeAutoSnapshot();
  showBackupReminderIfNeeded();

  // 4) Auto-backup Google Drive (1/jour, silencieux)
  setTimeout(() => maybeAutoDriveBackup(), 2000); // laisse GSI se charger

  // 5) Notifications / rappels
  if (getNotifSettings().enabled) startNotifLoop();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getNotifSettings().enabled) tickNotifications();
  });

  // 6) Deep-link depuis un clic de notification système (postMessage du SW)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'navigate' && e.data.view) navigate(e.data.view);
    });
  }
  const params = new URLSearchParams(window.location.search);
  const notifView = params.get('notif');
  if (notifView && views[notifView]) navigate(notifView);
});
