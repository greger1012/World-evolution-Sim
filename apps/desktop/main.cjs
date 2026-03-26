const { app, BrowserWindow } = require("electron");
const path = require("path");

const isDev = process.env.EVO_ELECTRON_DEV === "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0c0e12",
    webPreferences: {
      contextIsolation: true,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    const file = path.join(__dirname, "../web/dist/index.html");
    win.loadFile(file);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
