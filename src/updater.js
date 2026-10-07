// Mise à jour automatique via GitHub Releases (electron-updater), même principe que You4.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let state = { status: 'idle', current: app.getVersion() };
let notify = () => {};

function set(patch) {
  state = { ...state, ...patch, current: app.getVersion() };
  notify(state);
}

function initUpdater(onState) {
  notify = onState;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }));
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'none', version: undefined }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, percent: 100 }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: e.message }));
}

async function checkForUpdate() {
  if (!app.isPackaged) {
    set({ status: 'dev' }); // pas de mise à jour depuis « npm start »
    return state;
  }
  if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* déjà remonté par l'évènement 'error' */
  }
  return state;
}

function installUpdate() {
  if (state.status === 'ready') autoUpdater.quitAndInstall(false, true);
}

const getState = () => state;

module.exports = { initUpdater, checkForUpdate, installUpdate, getState };
