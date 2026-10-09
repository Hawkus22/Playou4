# Playou4

Application desktop Windows (Electron) — Hawkus Corp.
Lecteur de vidéos mp4, compagnon de [You4](../You4) : lit les vidéos téléchargées par You4 et tous les mp4 des dossiers choisis.

## Fonctions

- **Bibliothèque** : tri (date, auteur, titre, taille, nombre de lectures), filtres (recherche, auteur), cases à cocher.
- **Playlists** : enregistrer la sélection, lire, mettre à jour, supprimer, et **déplacer la playlist** vers un autre dossier ou disque.
- **Playlists intelligentes** : le moteur (`src/smart.js`) crée et range des playlists « Auto · … » par **auteur**, par **mots du titre** (mots fréquents, hors mots vides) et par **durée** (courtes / moyennes / longues, seuils réglables). Une vidéo peut être dans plusieurs playlists. Les playlists manuelles ne sont jamais modifiées ; mise à jour manuelle ou automatique au lancement. La durée est lue dans l'en-tête du fichier (`src/duration.js`) et mise en cache.
- **Compteur de lectures** par vidéo (seuil réglable, 80 % par défaut), conservé après déplacement : les vidéos sont identifiées par une empreinte de leur contenu, pas par leur chemin.
- **Réglages** : dossiers analysés (sous-dossiers inclus), emplacement du fichier de playlists (ouvrir un autre fichier / le déplacer).
- **À propos** : version et mise à jour automatique via GitHub Releases.

## Lancer

```
npm install
npm start          # lance l'application
npm run icon       # régénère assets/icon.png depuis le SVG de scripts/make-icon.js
npm run dist       # installeur Windows -> release/Playou4-Setup-x.y.z.exe
npm run release    # publie la version de package.json sur GitHub Releases
```

Node 22+ requis (`node:sqlite` pour lire l'historique de You4, en lecture seule).

## Architecture

| Fichier | Rôle |
|---|---|
| `src/main.js` | fenêtre, analyse des dossiers, empreintes, playlists, déplacements, fichier de données, IPC |
| `src/updater.js` | mise à jour automatique (electron-updater) |
| `src/preload.js` | API exposée à l'interface (`window.playou4`) |
| `src/index.html`, `style.css`, `app.js` | interface (sans framework) |
| `scripts/` | lancement, icône, publication |

Données utilisateur : `%APPDATA%\playou4\` (`store.json` = playlists, compteurs, dossiers ; `config.json` = emplacement de ce fichier).

## Publier une nouvelle version

```
git add -A && git commit -m "..." && git push
npm version patch          # 0.1.0 -> 0.1.1 (crée aussi le tag git ; minor/major au besoin)
git push --follow-tags
npm run release            # construit l'installeur et crée la Release GitHub (gh requis)
```

Les installations existantes détectent la Release au prochain lancement (onglet À propos). L'exe n'est pas signé : SmartScreen affiche un avertissement à la première installation. Le dépôt doit être **public** pour que la mise à jour fonctionne sans jeton.
