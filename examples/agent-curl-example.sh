#!/usr/bin/env bash
# ==============================================================================
# AI Bridge — CLI / Agent cURL Integration Example
# Dispatches a coding goal to Google AI Studio or Gemini Web without API keys.
# ==============================================================================

SERVER="http://localhost:3388"

echo "⚡ [1/2] Dispatching coding task to AI Bridge..."
RESPONSE=$(curl -s -X POST "${SERVER}/api/task/dispatch" \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Write a lightweight Node.js rate-limiting middleware using a sliding window algorithm with in-memory map and cleanup interval.",
    "chatUrl": "https://aistudio.google.com/apps"
  }')

echo "Task Response: ${RESPONSE}"

echo ""
echo "⏳ [2/2] Fetching latest completed handoff..."
sleep 5
HANDOFF=$(curl -s "${SERVER}/api/handoff/latest")
echo "Latest Code Handoff: ${HANDOFF}"
