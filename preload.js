const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectPet: (petData) => ipcRenderer.send('select-pet', petData),
  backToSelect: () => ipcRenderer.send('back-to-select'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  quitApp: () => ipcRenderer.send('quit-app'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  onPetData: (callback) => ipcRenderer.on('pet-data', (_event, data) => callback(data)),
  onContextMenuAction: (callback) => ipcRenderer.on('context-menu-action', (_event, action) => callback(action)),
  getSavedPet: () => ipcRenderer.invoke('get-saved-pet'),
  clearSavedPet: () => ipcRenderer.send('clear-saved-pet'),
  saveTimerState: (state) => ipcRenderer.send('save-timer-state', state),
  onRequestTimerState: (callback) => ipcRenderer.on('request-timer-state', () => callback()),
  onRestoreTimerState: (callback) => ipcRenderer.on('restore-timer-state', (_event, state) => callback(state)),
  onSetOpacity: (callback) => ipcRenderer.on('set-opacity', (_event, value) => callback(value))
});
