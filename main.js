/**
 * AI Bridge — Electron Desktop Application Entry Point
 * Launches the native desktop window and embedded server without
 * requiring the user to open any terminal.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow = null;

// Ignore port conflicts cleanly if a server is already running
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[Electron] Port 3388 in use, reusing active server.');
  } else {
    console.error('[Electron Uncaught]', err.message);
  }
});

let embeddedServer = null;

function startEmbeddedServer() {
  try {
    console.log('[Electron] Starting embedded server...');
    embeddedServer = require('./server');
  } catch (err) {
    console.log('[Electron] Server note:', err.message);
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
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Open external links (AI Studio, Gemini, ChatGPT, Claude) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:3388')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the desktop interface
  mainWindow.loadURL('http://localhost:3388');

  // Retry if server takes a split second to listen
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL('http://localhost:3388');
      }
    }, 400);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Safety fallback: ensure window is visible even if ready-to-show was delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1200);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Single instance handling: if already open, focus or recreate the window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    startEmbeddedServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  try {
    if (embeddedServer && embeddedServer.server && embeddedServer.server.close) {
      embeddedServer.server.close();
    }
  } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    try {
      if (embeddedServer && embeddedServer.server && embeddedServer.server.close) {
        embeddedServer.server.close();
      }
    } catch (e) {}
    app.quit();
    process.exit(0);
  }
});

