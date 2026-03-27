const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectPet: (petData) => ipcRenderer.send('select-pet', petData),
  backToSelect: () => ipcRenderer.send('back-to-select'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  quitApp: () => ipcRenderer.send('quit-app'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  onPetData: (callback) => ipcRenderer.on('pet-data', (_event, data) => callback(data)),
  onContextMenuAction: (callback) => ipcRenderer.on('context-menu-action', (_event, action) => callback(action)),
  onActivityState: (callback) => ipcRenderer.on('activity-state', (_event, data) => callback(data)),
  onActivityAlert: (callback) => ipcRenderer.on('activity-alert', (_event, type) => callback(type)),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getSavedPet: () => ipcRenderer.invoke('get-saved-pet'),
  clearSavedPet: () => ipcRenderer.send('clear-saved-pet'),
  getMemo: () => ipcRenderer.invoke('get-memo'),
  saveMemo: (memo) => ipcRenderer.send('save-memo', memo)
});
