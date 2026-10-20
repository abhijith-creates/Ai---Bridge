/**
 * AI Bridge — Community Edition Server
 * Bridges local AI coding agents (Antigravity, Cursor, Windsurf, Claude Code, Aider)
 * directly with Web LLMs (Google AI Studio, Gemini, ChatGPT, Claude) without API keys.
 * Supports dual operation: 100% Local Filesystem Mode (default) or Multi-VPS SSH Mode.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');

const configManager = require('./config-manager');
const localWorkspace = require('./local-workspace');
const vpsManager = require('./vps-manager');
const { splitTaskIntoParts } = require('./splitter');
const featureGuard = require('./feature-guard');

const PORT = process.env.PORT || 3388;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const HANDOFF_DIR = path.join(__dirname, 'handoff');
if (!fs.existsSync(HANDOFF_DIR)) {
  fs.mkdirSync(HANDOFF_DIR, { recursive: true });
}

// Global active session state
let chromeClient = null;
const uiClients = new Set();
const agentClients = new Set();
let currentTask = null;
let multiPartSession = null;
let latestHandoff = null;

// Load existing handoff if available
try {
  const hPath = path.join(HANDOFF_DIR, 'results.json');
  if (fs.existsSync(hPath)) {
    latestHandoff = JSON.parse(fs.readFileSync(hPath, 'utf8'));
  }
} catch (e) {}

function broadcastToUI(message) {
  const data = JSON.stringify(message);
  for (const client of uiClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(data); } catch (e) {}
    }
  }
}

function broadcastToAgents(message) {
  const data = JSON.stringify(message);
  for (const client of agentClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(data); } catch (e) {}
    }
  }
}

function dispatchCurrentPart() {
  if (!multiPartSession || !chromeClient || chromeClient.readyState !== WebSocket.OPEN) return false;
  const currentPart = multiPartSession.parts[multiPartSession.currentIndex];
  
  currentTask = {
    id: `${multiPartSession.id}_part_${currentPart.partNumber}`,
    goal: currentPart.prompt,
    bundle: currentPart.prompt,
    chatUrl: multiPartSession.chatUrl,
    freshChat: currentPart.partNumber === 1,
    partInfo: {
      partNumber: currentPart.partNumber,
      totalParts: currentPart.totalParts,
      title: currentPart.title
    }
  };

  chromeClient.send(JSON.stringify({
    type: 'EXECUTE_TASK',
    payload: currentTask
  }));

  const evt = {
    type: 'MULTIPART_PART_STARTED',
    partNumber: currentPart.partNumber,
    totalParts: currentPart.totalParts,
    title: currentPart.title,
    task: currentTask
  };
  broadcastToUI(evt);
  broadcastToAgents(evt);
  return true;
}

// -------------------------------------------------------------
// WebSocket Orchestration
// -------------------------------------------------------------
wss.on('connection', (ws, req) => {
  console.log(`[WS] Connection established on ${req.url}`);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'REGISTER_CHROME':
          chromeClient = ws;
          console.log('[WS] Chrome Extension connected!');
          broadcastToUI({ type: 'CHROME_STATUS', connected: true, tabUrl: msg.tabUrl });
          broadcastToAgents({ type: 'CHROME_STATUS', connected: true });
          break;

        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;

        case 'REGISTER_UI':
          uiClients.add(ws);
          ws.send(JSON.stringify({
            type: 'INIT_STATE',
            chromeConnected: !!(chromeClient && chromeClient.readyState === WebSocket.OPEN),
            currentTask,
            latestHandoff,
            config: configManager.getPublicConfig()
          }));
          break;

        case 'REGISTER_AGENT':
          agentClients.add(ws);
          console.log('[WS] External AI Coding Agent connected!');
          ws.send(JSON.stringify({
            type: 'AGENT_CONNECTED',
            chromeConnected: !!(chromeClient && chromeClient.readyState === WebSocket.OPEN),
            config: configManager.getPublicConfig()
          }));
          break;

        case 'DISPATCH_TO_CHROME':
          if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Chrome Extension is not connected. Open Chrome with the AI Bridge extension installed.' }));
            return;
          }
          currentTask = msg.payload;
          chromeClient.send(JSON.stringify({
            type: 'EXECUTE_TASK',
            payload: msg.payload
          }));
          broadcastToUI({ type: 'TASK_STARTED', task: currentTask, isRetry: false });
          broadcastToAgents({ type: 'TASK_STARTED', task: currentTask });
          break;

        case 'RETRY_TASK':
          if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Chrome Extension is not connected.' }));
            return;
          }
          const taskToRetry = msg.payload || currentTask;
          if (!taskToRetry) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'No active task to retry.' }));
            return;
          }
          currentTask = taskToRetry;
          chromeClient.send(JSON.stringify({
            type: 'RETRY_TASK',
            payload: currentTask
          }));
          broadcastToUI({ type: 'TASK_STARTED', task: currentTask, isRetry: true });
          broadcastToAgents({ type: 'TASK_RETRYING', task: currentTask });
          break;

        case 'CHROME_PROGRESS':
          broadcastToUI({
            type: 'TASK_PROGRESS',
            status: msg.status,
            detail: msg.detail
          });
          broadcastToAgents({
            type: 'TASK_PROGRESS',
            status: msg.status,
            detail: msg.detail
          });
          break;

        case 'CHROME_COMPLETED':
          console.log('[WS] Task completed from Chrome!');
          
          if (multiPartSession && currentTask?.partInfo) {
            const partInfo = currentTask.partInfo;
            const partResult = {
              partNumber: partInfo.partNumber,
              totalParts: partInfo.totalParts,
              title: partInfo.title,
              response: msg.response,
              codeBlocks: msg.codeBlocks || [],
              completedAt: new Date().toISOString()
            };

            multiPartSession.completedParts.push(partResult);
            multiPartSession.accumulatedCodeBlocks.push(...(msg.codeBlocks || []));

            broadcastToUI({
              type: 'MULTIPART_PART_COMPLETED',
              partResult,
              accumulatedCodeBlocks: multiPartSession.accumulatedCodeBlocks,
              hasMore: multiPartSession.currentIndex < multiPartSession.parts.length - 1
            });

            if (multiPartSession.currentIndex < multiPartSession.parts.length - 1) {
              multiPartSession.currentIndex++;
              if (multiPartSession.autoAdvance) {
                setTimeout(() => {
                  dispatchCurrentPart();
                }, 3000);
              }
              break;
            } else {
              // All parts finished
              const finalResult = {
                id: multiPartSession.id,
                response: multiPartSession.completedParts.map(p => `### Part ${p.partNumber}: ${p.title}\n\n${p.response}`).join('\n\n---\n\n'),
                codeBlocks: multiPartSession.accumulatedCodeBlocks,
                completedAt: new Date().toISOString()
              };

              latestHandoff = finalResult;
              fs.writeFileSync(path.join(HANDOFF_DIR, 'results.json'), JSON.stringify(finalResult, null, 2), 'utf8');

              broadcastToUI({ type: 'TASK_COMPLETED', result: finalResult });
              broadcastToAgents({ type: 'TASK_COMPLETED', result: finalResult });
              multiPartSession = null;
              break;
            }
          }

          // Single task completion
          const result = {
            id: currentTask?.id || 'task_' + Date.now(),
            response: msg.response,
            codeBlocks: msg.codeBlocks || [],
            completedAt: new Date().toISOString()
          };

          latestHandoff = result;
          fs.writeFileSync(path.join(HANDOFF_DIR, 'results.json'), JSON.stringify(result, null, 2), 'utf8');

          broadcastToUI({ type: 'TASK_COMPLETED', result });
          broadcastToAgents({ type: 'TASK_COMPLETED', result });
          break;

        case 'CHROME_ERROR':
          console.warn('[WS] Chrome reporting error:', msg.error);
          broadcastToUI({ type: 'TASK_ERROR', error: msg.error });
          broadcastToAgents({ type: 'TASK_ERROR', error: msg.error });
          break;
      }
    } catch (err) {
      console.error('[WS Error]', err.message);
    }
  });

  ws.on('close', () => {
    if (ws === chromeClient) {
      chromeClient = null;
      console.log('[WS] Chrome Extension disconnected');
      broadcastToUI({ type: 'CHROME_STATUS', connected: false });
      broadcastToAgents({ type: 'CHROME_STATUS', connected: false });
    }
    uiClients.delete(ws);
    agentClients.delete(ws);
  });
});

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

// Health & Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: configManager.config.version || '1.0.0',
    chromeConnected: !!(chromeClient && chromeClient.readyState === WebSocket.OPEN),
    mode: configManager.config.mode,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/open-extension-folder', (req, res) => {
  const extDir = path.join(__dirname, 'extension');
  const cmd = process.platform === 'win32' ? `explorer.exe "${extDir}"` : `open "${extDir}"`;
  exec(cmd, (err) => {
    if (err) console.warn('[Open Extension Warning]', err.message);
  });
  res.json({ success: true, path: extDir });
});

// Configuration Management
app.get('/api/config', (req, res) => {
  res.json(configManager.getPublicConfig());
});

app.post('/api/config/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'local' || mode === 'vps') {
    configManager.setMode(mode);
    broadcastToUI({ type: 'CONFIG_UPDATED', config: configManager.getPublicConfig() });
    res.json({ success: true, mode });
  } else {
    res.status(400).json({ error: 'Mode must be "local" or "vps"' });
  }
});

app.post('/api/config/workspace', (req, res) => {
  const { path: newPath } = req.body;
  const resolved = configManager.setLocalWorkspace(newPath);
  broadcastToUI({ type: 'CONFIG_UPDATED', config: configManager.getPublicConfig() });
  res.json({ success: true, path: resolved });
});

app.post('/api/config/vps', (req, res) => {
  const profile = req.body;
  if (!profile.host) {
    return res.status(400).json({ error: 'Host is required' });
  }
  const saved = configManager.addOrUpdateVpsProfile(profile);
  broadcastToUI({ type: 'CONFIG_UPDATED', config: configManager.getPublicConfig() });
  res.json({ success: true, profile: saved });
});

app.delete('/api/config/vps/:id', (req, res) => {
  configManager.deleteVpsProfile(req.params.id);
  broadcastToUI({ type: 'CONFIG_UPDATED', config: configManager.getPublicConfig() });
  res.json({ success: true });
});

app.post('/api/config/vps/activate', (req, res) => {
  const { id } = req.body;
  const ok = configManager.setActiveVps(id);
  if (ok) {
    vpsManager.disconnect();
    broadcastToUI({ type: 'CONFIG_UPDATED', config: configManager.getPublicConfig() });
    res.json({ success: true, activeVpsId: id });
  } else {
    res.status(404).json({ error: 'VPS Profile not found' });
  }
});

app.post('/api/vps/test', async (req, res) => {
  try {
    const result = await vpsManager.connect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// Workspace File Operations (Local or VPS based on active mode)
app.get('/api/workspace/files', async (req, res) => {
  const mode = configManager.config.mode;
  const relPath = req.query.path || '';

  try {
    if (mode === 'local') {
      const data = await localWorkspace.listFiles(relPath);
      res.json({ mode: 'local', ...data });
    } else {
      const activeVps = configManager.getActiveVpsProfile();
      if (!activeVps) {
        return res.status(400).json({ error: 'No active VPS profile configured. Switch to Local mode or add a VPS.' });
      }
      const remoteRoot = activeVps.remotePath || '/root';
      const targetPath = relPath ? path.posix.join(remoteRoot, relPath) : remoteRoot;
      
      const cmd = `ls -la --time-style=iso "${targetPath}"`;
      const execRes = await vpsManager.exec(cmd);
      
      const lines = execRes.stdout.split('\n').slice(1); // skip total
      const items = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 8) {
          const isDir = parts[0].startsWith('d');
          const size = parseInt(parts[4], 10) || 0;
          const name = parts.slice(7).join(' ');
          if (name === '.' || name === '..' || name === '.git' || name === 'node_modules') continue;
          items.push({
            name,
            path: path.posix.relative(remoteRoot, path.posix.join(targetPath, name)),
            isDirectory: isDir,
            size,
            modified: parts[5] + ' ' + parts[6]
          });
        }
      }
      res.json({
        mode: 'vps',
        currentPath: relPath || '/',
        absolutePath: targetPath,
        items
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/file', async (req, res) => {
  const mode = configManager.config.mode;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });

  try {
    if (mode === 'local') {
      const content = await localWorkspace.readFile(filePath);
      res.json({ path: filePath, content });
    } else {
      const activeVps = configManager.getActiveVpsProfile();
      const remoteRoot = activeVps?.remotePath || '/root';
      const fullPath = path.isAbsolute(filePath) ? filePath : path.posix.join(remoteRoot, filePath);
      const content = await vpsManager.readFile(fullPath);
      res.json({ path: fullPath, content });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspace/file', async (req, res) => {
  const { path: filePath, content, skipGuard } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'Path and content are required' });
  }

  const mode = configManager.config.mode;

  try {
    let existingContent = '';
    try {
      if (mode === 'local') {
        existingContent = await localWorkspace.readFile(filePath);
      } else {
        const activeVps = configManager.getActiveVpsProfile();
        const fullPath = path.isAbsolute(filePath) ? filePath : path.posix.join(activeVps?.remotePath || '/root', filePath);
        existingContent = await vpsManager.readFile(fullPath);
      }
    } catch (e) {
      // File may be new, existingContent remains empty
    }

    // Feature guard verification if replacing an existing file
    let guardReport = null;
    if (existingContent && !skipGuard) {
      guardReport = featureGuard.compareFeatures(existingContent, content);
      if (guardReport.regressionDetected) {
        return res.status(422).json({
          error: 'Regression detected: incoming code dropped core functions/components or truncated file drastically.',
          guardReport
        });
      }
    }

    // Verify syntax
    const ext = path.extname(filePath).toLowerCase();
    const syntaxCheck = await featureGuard.verifySyntax(content, ext);
    if (!syntaxCheck.valid) {
      return res.status(422).json({
        error: `Syntax check failed: ${syntaxCheck.error}`,
        syntaxCheck
      });
    }

    // Safe write
    if (mode === 'local') {
      const writeRes = await localWorkspace.writeFile(filePath, content);
      res.json({ success: true, mode: 'local', writeRes, guardReport });
    } else {
      const activeVps = configManager.getActiveVpsProfile();
      const fullPath = path.isAbsolute(filePath) ? filePath : path.posix.join(activeVps?.remotePath || '/root', filePath);
      const writeRes = await vpsManager.writeFile(fullPath, content);
      res.json({ success: true, mode: 'vps', writeRes, guardReport });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Task Dispatching (Single & Multi-Part)
app.post('/api/task/dispatch', (req, res) => {
  const { goal, bundle, chatUrl, images, freshChat } = req.body;
  if (!goal) return res.status(400).json({ error: 'Goal is required' });

  if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: 'Chrome Extension is not connected. Open Chrome with the AI Bridge extension installed.' });
  }

  currentTask = {
    id: 'task_' + Date.now(),
    goal,
    bundle: bundle || goal,
    chatUrl: chatUrl || 'https://aistudio.google.com/apps',
    images: images || [],
    freshChat: freshChat || false,
    dispatchedAt: new Date().toISOString()
  };

  chromeClient.send(JSON.stringify({
    type: 'EXECUTE_TASK',
    payload: currentTask
  }));

  broadcastToUI({ type: 'TASK_STARTED', task: currentTask, isRetry: false });
  broadcastToAgents({ type: 'TASK_STARTED', task: currentTask });
  res.json({ success: true, task: currentTask });
});

app.post('/api/task/multipart/start', (req, res) => {
  const { goal, bundle, chatUrl, partsCount, customParts, filePaths } = req.body;
  if (!goal) return res.status(400).json({ error: 'Goal is required' });

  if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: 'Chrome Extension is not connected.' });
  }

  const parts = splitTaskIntoParts(goal, { bundle, partsCount, customParts, filePaths });

  multiPartSession = {
    id: 'multipart_' + Date.now(),
    goal,
    chatUrl: chatUrl || 'https://aistudio.google.com/apps',
    parts,
    currentIndex: 0,
    completedParts: [],
    accumulatedCodeBlocks: [],
    autoAdvance: true,
    startedAt: new Date().toISOString()
  };

  dispatchCurrentPart();
  res.json({ success: true, session: multiPartSession });
});

app.post('/api/task/retry', (req, res) => {
  if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
    return res.status(503).json({ error: 'Chrome Extension is not connected.' });
  }
  if (!currentTask) {
    return res.status(400).json({ error: 'No active task to retry.' });
  }

  chromeClient.send(JSON.stringify({
    type: 'RETRY_TASK',
    payload: currentTask
  }));

  broadcastToUI({ type: 'TASK_STARTED', task: currentTask, isRetry: true });
  broadcastToAgents({ type: 'TASK_RETRYING', task: currentTask });
  res.json({ success: true, task: currentTask });
});

app.get('/api/task/active', (req, res) => {
  res.json({
    activeTask: currentTask,
    multiPartSession: multiPartSession ? {
      id: multiPartSession.id,
      currentIndex: multiPartSession.currentIndex,
      totalParts: multiPartSession.parts.length,
      currentPart: multiPartSession.parts[multiPartSession.currentIndex]
    } : null
  });
});

app.get('/api/handoff/latest', (req, res) => {
  if (latestHandoff) {
    res.json(latestHandoff);
  } else {
    res.status(404).json({ error: 'No handoff results available yet.' });
  }
});

// Apply Code Block directly to target file
app.post('/api/apply/codeblock', async (req, res) => {
  const { targetPath, code } = req.body;
  if (!targetPath || !code) {
    return res.status(400).json({ error: 'targetPath and code are required' });
  }

  const mode = configManager.config.mode;
  try {
    let existing = '';
    try {
      if (mode === 'local') {
        existing = await localWorkspace.readFile(targetPath);
      } else {
        const activeVps = configManager.getActiveVpsProfile();
        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.posix.join(activeVps?.remotePath || '/root', targetPath);
        existing = await vpsManager.readFile(fullPath);
      }
    } catch (e) {}

    const guardReport = existing ? featureGuard.compareFeatures(existing, code) : null;
    const syntax = await featureGuard.verifySyntax(code, path.extname(targetPath));

    if (!syntax.valid) {
      return res.status(422).json({ error: `Syntax error in generated code: ${syntax.error}`, syntax });
    }

    if (mode === 'local') {
      const r = await localWorkspace.writeFile(targetPath, code);
      res.json({ success: true, mode: 'local', result: r, guardReport });
    } else {
      const activeVps = configManager.getActiveVpsProfile();
      const fullPath = path.isAbsolute(targetPath) ? targetPath : path.posix.join(activeVps?.remotePath || '/root', targetPath);
      const r = await vpsManager.writeFile(fullPath, code);
      res.json({ success: true, mode: 'vps', result: r, guardReport });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`⚡ AI Bridge (Community Edition) Running on :${PORT}`);
  console.log(`📁 Local Workspace: ${configManager.config.localWorkspace.path}`);
  console.log(`🌐 Web UI: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});
