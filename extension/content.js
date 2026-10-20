/**
 * AI Bridge — Multi-Platform Web LLM Content Script
 * Supports Google AI Studio (App Builder & Playground), Gemini Web,
 * ChatGPT, Claude, and any custom web chat interface using universal adapters.
 */

console.log('[AI Bridge Content Script] Initialized on:', window.location.href);

let directWs = null;
let lastTaskPayload = null;

// Dual Communication: Direct WebSocket + Chrome Runtime Messages
function connectDirectWS() {
  try {
    directWs = new WebSocket('ws://localhost:3388/ws');

    directWs.onopen = () => {
      console.log('[AI Bridge] Direct WebSocket connected to local server');
      directWs.send(JSON.stringify({
        type: 'REGISTER_CHROME',
        tabUrl: window.location.href
      }));
    };

    directWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'EXECUTE_TASK') {
          console.log('[AI Bridge] Executing task via direct WS:', msg.payload.id);
          lastTaskPayload = msg.payload;
          executeTaskOnCurrentPage(msg.payload.bundle || msg.payload.goal, msg.payload.id, msg.payload.images || []);
        } else if (msg.type === 'RETRY_TASK') {
          console.log('[AI Bridge] Retrying task via direct WS:', msg.payload?.id);
          const bundle = msg.payload?.bundle || lastTaskPayload?.bundle;
          const id = msg.payload?.id || lastTaskPayload?.id;
          const images = msg.payload?.images || lastTaskPayload?.images || [];
          retryTaskOnCurrentPage(bundle, id, images);
        }
      } catch (e) {
        console.error('[AI Bridge] WS message parse error:', e);
      }
    };

    directWs.onclose = () => {
      setTimeout(connectDirectWS, 3000);
    };

    directWs.onerror = () => {
      try { directWs.close(); } catch (e) {}
    };
  } catch (e) {
    setTimeout(connectDirectWS, 3000);
  }
}

connectDirectWS();

// Listen for messages dispatched from background.js service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'INJECT_AND_SEND') {
    lastTaskPayload = { bundle: request.bundle, id: request.taskId, images: request.images || [] };
    executeTaskOnCurrentPage(request.bundle, request.taskId, request.images || []);
    sendResponse({ started: true });
  } else if (request.action === 'RETRY_TASK') {
    const bundle = request.bundle || lastTaskPayload?.bundle;
    const id = request.taskId || lastTaskPayload?.id;
    const images = request.images || lastTaskPayload?.images || [];
    retryTaskOnCurrentPage(bundle, id, images);
    sendResponse({ started: true });
  }
  return true;
});

function reportProgress(status, detail) {
  if (directWs && directWs.readyState === WebSocket.OPEN) {
    directWs.send(JSON.stringify({
      type: 'CHROME_PROGRESS',
      status,
      detail
    }));
  }
  try {
    chrome.runtime.sendMessage({
      from: 'content_script',
      type: 'PROGRESS',
      status,
      detail
    });
  } catch (e) {}
}

function reportCompleted(response, codeBlocks) {
  if (directWs && directWs.readyState === WebSocket.OPEN) {
    directWs.send(JSON.stringify({
      type: 'CHROME_COMPLETED',
      response,
      codeBlocks
    }));
  }
  try {
    chrome.runtime.sendMessage({
      from: 'content_script',
      type: 'COMPLETED',
      response,
      codeBlocks
    });
  } catch (e) {}
}

function reportError(error) {
  const errMsg = error.message || String(error);
  if (directWs && directWs.readyState === WebSocket.OPEN) {
    directWs.send(JSON.stringify({
      type: 'CHROME_ERROR',
      error: errMsg
    }));
  }
  try {
    chrome.runtime.sendMessage({
      from: 'content_script',
      type: 'ERROR',
      error: errMsg
    });
  } catch (e) {}
}

/* =========================================================================
   PLATFORM ADAPTERS (AI Studio, Gemini, ChatGPT, Claude, Generic)
   ========================================================================= */

const Adapters = {
  // 1. Google AI Studio (App Builder & Prompts Playground)
  aistudio: {
    match: () => window.location.hostname.includes('aistudio.google.com'),
    name: 'Google AI Studio',
    inputSelectors: [
      'textarea[placeholder*="Describe an app" i]',
      'textarea[placeholder*="Ask Gemini to make changes" i]',
      'textarea[placeholder*="Ask Gemini" i]',
      'textarea[placeholder*="Start typing a prompt" i]',
      'textarea.prompt-textarea',
      'ms-autosize-textarea textarea',
      'textarea.mat-input-element',
      'textarea',
      'div[contenteditable="true"]'
    ],
    sendSelectors: [
      'button[aria-label*="Run" i]',
      'button.run-button',
      'button[data-test-id*="run" i]',
      'button[aria-label*="Create" i]',
      'button.mat-primary',
      'button[aria-label*="Send" i]'
    ],
    stopSelectors: [
      'button[aria-label*="Stop" i]',
      'button.stop-button',
      'button[data-test-id*="stop" i]'
    ],
    responseSelectors: [
      'ms-chat-turn',
      'ms-prompt-chunk',
      '.response-container',
      'ms-text-chunk',
      '.chat-turn-content',
      '.markdown-content',
      'model-response',
      'pre'
    ],
    useCtrlEnter: true
  },

  // 2. Google Gemini Web
  gemini: {
    match: () => window.location.hostname.includes('gemini.google.com'),
    name: 'Google Gemini Web',
    inputSelectors: [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '.ql-editor',
      'textarea'
    ],
    sendSelectors: [
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Send prompt" i]',
      'button[aria-label*="Send" i]',
      'button.send-button',
      '.send-button-container button'
    ],
    stopSelectors: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="stop" i]'
    ],
    responseSelectors: [
      'model-response',
      '.response-container',
      'message-content',
      '[data-message-author="model"]'
    ],
    useCtrlEnter: false
  },

  // 3. ChatGPT
  chatgpt: {
    match: () => window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('openai.com'),
    name: 'ChatGPT',
    inputSelectors: [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendSelectors: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send prompt" i]',
      'button[aria-label*="Send" i]',
      'button.send-button'
    ],
    stopSelectors: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop" i]'
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '.markdown'
    ],
    useCtrlEnter: false
  },

  // 4. Claude
  claude: {
    match: () => window.location.hostname.includes('claude.ai'),
    name: 'Claude',
    inputSelectors: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendSelectors: [
      'button[aria-label*="Send Message" i]',
      'button[aria-label*="Send" i]',
      'button.send-button'
    ],
    stopSelectors: [
      'button[aria-label*="Stop response" i]',
      'button[aria-label*="Stop" i]'
    ],
    responseSelectors: [
      '.font-claude-message',
      '[data-is-streaming]',
      'div[data-testid="chat-message"]'
    ],
    useCtrlEnter: false
  },

  // 5. Generic Web LLM (Universal Fallback)
  generic: {
    match: () => true,
    name: 'Universal Web LLM',
    inputSelectors: [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="message" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ],
    sendSelectors: [
      'button[type="submit"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Run" i]',
      'button[aria-label*="Submit" i]',
      'button.submit',
      'button.send'
    ],
    stopSelectors: [
      'button[aria-label*="Stop" i]'
    ],
    responseSelectors: [
      'pre',
      '.markdown',
      '.chat-response',
      '.message-content'
    ],
    useCtrlEnter: true
  }
};

function getActiveAdapter() {
  for (const key of ['aistudio', 'gemini', 'chatgpt', 'claude']) {
    if (Adapters[key].match()) return Adapters[key];
  }
  return Adapters.generic;
}

/* =========================================================================
   CORE EXECUTION & INJECTION LOGIC
   ========================================================================= */

async function executeTaskOnCurrentPage(text, taskId, images = []) {
  const adapter = getActiveAdapter();
  console.log(`[AI Bridge] Executing with adapter: ${adapter.name}`);

  try {
    reportProgress('FINDING_EDITOR', `Searching for input on ${adapter.name}...`);

    const editor = await waitForElement(adapter.inputSelectors, 12000);
    if (!editor) {
      throw new Error(`Could not locate text prompt editor on ${adapter.name}. Please ensure the page is loaded and ready.`);
    }

    // Baseline response count
    const initialCount = document.querySelectorAll(adapter.responseSelectors.join(', ')).length;

    // Attach any images or screenshots
    if (images && images.length > 0) {
      await injectImages(images, editor);
    }

    reportProgress('INJECTING_PROMPT', `Injecting instructions into ${adapter.name}...`);
    editor.focus();

    // Fast DataTransfer clipboard paste simulation (avoids per-char UI freeze)
    let injected = false;
    try {
      editor.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editor.dispatchEvent(pasteEvt);
      if ((editor.value || editor.textContent || '').trim().length > 20) {
        injected = true;
      }
    } catch (e) {
      console.warn('[AI Bridge] Clipboard event paste failed, using fallback:', e);
    }

    // Fallback 1: Input value assignment for textarea
    if (!injected && 'value' in editor) {
      editor.value = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      injected = true;
    }

    // Fallback 2: textContent / execCommand
    if (!injected) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch (e) {}
      if (!editor.textContent?.trim()) {
        editor.textContent = text;
      }
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text }));
    }

    await sleep(600);

    reportProgress('SENDING', `Submitting task to ${adapter.name}...`);

    // Submit via Send button or Ctrl+Enter
    let sendButton = await waitForElement(adapter.sendSelectors, 3000);
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
    } else {
      // Simulate Enter or Ctrl+Enter key dispatch
      const isCtrl = adapter.useCtrlEnter;
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: isCtrl,
        metaKey: isCtrl,
        bubbles: true,
        cancelable: true
      }));
    }

    // Verification check: if text remains after 1.5s, trigger Ctrl+Enter
    await sleep(1500);
    const contentRemaining = (editor.value || editor.textContent || '').trim().length > 50;
    const stopButtonPresent = document.querySelector(adapter.stopSelectors.join(', '));

    if (contentRemaining && !stopButtonPresent) {
      console.log('[AI Bridge] Text still in input, dispatching Ctrl+Enter trigger...');
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
      sendButton = document.querySelector(adapter.sendSelectors.join(', '));
      if (sendButton && !sendButton.disabled) sendButton.click();
    }

    reportProgress('WAITING_RESPONSE', `${adapter.name} is reasoning and generating code...`);

    // Track response completion
    await waitForGenerationComplete(adapter, initialCount);

    reportProgress('EXTRACTING_CODE', 'Parsing AI output and extracting code blocks...');
    const result = extractResponseAndCode(adapter);

    reportCompleted(result.rawText, result.codeBlocks);
  } catch (err) {
    console.error(`[AI Bridge Error on ${adapter.name}]`, err);
    reportError(err);
  }
}

async function injectImages(images, editor) {
  reportProgress('ATTACHING_MEDIA', `Attaching ${images.length} visual asset(s)...`);

  const files = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const res = await fetch(img.dataUrl);
      const blob = await res.blob();
      const filename = img.name || `image_${i + 1}.png`;
      const file = new File([blob], filename, { type: img.type || blob.type || 'image/png' });
      files.push(file);
    } catch (e) {}
  }

  if (files.length === 0) return;

  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput) {
    try {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
  }

  if (editor) {
    try {
      for (const file of files) {
        editor.focus();
        const dt = new DataTransfer();
        dt.items.add(file);
        const pasteEvt = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        editor.dispatchEvent(pasteEvt);
        await sleep(300);
      }
    } catch (e) {}
  }

  await sleep(2000);
}

async function waitForGenerationComplete(adapter, initialCount = 0) {
  const startTime = Date.now();
  const maxWait = 240000; // 4 minutes max for complex generation
  let generationStarted = false;

  // Step 1: Detect start of generation (up to 25s)
  while (Date.now() - startTime < 25000) {
    const stopBtn = document.querySelector(adapter.stopSelectors.join(', '));
    const responses = document.querySelectorAll(adapter.responseSelectors.join(', '));
    const hasNewResponse = responses.length > initialCount;
    const hasSpinner = !!document.querySelector('.loading, .spinner, mat-progress-spinner, [aria-label*="Generating" i], .sparkle-spinner');

    if (stopBtn || (hasNewResponse && (responses[responses.length - 1].textContent || '').trim().length > 20) || hasSpinner) {
      generationStarted = true;
      break;
    }
    await sleep(500);
  }

  // Step 2: Track streaming until stop button disappears and text length stabilizes
  let lastText = '';
  let stableCount = 0;

  while (Date.now() - startTime < maxWait) {
    const stopBtn = document.querySelector(adapter.stopSelectors.join(', '));
    const responses = document.querySelectorAll(adapter.responseSelectors.join(', '));

    if (responses.length <= initialCount && !stopBtn) {
      await sleep(500);
      continue;
    }

    const latest = responses[responses.length - 1];
    const currentText = latest ? (latest.textContent || '') : '';

    if (!stopBtn) {
      if (currentText.length > 50 && currentText === lastText) {
        stableCount++;
        if (stableCount >= 4) {
          // Settled for 2 seconds
          break;
        }
      } else {
        stableCount = 0;
      }
    } else {
      stableCount = 0;
    }

    lastText = currentText;
    await sleep(500);
  }

  await sleep(1000);
}

async function retryTaskOnCurrentPage(text, taskId, images = []) {
  reportProgress('RETRYING', 'Retrying task: looking for Retry / Regenerate option...');

  const retryBtn = document.querySelector([
    'button[aria-label*="Retry" i]',
    'button[aria-label*="Try again" i]',
    'button[aria-label*="Regenerate" i]',
    'button[mattooltip*="Retry" i]'
  ].join(', '));

  if (retryBtn) {
    console.log('[AI Bridge] Found native retry button. Clicking...');
    retryBtn.click();
    const adapter = getActiveAdapter();
    const count = Math.max(0, document.querySelectorAll(adapter.responseSelectors.join(', ')).length - 1);
    await waitForGenerationComplete(adapter, count);
    const result = extractResponseAndCode(adapter);
    reportCompleted(result.rawText, result.codeBlocks);
    return;
  }

  // Fallback: fresh injection
  console.log('[AI Bridge] Falling back to fresh injection for retry...');
  await executeTaskOnCurrentPage(text, taskId, images);
}

function extractResponseAndCode(adapter) {
  const responses = document.querySelectorAll(adapter.responseSelectors.join(', '));
  const latestResponse = responses[responses.length - 1] || document.body;

  const rawText = latestResponse.textContent || '';
  const codeBlocks = [];

  const preElements = latestResponse.querySelectorAll('pre');
  preElements.forEach((pre, index) => {
    const codeEl = pre.querySelector('code') || pre;
    const rawCode = codeEl.textContent || '';

    let language = 'javascript';
    let targetPath = '';

    const langMatch = (pre.className + ' ' + (codeEl.className || '')).match(/language-([a-zA-Z0-9_-]+)/);
    if (langMatch) language = langMatch[1];

    const pathMatch = rawCode.match(/(?:path|file|target)=["']?([\/\\a-zA-Z0-9_.-]+)["']?/i) ||
                      rawCode.match(/^\/\/\s*([\/\\a-zA-Z0-9_.-]+)/m) ||
                      rawCode.match(/^\/\*\s*([\/\\a-zA-Z0-9_.-]+)\s*\*\//m);

    if (pathMatch) {
      targetPath = pathMatch[1].trim();
    }

    codeBlocks.push({
      index: index + 1,
      language,
      targetPath,
      code: rawCode.trim()
    });
  });

  return { rawText, codeBlocks };
}

function waitForElement(selectors, timeout = 10000) {
  return new Promise((resolve) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return resolve(el);
    }

    const observer = new MutationObserver(() => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          observer.disconnect();
          return resolve(el);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return resolve(el);
      }
      resolve(null);
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
