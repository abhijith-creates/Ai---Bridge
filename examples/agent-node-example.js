/**
 * AI Bridge — Node.js Autonomous Agent Loop Example
 * Connects to the local AI Bridge server over WebSocket, dispatches
 * complex multi-file tasks, listens for code generation events, and applies fixes.
 */

const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3388/ws');

ws.on('open', () => {
  console.log('🤖 Agent connected to AI Bridge on ws://localhost:3388/ws');
  ws.send(JSON.stringify({ type: 'REGISTER_AGENT' }));

  // Dispatch a task
  console.log('⚡ Dispatching autonomous task to Google AI Studio App Builder...');
  ws.send(JSON.stringify({
    type: 'DISPATCH_TO_CHROME',
    payload: {
      id: 'agent_task_' + Date.now(),
      goal: 'Create an Express.js healthcheck endpoint with memory usage and uptime statistics',
      chatUrl: 'https://aistudio.google.com/apps'
    }
  }));
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    if (msg.type === 'TASK_PROGRESS') {
      console.log(`[Status] ${msg.status}: ${msg.detail}`);
    } else if (msg.type === 'TASK_COMPLETED') {
      console.log('🎉 Code generation complete!');
      console.log(`Extracted ${msg.result.codeBlocks.length} code blocks:`);
      msg.result.codeBlocks.forEach((b, i) => {
        console.log(`\n--- [Block ${i + 1}] ${b.targetPath || 'Snippet'} ---`);
        console.log(b.code.slice(0, 200) + '...');
      });
      process.exit(0);
    } else if (msg.type === 'TASK_ERROR') {
      console.error('❌ Task error:', msg.error);
      process.exit(1);
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
});
