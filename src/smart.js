// Moteur de playlists intelligentes : regroupe la bibliothèque par auteur, mots du titre et durée.
// Une vidéo peut figurer dans plusieurs playlists. Module sans dépendance (navigateur et Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Smart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PREFIX = 'Auto · ';

  const DEFAULTS = {
    byAuthor: true,
    byKeyword: true,
    byDuration: true,
    minAuthor: 2, // vidéos minimum pour une playlist d'auteur
    minKeyword: 3, // vidéos minimum pour une playlist de mot-clé
    maxKeywords: 20, // nombre maximum de playlists de mots-clés
    shortMax: 5, // minutes : en dessous = « courtes »
    longMin: 20, // minutes : à partir de = « longues »
    auto: false, // régénération automatique au lancement
  };

  // Mots trop courants pour être des thèmes (français, anglais, remplissage fréquent dans les titres).
  const STOP = new Set(
    (
      'le la les un une des du de dans sur sous avec sans pour par aux au en et ou ni mais donc car que qui quoi dont ' +
      'ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs il elle ils elles nous vous ' +
      'je tu moi toi lui eux est sont etait etre avoir fait faire comme plus moins tres tout tous toute toutes ' +
      'the and for with from this that these those you your our their his her its are was were been have has had ' +
      'not but all any can will just into out over under more most very about after before ' +
      'video videos part partie episode ep hd full new best top official officiel clip live version extrait ' +
      'pendant apres avant entre chez vers depuis alors aussi encore ainsi bien tres meme autre autres deux trois'
    ).split(/\s+/)
  );

  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Mots significatifs d'un texte : [{ key, shown }], sans doublon. */
  function words(text) {
    const out = new Map();
    for (const raw of String(text).split(/[^\p{L}\p{N}]+/u)) {
      if (!raw) continue;
      let key = fold(raw);
      if (key.length < 3 || /^\d+$/.test(key) || STOP.has(key)) continue;
      if (key.length > 4 && key.endsWith('s') && !key.endsWith('ss')) key = key.slice(0, -1); // pluriel simple
      if (STOP.has(key) || out.has(key)) continue;
      out.set(key, raw);
    }
    return out;
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  /**
   * videos : [{ id, title, creator, duration (secondes, 0 = inconnue) }]
   * Retourne { playlists: { nom: [ids] }, counts: { author, keyword, duration } }.
   */
  function generate(videos, options) {
    const o = { ...DEFAULTS, ...(options || {}) };
    const playlists = {};
    const counts = { author: 0, keyword: 0, duration: 0 };
    const seen = new Set(); // signatures de contenu : pas deux playlists identiques
    const add = (kind, name, ids) => {
      const sig = [...ids].sort().join('|');
      if (!ids.length || seen.has(sig)) return;
      seen.add(sig);
      playlists[PREFIX + name] = ids;
      counts[kind]++;
    };

    // Durée
    if (o.byDuration) {
      const known = videos.filter((v) => v.duration > 0);
      const short = known.filter((v) => v.duration < o.shortMax * 60).map((v) => v.id);
      const long = known.filter((v) => v.duration >= o.longMin * 60).map((v) => v.id);
      const mid = known.filter((v) => v.duration >= o.shortMax * 60 && v.duration < o.longMin * 60).map((v) => v.id);
      add('duration', `Durée · Courtes (moins de ${o.shortMax} min)`, short);
      add('duration', `Durée · Moyennes (${o.shortMax} à ${o.longMin} min)`, mid);
      add('duration', `Durée · Longues (${o.longMin} min et plus)`, long);
    }

    // Auteur
    const authorKeys = new Set();
    if (o.byAuthor) {
      const by = new Map();
      for (const v of videos) {
        if (!v.creator || v.creator === 'Inconnu') continue;
        if (!by.has(v.creator)) by.set(v.creator, []);
        by.get(v.creator).push(v.id);
      }
      for (const [name, ids] of [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))) {
        if (ids.length >= o.minAuthor) add('author', `Auteur · ${name}`, ids);
      }
    }
    // Les mots d'un nom d'auteur ne sont pas des thèmes (évite « Auto · Mot-clé · Dupont » en doublon).
    for (const v of videos) for (const k of words(v.creator || '').keys()) authorKeys.add(k);

    // Mots du titre
    if (o.byKeyword && videos.length) {
      const df = new Map(); // mot -> { ids, forms }
      for (const v of videos) {
        for (const [key, shown] of words(v.title)) {
          if (authorKeys.has(key)) continue;
          if (!df.has(key)) df.set(key, { ids: [], forms: new Map() });
          const e = df.get(key);
          e.ids.push(v.id);
          const form = shown.toLowerCase(); // forme d'origine (accents conservés) pour l'affichage
          e.forms.set(form, (e.forms.get(form) || 0) + 1);
        }
      }
      const maxShare = Math.max(o.minKeyword, Math.floor(videos.length * 0.5)); // un mot présent partout ne trie rien
      const ranked = [...df]
        .filter(([, e]) => e.ids.length >= o.minKeyword && e.ids.length <= maxShare)
        .sort((a, b) => b[1].ids.length - a[1].ids.length || a[0].localeCompare(b[0], 'fr'))
        .slice(0, o.maxKeywords);
      for (const [, e] of ranked) {
        const best = [...e.forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0];
        add('keyword', `Mot-clé · ${cap(best)}`, e.ids);
      }
    }

    return { playlists, counts };
  }

  return { generate, words, DEFAULTS, PREFIX };
});
