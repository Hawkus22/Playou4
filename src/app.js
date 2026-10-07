const $ = (id) => document.getElementById(id);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR');
const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' Go' : Math.round(b / 1048576) + ' Mo');
const subline = (v) => `${v.creator} · ${fmtDate(v.date)} · ${fmtSize(v.size)} · ▶ ${v.plays}`;

let videos = [];
let view = []; // liste filtrée/triée de la bibliothèque
let queue = []; // ordre de lecture en cours
let current = null; // id en lecture
let counted = false; // lecture courante déjà comptée
let checked = new Set();
let playlists = {};
let activePl = ''; // playlist affichée dans l'onglet Playlists
let settings = { wheelSeconds: 10, countPercent: 80 };

try {
  checked = new Set(JSON.parse(localStorage.getItem('checked') || '[]'));
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
      li.append(cb);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = v.title;
    t.title = v.title + '\n' + v.path;
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = subline(v);
    meta.append(t, s);
    li.append(meta);
    li.onclick = () => {
      queue = list.slice();
      play(v);
    };
    ul.append(li);
  }
}

function refresh() {
  const q = $('q').value.trim().toLowerCase();
  const au = $('author').value;
  view = videos
    .filter((v) => {
      if (au && v.creator !== au) return false;
      if (q && !(v.title + ' ' + v.creator).toLowerCase().includes(q)) return false;
      if ($('onlyChecked').checked && !checked.has(v.id)) return false;
      return true;
    })
    .sort(sorters[$('sort').value]);
  fillVideoList($('list'), view, { withCheckbox: true });
  count();
}

function count() {
  const n = videos.filter((v) => checked.has(v.id)).length;
  $('count').textContent = `${view.length} vidéo(s) affichée(s) sur ${videos.length} · ${n} cochée(s)`;
}

function say(msg) {
  $('plMsg').textContent = msg;
}

// ---- Lecture ---------------------------------------------------------------

function play(v) {
  current = v.id;
  counted = false;
  $('video').src = v.url;
  $('video').play();
  $('now').textContent = `${v.creator} — ${v.title}`;
  document.querySelectorAll('.vlist li').forEach((li) => li.classList.toggle('playing', li.dataset.id === current));
}

function step(dir) {
  if (!queue.length) return;
  let i = queue.findIndex((v) => v.id === current);
  if ($('shuffle').checked && dir > 0) i = Math.floor(Math.random() * queue.length);
  else i += dir;
  if (i >= 0 && i < queue.length) play(queue[i]);
}

function playList(list) {
  queue = list.slice();
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
    li.className = name === activePl ? 'active' : '';
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
  $('plEmpty').hidden = names.length > 0;
  $('plDetail').hidden = !activePl;
  if (!activePl) return;
  const list = plVideos(activePl);
  const missing = playlists[activePl].length - list.length;
  $('plTitle').textContent = activePl;
  $('plInfo').textContent =
    `${list.length} vidéo(s) · ${fmtSize(list.reduce((s, v) => s + v.size, 0))}` +
    (missing ? ` · ${missing} fichier(s) introuvable(s)` : '');
  fillVideoList($('plVideos'), list, { withCheckbox: false });
}

async function savePlaylist(name, ids) {
  playlists = await window.playou4.savePlaylist(name, ids);
  activePl = name;
  renderPlaylists();
}

// Déplace les fichiers vers un autre dossier/disque ; compteurs et playlists suivent grâce à l'empreinte.
async function moveVideos(list) {
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

function fillFolders(folders) {
  const ul = $('folderList');
  ul.textContent = '';
  for (const f of folders) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = 'Retirer';
    b.onclick = async () => {
      fillFolders(await window.playou4.removeFolder(f));
      await reload();
    };
    li.append(f, b);
    ul.append(li);
  }
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
  settings = res.settings;
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
  showTab('library');
  refresh();
  const li = [...$('list').children].find((el) => el.dataset.id === v.id);
  if (!li) return;
  li.scrollIntoView({ block: 'center' });
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 2500);
}

async function init() {
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  ['q', 'author', 'sort', 'onlyChecked'].forEach((id) => $(id).addEventListener('input', refresh));
  $('selAll').onclick = () => {
    view.forEach((v) => checked.add(v.id));
    saveChecked();
    refresh();
  };
  $('selNone').onclick = () => {
    view.forEach((v) => checked.delete(v.id));
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

  $('addFolder').onclick = async () => {
    fillFolders(await window.playou4.addFolder());
    await reload();
  };

  $('playSel').onclick = () => playList(videos.filter((v) => checked.has(v.id)).sort(sorters[$('sort').value]));
  $('next').onclick = () => step(1);
  $('prev').onclick = () => step(-1);
  $('reveal').onclick = () => {
    const v = byId(current);
    if (v) window.playou4.reveal(v.path);
  };
  const video = $('video');
  video.addEventListener('ended', () => step(1));

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
    if (!counted && video.duration > 0 && video.currentTime / video.duration >= settings.countPercent / 100) countPlay();
  });

  window.playou4.onShowFile(showFile);
  await reload();
  const pending = await window.playou4.showPending();
  if (pending) showFile(pending);
}
init();
