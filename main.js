/**
 * AI Bridge — Electron Desktop Application Entry Point
 * Launches the native desktop window and embedded server without
 * requiring the user to open any terminal.
 */

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;
let serverProcess = null;

// Ensure server is running on port 3388
function checkServerRunning(callback) {
  const req = http.get('http://localhost:3388/api/health', (res) => {
    callback(res.statusCode === 200);
  });
  req.on('error', () => callback(false));
  req.setTimeout(1000, () => {
    req.abort();
    callback(false);
  });
}

function startEmbeddedServer() {
  try {
    console.log('[Electron] Starting embedded server...');
    require('./server');
  } catch (err) {
    console.error('[Electron] Embedded server error:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#07090e',
    title: 'AI Bridge',
    icon: path.join(__dirname, 'extension/icons/icon128.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Open external links (like AI Studio, Gemini, ChatGPT) in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:3388')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the desktop app interface
  mainWindow.loadURL('http://localhost:3388');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  checkServerRunning((isRunning) => {
    if (!isRunning) {
      startEmbeddedServer();
      setTimeout(createWindow, 800);
    } else {
      createWindow();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
