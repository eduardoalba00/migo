import { BrowserWindow, screen } from "electron";

const SPLASH_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    background: #1a1a2e;
    color: #e5e5e5;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .logo {
    width: 80px;
    height: 80px;
    margin-bottom: 32px;
    border-radius: 20px;
    background: linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40px;
    font-weight: 700;
    color: white;
    box-shadow: 0 8px 32px rgba(139, 92, 246, 0.3);
  }

  .app-name {
    font-size: 24px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 40px;
    letter-spacing: 0.5px;
  }

  .status {
    font-size: 13px;
    color: #9CA3AF;
    margin-bottom: 16px;
    min-height: 20px;
    transition: opacity 0.2s;
  }

  .progress-container {
    width: 200px;
    height: 4px;
    background: #2a2a3e;
    border-radius: 2px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .progress-container.visible { opacity: 1; }

  .progress-bar {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #8B5CF6, #A78BFA);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .progress-container.indeterminate .progress-bar {
    width: 40%;
    animation: indeterminate 1.2s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .version {
    position: absolute;
    bottom: 16px;
    font-size: 11px;
    color: #6B7280;
  }
</style>
</head>
<body>
  <div class="logo">M</div>
  <div class="app-name">Migo</div>
  <div class="status" id="status">Checking for updates...</div>
  <div class="progress-container indeterminate visible" id="progressContainer">
    <div class="progress-bar" id="progressBar"></div>
  </div>
  <div class="version" id="version"></div>
</body>
</html>`;

export function createSplashWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const splashWidth = 300;
  const splashHeight = 400;

  const splash = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    x: Math.round(width / 2 - splashWidth / 2),
    y: Math.round(height / 2 - splashHeight / 2),
    frame: false,
    resizable: false,
    movable: false,
    transparent: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      sandbox: false,
    },
  });

  splash.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(SPLASH_HTML),
  );

  splash.once("ready-to-show", () => {
    splash.show();
  });

  return splash;
}

export function splashSetStatus(
  splash: BrowserWindow,
  text: string,
): void {
  if (splash.isDestroyed()) return;
  splash.webContents
    .executeJavaScript(
      `document.getElementById("status").textContent = ${JSON.stringify(text)};`,
    )
    .catch(() => {});
}

export function splashSetProgress(
  splash: BrowserWindow,
  percent: number,
): void {
  if (splash.isDestroyed()) return;
  splash.webContents
    .executeJavaScript(
      `(() => {
        const c = document.getElementById("progressContainer");
        const b = document.getElementById("progressBar");
        c.classList.remove("indeterminate");
        c.classList.add("visible");
        b.style.width = "${Math.round(percent)}%";
      })()`,
    )
    .catch(() => {});
}

export function splashSetVersion(
  splash: BrowserWindow,
  version: string,
): void {
  if (splash.isDestroyed()) return;
  splash.webContents
    .executeJavaScript(
      `document.getElementById("version").textContent = ${JSON.stringify("v" + version)};`,
    )
    .catch(() => {});
}

export function splashHideProgress(splash: BrowserWindow): void {
  if (splash.isDestroyed()) return;
  splash.webContents
    .executeJavaScript(
      `document.getElementById("progressContainer").classList.remove("visible");`,
    )
    .catch(() => {});
}
