const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('playou4', {
  list: call('library:list'),
  reveal: call('library:reveal'),
  addFolder: call('folders:add'),
  removeFolder: call('folders:remove'),
  savePlaylist: call('playlists:save'),
  deletePlaylist: call('playlists:delete'),
  addPlay: call('plays:add'),
  move: call('playlist:move'),
  storeInfo: call('store:info'),
  storeReveal: call('store:reveal'),
  storeOpen: call('store:open'),
  storeSaveAs: call('store:saveAs'),
  setSettings: call('settings:set'),
  appInfo: call('app:info'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
