const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const updater = require('./updater');
const Smart = require('./smart');
const { readDuration } = require('./duration');
const createLang = require('./lang');
const { pathToFileURL } = require('url');

const YOU4_DB = path.join(app.getPath('appData'), 'You4', 'you4.db');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_STORE = path.join(app.getPath('userData'), 'store.json');

// Données propres à Playou4. Les vidéos sont identifiées par une empreinte de leur contenu (et non leur chemin),
// ce qui conserve compteurs, playlists et métadonnées quand un fichier change de dossier ou de disque.
// Le fichier de données (playlists + compteurs) peut être placé n'importe où : son chemin est dans config.json.
let storePath = DEFAULT_STORE;
let store;

const DEFAULT_SETTINGS = { wheelSeconds: 10, countPercent: 80, langAuto: false, langModel: 'base', smart: { ...Smart.DEFAULTS } };
const emptyStore = () => ({ folders: [], plays: {}, playlists: {}, autoPlaylists: [], lang: {}, meta: {}, fpCache: {}, settings: { ...DEFAULT_SETTINGS } });


// Réglages du moteur de playlists intelligentes : types et bornes vérifiés.
function sanitizeSmart(v) {
  const D = Smart.DEFAULTS;
  const n = (x, lo, hi, def) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, Math.round(+x))) : def);
  const b = (x, def) => (typeof x === 'boolean' ? x : def);
  const o = { ...D, ...(v || {}) };
  const out = {
    byAuthor: b(o.byAuthor, D.byAuthor),
    byKeyword: b(o.byKeyword, D.byKeyword),
    byDuration: b(o.byDuration, D.byDuration),
    byLanguage: b(o.byLanguage, D.byLanguage),
    auto: b(o.auto, D.auto),
    folderAuthors: b(o.folderAuthors, D.folderAuthors),
    ignore: typeof o.ignore === 'string' ? o.ignore.slice(0, 2000) : D.ignore,
    minAuthor: n(o.minAuthor, 2, 100, D.minAuthor),
    minKeyword: n(o.minKeyword, 2, 100, D.minKeyword),
    maxKeywords: n(o.maxKeywords, 1, 100, D.maxKeywords),
    shortMax: n(o.shortMax, 1, 600, D.shortMax),
    longMin: n(o.longMin, 1, 600, D.longMin),
  };
  if (out.longMin <= out.shortMax) out.longMin = out.shortMax + 1;
  return out;
}

function readStoreFile(file) {
  const s = { ...emptyStore(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  if (!s.folders.length) s.folders = [app.getPath('downloads')];
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  s.settings.smart = sanitizeSmart(s.settings.smart);
  if (!Array.isArray(s.autoPlaylists)) s.autoPlaylists = [];
  if (!s.lang || typeof s.lang !== 'object') s.lang = {};
  if (!['tiny', 'base'].includes(s.settings.langModel)) s.settings.langModel = DEFAULT_SETTINGS.langModel;
  return s;
}

function loadStore() {
  try {
    storePath = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).storePath || DEFAULT_STORE;
  } catch {
    /* config absente : emplacement par défaut */
  }
  try {
    store = readStoreFile(storePath);
  } catch {
    store = emptyStore(); // premier lancement ou fichier illisible
    store.folders = [app.getPath('downloads')];
  }
}

function saveStore() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = storePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, storePath);
}

function setStorePath(file) {
  storePath = file;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ storePath }));
}

// Progression envoyée à l'interface (barre de progression), limitée à ~20 messages/s.
let lastProgress = 0;
function progress(label, done, total, force = false) {
  const t = Date.now();
  if (!force && t - lastProgress < 50) return;
  lastProgress = t;
  if (win && !win.isDestroyed()) win.webContents.send('progress', { label, done, total });
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && !e.name.startsWith('$')) await walk(p, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.mp4')) out.push(p);
  }
}

const CHUNK = 256 * 1024;
async function fingerprint(file, st) {
  const c = store.fpCache[file];
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.fp;
  const fh = await fsp.open(file, 'r');
  try {
    const h = crypto.createHash('sha1').update(String(st.size));
    const buf = Buffer.alloc(CHUNK);
    let r = await fh.read(buf, 0, CHUNK, 0);
    h.update(buf.subarray(0, r.bytesRead));
    if (st.size > CHUNK) {
      r = await fh.read(buf, 0, CHUNK, Math.max(0, st.size - CHUNK));
      h.update(buf.subarray(0, r.bytesRead));
    }
    const fp = h.digest('hex');
    store.fpCache[file] = { size: st.size, mtimeMs: st.mtimeMs, fp };
    return fp;
  } finally {
    await fh.close();
  }
}

// Métadonnées de You4 (auteur, date de téléchargement), indexées par chemin.
function you4Meta() {
  const map = new Map();
  if (!fs.existsSync(YOU4_DB)) return map;
  try {
    const db = new DatabaseSync(YOU4_DB, { readOnly: true });
    for (const r of db.prepare(`SELECT creator, file_path, finished_at FROM downloads WHERE status='OK' AND file_path IS NOT NULL`).all()) {
      map.set(r.file_path.toLowerCase(), r);
    }
    db.close();
  } catch {
    /* base verrouillée ou absente : on continue sans */
  }
  return map;
}

// Durée lue une fois par fichier, puis conservée avec l'empreinte (mêmes taille et date = même durée).
async function cachedDuration(file, st) {
  const c = store.fpCache[file];
  if (!c) return 0;
  if (c.dur === undefined) c.dur = await readDuration(file, st.size);
  return c.dur || 0;
}

async function listVideos() {
  const files = [];
  progress('Recherche des fichiers mp4…', 0, 0, true);
  for (const f of store.folders) await walk(f, files);
  const total = files.length;
  let done = 0;
  const y4 = you4Meta();
  const roots = store.folders.map((f) => path.resolve(f).toLowerCase());
  const byFp = new Map();
  const queue = files.slice();
  const worker = async () => {
    for (let f; (f = queue.shift()); ) {
      let st;
      try {
        st = await fsp.stat(f);
        const fp = await fingerprint(f, st);
        if (byFp.has(fp)) continue; // doublon exact : une seule entrée
        const dur = await cachedDuration(f, st);
        const d = y4.get(f.toLowerCase());
        if (d && d.creator) store.meta[fp] = { creator: d.creator, date: d.finished_at || st.mtime.toISOString() };
        const m = store.meta[fp] || {};
        const parent = path.dirname(f);
        const creatorSource = m.creator ? 'meta' : roots.includes(path.resolve(parent).toLowerCase()) ? 'none' : 'folder';
        const creator = m.creator || (roots.includes(path.resolve(parent).toLowerCase()) ? 'Inconnu' : path.basename(parent));
        let title = path.basename(f, path.extname(f));
        if (title.startsWith(`${creator} - `)) title = title.slice(creator.length + 3);
        const p = store.plays[fp] || {};
        byFp.set(fp, {
          id: fp,
          title,
          creator,
          creatorSource,
          date: m.date || st.mtime.toISOString(),
          size: st.size,
          duration: dur,
          lang: (store.lang[fp] || {}).l || null,
          url: pathToFileURL(f).href,
          path: f,
          plays: p.count || 0,
          last: p.last || null,
        });
      } catch {
        /* fichier disparu ou illisible */
      } finally {
        progress('Analyse des vidéos', ++done, total);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  progress('Analyse des vidéos', total, total, true);
  saveStore();
  return { videos: [...byFp.values()], folders: store.folders, playlists: store.playlists, auto: store.autoPlaylists, settings: store.settings };
}

// Déplace un fichier ; entre deux disques, copie par flux avec progression (onBytes reçoit les octets copiés).
async function moveFile(src, dst, onBytes) {
  if (fs.existsSync(dst)) throw new Error('existe déjà à destination');
  try {
    await fsp.rename(src, dst);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    const rs = fs.createReadStream(src);
    rs.on('data', (chunk) => onBytes(chunk.length));
    await pipeline(rs, fs.createWriteStream(dst, { flags: 'wx' }));
    const a = await fsp.stat(src);
    const b = await fsp.stat(dst);
    if (a.size !== b.size) {
      await fsp.unlink(dst);
      throw new Error('copie incomplète');
    }
    await fsp.utimes(dst, a.atime, a.mtime);
    await fsp.unlink(src);
  }
}

let win;

ipcMain.handle('library:list', listVideos);
// ---- Langue parlée (Whisper, installé à la demande) ---------------------------------------------
const toUi = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);
const ffmpegExe = () => require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
let langEngine = null;
let langEngineModel = '';
function getLang() {
  const model = store.settings.langModel;
  if (!langEngine || langEngineModel !== model) {
    langEngineModel = model;
    langEngine = createLang({ dir: path.join(app.getPath('userData'), 'lang'), ffmpeg: ffmpegExe(), modelName: model });
  }
  return langEngine;
}
let langJob = null; // { total, done, cancelled }

ipcMain.handle('lang:status', () => ({
  installed: getLang().installed(),
  model: store.settings.langModel,
  running: !!langJob,
  total: langJob ? langJob.total : 0,
  done: langJob ? langJob.done : 0,
}));

ipcMain.handle('lang:install', async () => {
  try {
    await getLang().install((p) => toUi('lang:progress', p));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Analyse en arrière-plan (2 vidéos à la fois) ; chaque résultat est conservé avec l'empreinte du fichier.
ipcMain.handle('lang:analyze', (_e, items) => {
  if (langJob || !getLang().installed()) return { started: 0 };
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.id === 'string' && typeof i.path === 'string');
  if (!list.length) return { started: 0 };
  const lang = getLang();
  const job = { total: list.length, done: 0, cancelled: false };
  langJob = job;
  const queue = list.slice();
  const worker = async () => {
    for (let it; !job.cancelled && (it = queue.shift()); ) {
      const r = await lang.detectLanguage(it.path, Number(it.duration) || 0);
      if (r) {
        store.lang[it.id] = { l: r.lang, p: r.p };
        toUi('lang:result', { id: it.id, lang: r.lang, p: r.p });
      }
      job.done++;
      if (job.done % 20 === 0) saveStore();
      toUi('lang:progress', { phase: 'analyse', done: job.done, total: job.total });
    }
  };
  Promise.all([worker(), worker()]).finally(() => {
    saveStore();
    langJob = null;
    toUi('lang:done', { done: job.done, total: job.total, cancelled: job.cancelled });
  });
  return { started: list.length };
});
ipcMain.handle('lang:cancel', () => {
  if (langJob) langJob.cancelled = true;
});

ipcMain.handle('library:reveal', (_e, p) => shell.showItemInFolder(p));

// Met des fichiers à la Corbeille (récupérables) ; ne touche que des fichiers de la bibliothèque.
// Retire aussi ces vidéos des playlists, compteurs et caches. Retourne { deleted: [ids], failed: [messages] }.
ipcMain.handle('library:trash', async (_e, items) => {
  const roots = store.folders.map((f) => path.resolve(f).toLowerCase() + path.sep);
  const deleted = [];
  const failed = [];
  for (const it of Array.isArray(items) ? items : []) {
    const p = it && typeof it.path === 'string' ? path.resolve(it.path) : '';
    const name = path.basename(p);
    try {
      if (!/\.mp4$/i.test(p) || !roots.some((r) => p.toLowerCase().startsWith(r))) throw new Error('hors de la bibliothèque');
      if (fs.existsSync(p)) await shell.trashItem(p); // déjà absent : on nettoie quand même les données
      deleted.push(it.id);
    } catch (e) {
      failed.push(name + ' : ' + e.message);
    }
  }
  const gone = new Set(deleted);
  for (const id of gone) {
    delete store.plays[id];
    delete store.meta[id];
    delete store.lang[id];
  }
  for (const f of Object.keys(store.fpCache)) if (!fs.existsSync(f)) delete store.fpCache[f];
  for (const n of Object.keys(store.playlists)) {
    store.playlists[n] = store.playlists[n].filter((id) => !gone.has(id));
    if (!store.playlists[n].length && store.autoPlaylists.includes(n)) delete store.playlists[n]; // « Auto » vide : inutile
  }
  store.autoPlaylists = store.autoPlaylists.filter((n) => n in store.playlists);
  saveStore();
  return { deleted, failed };
});

ipcMain.handle('folders:add', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (!r.canceled && !store.folders.includes(r.filePaths[0])) {
    store.folders.push(r.filePaths[0]);
    saveStore();
  }
  return store.folders;
});
ipcMain.handle('folders:remove', (_e, f) => {
  store.folders = store.folders.filter((x) => x !== f);
  saveStore();
  return store.folders;
});

// Réglages de lecture : pas de la molette (secondes) et seuil (% visionné) à partir duquel une vidéo est comptée lue.
ipcMain.handle('settings:set', (_e, patch) => {
  const clamp = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : def);
  const s = store.settings;
  if ('wheelSeconds' in patch) s.wheelSeconds = clamp(patch.wheelSeconds, 1, 600, s.wheelSeconds);
  if ('countPercent' in patch) s.countPercent = clamp(patch.countPercent, 1, 100, s.countPercent);
  if ('langAuto' in patch) s.langAuto = !!patch.langAuto;
  if ('langModel' in patch && ['tiny', 'base'].includes(patch.langModel)) s.langModel = patch.langModel;
  if ('smart' in patch) s.smart = sanitizeSmart({ ...s.smart, ...patch.smart });
  saveStore();
  return s;
});

ipcMain.handle('playlists:save', (_e, name, ids) => {
  store.playlists[name] = ids;
  store.autoPlaylists = store.autoPlaylists.filter((n) => n !== name); // modifiée à la main : n'est plus automatique
  saveStore();
  return store.playlists;
});
// Remplace toutes les playlists automatiques par la proposition du moteur ; les playlists manuelles ne sont jamais touchées.
ipcMain.handle('playlists:applyAuto', (_e, proposals) => {
  for (const n of store.autoPlaylists) delete store.playlists[n];
  store.autoPlaylists = [];
  for (const [name, ids] of Object.entries(proposals || {})) {
    if (name in store.playlists || !Array.isArray(ids)) continue; // homonyme manuel : on ne l'écrase pas
    store.playlists[name] = ids;
    store.autoPlaylists.push(name);
  }
  saveStore();
  return { playlists: store.playlists, auto: store.autoPlaylists };
});
ipcMain.handle('playlists:clearAuto', () => {
  for (const n of store.autoPlaylists) delete store.playlists[n];
  store.autoPlaylists = [];
  saveStore();
  return { playlists: store.playlists, auto: store.autoPlaylists };
});
ipcMain.handle('playlists:delete', (_e, name) => {
  delete store.playlists[name];
  saveStore();
  return store.playlists;
});

// Une lecture est comptée côté interface (80 % visionné) ; l'empreinte garde le compteur après déplacement.
ipcMain.handle('plays:add', (_e, id) => {
  const p = store.plays[id] || { count: 0 };
  p.count++;
  p.last = new Date().toISOString();
  store.plays[id] = p;
  saveStore();
  return p.count;
});

// Déplace les fichiers (autre dossier ou autre disque). Le dossier de destination rejoint la bibliothèque.
ipcMain.handle('playlist:move', async (_e, paths) => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier de destination', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return { canceled: true };
  const dest = r.filePaths[0];
  const failed = [];
  let moved = 0;
  let total = 0;
  for (const src of paths) {
    try {
      total += fs.statSync(src).size;
    } catch {
      /* signalé plus bas */
    }
  }
  let doneBytes = 0;
  for (const [i, src] of paths.entries()) {
    const label = `Déplacement ${i + 1}/${paths.length} : ${path.basename(src)}`;
    progress(label, doneBytes, total, true);
    let size = 0;
    let copied = 0;
    try {
      size = fs.statSync(src).size;
      await moveFile(src, path.join(dest, path.basename(src)), (n) => {
        copied += n;
        progress(label, doneBytes + copied, total);
      });
      moved++;
    } catch (e) {
      failed.push(`${path.basename(src)} : ${e.message}`);
    }
    doneBytes += size;
  }
  progress('Déplacement terminé', total, total, true);
  if (moved && !store.folders.some((f) => path.resolve(dest).toLowerCase().startsWith(path.resolve(f).toLowerCase()))) {
    store.folders.push(dest);
  }
  saveStore();
  return { dest, moved, failed };
});

// ---- Fichier de données (playlists, compteurs, dossiers) --------------------

ipcMain.handle('store:info', () => storePath);
ipcMain.handle('store:reveal', () => shell.showItemInFolder(storePath));

// Ouvre un autre fichier de données existant (ex. une autre collection de playlists).
ipcMain.handle('store:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Ouvrir un fichier de playlists',
    defaultPath: storePath,
    filters: [{ name: 'Playou4 (JSON)', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled) return { canceled: true };
  try {
    store = readStoreFile(r.filePaths[0]);
  } catch {
    return { error: 'Fichier illisible ou invalide.' };
  }
  setStorePath(r.filePaths[0]);
  return { path: storePath };
});

// Enregistre les données courantes dans un nouveau fichier (ex. sur un autre disque) et l'utilise désormais.
ipcMain.handle('store:saveAs', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Déplacer le fichier de playlists vers…',
    defaultPath: storePath,
    filters: [{ name: 'Playou4 (JSON)', extensions: ['json'] }],
  });
  if (r.canceled) return { canceled: true };
  const old = storePath;
  setStorePath(r.filePath);
  saveStore();
  return { path: storePath, old };
});

// ---- Mises à jour et À propos --------------------------------------------------

ipcMain.handle('app:info', () => ({ version: app.getVersion(), update: updater.getState() }));
ipcMain.handle('update:check', () => updater.checkForUpdate());
ipcMain.handle('update:install', () => updater.installUpdate());

// ---- « Afficher dans Playou4 » (lancé par You4 : Playou4.exe --show "<fichier>") ----------------
// Une seule instance : un second lancement donne son argument à la fenêtre déjà ouverte.

const showArg = (argv) => {
  const i = argv.indexOf('--show');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
let pendingShow = showArg(process.argv); // fichier demandé avant que l'interface soit prête

ipcMain.handle('show:pending', () => {
  const p = pendingShow;
  pendingShow = null;
  return p;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = showArg(argv);
    if (p) win.webContents.send('show:file', p);
  });
}

app.whenReady().then(() => {
  loadStore();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#14151a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  updater.initUpdater((s) => win && !win.isDestroyed() && win.webContents.send('update:state', s));
  win.webContents.once('did-finish-load', () => updater.checkForUpdate());
});
app.on('window-all-closed', () => app.quit());
