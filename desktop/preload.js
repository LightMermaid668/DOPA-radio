const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dopaDesktop", {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron,
  download: (payload) => ipcRenderer.invoke("dopa:download", payload),
  listDownloads: () => ipcRenderer.invoke("dopa:list-downloads"),
  revealDownload: (id) => ipcRenderer.invoke("dopa:reveal-download", id),
  deleteDownload: (id) => ipcRenderer.invoke("dopa:delete-download", id),
  playInAppleMusic: (payload) => ipcRenderer.invoke("dopa:apple-music-play", payload),
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("dopa-desktop");
  if (process.platform === "darwin") {
    document.documentElement.classList.add("dopa-desktop-mac");
  }
});
