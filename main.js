/**
 * AI Bridge — Electron Desktop Application Entry Point
 * Launches the native desktop window and embedded server without
 * requiring the user to open any terminal.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let embeddedServer = null;

// Ignore port conflicts cleanly if a server is already running
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('[Electron] Port 3388 in use, reusing active server.');
  } else {
    console.error('[Electron Uncaught]', err.message);
  }
});

function startEmbeddedServer(onReady) {
  let called = false;
  const done = () => {
    if (!called) {
      called = true;
      if (typeof onReady === 'function') onReady();
    }
  };

  try {
    console.log('[Electron] Starting embedded server...');
    embeddedServer = require('./server');

    if (embeddedServer && embeddedServer.server) {
      if (embeddedServer.server.listening) {
        done();
      } else {
        embeddedServer.server.once('listening', done);
        embeddedServer.server.once('error', (err) => {
          console.log('[Electron] Server listen note:', err.message);
          done();
        });
      }
    } else {
      done();
    }
  } catch (err) {
    console.log('[Electron] Server note:', err.message);
    done();
  }

  // Safety fallback: never hang waiting for server
  setTimeout(done, 600);
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
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Open external links in default web browser
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
  }, 1000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start application
app.whenReady().then(() => {
  startEmbeddedServer(() => {
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

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
