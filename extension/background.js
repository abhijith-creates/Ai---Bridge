/**
 * AI Bridge — Chrome Extension Service Worker
 * Manages WebSocket keepalive, tab routing, multi-platform URL targeting,
 * and command relay between local agents and web chat interfaces.
 */

let ws = null;
let isConnected = false;
let pendingTask = null;
let heartbeatInterval = null;

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket('ws://localhost:3388/ws');

    ws.onopen = () => {
      console.log('[AI Bridge Background] Connected to local WebSocket server');
      isConnected = true;
      ws.send(JSON.stringify({ type: 'REGISTER_CHROME' }));
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

      // MV3 keepalive ping
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PING' }));
        }
      }, 10000);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PONG') return;

        console.log('[AI Bridge Background] WS message received:', msg.type);
        if (msg.type === 'EXECUTE_TASK') {
          handleExecuteTask(msg.payload, false);
        } else if (msg.type === 'RETRY_TASK') {
          handleExecuteTask(msg.payload, true);
        }
      } catch (e) {
        console.error('[AI Bridge Background] WS parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[AI Bridge Background] WS disconnected, reconnecting in 3s...');
      isConnected = false;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      setTimeout(connectWS, 3000);
    };

    ws.onerror = (err) => {
      console.warn('[AI Bridge Background] WS error:', err);
      try { ws.close(); } catch (e) {}
    };
  } catch (e) {
    console.warn('[AI Bridge Background] Connection attempt failed:', e);
    setTimeout(connectWS, 3000);
  }
}

connectWS();

// Keep service worker alive with MV3 alarm
chrome.alarms.create('ai-bridge-ws-keepalive', { periodInMinutes: 0.2 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ai-bridge-ws-keepalive') {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      connectWS();
    } else {
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  }
});

function getDomainFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname;
  } catch (e) {
    return urlStr;
  }
}

async function handleExecuteTask(payload, isRetry = false) {
  pendingTask = payload;
  const targetUrl = payload.chatUrl || 'https://aistudio.google.com/apps';
  const targetHost = getDomainFromUrl(targetUrl);

  try {
    // 1. Check all open tabs to find an existing tab matching the target host or URL
    const allTabs = await chrome.tabs.query({});
    let targetTab = allTabs.find(t => t.url && (t.url.includes(targetHost) || t.url.startsWith(targetUrl)));

    if (targetTab) {
      console.log(`[AI Bridge] Existing tab found for ${targetHost} (ID: ${targetTab.id}). Reusing.`);
      try {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      } catch (e) {}
      await chrome.tabs.update(targetTab.id, { active: true });

      if (payload.freshChat) {
        console.log(`[AI Bridge] Fresh chat requested: navigating to ${targetUrl}`);
        await chrome.tabs.update(targetTab.id, { url: targetUrl });
        await waitForTabComplete(targetTab.id);
      }
    } else {
      console.log(`[AI Bridge] No existing tab found. Creating new tab: ${targetUrl}`);
      targetTab = await chrome.tabs.create({ url: targetUrl, active: true });
      await waitForTabComplete(targetTab.id);
    }

    // 2. Ensure content.js is injected (works for ANY custom URL)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        files: ['content.js']
      });
    } catch (e) {
      console.log('[AI Bridge] Script already injected or restricted page:', e.message);
    }

    await new Promise(r => setTimeout(r, 600));

    // 3. Send execution instruction to content script
    await sendToTabWithRetry(targetTab.id, {
      action: isRetry ? 'RETRY_TASK' : 'INJECT_AND_SEND',
      bundle: payload.bundle || payload.goal,
      images: payload.images || [],
      taskId: payload.id,
      targetUrl: targetUrl
    });
  } catch (err) {
    console.error('[AI Bridge Background] Task routing error:', err);
    if (ws && isConnected) {
      ws.send(JSON.stringify({
        type: 'CHROME_ERROR',
        error: err.message || String(err)
      }));
    }
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (!tab) return resolve();
      if (tab.status === 'complete') {
        setTimeout(resolve, 1200);
      } else {
        const listener = (tid, changeInfo) => {
          if (tid === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 1200);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

function sendToTabWithRetry(tabId, message, maxAttempts = 5) {
  return new Promise((resolve) => {
    let attempts = 0;

    function trySend() {
      attempts++;
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (!lastErr) {
          console.log('[AI Bridge] Tab accepted message:', tabId);
          return resolve(response);
        }

        console.warn(`[AI Bridge] Tab message attempt ${attempts} failed:`, lastErr.message);
        if (attempts < maxAttempts) {
          setTimeout(trySend, 1200);
        } else {
          // Fallback to direct WebSocket from content script if runtime message fails
          resolve({ fallbackToDirectWs: true });
        }
      });
    }

    trySend();
  });
}

// Forward progress and results from content scripts back to the WebSocket server
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.from === 'content_script' && ws && isConnected) {
    if (msg.type === 'PROGRESS') {
      ws.send(JSON.stringify({
        type: 'CHROME_PROGRESS',
        status: msg.status,
        detail: msg.detail
      }));
    } else if (msg.type === 'COMPLETED') {
      ws.send(JSON.stringify({
        type: 'CHROME_COMPLETED',
        response: msg.response,
        codeBlocks: msg.codeBlocks
      }));
    } else if (msg.type === 'ERROR') {
      ws.send(JSON.stringify({
        type: 'CHROME_ERROR',
        error: msg.error
      }));
    }
  }
  sendResponse({ received: true });
});
