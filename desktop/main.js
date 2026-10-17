const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_URL = process.env.DOPA_URL || "https://dopa-radio.sosukeiwasaki.f5.si";

let mainWindow = null;

function sanitizeFilename(name) {
  return String(name || "track.m4a")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 1; index < 1000; index++) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return target;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // バックグラウンドでも再生・進捗更新が止まらないようにする
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  // 外部リンク（Apple Music / Spotify 等）は既定のブラウザで開く
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ダウンロード: セッション（ログインCookie）を使って保存する
ipcMain.handle("dopa:download", async (event, payload) => {
  const url = payload && typeof payload.url === "string" ? payload.url : null;
  if (!url) return { ok: false, error: "url が不正です" };

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: "ウィンドウが見つかりません" };

  const filename = sanitizeFilename(payload.filename);
  const target = uniquePath(path.join(app.getPath("downloads"), filename));
  const targetSession = win.webContents.session;

  return await new Promise((resolve) => {
    const onWillDownload = (_event, item) => {
      item.setSavePath(target);
      item.once("done", (_doneEvent, state) => {
        targetSession.removeListener("will-download", onWillDownload);
        if (state === "completed") {
          resolve({ ok: true, path: item.getSavePath() });
        } else {
          resolve({ ok: false, error: `保存に失敗しました (${state})` });
        }
      });
    };

    targetSession.on("will-download", onWillDownload);
    targetSession.downloadURL(url);
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
