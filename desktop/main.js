const { app, BrowserWindow, ipcMain, shell, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const crypto = require("node:crypto");

const APP_URL = process.env.DOPA_URL || "https://dopa-radio.sosukeiwasaki.f5.si";

let mainWindow = null;

// ---- ダウンロード済みリスト ----

function downloadsFile() {
  return path.join(app.getPath("userData"), "downloads.json");
}

function loadDownloads() {
  try {
    const raw = fs.readFileSync(downloadsFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDownloads(records) {
  try {
    fs.writeFileSync(downloadsFile(), JSON.stringify(records, null, 2));
  } catch (error) {
    console.warn("[dopa] failed to save downloads:", error);
  }
}

let downloadRecords = [];

function findDownload(id) {
  return downloadRecords.find((record) => record.id === id) || null;
}

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

// ---- ローカル音源再生用のカスタムプロトコル ----
// ダウンロード済みの曲をアプリ内プレイヤーで再生できるようにする
protocol.registerSchemesAsPrivileged([
  {
    scheme: "dopa-local",
    privileges: { stream: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

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

// ---- ダウンロード ----

let downloadChain = Promise.resolve();

ipcMain.handle("dopa:download", (event, payload) => {
  const task = () => performDownload(event.sender, payload);
  const result = downloadChain.then(task, task);
  downloadChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
});

async function performDownload(sender, payload) {
  const url = payload && typeof payload.url === "string" ? payload.url : null;
  if (!url) return { ok: false, error: "url が不正です" };

  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return { ok: false, error: "ウィンドウが見つかりません" };

  const filename = sanitizeFilename(payload && payload.filename);
  const target = uniquePath(path.join(app.getPath("downloads"), filename));
  const targetSession = win.webContents.session;

  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      targetSession.removeListener("will-download", onWillDownload);
      resolve(value);
    };

    const onWillDownload = (_event, item) => {
      // 別の要因で始まったダウンロードと混ざらないようにURLで照合する
      const chain = typeof item.getURLChain === "function" ? item.getURLChain() : [];
      if (Array.isArray(chain) && chain.length > 0 && chain[0] !== url) return;

      item.setSavePath(target);
      item.once("done", (_doneEvent, state) => {
        if (state === "completed") {
          finish({ ok: true, path: item.getSavePath() });
        } else {
          finish({ ok: false, error: `保存に失敗しました (${state})` });
        }
      });
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: "ダウンロードが開始されませんでした" }),
      60_000,
    );

    targetSession.on("will-download", onWillDownload);
    try {
      targetSession.downloadURL(url)?.catch?.(() => {
        finish({ ok: false, error: "ダウンロードを開始できませんでした" });
      });
    } catch {
      finish({ ok: false, error: "ダウンロードを開始できませんでした" });
    }
  });

  // 成功したらダウンロード済みリストに記録する
  if (result.ok) {
    const record = {
      id: (payload && typeof payload.trackId === "string" && payload.trackId) || crypto.randomUUID(),
      title:
        (payload && typeof payload.title === "string" && payload.title) ||
        filename.replace(/\.m4a$/i, ""),
      artist: (payload && typeof payload.artist === "string" && payload.artist) || null,
      filename: path.basename(result.path),
      path: result.path,
      completedAt: Date.now(),
    };
    downloadRecords = [record, ...downloadRecords.filter((item) => item.id !== record.id)];
    saveDownloads(downloadRecords);
    result.record = record;
  }

  return result;
}

ipcMain.handle("dopa:list-downloads", async () => {
  // ファイルが消えていたらリストからも外す
  downloadRecords = downloadRecords.filter((record) => {
    try {
      return fs.existsSync(record.path);
    } catch {
      return false;
    }
  });
  saveDownloads(downloadRecords);
  return downloadRecords;
});

ipcMain.handle("dopa:reveal-download", async (_event, id) => {
  const record = findDownload(id);
  if (!record) return { ok: false };
  shell.showItemInFolder(record.path);
  return { ok: true };
});

ipcMain.handle("dopa:delete-download", async (_event, id) => {
  const record = findDownload(id);
  if (!record) return { ok: false };
  try {
    fs.unlinkSync(record.path);
  } catch {
    /* 既に消えていてもリストからは外す */
  }
  downloadRecords = downloadRecords.filter((item) => item.id !== id);
  saveDownloads(downloadRecords);
  return { ok: true };
});

// ---- Apple Music 再生（macOS: Music.appを直接操作してフル再生） ----

const APPLE_MUSIC_SCRIPT = `
on run argv
  set trackName to item 1 of argv
  set trackArtist to item 2 of argv
  tell application "Music"
    activate
    try
      if trackArtist is not "" then
        set matched to (every track of library playlist 1 whose name is trackName and artist is trackArtist)
        if (count of matched) > 0 then
          play item 1 of matched
          return "played"
        end if
      end if
      set matched to (every track of library playlist 1 whose name is trackName)
      if (count of matched) > 0 then
        play item 1 of matched
        return "played"
      end if
    end try
    return "notfound"
  end tell
end run
`;

ipcMain.handle("dopa:apple-music-play", async (_event, payload) => {
  const title = payload && typeof payload.title === "string" ? payload.title : "";
  const artist = payload && typeof payload.artist === "string" ? payload.artist : "";
  const deepLink = payload && typeof payload.deepLink === "string" ? payload.deepLink : null;
  if (!title) return { ok: false, status: "invalid" };

  if (process.platform === "darwin") {
    const status = await new Promise((resolve) => {
      execFile(
        "osascript",
        ["-e", APPLE_MUSIC_SCRIPT, title, artist],
        { timeout: 15_000 },
        (error, stdout) => {
          if (error) {
            resolve("error");
            return;
          }
          resolve(String(stdout).trim());
        },
      );
    });
    if (status === "played") return { ok: true, status };
    // ライブラリに無い場合はApple Musicのページを開く
    if (deepLink) shell.openExternal(deepLink);
    return { ok: status !== "error", status: status === "error" ? "error" : "opened" };
  }

  // Windows等はApple Musicアプリ/ブラウザでページを開く
  if (deepLink) {
    shell.openExternal(deepLink);
    return { ok: true, status: "opened" };
  }
  return { ok: false, status: "unsupported" };
});

app.whenReady().then(() => {
  downloadRecords = loadDownloads();

  // dopa-local://track/<id> → 保存済みファイルを配信
  protocol.handle("dopa-local", (request) => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const record = findDownload(id);
      if (!record) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(record.path).toString());
    } catch {
      return new Response("Bad request", { status: 400 });
    }
  });

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
