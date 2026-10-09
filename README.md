# Playou4

Application desktop Windows (Electron) — Hawkus Corp.
Lecteur de vidéos mp4, compagnon de [You4](../You4) : lit les vidéos téléchargées par You4 et tous les mp4 des dossiers choisis.

## Fonctions

- **Bibliothèque** : tri (date, auteur, titre, taille, nombre de lectures), filtres (recherche, auteur), cases à cocher.
- **Playlists** : enregistrer la sélection, lire, mettre à jour, supprimer, et **déplacer la playlist** vers un autre dossier ou disque.
- **Playlists intelligentes** : le moteur (`src/smart.js`) crée et range des playlists « Auto · … » par **auteur**, par **mots du titre** (mots fréquents, hors mots vides) et par **durée** (courtes / moyennes / longues, seuils réglables). Une vidéo peut être dans plusieurs playlists. Les playlists manuelles ne sont jamais modifiées ; mise à jour manuelle ou automatique au lancement. La durée est lue dans l'en-tête du fichier (`src/duration.js`) et mise en cache. Les noms de dossiers ne sont pas des auteurs par défaut (option), et une liste d'exclusion (auteurs, dossiers ou mots, `*` = joker) écarte ce qu'on ne veut pas.
- **Suppression** : bouton « Supprimer » (vidéo en cours) et « Supprimer la sélection » (cases cochées) : les fichiers vont à la **Corbeille Windows** (récupérables) et disparaissent des playlists, compteurs et caches.
- **Dossiers sources multiples** : chaque dossier se coche / décoche (bibliothèque et Réglages). Les **doublons** entre dossiers (même contenu, empreinte identique) sont repérés (badge ⧉, filtre « Doublons », bouton pour mettre les copies en trop à la Corbeille en gardant celle du premier dossier).
- **Supports reconnus par leur numéro de série** (`src/volumes.js`) : chaque disque est identifié par le numéro de série de son volume, qu'on peut nommer (Réglages). À l'ouverture, à l'actualisation et au retour dans la fenêtre, Playou4 voit tout seul s'il est branché, même si sa lettre de lecteur a changé (E: devient F:) : le dossier, le catalogue et le cache sont réécrits en conséquence. Plus de case à cocher à chaque fois ; un autre disque qui prend la même lettre n'est jamais confondu.
- **Disques externes** : un disque débranché ou lent ne bloque rien (délai de 3 s). Ses vidéos restent dans la bibliothèque et les playlists, grisées « hors ligne » (catalogue conservé), et se réactivent au rebranchement (rafraîchissement automatique au retour dans la fenêtre).
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
