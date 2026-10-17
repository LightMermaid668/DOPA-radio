const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dopaDesktop", {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron,
  download: (payload) => ipcRenderer.invoke("dopa:download", payload),
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("dopa-desktop");
  if (process.platform === "darwin") {
    document.documentElement.classList.add("dopa-desktop-mac");
  }
});
