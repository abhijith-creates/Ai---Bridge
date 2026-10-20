document.addEventListener('DOMContentLoaded', async () => {
  const serverStatus = document.getElementById('server-status');
  const serverDot = document.getElementById('server-dot');
  const tabStatus = document.getElementById('tab-status');

  // Check server health
  try {
    const res = await fetch('http://localhost:3388/api/health');
    if (res.ok) {
      serverDot.className = 'dot green';
      serverStatus.innerHTML = '<span class="dot green"></span> Online (3388)';
    } else {
      serverDot.className = 'dot red';
      serverStatus.innerHTML = '<span class="dot red"></span> Error';
    }
  } catch (e) {
    serverDot.className = 'dot red';
    serverStatus.innerHTML = '<span class="dot red"></span> Offline';
  }

  // Check active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const url = tabs[0].url || '';
      if (url.includes('aistudio.google.com')) {
        tabStatus.textContent = 'Google AI Studio';
      } else if (url.includes('gemini.google.com')) {
        tabStatus.textContent = 'Gemini Web';
      } else if (url.includes('chatgpt.com') || url.includes('openai.com')) {
        tabStatus.textContent = 'ChatGPT';
      } else if (url.includes('claude.ai')) {
        tabStatus.textContent = 'Claude';
      } else if (url.startsWith('http')) {
        try {
          tabStatus.textContent = new URL(url).hostname;
        } catch (e) {
          tabStatus.textContent = 'Web Page';
        }
      } else {
        tabStatus.textContent = 'Internal Tab';
      }
    }
  });
});
