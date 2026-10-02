const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bancozAPI', {
  getInfo: () => ipcRenderer.invoke('bancoz:info'),
  listCollections: () => ipcRenderer.invoke('bancoz:listCollections'),
  getCollectionData: (params) => ipcRenderer.invoke('bancoz:getCollectionData', params),
  deleteKey: (params) => ipcRenderer.invoke('bancoz:deleteKey', params)
});
