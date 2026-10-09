// Suppression des doublons : l'utilisateur choisit le disque (ou, à défaut, le dossier) sur lequel il GARDE les fichiers ;
// les copies des autres endroits partent à la Corbeille. Module sans dépendance (navigateur et Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dedupe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * groups : [{ copies: [chemins], size, title }] — `copies` contient au moins 2 chemins du même contenu.
   * keyOf  : chemin -> { key, label } (le support, ou le dossier source, qui contient ce fichier).
   */

  /** Pour chaque support : nombre de copies qu'il contient dans ces groupes, et leur taille. */
  function summarize(groups, keyOf) {
    const m = new Map();
    for (const g of groups) {
      for (const c of g.copies) {
        const k = keyOf(c);
        if (!m.has(k.key)) m.set(k.key, { key: k.key, label: k.label, files: 0, bytes: 0 });
        const e = m.get(k.key);
        e.files++;
        e.bytes += g.size || 0;
      }
    }
    return [...m.values()].sort((a, b) => b.files - a.files || a.label.localeCompare(b.label, 'fr'));
  }

  /**
   * Plan de suppression si l'on garde les fichiers sur `keepKey` :
   * - dans chaque groupe, on garde UNE copie : la première trouvée sur `keepKey` ;
   * - si le groupe n'a aucune copie sur `keepKey`, on garde sa première copie (rien n'est perdu) et on le compte dans `fallback` ;
   * - toutes les autres copies (y compris une 2e copie sur `keepKey`) sont à supprimer.
   * Retourne { paths, bytes, fallback, groups }.
   */
  function plan(groups, keyOf, keepKey) {
    const paths = [];
    let bytes = 0;
    let fallback = 0;
    for (const g of groups) {
      const onKeep = g.copies.filter((c) => keyOf(c).key === keepKey);
      if (!onKeep.length) fallback++;
      const kept = onKeep[0] || g.copies[0];
      for (const c of g.copies) {
        if (c === kept) continue;
        paths.push(c);
        bytes += g.size || 0;
      }
    }
    return { paths, bytes, fallback, groups: groups.length };
  }

  /** Choisit le niveau de choix : par disque s'il y en a plusieurs, sinon par dossier source. */
  function pickKeyOf(groups, supportOf, folderOf) {
    const supports = new Set(groups.flatMap((g) => g.copies.map((c) => supportOf(c).key)));
    return supports.size > 1 ? { keyOf: supportOf, level: 'disque' } : { keyOf: folderOf, level: 'dossier' };
  }

  return { summarize, plan, pickKeyOf };
});
