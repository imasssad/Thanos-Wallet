import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('thanosDesktop', {
  vaultGet: (key: string) => ipcRenderer.invoke('vault:get', key),
  vaultSet: (key: string, value: string) => ipcRenderer.invoke('vault:set', key, value),
  vaultRemove: (key: string) => ipcRenderer.invoke('vault:remove', key)
});
