// Supports (disques) : chaque dossier source est rattaché au numéro de série de son volume, ce qui permet
// de savoir si le disque est branché même quand sa lettre de lecteur change (E: devient F:, etc.).
const path = require('path');

const driveRoot = (p) => (/^[A-Za-z]:([\\/]|$)/.test(p) ? p.slice(0, 2).toUpperCase() + '\\' : null);

/** Remplace le préfixe `from` de `p` par `to` (insensible à la casse), sinon rend `p` inchangé. */
function relocate(p, from, to) {
  const lp = p.toLowerCase();
  const lf = from.toLowerCase();
  if (lp === lf) return to;
  const prefix = lf.endsWith(path.sep) ? lf : lf + path.sep;
  if (lp.startsWith(prefix)) return to.replace(/[\\/]+$/, '') + path.sep + p.slice(prefix.length);
  return p;
}

/** Le dossier a changé de lettre de lecteur : on met à jour la liste, le catalogue et le cache d'empreintes. */
function relocateFolder(store, from, to) {
  store.folders = [...new Set(store.folders.map((f) => (f === from ? to : f)))];
  if (store.folderVol[from]) {
    store.folderVol[to] = store.folderVol[from];
    delete store.folderVol[from];
  }
  store.disabledFolders = store.disabledFolders.map((f) => (f === from ? to : f));
  if (Array.isArray(store.exclusions)) store.exclusions = store.exclusions.map((e) => (e.folder === from ? { ...e, folder: to } : e)); // sous-dossiers exclus : relatifs au dossier source
  for (const c of Object.values(store.catalog)) {
    if (c.folder === from) {
      c.folder = to;
      c.path = relocate(c.path, from, to);
    }
  }
  const cache = {};
  for (const [k, v] of Object.entries(store.fpCache)) cache[relocate(k, from, to)] = v;
  store.fpCache = cache;
}

/**
 * store   : { folders, disabledFolders, folderVol, volumes, catalog, fpCache } (modifié sur place)
 * mounted : Map(numéro de série -> [racines, ex. 'F:\\']) des volumes branchés en ce moment
 * reachable : async (chemin) => booléen, pour les dossiers sans support connu (réseau, etc.)
 * Retourne { infos: [{ path, enabled, connected, serial, name }], changed } ; `changed` = le store a été modifié.
 */
async function resolveSources(store, mounted, reachable) {
  const infos = [];
  let changed = false;
  for (const f of [...store.folders]) {
    let meta = store.folderVol[f];
    const root = driveRoot(f);
    if (!meta && root) {
      // Premier passage : on retient le support actuellement derrière cette lettre.
      for (const [serial, roots] of mounted) {
        if (roots.some((r) => r.toLowerCase() === root.toLowerCase())) {
          meta = { serial, rel: f.slice(3) };
          store.folderVol[f] = meta;
          changed = true;
          break;
        }
      }
    }
    let cur = f;
    let connected;
    if (meta) {
      const roots = mounted.get(meta.serial);
      if (roots && roots.length) {
        // Même support sous une autre lettre : on suit le support, pas la lettre.
        const nowRoot = roots.find((r) => root && r.toLowerCase() === root.toLowerCase()) || roots[0];
        const np = meta.rel ? nowRoot + meta.rel : nowRoot;
        if (np.toLowerCase() !== f.toLowerCase()) {
          relocateFolder(store, f, np);
          cur = np;
          changed = true;
        }
        // Disque branché mais dossier introuvable (renommé, déplacé…) : « hors ligne », ses pistes restent en mémoire.
        connected = await reachable(cur);
      } else {
        connected = false; // support absent (ou lettre prise par un autre disque)
      }
    } else {
      connected = await reachable(f);
    }
    infos.push({
      path: cur,
      enabled: !store.disabledFolders.includes(cur),
      connected,
      serial: meta ? meta.serial : null,
      name: meta ? (store.volumes[meta.serial] || {}).name || null : null,
    });
  }
  return { infos, changed };
}

/** Numéros de série des supports utilisés par les dossiers mais qui n'ont pas encore de nom. */
function unnamedSerials(store) {
  const out = new Set();
  for (const m of Object.values(store.folderVol)) if (!(store.volumes[m.serial] && store.volumes[m.serial].name)) out.add(m.serial);
  return [...out];
}

module.exports = { driveRoot, relocate, resolveSources, unnamedSerials };
