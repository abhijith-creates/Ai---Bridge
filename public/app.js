/**
 * AI Bridge — Community Edition Frontend Logic
 * Manages WebSocket pipeline, multi-target platform switching,
 * task orchestration, file browsing, and multi-VPS configuration.
 */

// Application State
const state = {
  ws: null,
  config: null,
  activeTab: 'mission-control',
  chromeConnected: false,
  selectedFiles: new Map(), // path -> { name, path, content }
  attachedMedia: [], // [{ name, dataUrl, type }]
  currentDir: '',
  dirItems: [],
  activeTask: null,
  multiPartSession: null,
  activePreviewFile: null
};

// DOM Elements Cache
const el = {
  // Navigation & Top Bar
  tabButtons: document.querySelectorAll('.nav-tab'),
  tabPages: document.querySelectorAll('.tab-page'),
  btnModeToggleLocal: document.getElementById('btn-mode-toggle-local'),
  btnModeToggleVps: document.getElementById('btn-mode-toggle-vps'),
  modeDot: document.getElementById('mode-dot'),
  modeValue: document.getElementById('mode-value'),
  chromeDot: document.getElementById('chrome-dot'),
  chromeValue: document.getElementById('chrome-value'),
  targetValue: document.getElementById('target-value'),

  // Mission Control
  selectTargetPlatform: document.getElementById('select-target-platform'),
  inputCustomUrl: document.getElementById('input-custom-url'),
  btnOpenTargetTab: document.getElementById('btn-open-target-tab'),
  inputTaskGoal: document.getElementById('input-task-goal'),
  goalCharCounter: document.getElementById('goal-char-counter'),
  attachedFilesList: document.getElementById('attached-files-list'),
  attachedFilesSummary: document.getElementById('attached-files-summary'),
  btnClearTask: document.getElementById('btn-clear-task'),
  btnBrowseMedia: document.getElementById('btn-browse-media'),
  inputMediaFiles: document.getElementById('input-media-files'),
  mediaCountText: document.getElementById('media-count-text'),
  mediaThumbnails: document.getElementById('media-thumbnails'),
  checkFreshChat: document.getElementById('check-fresh-chat'),
  checkMultipart: document.getElementById('check-multipart'),
  btnDispatchTask: document.getElementById('btn-dispatch-task'),
  btnRetryTask: document.getElementById('btn-retry-task'),

  // Results Monitor
  stepDot: document.getElementById('step-dot'),
  statusStepTitle: document.getElementById('status-step-title'),
  statusStepDetail: document.getElementById('status-step-detail'),
  multipartTracker: document.getElementById('multipart-tracker'),
  multipartTitle: document.getElementById('multipart-title'),
  multipartPercent: document.getElementById('multipart-percent'),
  multipartProgressFill: document.getElementById('multipart-progress-fill'),
  codeBlocksContainer: document.getElementById('code-blocks-container'),
  rawResponsePre: document.getElementById('raw-response-pre'),
  btnCopyResponse: document.getElementById('btn-copy-response'),

  // Explorer
  btnDirUp: document.getElementById('btn-dir-up'),
  btnRefreshDir: document.getElementById('btn-refresh-dir'),
  breadcrumbsBar: document.getElementById('breadcrumbs-bar'),
  inputExplorerFilter: document.getElementById('input-explorer-filter'),
  fileListView: document.getElementById('file-list-view'),
  btnAddSelectedToPrompt: document.getElementById('btn-add-selected-to-prompt'),
  checkedFilesBadge: document.getElementById('checked-files-badge'),
  previewFilename: document.getElementById('preview-filename'),
  codePreviewPre: document.getElementById('code-preview-pre'),
  btnCopyPreviewContent: document.getElementById('btn-copy-preview-content'),

  // Settings
  tileModeLocal: document.getElementById('tile-mode-local'),
  tileModeVps: document.getElementById('tile-mode-vps'),
  tileStatusLocal: document.getElementById('tile-status-local'),
  tileStatusVps: document.getElementById('tile-status-vps'),
  inputLocalWorkspacePath: document.getElementById('input-local-workspace-path'),
  btnSaveWorkspacePath: document.getElementById('btn-save-workspace-path'),
  vpsProfilesList: document.getElementById('vps-profiles-list'),
  btnShowAddVpsModal: document.getElementById('btn-show-add-vps-modal'),

  // VPS Modal
  modalVpsBackdrop: document.getElementById('modal-vps-backdrop'),
  modalVpsTitle: document.getElementById('modal-vps-title'),
  btnCloseVpsModal: document.getElementById('btn-close-vps-modal'),
  btnCancelVpsModal: document.getElementById('btn-cancel-vps-modal'),
  btnSaveVpsModal: document.getElementById('btn-save-vps-modal'),
  btnTestVpsModal: document.getElementById('btn-test-vps-modal'),
  vpsFieldId: document.getElementById('vps-field-id'),
  vpsFieldName: document.getElementById('vps-field-name'),
  vpsFieldHost: document.getElementById('vps-field-host'),
  vpsFieldPort: document.getElementById('vps-field-port'),
  vpsFieldUsername: document.getElementById('vps-field-username'),
  vpsFieldAuthtype: document.getElementById('vps-field-authtype'),
  rowVpsPassword: document.getElementById('row-vps-password'),
  vpsFieldPassword: document.getElementById('vps-field-password'),
  rowVpsKey: document.getElementById('row-vps-key'),
  vpsFieldKey: document.getElementById('vps-field-key'),
  vpsFieldRemotepath: document.getElementById('vps-field-remotepath'),
  vpsFieldPm2: document.getElementById('vps-field-pm2')
};

/* =========================================================================
   INITIALIZATION & WEBSOCKET
   ========================================================================= */

function init() {
  setupTabs();
  setupTargetSelector();
  setupTaskComposer();
  setupFileExplorer();
  setupSettingsAndVps();
  setupWebSocket();
  loadConfig();
  loadHandoff();

  if (el.btnModeToggleLocal) {
    el.btnModeToggleLocal.addEventListener('click', () => setMode('local'));
  }
  if (el.btnModeToggleVps) {
    el.btnModeToggleVps.addEventListener('click', () => setMode('vps'));
  }

  const btnOpenExt = document.getElementById('btn-open-ext-folder');
  if (btnOpenExt) {
    btnOpenExt.addEventListener('click', async () => {
      try {
        await fetch('/api/open-extension-folder', { method: 'POST' });
      } catch (e) {}
    });
  }
}

function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('[AI Bridge UI] WebSocket connected');
    state.ws.send(JSON.stringify({ type: 'REGISTER_UI' }));
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('[AI Bridge UI] WS message parse error:', e);
    }
  };

  state.ws.onclose = () => {
    console.log('[AI Bridge UI] WS closed, reconnecting in 2.5s...');
    setTimeout(setupWebSocket, 2500);
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'INIT_STATE':
      updateChromeStatus(msg.chromeConnected);
      if (msg.config) renderConfig(msg.config);
      if (msg.latestHandoff) renderCompletedResult(msg.latestHandoff);
      break;

    case 'CHROME_STATUS':
      updateChromeStatus(msg.connected);
      break;

    case 'CONFIG_UPDATED':
      renderConfig(msg.config);
      break;

    case 'TASK_STARTED':
      state.activeTask = msg.task;
      updateExecutionStatus('running', msg.isRetry ? 'Retrying Task...' : 'Task Dispatched', 'Connecting to web chat interface...');
      el.btnRetryTask.style.display = 'none';
      break;

    case 'TASK_PROGRESS':
      updateProgressStep(msg.status, msg.detail);
      break;

    case 'TASK_COMPLETED':
      updateExecutionStatus('done', 'Generation Complete! 🎉', 'Extracted code blocks ready for review and deployment.');
      renderCompletedResult(msg.result);
      el.btnRetryTask.style.display = 'none';
      break;

    case 'TASK_ERROR':
      updateExecutionStatus('error', 'Execution Halted', msg.error);
      el.btnRetryTask.style.display = 'inline-flex';
      break;

    case 'MULTIPART_PART_STARTED':
      updateMultipartTracker(msg.partNumber, msg.totalParts, msg.title);
      updateExecutionStatus('running', `Multi-Part Task: Part ${msg.partNumber} of ${msg.totalParts}`, msg.title);
      break;

    case 'MULTIPART_PART_COMPLETED':
      if (msg.accumulatedCodeBlocks) {
        renderCodeBlocks(msg.accumulatedCodeBlocks);
      }
      break;
  }
}

function updateChromeStatus(connected) {
  state.chromeConnected = connected;
  if (el.chromeDot) {
    el.chromeDot.className = `telemetry-dot ${connected ? 'active' : 'offline'}`;
  }
  if (el.chromeValue) {
    el.chromeValue.textContent = connected ? 'ONLINE' : 'OFFLINE';
    el.chromeValue.style.color = connected ? 'var(--accent-green)' : 'var(--accent-rose)';
  }
}

/* =========================================================================
   TABS & NAVIGATION
   ========================================================================= */

function setupTabs() {
  el.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  el.tabButtons.forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  el.tabPages.forEach(p => {
    p.classList.toggle('active', p.id === `view-${tabId}`);
  });

  if (tabId === 'workspace') {
    loadDirectory(state.currentDir);
  }
}

/* =========================================================================
   TARGET WEB AI PLATFORM SWITCHER
   ========================================================================= */

function setupTargetSelector() {
  el.selectTargetPlatform.addEventListener('change', () => {
    const val = el.selectTargetPlatform.value;
    if (val === 'custom') {
      el.inputCustomUrl.classList.remove('custom-url-hidden');
      el.inputCustomUrl.focus();
      el.targetValue.textContent = 'Custom URL';
    } else {
      el.inputCustomUrl.classList.add('custom-url-hidden');
      const optText = el.selectTargetPlatform.options[el.selectTargetPlatform.selectedIndex].text;
      el.targetValue.textContent = optText.split('(')[0].trim();
    }
  });

  el.btnOpenTargetTab.addEventListener('click', () => {
    const url = getActiveTargetUrl();
    window.open(url, '_blank');
  });
}

function getActiveTargetUrl() {
  const val = el.selectTargetPlatform.value;
  if (val === 'custom') {
    return el.inputCustomUrl.value.trim() || 'https://aistudio.google.com/apps';
  }
  return val;
}

/* =========================================================================
   TASK COMPOSER & DISPATCH
   ========================================================================= */

function setupTaskComposer() {
  el.inputTaskGoal.addEventListener('input', () => {
    const len = el.inputTaskGoal.value.length;
    el.goalCharCounter.textContent = `${len} chars`;
  });

  el.btnClearTask.addEventListener('click', () => {
    el.inputTaskGoal.value = '';
    el.goalCharCounter.textContent = '0 chars';
    state.selectedFiles.clear();
    state.attachedMedia = [];
    renderAttachedFiles();
    renderMediaThumbnails();
  });

  // Media Screenshots Upload
  el.btnBrowseMedia.addEventListener('click', () => el.inputMediaFiles.click());
  el.inputMediaFiles.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const f of files) {
      const dataUrl = await readFileAsDataUrl(f);
      state.attachedMedia.push({ name: f.name, dataUrl, type: f.type });
    }
    renderMediaThumbnails();
    el.inputMediaFiles.value = '';
  });

  // Dispatch Action
  el.btnDispatchTask.addEventListener('click', async () => {
    const goal = el.inputTaskGoal.value.trim();
    if (!goal) {
      alert('Please enter a coding goal or prompt instruction before dispatching.');
      el.inputTaskGoal.focus();
      return;
    }

    if (!state.chromeConnected) {
      const proceed = confirm('Chrome Extension does not appear to be connected.\n\nMake sure the extension is installed in Google Chrome. Do you want to attempt dispatching anyway?');
      if (!proceed) return;
    }

    const chatUrl = getActiveTargetUrl();
    const freshChat = el.checkFreshChat.checked;
    const isMultipart = el.checkMultipart.checked;

    // Assemble file bundle if files were selected
    let bundle = goal;
    if (state.selectedFiles.size > 0) {
      bundle += '\n\n### 📦 INCLUDED WORKSPACE FILES CONTEXT:';
      for (const [fp, fileObj] of state.selectedFiles) {
        bundle += `\n\n\`\`\`file path="${fp}"\n${fileObj.content}\n\`\`\``;
      }
    }

    const filePaths = Array.from(state.selectedFiles.keys());

    try {
      if (isMultipart) {
        const res = await fetch('/api/task/multipart/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal,
            bundle,
            chatUrl,
            filePaths
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start multipart task');
      } else {
        const res = await fetch('/api/task/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal,
            bundle,
            chatUrl,
            freshChat,
            images: state.attachedMedia
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to dispatch task');
      }
    } catch (err) {
      alert(`Dispatch Error: ${err.message}`);
    }
  });

  // Retry Action
  el.btnRetryTask.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/task/retry', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retry task');
    } catch (err) {
      alert(`Retry Error: ${err.message}`);
    }
  });

  el.btnCopyResponse.addEventListener('click', () => {
    const text = el.rawResponsePre.textContent;
    navigator.clipboard.writeText(text);
    el.btnCopyResponse.textContent = 'Copied!';
    setTimeout(() => el.btnCopyResponse.textContent = 'Copy All', 2000);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderMediaThumbnails() {
  el.mediaThumbnails.innerHTML = '';
  el.mediaCountText.textContent = state.attachedMedia.length === 0 
    ? 'No images attached' 
    : `${state.attachedMedia.length} screenshot(s) attached`;

  state.attachedMedia.forEach((media, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrapper';
    wrap.innerHTML = `
      <img src="${media.dataUrl}" class="thumb-img" title="${media.name}">
      <button class="thumb-remove" title="Remove image">✕</button>
    `;
    wrap.querySelector('.thumb-remove').addEventListener('click', () => {
      state.attachedMedia.splice(idx, 1);
      renderMediaThumbnails();
    });
    el.mediaThumbnails.appendChild(wrap);
  });
}

function renderAttachedFiles() {
  el.attachedFilesList.innerHTML = '';
  el.attachedFilesSummary.textContent = `${state.selectedFiles.size} file(s) selected`;

  if (state.selectedFiles.size === 0) {
    el.attachedFilesList.innerHTML = '<div class="empty-hint">No files selected from the File Explorer tab yet. Check files to inject their code into the prompt.</div>';
    return;
  }

  for (const [fp, fileObj] of state.selectedFiles) {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `
      <span>📄 ${fileObj.name}</span>
      <span class="file-chip-remove" title="Remove from prompt">✕</span>
    `;
    chip.querySelector('.file-chip-remove').addEventListener('click', () => {
      state.selectedFiles.delete(fp);
      renderAttachedFiles();
      updateCheckedBadge();
      updateFileExplorerChecks();
    });
    el.attachedFilesList.appendChild(chip);
  }
}

/* =========================================================================
   EXECUTION PROGRESS & CODE RENDERING
   ========================================================================= */

function updateExecutionStatus(stateType, title, detail) {
  el.stepDot.className = `status-step-dot ${stateType}`;
  el.statusStepTitle.textContent = title;
  el.statusStepDetail.textContent = detail;
}

function updateProgressStep(status, detail) {
  const steps = {
    FINDING_EDITOR: { title: 'Locating Prompt Editor', detail: detail || 'Searching web chat page for input box...' },
    ATTACHING_MEDIA: { title: 'Attaching Screenshots', detail: detail || 'Uploading visual assets to chat...' },
    INJECTING_PROMPT: { title: 'Injecting Context', detail: detail || 'Pasting project prompt and files into editor...' },
    SENDING: { title: 'Submitting Prompt', detail: detail || 'Triggering Run/Send command in web AI...' },
    WAITING_RESPONSE: { title: 'Reasoning & Generating', detail: detail || 'AI model is streaming code output...' },
    EXTRACTING_CODE: { title: 'Extracting Code Blocks', detail: detail || 'Parsing code sections and target paths...' },
    RETRYING: { title: 'Retrying Task', detail: detail || 'Auto-triggering native regenerate or retry...' }
  };

  const step = steps[status] || { title: status, detail: detail || '' };
  updateExecutionStatus('running', step.title, step.detail);
}

function updateMultipartTracker(partNum, totalParts, title) {
  el.multipartTracker.style.display = 'block';
  el.multipartTitle.textContent = `Multi-Part Task: Part ${partNum} of ${totalParts} (${title})`;
  const pct = Math.round((partNum / totalParts) * 100);
  el.multipartPercent.textContent = `${pct}%`;
  el.multipartProgressFill.style.width = `${pct}%`;
}

function renderCompletedResult(result) {
  if (!result) return;
  el.rawResponsePre.textContent = result.response || 'No raw text available.';
  renderCodeBlocks(result.codeBlocks || []);
}

function renderCodeBlocks(codeBlocks) {
  el.codeBlocksContainer.innerHTML = '';

  if (!codeBlocks || codeBlocks.length === 0) {
    el.codeBlocksContainer.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon">📝</div>
        <div class="empty-title">Response Generated (No Code Blocks)</div>
        <div class="empty-desc">The AI provided an explanation or answer without formal markdown code blocks. Click "View Full AI Markdown Response" below to read.</div>
      </div>
    `;
    return;
  }

  codeBlocks.forEach((block, idx) => {
    const card = document.createElement('div');
    card.className = 'code-card';

    const pathDisplay = block.targetPath || `Snippet #${idx + 1} (${block.language || 'code'})`;

    card.innerHTML = `
      <div class="code-card-header">
        <div class="code-card-path">
          <span>📦</span>
          <span>${escapeHtml(pathDisplay)}</span>
        </div>
        <div class="code-card-actions">
          <button class="btn btn-xs btn-outline btn-copy-block">Copy</button>
          <button class="btn btn-xs btn-primary btn-apply-block">⚡ 1-Click Apply to Workspace</button>
        </div>
      </div>
      <pre class="code-block-pre"><code>${escapeHtml(block.code)}</code></pre>
    `;

    // Copy Button
    card.querySelector('.btn-copy-block').addEventListener('click', (e) => {
      navigator.clipboard.writeText(block.code);
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy', 2000);
    });

    // 1-Click Apply Button with Feature Guard Protection
    card.querySelector('.btn-apply-block').addEventListener('click', async (e) => {
      let targetPath = block.targetPath;
      if (!targetPath) {
        targetPath = prompt('No file path was detected in code block header. Please enter the target file path (e.g. src/index.js):');
        if (!targetPath) return;
      }

      e.target.disabled = true;
      e.target.textContent = 'Applying...';

      try {
        const res = await fetch('/api/apply/codeblock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetPath,
            code: block.code
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to apply code block');
        }

        e.target.textContent = '✅ Applied Successfully!';
        e.target.style.background = '#10b981';
        setTimeout(() => {
          e.target.disabled = false;
          e.target.textContent = '⚡ 1-Click Apply to Workspace';
          e.target.style.background = '';
        }, 3000);
      } catch (err) {
        alert(`Apply Error: ${err.message}`);
        e.target.disabled = false;
        e.target.textContent = '⚡ 1-Click Apply to Workspace';
      }
    });

    el.codeBlocksContainer.appendChild(card);
  });
}

/* =========================================================================
   FILE EXPLORER
   ========================================================================= */

function setupFileExplorer() {
  el.btnDirUp.addEventListener('click', () => {
    if (!state.currentDir || state.currentDir === '/' || state.currentDir === '.') return;
    const parts = state.currentDir.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    const upPath = parts.join('/');
    loadDirectory(upPath);
  });

  el.btnRefreshDir.addEventListener('click', () => loadDirectory(state.currentDir));

  el.inputExplorerFilter.addEventListener('input', () => {
    filterDirectoryList(el.inputExplorerFilter.value.trim());
  });

  el.btnAddSelectedToPrompt.addEventListener('click', () => {
    renderAttachedFiles();
    switchTab('mission-control');
  });

  el.btnCopyPreviewContent.addEventListener('click', () => {
    const text = el.codePreviewPre.textContent;
    navigator.clipboard.writeText(text);
    el.btnCopyPreviewContent.textContent = 'Copied!';
    setTimeout(() => el.btnCopyPreviewContent.textContent = 'Copy', 2000);
  });
}

async function loadDirectory(relPath = '') {
  el.fileListView.innerHTML = '<div class="loading-state">Loading directory...</div>';

  try {
    const res = await fetch(`/api/workspace/files?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load directory');

    state.currentDir = data.currentPath === '/' ? '' : data.currentPath;
    state.dirItems = data.items || [];

    renderBreadcrumbs(data.currentPath, data.absolutePath);
    renderDirectoryItems(state.dirItems);
  } catch (err) {
    if (err.message && err.message.includes('No active VPS profile')) {
      el.fileListView.innerHTML = `
        <div class="empty-state-card" style="padding: 28px 18px;">
          <div class="empty-icon">☁️</div>
          <div class="empty-title">VPS Server Not Configured</div>
          <div class="empty-desc" style="margin-bottom: 16px;">
            You are currently in Remote VPS mode, but haven't added or activated an SSH server yet.
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
            <button class="btn btn-sm btn-primary" id="btn-err-switch-local" style="width:100%; max-width:240px;">
              💻 Switch to Local Workspace
            </button>
            <button class="btn btn-sm btn-outline" id="btn-err-add-vps" style="width:100%; max-width:240px;">
              ➕ Configure Remote VPS
            </button>
          </div>
        </div>
      `;

      const btnSwitchLocal = document.getElementById('btn-err-switch-local');
      if (btnSwitchLocal) {
        btnSwitchLocal.addEventListener('click', () => setMode('local'));
      }
      const btnAddVps = document.getElementById('btn-err-add-vps');
      if (btnAddVps) {
        btnAddVps.addEventListener('click', () => openVpsModal());
      }
      return;
    }

    el.fileListView.innerHTML = `<div class="empty-state-card"><div class="empty-desc" style="color:#ef4444;">Error: ${escapeHtml(err.message)}</div></div>`;
  }
}

function renderBreadcrumbs(currentPath, absolutePath) {
  el.breadcrumbsBar.innerHTML = '';
  const rootBtn = document.createElement('span');
  rootBtn.className = 'breadcrumb-item root';
  rootBtn.textContent = '📁 Root';
  rootBtn.style.cursor = 'pointer';
  rootBtn.addEventListener('click', () => loadDirectory(''));
  el.breadcrumbsBar.appendChild(rootBtn);

  if (!currentPath || currentPath === '/' || currentPath === '.') return;

  const segments = currentPath.split('/').filter(Boolean);
  let accumulated = '';

  segments.forEach((seg) => {
    accumulated = accumulated ? `${accumulated}/${seg}` : seg;
    const pathRef = accumulated;

    const sep = document.createElement('span');
    sep.textContent = ' / ';
    sep.style.color = '#64748b';
    el.breadcrumbsBar.appendChild(sep);

    const segEl = document.createElement('span');
    segEl.className = 'breadcrumb-item';
    segEl.textContent = seg;
    segEl.style.cursor = 'pointer';
    segEl.addEventListener('click', () => loadDirectory(pathRef));
    el.breadcrumbsBar.appendChild(segEl);
  });
}

function renderDirectoryItems(items) {
  el.fileListView.innerHTML = '';

  if (items.length === 0) {
    el.fileListView.innerHTML = '<div class="empty-state-card"><div class="empty-desc">Folder is empty</div></div>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'file-row';

    const isChecked = state.selectedFiles.has(item.path);

    row.innerHTML = `
      ${!item.isDirectory ? `<input type="checkbox" class="file-check" ${isChecked ? 'checked' : ''}>` : '<span style="width:16px;"></span>'}
      <span class="file-icon">${item.isDirectory ? '📁' : getFileIcon(item.name)}</span>
      <span class="file-name" title="${item.path}">${escapeHtml(item.name)}</span>
      <span class="file-meta">${item.isDirectory ? '' : formatBytes(item.size)}</span>
    `;

    // Row click: if folder, enter directory. If file, preview file
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-check')) return; // handled separately
      if (item.isDirectory) {
        loadDirectory(item.path);
      } else {
        previewFile(item.path, item.name);
      }
    });

    // Checkbox toggle for context bundle
    const checkEl = row.querySelector('.file-check');
    if (checkEl) {
      checkEl.addEventListener('change', async (e) => {
        if (e.target.checked) {
          try {
            const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(item.path)}`);
            const data = await res.json();
            if (res.ok) {
              state.selectedFiles.set(item.path, { name: item.name, path: item.path, content: data.content });
            }
          } catch (err) {}
        } else {
          state.selectedFiles.delete(item.path);
        }
        updateCheckedBadge();
      });
    }

    el.fileListView.appendChild(row);
  });
}

function filterDirectoryList(query) {
  if (!query) {
    renderDirectoryItems(state.dirItems);
    return;
  }
  const filtered = state.dirItems.filter(i => i.name.toLowerCase().includes(query.toLowerCase()));
  renderDirectoryItems(filtered);
}

async function previewFile(filePath, filename) {
  el.previewFilename.textContent = filename;
  el.codePreviewPre.textContent = 'Loading file contents...';

  try {
    const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (res.ok) {
      el.codePreviewPre.textContent = data.content;
      state.activePreviewFile = { path: filePath, content: data.content };
    } else {
      el.codePreviewPre.textContent = `Error loading file: ${data.error}`;
    }
  } catch (err) {
    el.codePreviewPre.textContent = `Error loading file: ${err.message}`;
  }
}

function updateCheckedBadge() {
  el.checkedFilesBadge.textContent = state.selectedFiles.size;
}

function updateFileExplorerChecks() {
  document.querySelectorAll('.file-row').forEach(row => {
    const nameEl = row.querySelector('.file-name');
    const checkEl = row.querySelector('.file-check');
    if (nameEl && checkEl) {
      const p = nameEl.getAttribute('title');
      checkEl.checked = state.selectedFiles.has(p);
    }
  });
}

/* =========================================================================
   SETTINGS & MULTI-VPS MANAGEMENT
   ========================================================================= */

function setupSettingsAndVps() {
  // Mode toggling
  el.tileModeLocal.addEventListener('click', () => setMode('local'));
  el.tileModeVps.addEventListener('click', () => setMode('vps'));

  // Save Local Workspace Path
  el.btnSaveWorkspacePath.addEventListener('click', async () => {
    const newPath = el.inputLocalWorkspacePath.value.trim();
    if (!newPath) return;

    try {
      const res = await fetch('/api/config/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Local workspace path updated successfully!');
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  // VPS Modal Handlers
  el.btnShowAddVpsModal.addEventListener('click', () => openVpsModal());
  el.btnCloseVpsModal.addEventListener('click', () => closeVpsModal());
  el.btnCancelVpsModal.addEventListener('click', () => closeVpsModal());

  el.vpsFieldAuthtype.addEventListener('change', () => {
    const type = el.vpsFieldAuthtype.value;
    if (type === 'password') {
      el.rowVpsPassword.style.display = 'flex';
      el.rowVpsKey.style.display = 'none';
    } else {
      el.rowVpsPassword.style.display = 'none';
      el.rowVpsKey.style.display = 'flex';
    }
  });

  el.btnTestVpsModal.addEventListener('click', async () => {
    const host = el.vpsFieldHost.value.trim();
    if (!host) {
      alert('Host/IP Address is required to test SSH connection');
      return;
    }

    const profile = {
      id: el.vpsFieldId.value || undefined,
      name: el.vpsFieldName.value.trim() || host,
      host,
      port: parseInt(el.vpsFieldPort.value, 10) || 22,
      username: el.vpsFieldUsername.value.trim() || 'root',
      remotePath: el.vpsFieldRemotepath.value.trim() || '/root',
      pm2App: el.vpsFieldPm2.value.trim() || ''
    };

    if (el.vpsFieldAuthtype.value === 'password') {
      profile.password = el.vpsFieldPassword.value;
    } else {
      profile.privateKey = el.vpsFieldKey.value;
    }

    el.btnTestVpsModal.textContent = '⏳ Testing SSH Connection...';
    try {
      const res = await fetch('/api/vps/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      const data = await res.json();
      if (data.connected) {
        const info = data.details?.os ? `\nOS: ${data.details.os}` : '';
        const latency = data.details?.latencyMs !== undefined ? `\nLatency: ${data.details.latencyMs}ms` : '';
        alert(`✅ SSH Connection Successful to: ${data.profile || host}${info}${latency}`);
      } else {
        alert(`❌ Connection failed: ${data.error || data.reason || 'Authentication or network timeout'}`);
      }
    } catch (err) {
      alert(`❌ Connection test error: ${err.message}`);
    } finally {
      el.btnTestVpsModal.textContent = '🔌 Test SSH Connection';
    }
  });

  el.btnSaveVpsModal.addEventListener('click', async () => {
    const host = el.vpsFieldHost.value.trim();
    if (!host) {
      alert('Host/IP Address is required');
      return;
    }

    const profile = {
      id: el.vpsFieldId.value || undefined,
      name: el.vpsFieldName.value.trim() || host,
      host,
      port: parseInt(el.vpsFieldPort.value, 10) || 22,
      username: el.vpsFieldUsername.value.trim() || 'root',
      remotePath: el.vpsFieldRemotepath.value.trim() || '/root',
      pm2App: el.vpsFieldPm2.value.trim() || ''
    };

    if (el.vpsFieldAuthtype.value === 'password') {
      profile.password = el.vpsFieldPassword.value;
    } else {
      profile.privateKey = el.vpsFieldKey.value;
    }

    try {
      const res = await fetch('/api/config/vps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      const data = await res.json();
      if (res.ok) {
        closeVpsModal();
        await loadConfig();
        if (state.activeTab === 'workspace') {
          loadDirectory(state.currentDir);
        }
      } else {
        alert(`Error saving VPS: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });
}

async function setMode(mode) {
  if (mode === 'vps' && (!state.config?.vpsProfiles || state.config.vpsProfiles.length === 0)) {
    openVpsModal();
  }
  try {
    const res = await fetch('/api/config/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    if (res.ok) {
      await loadConfig();
      state.currentDir = '';
      if (state.activeTab === 'workspace') {
        loadDirectory('');
      }
    }
  } catch (err) {}
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (res.ok) {
      state.config = data;
      renderConfig(data);
    }
  } catch (err) {}
}

async function loadHandoff() {
  try {
    const res = await fetch('/api/handoff/latest');
    const data = await res.json();
    if (res.ok) {
      renderCompletedResult(data);
    }
  } catch (err) {}
}

function renderConfig(config) {
  state.config = config;

  // Mode UI
  const isLocal = config.mode === 'local';
  if (el.modeDot) el.modeDot.className = `status-indicator ${isLocal ? 'local' : 'active'}`;
  if (el.modeValue) el.modeValue.textContent = isLocal ? 'Local Workspace' : 'Remote VPS';

  if (el.btnModeToggleLocal) el.btnModeToggleLocal.classList.toggle('active', isLocal);
  if (el.btnModeToggleVps) el.btnModeToggleVps.classList.toggle('active', !isLocal);

  el.tileModeLocal.classList.toggle('active', isLocal);
  el.tileModeVps.classList.toggle('active', !isLocal);
  el.tileStatusLocal.textContent = isLocal ? 'ACTIVE' : 'SELECT';
  el.tileStatusVps.textContent = isLocal ? 'SELECT' : 'ACTIVE';

  // Local Path
  if (config.localWorkspace?.path) {
    el.inputLocalWorkspacePath.value = config.localWorkspace.path;
  }

  // VPS Profiles List
  renderVpsProfiles(config.vpsProfiles || [], config.activeVpsId);
}

function renderVpsProfiles(profiles, activeId) {
  el.vpsProfilesList.innerHTML = '';

  if (profiles.length === 0) {
    el.vpsProfilesList.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-desc">No VPS profiles configured yet. Click "+ Add New VPS Profile" above to configure remote SSH deployment.</div>
      </div>
    `;
    return;
  }

  profiles.forEach(p => {
    const isActive = p.id === activeId;
    const item = document.createElement('div');
    item.className = 'vps-profile-item';

    item.innerHTML = `
      <div class="vps-profile-info">
        <div class="vps-profile-name">
          <span>${escapeHtml(p.name || p.host)}</span>
          ${isActive ? '<span class="badge-os" style="background:#10b981; color:#000;">ACTIVE</span>' : ''}
        </div>
        <div class="vps-profile-details">
          ${escapeHtml(p.username)}@${escapeHtml(p.host)}:${p.port || 22} ➔ ${escapeHtml(p.remotePath || '/root')}
        </div>
      </div>
      <div style="display:flex; gap:8px;">
        ${!isActive ? `<button class="btn btn-xs btn-outline btn-activate-vps">Activate</button>` : ''}
        <button class="btn btn-xs btn-outline btn-edit-vps">Edit</button>
        <button class="btn btn-xs btn-ghost btn-delete-vps">Delete</button>
      </div>
    `;

    if (!isActive) {
      item.querySelector('.btn-activate-vps').addEventListener('click', async () => {
        await fetch('/api/config/vps/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id })
        });
        await loadConfig();
        state.currentDir = '';
        if (state.activeTab === 'workspace') {
          loadDirectory('');
        }
      });
    }

    item.querySelector('.btn-edit-vps').addEventListener('click', () => openVpsModal(p));
    item.querySelector('.btn-delete-vps').addEventListener('click', async () => {
      if (confirm(`Delete VPS Profile "${p.name || p.host}"?`)) {
        await fetch(`/api/config/vps/${p.id}`, { method: 'DELETE' });
        loadConfig();
      }
    });

    el.vpsProfilesList.appendChild(item);
  });
}

function openVpsModal(profile = null) {
  el.modalVpsTitle.textContent = profile ? 'Edit VPS Profile' : 'Add Remote VPS Profile';
  el.vpsFieldId.value = profile?.id || '';
  el.vpsFieldName.value = profile?.name || '';
  el.vpsFieldHost.value = profile?.host || '';
  el.vpsFieldPort.value = profile?.port || 22;
  el.vpsFieldUsername.value = profile?.username || 'root';
  el.vpsFieldRemotepath.value = profile?.remotePath || '/root';
  el.vpsFieldPm2.value = profile?.pm2App || '';

  if (profile?.privateKey) {
    el.vpsFieldAuthtype.value = 'key';
    el.rowVpsPassword.style.display = 'none';
    el.rowVpsKey.style.display = 'flex';
    el.vpsFieldKey.value = profile.privateKey;
  } else {
    el.vpsFieldAuthtype.value = 'password';
    el.rowVpsPassword.style.display = 'flex';
    el.rowVpsKey.style.display = 'none';
    el.vpsFieldPassword.value = profile?.password || '';
  }

  el.modalVpsBackdrop.style.display = 'flex';
}

function closeVpsModal() {
  el.modalVpsBackdrop.style.display = 'none';
}

/* =========================================================================
   UTILITY HELPERS
   ========================================================================= */

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs': return '🟨';
    case 'ts':
    case 'tsx': return '🟦';
    case 'html': return '🌐';
    case 'css': return '🎨';
    case 'json': return '📋';
    case 'md': return '📝';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg': return '🖼️';
    default: return '📄';
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Start application on load
window.addEventListener('DOMContentLoaded', init);
