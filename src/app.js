const $ = (id) => document.getElementById(id);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR');
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' Go' : Math.round(b / 1048576) + ' Mo');
const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
// Niveaux : 1 à supprimer · 2 Bof · 3 Moyen · 4 Très sympa · 5 Top. rating = null : non classée (affichée au niveau 3).
const LEVELS = { 1: 'À supprimer', 2: 'Bof', 3: 'Moyen', 4: 'Très sympa', 5: 'Top' };
const levelLabel = (r) => (r ? `${r} · ${LEVELS[r]}` : 'Non classée');
const subline = (v) => `${v.creator} · ${fmtDate(v.date)} · ${v.duration ? fmtDur(v.duration) + ' · ' : ''}${v.lang && v.lang !== 'und' ? v.lang.toUpperCase() + ' · ' : ''}${fmtSize(v.size)}${v.dups && v.dups.length ? ' · ⧉ ×' + (v.dups.length + 1) : ''}${v.offline ? ' · hors ligne' + (v.support ? ' (' + v.support + ')' : '') : ''} · ${levelLabel(v.rating)} · ▶ ${v.plays}`;

let videos = [];
let view = []; // liste filtrée/triée de la bibliothèque
let queue = []; // ordre de lecture en cours
// D'où vient la file : 'library' = liste affichée de la Bibliothèque (elle suit les filtres en direct, cochée ou non),
// 'selection' = vidéos cochées (figées au moment du clic sur Lire), 'playlist' = playlist ouverte.
let queueSource = 'library';
let current = null; // id en lecture
let launchNote = ''; // résultat du nettoyage des doublons au lancement, affiché dans le compteur
let counted = false; // lecture courante déjà comptée
let checked = new Set();
let playlists = {};
let autoNames = new Set(); // playlists créées par le moteur intelligent
let activePl = ''; // playlist affichée dans l'onglet Playlists
let settings = { wheelSeconds: 10, countPercent: 80 };

try {
  checked = new Set(JSON.parse(localStorage.getItem('checked') || '[]'));
} catch {}
// Ancienne case rouge « à supprimer » (≤ 0.5.x) : reprise une fois en niveau 1 au lancement, puis supprimée.
let legacyDelete = [];
try {
  legacyDelete = JSON.parse(localStorage.getItem('toDelete') || '[]');
} catch {}
const saveChecked = () => {
  try {
    localStorage.setItem('checked', JSON.stringify([...checked]));
  } catch {}
};

const sorters = {
  'date-desc': (a, b) => b.date.localeCompare(a.date),
  'date-asc': (a, b) => a.date.localeCompare(b.date),
  author: (a, b) => a.creator.localeCompare(b.creator, 'fr') || b.date.localeCompare(a.date),
  title: (a, b) => a.title.localeCompare(b.title, 'fr'),
  'size-desc': (a, b) => b.size - a.size,
  'size-asc': (a, b) => a.size - b.size,
  'rating-desc': (a, b) => (b.rating || 3) - (a.rating || 3) || b.date.localeCompare(a.date),
  'rating-asc': (a, b) => (a.rating || 3) - (b.rating || 3) || b.date.localeCompare(a.date),
  'plays-desc': (a, b) => b.plays - a.plays || b.date.localeCompare(a.date),
  'plays-asc': (a, b) => a.plays - b.plays || b.date.localeCompare(a.date),
};

const byId = (id) => videos.find((v) => v.id === id);
const plVideos = (name) => (playlists[name] || []).map(byId).filter(Boolean); // ignore les fichiers disparus

// ---- Onglets -------------------------------------------------------------

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('#side section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
}

// ---- Liste de vidéos (commune Bibliothèque / détail playlist) -------------

function fillVideoList(ul, list, { withCheckbox }) {
  ul.textContent = '';
  for (const v of list) {
    const li = document.createElement('li');
    li.dataset.id = v.id;
    if (v.id === current) li.className = 'playing';
    if (v.rating === 1) li.classList.add('lvl1'); // à supprimer : en rouge
    if (v.offline) li.classList.add('missing'); // disque absent : visible mais non lisible
    if (withCheckbox) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(v.id);
      cb.onclick = (e) => {
        e.stopPropagation();
        if (cb.checked) checked.add(v.id);
        else checked.delete(v.id);
        saveChecked();
        count();
      };
      cb.title = 'Sélectionner (lecture, playlist, aléatoire)';
      li.append(cb);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = v.title;
    t.title = v.title + '\n' + v.path + (v.dups && v.dups.length ? '\nCopies :\n' + v.dups.join('\n') : '');
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = subline(v);
    meta.append(t, s);
    li.append(meta);
    li.onclick = () => {
      if (v.offline) return;
      queue = list.filter((x) => !x.offline);
      queueSource = withCheckbox ? 'library' : 'playlist';
      play(v, false); // un clic sur un fichier le charge en pause (rien ne démarre par surprise) ; ▶ ou Espace pour lire
    };
    ul.append(li);
  }
}

function refresh() {
  const q = $('q').value.trim().toLowerCase();
  const au = $('author').value;
  const pl = $('plFilter').value;
  const plIds = new Set(pl ? playlists[pl] || [] : []);
  const dur = $('durFilter').value;
  const hideOff = true; // vidéos indisponibles (disque débranché) : masquées de la liste, pas grisées
  const lg = $('langFilter').value;
  const lvf = $('levelFilter').value;
  const sm = settings.smart || { shortMax: 5, longMin: 20 };
  view = videos
    .filter((v) => {
      if (au && v.creator !== au) return false;
      if (pl && !plIds.has(v.id)) return false;
      if (hideOff && v.offline) return false;
      if (lg === 'fr' && v.lang !== 'fr') return false;
      if (lg === 'other' && (!v.lang || v.lang === 'fr' || v.lang === 'und')) return false;
      if (lg === 'und' && v.lang !== 'und') return false;
      if (lg === 'none' && v.lang) return false;
      if (!levelMatch(v, lvf)) return false;
      if (dur) {
        const m = v.duration / 60;
        if (!v.duration) return false;
        if (dur === 'short' && m >= sm.shortMax) return false;
        if (dur === 'mid' && (m < sm.shortMax || m >= sm.longMin)) return false;
        if (dur === 'long' && m < sm.longMin) return false;
      }
      if (q && !(v.title + ' ' + v.creator).toLowerCase().includes(q)) return false;
      if ($('onlyChecked').checked && !checked.has(v.id)) return false;
      if ($('onlyToday').checked && new Date(v.date).toDateString() !== new Date().toDateString()) return false;
      return true;
    })
    .sort(sorters[$('sort').value]);
  if (queueSource === 'library') queue = view.filter((v) => !v.offline); // lecture / aléatoire : toujours sur ce qui est affiché
  fillVideoList($('list'), view, { withCheckbox: true });
  count();
}

function count() {
  syncCur();
  const n = videos.filter((v) => checked.has(v.id)).length;
  const nd = videos.filter((v) => v.dups && v.dups.length).length;
  $('count').textContent = `${view.length} vidéo(s) affichée(s) sur ${videos.length} · ${n} cochée(s)` + (nd ? ` · ${nd} en doublon` : '') + (launchNote ? ` · ${launchNote}` : '') + (videos.some((v) => v.offline) ? ` · ${videos.filter((v) => v.offline).length} hors ligne` : '');
  $('playSel').textContent = n ? `▶ Lire la sélection (${n})` : '▶ Lire la liste';
  $('playSel').title = n ? 'Lit les vidéos cochées' : 'Aucune vidéo cochée : lit la liste affichée';
  const nDel = videos.filter((v) => v.rating === 1).length;
  $('selDelete').textContent = nDel ? `Supprimer la liste (${nDel})` : 'Supprimer la liste';
  $('selDelete').title = nDel ? 'Met à la Corbeille toutes les vidéos de niveau 1 (la liste est affichée avant confirmation)' : 'Aucune vidéo de niveau 1 : mets le curseur à 1 pendant la lecture';
  $('selDelete').disabled = !nDel;
  $('showDel').textContent = `🗑 À supprimer (${nDel})`;
  $('showDel').classList.toggle('on', $('levelFilter').value === '1');
  for (const o of $('levelFilter').options) {
    const k = o.value;
    if (!k) continue;
    o.dataset.base = o.dataset.base || o.textContent;
    const n = videos.filter((v) => (k === 'none' ? !v.rating : k === '45' ? v.rating >= 4 : v.rating === +k)).length;
    o.textContent = `${o.dataset.base} (${n})`;
  }
}

function say(msg) {
  $('plMsg').textContent = msg;
}

// ---- Lecture ---------------------------------------------------------------

// Mémorise la vidéo en cours et la position pour la retrouver à la réouverture.
const saveLast = (id, t) => {
  try {
    localStorage.setItem('lastPlayed', JSON.stringify({ id, t }));
  } catch {}
};
let lastSaveAt = 0;

function play(v, autoplay = true, startAt = 0) {
  current = v.id;
  counted = startAt > 0; // une reprise de lecture au-delà de 80 % ne compte pas comme une nouvelle lecture
  saveLast(v.id, startAt);
  $('video').src = v.url;
  if (startAt > 0) $('video').addEventListener('loadedmetadata', () => { $('video').currentTime = Math.min(startAt, Math.max(0, $('video').duration - 1)); }, { once: true });
  if (autoplay) $('video').play();
  else $('video').pause();
  setNow(v);
  syncCur();
  document.querySelectorAll('.vlist li').forEach((li) => li.classList.toggle('playing', li.dataset.id === current));
  revealCurrent();
}

// Garde la vidéo en cours visible dans la liste de la Bibliothèque : elle est centrée seulement si elle est hors de vue.
function revealCurrent() {
  const li = [...$('list').children].find((el) => el.dataset.id === current);
  if (!li) return;
  const r = li.getBoundingClientRect();
  const c = $('list').getBoundingClientRect();
  if (r.top < c.top || r.bottom > c.bottom) li.scrollIntoView({ block: 'center' });
}

// Cases du plein écran = état de la vidéo en cours.
function syncCur() {
  $('vSel').checked = !!current && checked.has(current);
  const v = current ? byId(current) : null;
  drawLevel(v ? v.rating : undefined);
}

// Dégradé des niveaux : rouge (1) → vert (5).
const LEVEL_COLORS = { 1: '#ff5b5b', 2: '#ff9f45', 3: '#ffd23f', 4: '#a8d84e', 5: '#3ddc84' };

// Barre de niveaux : une ligne, un trait par niveau, un curseur. r : 1 à 5, null = non classée, undefined = pas de vidéo.
function drawLevel(r) {
  const el = $('vLevel');
  if (!el.firstChild) {
    el.style.setProperty('--grad', `linear-gradient(90deg, ${[1, 2, 3, 4, 5].map((n) => LEVEL_COLORS[n]).join(', ')})`);
    el.innerHTML = '<div class="rule"></div>';
    for (let n = 1; n <= 5; n++) {
      const t = document.createElement('div');
      t.className = 'tick';
      t.dataset.n = n;
      t.style.left = `calc(6px + (100% - 12px) * ${(n - 1) / 4})`;
      t.style.setProperty('--c', LEVEL_COLORS[n]);
      el.append(t);
    }
    const th = document.createElement('div');
    th.className = 'thumb';
    el.append(th);
  }
  const shown = r || 3;
  el.classList.toggle('off', r === undefined);
  el.querySelectorAll('.tick').forEach((t) => t.classList.toggle('on', !!r && +t.dataset.n === r));
  const th = el.querySelector('.thumb');
  th.style.left = `calc(6px + (100% - 12px) * ${(shown - 1) / 4})`;
  th.style.background = r ? LEVEL_COLORS[r] : '';
  th.classList.toggle('unrated', !r);
  el.setAttribute('aria-valuenow', shown);
  el.setAttribute('aria-valuetext', levelLabel(r || null));
  const n = $('vLevelName');
  n.textContent = r === undefined ? '—' : levelLabel(r);
  n.style.color = r ? LEVEL_COLORS[r] : '';
}

// Change le niveau d'une vidéo : enregistré tout de suite, ligne de la liste mise à jour sur place.
// La vidéo correspond-elle au filtre de niveau ? k : '' (tous), 'none' (non classées), '45', ou '1' à '5'.
function levelMatch(v, k) {
  if (!k) return true;
  if (k === 'none') return !v.rating;
  if (k === '45') return v.rating >= 4;
  return v.rating === +k;
}

function setLevel(id, lv) {
  const v = byId(id);
  if (!v) return;
  v.rating = lv;
  window.playou4.setRating({ [id]: lv });
  const li = document.querySelector(`.vlist li[data-id="${id}"]`);
  if (li) {
    li.classList.toggle('lvl1', lv === 1);
    const s = li.querySelector('.s');
    if (s) s.textContent = subline(v);
    // Filtre de niveau actif (ex. « Non classées ») : la vidéo qui n'y correspond plus sort tout de suite de la liste.
    // La file de lecture n'est pas touchée : la lecture continue normalement.
    if (!levelMatch(v, $('levelFilter').value)) {
      li.remove();
      view = view.filter((x) => x.id !== id);
    }
  }
  count();
}

// Infos de la vidéo en cours (sous les boutons) ; la pastille à gauche copie le nom de l'auteur.
function setNow(v) {
  $('now').textContent = v ? `${v.creator} — ${v.title}` : 'Aucune vidéo';
  $('now').title = v ? `${v.creator} — ${v.title}` : '';
  $('copyAuthor').hidden = !v || !v.creator;
  $('copyAuthor').classList.remove('done');
}

async function copyAuthor() {
  const v = byId(current);
  if (!v || !v.creator) return;
  try {
    await navigator.clipboard.writeText(v.creator);
  } catch {
    const t = document.createElement('textarea'); // secours si le presse-papiers est refusé
    t.value = v.creator;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  const b = $('copyAuthor');
  b.classList.add('done');
  b.textContent = '✓';
  setTimeout(() => { b.classList.remove('done'); b.textContent = '⧉'; }, 1200);
}

// Lecture fléchée : 0 = normale, -1 = vers le haut, 1 = vers le bas, dans la liste affichée (filtres compris).
let autoDir = 0;
function setAutoDir(d) {
  autoDir = autoDir === d ? 0 : d; // un second clic sur la même flèche l'arrête
  $('dirUp').classList.toggle('on', autoDir === -1);
  $('dirDown').classList.toggle('on', autoDir === 1);
  if (!autoDir) return;
  queue = view.filter((v) => !v.offline);
  queueSource = 'library';
  if (!queue.length) return;
  const cur = queue.find((v) => v.id === current);
  play(cur || (autoDir > 0 ? queue[0] : queue[queue.length - 1]));
}

function step(dir) {
  if (!queue.length) return;
  let i = queue.findIndex((v) => v.id === current);
  if (autoDir && dir === autoDir) i += dir;
  else if ($('shuffle').checked && dir > 0) i = Math.floor(Math.random() * queue.length);
  else i += dir;
  if (i >= 0 && i < queue.length) play(queue[i]);
}

function playList(list, source = 'playlist') {
  queue = list.filter((v) => !v.offline);
  queueSource = source;
  if (queue.length) play($('shuffle').checked ? queue[Math.floor(Math.random() * queue.length)] : queue[0]);
}

// Une lecture compte à partir de 80 % de la durée, une seule fois par lancement.
async function countPlay() {
  const v = byId(current);
  if (!v) return;
  counted = true;
  v.plays = await window.playou4.addPlay(v.id);
  document.querySelectorAll(`.vlist li[data-id="${v.id}"] .s`).forEach((el) => (el.textContent = subline(v)));
}

// ---- Playlists -----------------------------------------------------------

function renderPlaylists() {
  const names = Object.keys(playlists).sort((a, b) => a.localeCompare(b, 'fr'));
  if (!names.includes(activePl)) activePl = '';
  const ul = $('plList');
  ul.textContent = '';
  for (const name of names) {
    const li = document.createElement('li');
    li.className = (name === activePl ? 'active' : '') + (autoNames.has(name) ? ' auto' : '');
    const n = document.createElement('span');
    n.textContent = name;
    const c = document.createElement('span');
    c.className = 'n';
    c.textContent = `${plVideos(name).length} vidéo(s)`;
    li.append(n, c);
    li.onclick = () => {
      activePl = name;
      renderPlaylists();
    };
    ul.append(li);
  }
  const target = $('plTarget');
  const prev = target.value;
  target.textContent = '';
  target.append(new Option(names.length ? 'Choisir une playlist…' : 'Aucune playlist', ''));
  for (const name of names) target.append(new Option(`${name} (${plVideos(name).length})`, name));
  target.value = names.includes(prev) ? prev : activePl;
  // Filtre de la bibliothèque : « Toutes les vidéos » ou une playlist (s'applique tout de suite au changement).
  const filter = $('plFilter');
  const prevFilter = filter.value;
  filter.textContent = '';
  filter.append(new Option('Toutes les vidéos', ''));
  for (const name of names) filter.append(new Option(`${name} (${plVideos(name).length})`, name));
  filter.value = names.includes(prevFilter) ? prevFilter : '';
  if (filter.value !== prevFilter) refresh(); // la playlist filtrée n'existe plus
  $('plEmpty').hidden = names.length > 0;
  $('plDetail').hidden = !activePl;
  if (!activePl) return;
  const list = plVideos(activePl);
  const missing = playlists[activePl].length - list.length;
  $('plTitle').textContent = activePl;
  $('plInfo').textContent =
    `${list.length} vidéo(s) · ${fmtSize(list.reduce((s, v) => s + v.size, 0))}` +
    (list.some((v) => v.offline) ? ` · ${list.filter((v) => v.offline).length} hors ligne` : '') +
    (missing ? ` · ${missing} fichier(s) introuvable(s)` : '');
  fillVideoList($('plVideos'), list, { withCheckbox: false });
}

async function savePlaylist(name, ids) {
  playlists = await window.playou4.savePlaylist(name, ids);
  autoNames.delete(name); // modifiée à la main : n'est plus automatique
  activePl = name;
  renderPlaylists();
}

// Déplace les fichiers vers un autre dossier/disque ; compteurs et playlists suivent grâce à l'empreinte.
async function moveVideos(all) {
  const list = all.filter((v) => !v.offline);
  if (all.length > list.length) alert(`${all.length - list.length} vidéo(s) hors ligne ignorée(s) : branche le disque pour les déplacer.`);
  if (!list.length) return;
  if (!confirm(`Déplacer ${list.length} fichier(s) vers un autre dossier ou disque ?\nLes compteurs de lecture et les playlists sont conservés.`)) return;
  const video = $('video');
  if (list.some((v) => v.id === current)) {
    video.removeAttribute('src'); // libère le fichier en cours de lecture
    video.load();
  }
  const r = await window.playou4.move(list.map((v) => v.path));
  if (r.canceled) return;
  await reload();
  alert(`${r.moved} fichier(s) déplacé(s) vers ${r.dest}` + (r.failed.length ? `\n\nÉchecs :\n${r.failed.join('\n')}` : ''));
}

// ---- Réglages ------------------------------------------------------------

let lastReach = '';
let exclusionList = []; // sous-dossiers exclus : [{ folder, rel }]
let folderInfos = []; // dossiers sources : [{ path, name, serial, connected… }]
function fillFolders(folders) {
  const infos = (folders || []).map((f) => (typeof f === 'string' ? { path: f, enabled: true, connected: true } : f));
  // Signature des dossiers branchés (support + chemin actuel) : change quand un disque est (dé)branché ou change de lettre.
  folderInfos = infos;
  lastReach = infos.map((f) => (f.enabled && f.connected ? f.path : '')).join('|');
  const online = infos.filter((f) => f.enabled && f.connected).length;
  $('srcSummary').textContent = `Dossiers sources (${online} connecté(s) sur ${infos.length})`;
  const apply = async (list) => {
    fillFolders(list);
    await reload();
  };
  const row = (f, settingsView) => {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'Analyser ce dossier (décocher = ignorer, même branché)';
    cb.checked = f.enabled;
    cb.onchange = async () => apply(await window.playou4.toggleFolder(f.path, cb.checked));
    li.append(cb);
    if (f.serial && settingsView) {
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'volname';
      name.value = f.name || '';
      name.title = 'Nom de ce disque (reconnu par son numéro de série ' + f.serial + ')';
      name.onchange = async () => apply(await window.playou4.renameVolume(f.serial, name.value));
      li.append(name);
    } else if (f.name) {
      const b = document.createElement('b');
      b.textContent = f.name;
      li.append(b);
    }
    const p = document.createElement('span');
    p.textContent = f.path;
    li.append(p);
    const st = document.createElement('span');
    st.className = f.connected ? 'online' : 'absent';
    st.textContent = f.connected ? '● connecté' : '○ hors ligne : fichiers gardés en mémoire';
    li.append(st);
    if (settingsView) {
      const ex = document.createElement('button');
      ex.textContent = 'Exclure un sous-dossier…';
      ex.title = 'Choisir un sous-dossier de ce dossier source à ne plus analyser';
      ex.onclick = async () => {
        const r = await window.playou4.addExclusion(f.path);
        if (r && r.error) return alert(r.error);
        exclusionList = Array.isArray(r) ? r : r.list || exclusionList;
        fillFolders(await window.playou4.folderStatus());
        await reload();
      };
      li.append(ex);
      const rm = document.createElement('button');
      rm.textContent = 'Retirer';
      rm.onclick = async () => apply(await window.playou4.removeFolder(f.path));
      li.append(rm);
    }
    return li;
  };
  const withExclusions = (f) => {
    const li = row(f, true);
    const mine = exclusionList.filter((e) => e.folder === f.path);
    if (mine.length) {
      const ul = document.createElement('ul');
      ul.className = 'exlist';
      for (const e of mine) {
        const item = document.createElement('li');
        const t = document.createElement('span');
        t.textContent = '↳ exclu : ' + e.rel;
        const back = document.createElement('button');
        back.textContent = 'Rétablir';
        back.onclick = async () => {
          exclusionList = await window.playou4.removeExclusion(e.folder, e.rel);
          fillFolders(await window.playou4.folderStatus());
          await reload();
        };
        item.append(t, back);
        ul.append(item);
      }
      li.append(ul);
    }
    return li;
  };
  $('folderList').replaceChildren(...infos.map(withExclusions));
  $('srcList').replaceChildren(...infos.map((f) => row(f, false)));
}

// ---- Barre de progression (analyse des dossiers, déplacements) -------------

let hideTimer;
function showProgress({ label, done, total }) {
  clearTimeout(hideTimer);
  $('progress').hidden = false;
  $('progLabel').textContent = label;
  const fill = $('progFill');
  fill.classList.toggle('indeterminate', !total);
  fill.style.width = total ? `${Math.min(100, (done / total) * 100)}%` : '';
  $('progPct').textContent = total ? `${Math.floor((done / total) * 100)} %` : '';
  if (total && done >= total) hideTimer = setTimeout(() => ($('progress').hidden = true), 800);
}

// ---- À propos / mises à jour ---------------------------------------------

function showUpdate(s) {
  const txt = {
    idle: 'Pas encore vérifié.',
    dev: 'Mode développement : les mises à jour ne fonctionnent que dans la version installée.',
    checking: 'Recherche en cours…',
    none: 'Vous avez la dernière version.',
    downloading: `Téléchargement de la version ${s.version} : ${s.percent ?? 0} %`,
    ready: `La version ${s.version} est prête à être installée.`,
    error: `Mise à jour impossible : ${s.error}`,
  }[s.status];
  $('aboutVersion').textContent = `Version ${s.current}`;
  $('updateStatus').textContent = txt;
  $('updateInstall').hidden = s.status !== 'ready';
  $('updateBanner').hidden = s.status !== 'ready';
  $('updateBanner').textContent = `Mise à jour ${s.version} prête : redémarrer et installer`;
  $('updateCheck').disabled = ['checking', 'downloading'].includes(s.status);
}

async function refreshStoreInfo() {
  $('storePath').textContent = await window.playou4.storeInfo();
}

// ---- Chargement ----------------------------------------------------------

async function reload() {
  $('count').textContent = 'Analyse des dossiers…';
  const res = await window.playou4.list();
  videos = res.videos;
  playlists = res.playlists;
  autoNames = new Set(res.auto || []);
  settings = res.settings;
  fillSmart(settings.smart);
  $('wheelSeconds').value = settings.wheelSeconds;
  $('countPercent').value = settings.countPercent;
  const ids = new Set(videos.map((v) => v.id));
  checked = new Set([...checked].filter((id) => ids.has(id)));
  const au = $('author').value;
  const authors = [...new Set(videos.map((v) => v.creator))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('author').textContent = '';
  $('author').append(new Option('Tous les auteurs', ''), ...authors.map((a) => new Option(a, a)));
  $('author').value = authors.includes(au) ? au : '';
  $('stats').textContent = `${videos.length} vidéo(s) dans la bibliothèque · ${Object.keys(playlists).length} playlist(s)`;
  exclusionList = res.exclusions || [];
  $('excludeNames').value = settings.excludeNames || '';
  fillFolders(res.folders);
  refresh();
  renderPlaylists();
}

// Affiche une vidéo dans la bibliothèque (demandé par You4) : filtres levés, défilement, surbrillance.
async function showFile(p) {
  const same = (v) => v.path.toLowerCase() === String(p).toLowerCase();
  let v = videos.find(same);
  if (!v) {
    await reload(); // fichier récent ou dossier pas encore analysé
    v = videos.find(same);
  }
  if (!v) return alert(`Vidéo introuvable dans la bibliothèque :\n${p}\n\nAjoute son dossier dans les réglages.`);
  $('q').value = '';
  $('author').value = '';
  $('onlyChecked').checked = false;
  $('levelFilter').value = '';
  showTab('library');
  refresh();
  const li = [...$('list').children].find((el) => el.dataset.id === v.id);
  if (!li) return;
  li.scrollIntoView({ block: 'center' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 2500);
}

// Met des vidéos à la Corbeille (récupérables), puis les retire des playlists et de la bibliothèque.
async function deleteVideos(all, fromSelection = false) {
  const list = all.filter((v) => !v.offline);
  if (all.length > list.length) alert(`${all.length - list.length} vidéo(s) hors ligne ignorée(s) : branche le disque pour les supprimer.`);
  if (!list.length) return;
  let msg = list.length === 1 ? 'Mettre « ' + list[0].title + ' » à la Corbeille ?' : 'Mettre ces ' + list.length + ' fichier(s) à la Corbeille ?\n\n' + list.slice(0, 20).map((v) => '• ' + v.creator + ' — ' + v.title).join('\n') + (list.length > 20 ? `\n… et ${list.length - 20} autre(s)` : '');
  if (fromSelection) {
    const shown = new Set(view.map((v) => v.id));
    const hidden = list.filter((v) => !shown.has(v.id)).length;
    if (hidden) msg += `\n\nATTENTION : ${hidden} de ces fichiers sont marqués mais NON affichés (masqués par les filtres).`;
  }
  if (!confirm(msg + '\n\nElles disparaîtront aussi des playlists (récupérables depuis la Corbeille Windows).')) return;
  const video = $('video');
  if (list.some((v) => v.id === current)) {
    video.pause();
    video.removeAttribute('src'); // libère le fichier pour que Windows puisse le supprimer
    video.load();
    current = null;
    setNow(null);
    syncCur();
  }
  const r = await window.playou4.trash(list.map((v) => ({ id: v.id, path: v.path })));
  const gone = new Set(r.deleted);
  queue = queue.filter((v) => !gone.has(v.id));
  checked = new Set([...checked].filter((id) => !gone.has(id)));
  saveChecked();
  if (r.failed.length) alert('Non supprimé :\n' + r.failed.join('\n'));
  await reload();
}

// ---- Suppression des doublons : choix du disque sur lequel on garde les fichiers -------------------

/** Dossier source (et donc disque) qui contient ce fichier. */
function sourceOf(p) {
  const lp = p.toLowerCase();
  return folderInfos.filter((f) => lp.startsWith(f.path.toLowerCase().replace(/[\\/]+$/, '') + '\\')).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
const driveOf = (p) => (/^[A-Za-z]:/.test(p) ? p.slice(0, 2).toUpperCase() : '');
function supportOf(p) {
  const f = sourceOf(p);
  if (!f) return { key: '?', label: 'Autre' };
  return { key: f.serial || f.path, label: (f.name ? f.name + ' ' : '') + (driveOf(f.path) ? '(' + driveOf(f.path) + ')' : f.path) };
}
function folderOf(p) {
  const f = sourceOf(p);
  return f ? { key: f.path, label: f.path } : { key: '?', label: 'Autre' };
}

// ---- Playlists intelligentes ---------------------------------------------------------------

const SM_FLAGS = { byAuthor: 'smAuthor', byKeyword: 'smKeyword', byDuration: 'smDuration', byLanguage: 'smLang', folderAuthors: 'smFolders', auto: 'smAuto' };
const SM_NUMS = { minAuthor: 'smMinAuthor', minKeyword: 'smMinKeyword', maxKeywords: 'smMaxKeywords', shortMax: 'smShort', longMin: 'smLong' };

function fillSmart(o) {
  for (const [k, id] of Object.entries(SM_FLAGS)) $(id).checked = !!o[k];
  for (const [k, id] of Object.entries(SM_NUMS)) $(id).value = o[k];
  $('smIgnore').value = o.ignore || '';
}
function readSmart() {
  const o = {};
  for (const [k, id] of Object.entries(SM_FLAGS)) o[k] = $(id).checked;
  for (const [k, id] of Object.entries(SM_NUMS)) o[k] = Number($(id).value);
  o.ignore = $('smIgnore').value;
  return o;
}

async function runSmart() {
  settings = await window.playou4.setSettings({ smart: readSmart() }); // valeurs corrigées par le main
  fillSmart(settings.smart);
  const { playlists: proposals, counts } = Smart.generate(videos, settings.smart);
  const res = await window.playou4.applyAuto(proposals);
  playlists = res.playlists;
  autoNames = new Set(res.auto);
  renderPlaylists();
  const n = Object.keys(proposals).length;
  $('smMsg').textContent = n
    ? `${n} playlist(s) automatique(s) : ${counts.author} par auteur, ${counts.keyword} par mot-clé, ${counts.duration} par durée, ${counts.language} par langue.`
    : 'Rien à créer avec ces réglages (pas assez de pistes en commun).';
}

// ---- Langue parlée ------------------------------------------------------------------------

let langRunning = false;
let langTimer = null;

async function refreshLangUi() {
  const st = await window.playou4.langStatus();
  langRunning = st.running;
  $('langModel').value = settings.langModel || 'base';
  $('langAuto').checked = !!settings.langAuto;
  const analysed = videos.filter((v) => v.lang).length;
  const fr = videos.filter((v) => v.lang === 'fr').length;
  $('langState').textContent = st.installed
    ? `Moteur installé (${st.model}). ${analysed} vidéo(s) analysée(s) sur ${videos.length}, dont ${fr} en français.`
    : `Moteur non installé (${st.model === 'tiny' ? '≈ 80 Mo' : '≈ 150 Mo'} à télécharger, une seule fois).`;
  $('langInstall').hidden = st.installed;
  for (const id of ['langRun', 'langRunView']) $(id).hidden = !st.installed || st.running;
  $('langStop').hidden = !st.running;
}

async function startLang(list) {
  const items = list.filter((v) => !v.lang && !v.offline).map((v) => ({ id: v.id, path: v.path, duration: v.duration }));
  if (!items.length) { $('langMsg').textContent = 'Rien à analyser : toutes ces vidéos ont déjà une langue.'; return; }
  const r = await window.playou4.langAnalyze(items);
  $('langMsg').textContent = r.started ? `Analyse de ${r.started} vidéo(s) en arrière-plan…` : 'Analyse impossible (moteur absent ou déjà en cours).';
  refreshLangUi();
}

async function initLang() {
  $('langModel').onchange = async () => {
    settings = await window.playou4.setSettings({ langModel: $('langModel').value });
    refreshLangUi();
  };
  $('langAuto').onchange = async () => { settings = await window.playou4.setSettings({ langAuto: $('langAuto').checked }); };
  $('langInstall').onclick = async () => {
    $('langInstall').disabled = true;
    $('langMsg').textContent = 'Téléchargement…';
    const r = await window.playou4.langInstall();
    $('langInstall').disabled = false;
    $('langMsg').textContent = r.ok ? 'Moteur installé.' : `Échec : ${r.error}`;
    refreshLangUi();
  };
  $('langRun').onclick = () => startLang(videos);
  $('langRunView').onclick = () => startLang(view);
  $('langStop').onclick = () => window.playou4.langCancel();
  window.playou4.onLangProgress((p) => {
    if (p.phase === 'analyse') $('langMsg').textContent = `Analyse : ${p.done} / ${p.total}`;
    else $('langMsg').textContent = `${p.phase} : ${p.total ? Math.round((p.done / p.total) * 100) + ' %' : Math.round(p.done / 1048576) + ' Mo'}`;
  });
  window.playou4.onLangResult((r) => {
    const v = byId(r.id);
    if (v) v.lang = r.lang;
    if (!langTimer) langTimer = setTimeout(() => { langTimer = null; refresh(); }, 2000); // pas à chaque résultat
  });
  window.playou4.onLangDone((r) => {
    $('langMsg').textContent = r.cancelled ? `Analyse arrêtée (${r.done} / ${r.total}).` : `Analyse terminée : ${r.total} vidéo(s).`;
    refresh();
    refreshLangUi();
  });
  await refreshLangUi();
  if (settings.langAuto && !langRunning && (await window.playou4.langStatus()).installed) startLang(videos);
}

// Au lancement : un même contenu en plusieurs exemplaires est gardé une seule fois. La copie conservée est celle du
// premier dossier de la liste des sources ; les autres vont à la Corbeille (le main refuse tout fichier hors bibliothèque).
async function cleanDuplicates() {
  const paths = videos.filter((v) => !v.offline).flatMap((v) => (v.dups || []).map((d) => ({ path: d, keep: v.path })));
  if (!paths.length) return;
  const r = await window.playou4.trashCopies(paths);
  if (r.failed.length) alert(['Doublon non supprimé :', ...r.failed].join(String.fromCharCode(10)));
  if (r.deleted) launchNote = `${r.deleted} doublon(s) mis à la Corbeille au lancement`;
  await reload();
}

async function init() {
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  $('q').addEventListener('input', refresh);
  ['author', 'sort', 'onlyChecked', 'onlyToday', 'plFilter', 'durFilter', 'langFilter', 'levelFilter'].forEach((id) => $(id).addEventListener('change', refresh));
  $('listRefresh').onclick = refresh;

  // ---- Menu de sélection (filtres, tri, playlists) : masqué, il s'affiche au survol ; 📌 le garde ouvert ----
  const panel = $('toolsPanel');
  const bar = $('toolsBar');
  let pinned = false;
  let closeTimer = null;
  try {
    pinned = localStorage.getItem('toolsPinned') === '1';
  } catch {}
  const applyPin = () => {
    panel.classList.toggle('pinned', pinned);
    panel.classList.toggle('auto', !pinned);
    panel.classList.remove('open');
    $('toolsToggle').setAttribute('aria-pressed', String(pinned));
  };
  const openMenu = () => {
    if (pinned) return;
    clearTimeout(closeTimer);
    panel.style.top = bar.offsetHeight + 'px'; // collé sous la barre : pas de trou où la souris perdrait le menu
    panel.style.maxHeight = `calc(100% - ${bar.offsetHeight}px)`;
    panel.classList.add('open');
  };
  const keepsOpen = () => {
    // Une liste déroulante ou un champ de recherche qui a le focus garde le menu ouvert (sinon il se fermerait pendant le choix).
    const a = document.activeElement;
    return panel.contains(a) && (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && /^(search|text|number)$/.test(a.type)));
  };
  const scheduleClose = () => {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (bar.matches(':hover') || panel.matches(':hover') || keepsOpen()) return;
      if (panel.contains(document.activeElement)) document.activeElement.blur();
      panel.classList.remove('open');
    }, 450);
  };
  [bar, panel].forEach((el) => {
    el.addEventListener('mouseenter', openMenu);
    el.addEventListener('mouseleave', scheduleClose);
  });
  panel.addEventListener('focusout', () => setTimeout(scheduleClose, 0));
  panel.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT') e.target.blur(); // choix fait : la liste déroulante ne retient plus le menu
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !pinned && panel.classList.contains('open')) {
      if (panel.contains(document.activeElement)) document.activeElement.blur();
      panel.classList.remove('open');
    }
  });
  // Clic : garde le menu affiché (épinglé) ou le replie ; sans clic, il n'apparaît qu'au survol.
  $('toolsToggle').onclick = () => {
    pinned = !pinned;
    try {
      localStorage.setItem('toolsPinned', pinned ? '1' : '0');
    } catch {}
    applyPin();
    if (!pinned) panel.classList.remove('open');
  };
  applyPin();
  $('copyAuthor').onclick = copyAuthor;
  $('selAll').onclick = () => {
    view.forEach((v) => checked.add(v.id));
    saveChecked();
    refresh();
  };
  $('selNone').onclick = () => {
    checked.clear(); // décoche tout, même ce que les filtres masquent
    saveChecked();
    refresh();
  };

  $('plSave').onclick = async () => {
    const name = $('plName').value.trim();
    if (!name || !checked.size) return say(!name ? 'Donne un nom à la playlist.' : 'Coche au moins une vidéo.');
    if (name in playlists && !confirm(`La playlist « ${name} » existe déjà. La remplacer ?`)) return;
    await savePlaylist(name, [...checked]);
    $('plName').value = '';
    say(`Playlist « ${name} » enregistrée (${checked.size} vidéo(s)).`);
  };

  // Ajoute les vidéos cochées à une playlist existante, sans doublon.
  $('plAdd').onclick = async () => {
    const name = $('plTarget').value;
    if (!name) return say('Choisis une playlist.');
    if (!checked.size) return say('Coche au moins une vidéo.');
    const have = new Set(playlists[name]);
    const added = [...checked].filter((id) => !have.has(id));
    if (!added.length) return say(`Déjà toutes dans « ${name} ».`);
    await savePlaylist(name, [...playlists[name], ...added]);
    say(`${added.length} vidéo(s) ajoutée(s) à « ${name} ».`);
  };

  $('plPlay').onclick = () => playList(plVideos(activePl));
  $('plShow').onclick = () => {
    $('plFilter').value = activePl;
    $('onlyChecked').checked = false;
    refresh();
    showTab('library');
  };
  $('plLoad').onclick = () => {
    checked = new Set(plVideos(activePl).map((v) => v.id));
    saveChecked();
    $('onlyChecked').checked = true;
    refresh();
    showTab('library');
  };
  $('plUpdate').onclick = async () => {
    if (!checked.size) return;
    if (!confirm(`Remplacer le contenu de « ${activePl} » par les ${checked.size} vidéo(s) cochée(s) ?`)) return;
    await savePlaylist(activePl, [...checked]);
  };
  $('plMove').onclick = () => moveVideos(plVideos(activePl));
  $('plDel').onclick = async () => {
    if (!confirm(`Supprimer la playlist « ${activePl} » ? (les vidéos restent sur le disque)`)) return;
    playlists = await window.playou4.deletePlaylist(activePl);
    activePl = '';
    renderPlaylists();
  };

  window.playou4.onProgress(showProgress);
  window.playou4.onUpdate(showUpdate);
  window.playou4.appInfo().then((i) => showUpdate(i.update));
  $('updateCheck').onclick = () => window.playou4.checkUpdate();
  $('updateInstall').onclick = $('updateBanner').onclick = () => window.playou4.installUpdate();
  refreshStoreInfo();
  $('storeReveal').onclick = () => window.playou4.storeReveal();
  $('logReveal').onclick = () => window.playou4.logReveal();
  $('storeOpen').onclick = async () => {
    const r = await window.playou4.storeOpen();
    if (r.canceled) return;
    if (r.error) return alert(r.error);
    activePl = '';
    await refreshStoreInfo();
    await reload();
  };
  $('storeSaveAs').onclick = async () => {
    const r = await window.playou4.storeSaveAs();
    if (r.canceled) return;
    await refreshStoreInfo();
    alert(`Fichier de playlists déplacé vers :\n${r.path}\n\nL'ancien fichier (${r.old}) n'est pas supprimé.`);
  };

  $('excludeNames').onchange = async () => {
    settings = await window.playou4.setSettings({ excludeNames: $('excludeNames').value });
    await reload();
  };
  $('addFolder').onclick = async () => {
    fillFolders(await window.playou4.addFolder());
    await reload();
  };

  // Des vidéos cochées : on lit cette sélection. Aucune cochée : on lit la liste affichée (avec Aléatoire, au hasard dedans).
  $('playSel').onclick = () => {
    const sel = videos.filter((v) => checked.has(v.id)).sort(sorters[$('sort').value]);
    if (sel.length) playList(sel, 'selection');
    else playList(view, 'library');
  };
  $('next').onclick = () => step(1);
  $('prev').onclick = () => step(-1);
  $('srcRefresh').onclick = reload;
  // Au retour dans la fenêtre : si un disque a été (re)branché ou débranché, la bibliothèque se met à jour.
  window.addEventListener('focus', async () => {
    const f = await window.playou4.folderStatus();
    if (f.map((x) => x.enabled && x.exists).join() !== lastReach) {
      fillFolders(f);
      await reload();
    }
  });
  $('srcAdd').onclick = async () => {
    fillFolders(await window.playou4.addFolder());
    await reload();
  };
  $('del').onclick = () => {
    const v = byId(current);
    if (v) deleteVideos([v]);
  };
  $('selDelete').onclick = () => deleteVideos(videos.filter((v) => v.rating === 1), true);
  $('showDel').onclick = () => {
    $('levelFilter').value = $('levelFilter').value === '1' ? '' : '1';
    refresh();
  };
  $('reveal').onclick = () => {
    const v = byId(current);
    if (v) window.playou4.reveal(v.path);
  };
  const video = $('video');
  video.addEventListener('ended', () => step(autoDir || 1));
  $('dirUp').onclick = () => setAutoDir(-1);
  $('dirDown').onclick = () => setAutoDir(1);

  // Réglages de lecture : enregistrés à chaque modification, la valeur corrigée par le main est réaffichée.
  for (const key of ['wheelSeconds', 'countPercent']) {
    $(key).onchange = async () => {
      settings = await window.playou4.setSettings({ [key]: $(key).value });
      $(key).value = settings[key];
    };
  }

  // Molette sur la vidéo : bas = avance, haut = recule, de `wheelSeconds` par cran (le pavé tactile cumule les petits pas).
  let wheelAcc = 0;
  video.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!video.duration) return;
      wheelAcc += e.deltaY;
      const notches = Math.trunc(wheelAcc / 100);
      if (!notches) return;
      wheelAcc -= notches * 100;
      video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + notches * settings.wheelSeconds));
    },
    { passive: false }
  );
  video.addEventListener('timeupdate', () => {
    if (current && Date.now() - lastSaveAt > 2000) {
      lastSaveAt = Date.now();
      saveLast(current, video.currentTime);
    }
    if (!counted && video.duration > 0 && video.currentTime / video.duration >= settings.countPercent / 100) countPlay();
  });

  // ---- Barre de lecture (en haut du lecteur) : remplace les contrôles intégrés, qui restent toujours en bas ----
  const seek = $('vSeek');
  let seeking = false;
  const sync = () => {
    const d = video.duration;
    const ready = Number.isFinite(d) && d > 0;
    seek.disabled = !ready;
    if (!seeking) seek.value = ready ? Math.round((video.currentTime / d) * 1000) : 0;
    $('vTime').textContent = ready ? `${fmtDur(video.currentTime)} / ${fmtDur(d)}` : '0:00 / 0:00';
    $('vPlay').textContent = video.paused || video.ended ? '▶' : '⏸';
    $('vMute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
    if (document.activeElement !== $('vVol')) $('vVol').value = video.muted ? 0 : Math.round(video.volume * 100);
    $('vRate').value = String(video.playbackRate);
  };
  ['timeupdate', 'durationchange', 'loadedmetadata', 'emptied', 'play', 'pause', 'ended', 'volumechange', 'ratechange'].forEach((n) => video.addEventListener(n, sync));
  seek.addEventListener('input', () => {
    seeking = true;
    if (video.duration > 0) video.currentTime = (seek.value / 1000) * video.duration;
  });
  seek.addEventListener('change', () => {
    seeking = false;
    sync();
  });
  const togglePlay = () => {
    if (!video.currentSrc) return;
    if (video.paused) video.play();
    else video.pause();
  };
  $('vPlay').onclick = togglePlay;
  $('vPrev').onclick = () => step(-1);
  $('vNext').onclick = () => step(1);
  $('vSel').onclick = (e) => {
    e.target.blur();
    if (!current) return;
    if (checked.has(current)) checked.delete(current);
    else checked.add(current);
    saveChecked();
    const cb = document.querySelector(`.vlist li[data-id="${current}"] input`);
    if (cb) cb.checked = checked.has(current);
    count();
  };
  // Barre de niveaux : clic ou glissement (enregistré au relâchement), flèches du clavier (enregistrées tout de suite).
  const lvl = $('vLevel');
  const levelAt = (x) => {
    const r = lvl.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (x - r.left - 6) / (r.width - 12))) * 4) + 1;
  };
  let lvDrag = null;
  lvl.addEventListener('pointerdown', (e) => {
    if (!current) return;
    lvDrag = levelAt(e.clientX);
    lvl.setPointerCapture(e.pointerId);
    drawLevel(lvDrag);
  });
  lvl.addEventListener('pointermove', (e) => {
    if (lvDrag === null) return;
    const n = levelAt(e.clientX);
    if (n !== lvDrag) { lvDrag = n; drawLevel(n); }
  });
  lvl.addEventListener('pointerup', () => {
    if (lvDrag !== null && current) setLevel(current, lvDrag);
    lvDrag = null;
  });
  lvl.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    const v = current ? byId(current) : null;
    if (!v || (!k && e.key !== 'Home' && e.key !== 'End')) return;
    e.preventDefault();
    e.stopPropagation(); // les flèches ne doivent pas aussi avancer la vidéo
    setLevel(current, e.key === 'Home' ? 1 : e.key === 'End' ? 5 : Math.min(5, Math.max(1, (v.rating || 3) + k)));
  });
  video.addEventListener('click', togglePlay);
  $('vMute').onclick = () => (video.muted = !video.muted);
  $('vVol').addEventListener('input', () => {
    video.muted = false;
    video.volume = $('vVol').value / 100;
    try {
      localStorage.setItem('volume', String(video.volume));
    } catch {}
  });
  $('vRate').onchange = () => (video.playbackRate = Number($('vRate').value));
  // Plein écran sur le conteneur (et non sur la vidéo) pour garder la barre visible, en haut.
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : $('stage').requestFullscreen());
  $('vFull').onclick = toggleFull;
  video.addEventListener('dblclick', toggleFull);
  let idleTimer = null;
  $('stage').addEventListener('mousemove', () => {
    $('stage').classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.fullscreenElement && $('stage').classList.add('idle'), 2500);
  });
  document.addEventListener('fullscreenchange', () => $('stage').classList.remove('idle'));
  // Clavier (hors champs de saisie) : Espace = lecture/pause, flèches = ±5 s.
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement && document.activeElement.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && video.duration > 0) {
      e.preventDefault();
      video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + (e.code === 'ArrowRight' ? 5 : -5)));
    }
  });
  try {
    const vol = Number(localStorage.getItem('volume'));
    if (localStorage.getItem('volume') !== null && vol >= 0 && vol <= 1) video.volume = vol;
  } catch {}
  sync();

  $('smRun').onclick = runSmart;
  $('smClear').onclick = async () => {
    if (!autoNames.size) return;
    if (!confirm(`Supprimer les ${autoNames.size} playlist(s) automatique(s) ? (les fichiers et tes playlists restent)`)) return;
    const res = await window.playou4.clearAuto();
    playlists = res.playlists;
    autoNames = new Set(res.auto);
    activePl = '';
    renderPlaylists();
    $('smMsg').textContent = 'Playlists automatiques supprimées.';
  };
  for (const id of [...Object.values(SM_FLAGS), ...Object.values(SM_NUMS), 'smIgnore']) {
    $(id).onchange = async () => {
      settings = await window.playou4.setSettings({ smart: readSmart() });
      fillSmart(settings.smart);
    };
  }
  window.playou4.onShowFile(showFile);
  await reload();
  if (legacyDelete.length) {
    const map = {};
    for (const id of legacyDelete) if (byId(id) && !byId(id).rating) map[id] = 1;
    if (Object.keys(map).length) {
      await window.playou4.setRating(map);
      await reload();
    }
    try { localStorage.removeItem('toDelete'); } catch {}
  }
  await cleanDuplicates();
  await initLang();
  if (settings.smart.auto) runSmart(); // régénération au lancement
  // Retour sur la dernière vidéo lue, à la même position, en pause.
  try {
    const last = JSON.parse(localStorage.getItem('lastPlayed') || 'null');
    const v = last && byId(last.id);
    if (v && !v.offline) {
      queue = view.filter((x) => !x.offline);
      queueSource = 'library';
      play(v, false, last.t || 0);
    }
  } catch {}
  window.addEventListener('beforeunload', () => current && saveLast(current, $('video').currentTime));
  const pending = await window.playou4.showPending();
  if (pending) showFile(pending);
}
init();
