// Génère assets/icon.png (512x512) à partir d'un SVG, en utilisant Electron pour le rendu.
// Usage : npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="1" stop-color="#2fb8ff"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#shine)"/>
  <!-- écran vidéo -->
  <rect x="72" y="104" width="368" height="228" rx="36" fill="#14161c"/>
  <!-- triangle "play" -->
  <path d="M222 156 L222 280 Q222 300 239 290 L336 232 Q351 222 336 212 L239 154 Q222 144 222 156 Z" fill="#fff"/>
  <!-- lignes de playlist -->
  <g stroke="#fff" stroke-width="22" stroke-linecap="round">
    <path d="M96 380 H300"/>
    <path d="M96 430 H236" stroke-opacity="0.7"/>
  </g>
  <!-- coche : élément de la playlist -->
  <path d="M340 396 L368 424 L420 366" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), svg.trim());
  console.log('Icône écrite :', out);
  app.quit();
});
