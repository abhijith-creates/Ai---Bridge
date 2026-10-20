/**
 * AI Bridge — Electron Desktop Application Entry Point
 * Launches the native desktop window and embedded server without
 * requiring the user to open any terminal.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net = require('net');

let mainWindow = null;

// Prevent multiple instances: if user double-clicks shortcut while running, focus existing window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Ignore EADDRINUSE or port conflicts cleanly without showing error popups
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[Electron] Port 3388 in use, reusing active server.');
  } else {
    console.error('[Electron Uncaught]', err.message);
  }
});

// Check if port 3388 is already bound
function isPortInUse(port, callback) {
  const socket = new net.Socket();
  socket.setTimeout(600);
  socket.on('connect', () => {
    socket.destroy();
    callback(true);
  });
  socket.on('error', () => {
    socket.destroy();
    callback(false);
  });
  socket.on('timeout', () => {
    socket.destroy();
    callback(false);
  });
  socket.connect(port, '127.0.0.1');
}

function startEmbeddedServer() {
  try {
    console.log('[Electron] Starting embedded server...');
    require('./server');
  } catch (err) {
    console.log('[Electron] Embedded server start note:', err.message);
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  isPortInUse(3388, (inUse) => {
    if (!inUse) {
      startEmbeddedServer();
      setTimeout(createWindow, 800);
    } else {
      console.log('[Electron] Port 3388 is already running, opening window directly.');
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
