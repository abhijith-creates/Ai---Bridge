/**
 * AI Bridge — Generic Multi-Part Task Splitter
 * Intelligently decomposes large coding goals and multi-file tasks into
 * sequential, manageable parts. Prevents browser context overflow and
 * execution timeouts across any web AI chat interface.
 */

function splitTaskIntoParts(goal, options = {}) {
  const { bundle = '', filePaths = [], partsCount = null, customParts = null } = options;

  // 1. If user provided explicit custom parts from UI, use those directly
  if (Array.isArray(customParts) && customParts.length > 0) {
    return customParts.map((p, idx) => ({
      partNumber: idx + 1,
      totalParts: customParts.length,
      title: p.title || `Part ${idx + 1}`,
      prompt: p.prompt || p
    }));
  }

  // 2. If user requested specific number of parts or prompt is large
  const totalLength = (goal || '').length + (bundle || '').length;
  const parts = [];

  // Determine split strategy based on file count or task phases
  if (filePaths.length >= 2 && (!partsCount || partsCount === filePaths.length)) {
    // Strategy A: Split by target files
    filePaths.forEach((fp, idx) => {
      const fileName = fp.split(/[/\\]/).pop();
      parts.push({
        partNumber: idx + 1,
        totalParts: filePaths.length,
        title: `Implement / Refactor: ${fileName}`,
        prompt: `### 📌 MULTI-PART TASK [Part ${idx + 1} of ${filePaths.length}: ${fileName}]
> [!NOTE]
> This is Part ${idx + 1} of ${filePaths.length} for your current goal.
> Target File: \`${fp}\`

### 🎯 GOAL FOR THIS PART:
${goal}

### 📁 TARGET FILE IN FOCUS:
- File: \`${fp}\`
- Please provide complete, production-ready code blocks labeled with:
\`\`\`javascript path="${fp}"
// Code here
\`\`\`

${bundle ? `### 📦 CONTEXT BUNDLE:\n${bundle.slice(0, 8000)}` : ''}`
      });
    });
    return parts;
  }

  // Strategy B: Architectural 3-Phase Standard Decomposition
  // Phase 1: Models & Data Structures / Core Logic
  // Phase 2: Handlers, API Routes, Business Services
  // Phase 3: Frontend UI, Components & Integration
  const numParts = Math.max(2, Math.min(partsCount || (totalLength > 12000 ? 3 : 2), 4));

  if (numParts === 2) {
    parts.push({
      partNumber: 1,
      totalParts: 2,
      title: 'Phase 1: Architecture, Core Logic & Services',
      prompt: `### 📌 MULTI-PART TASK [Part 1 of 2: Architecture & Core Logic]
> [!NOTE]
> This is Part 1 of 2. Focus SOLELY on architecture, data structures, and core backend/system logic.
> Part 2 will cover the UI components and final integration.

### 🎯 MAIN PROJECT GOAL:
${goal}

### 📋 REQUIREMENTS FOR PART 1:
1. Define all required data models, interfaces, utility helpers, and business logic.
2. Ensure modular design, comprehensive error handling, and clean export structure.
3. Label all code blocks clearly with target file paths.

${bundle ? `### 📦 PROJECT CONTEXT:\n${bundle.slice(0, 10000)}` : ''}`
    });

    parts.push({
      partNumber: 2,
      totalParts: 2,
      title: 'Phase 2: UI Components, Integration & Polish',
      prompt: `### 📌 MULTI-PART TASK [Part 2 of 2: UI Components & Integration]
> [!NOTE]
> This is the final Part 2 of 2. Focus on UI components, user interactions, and end-to-end integration.

### 🎯 MAIN PROJECT GOAL:
${goal}

### 📋 REQUIREMENTS FOR PART 2:
1. Implement the frontend views, controls, and visual styling corresponding to Part 1.
2. Hook up event handlers, validation states, and reactive updates.
3. Output clean, complete code blocks labeled with target paths.

${bundle ? `### 📦 PROJECT CONTEXT:\n${bundle.slice(0, 10000)}` : ''}`
    });
  } else if (numParts === 3) {
    parts.push({
      partNumber: 1,
      totalParts: 3,
      title: 'Phase 1: Architecture, Schemas & Core Data Models',
      prompt: `### 📌 MULTI-PART TASK [Part 1 of 3: Core Architecture & Data Models]
> [!NOTE]
> This is Part 1 of 3. Focus solely on foundational schemas, constants, and data structures.

### 🎯 PROJECT GOAL:
${goal}

### 📋 SCOPE FOR PART 1:
- Core types, state schemas, and foundational interfaces.
- Label code blocks with explicit target file paths.

${bundle ? `### 📦 CONTEXT:\n${bundle.slice(0, 8000)}` : ''}`
    });

    parts.push({
      partNumber: 2,
      totalParts: 3,
      title: 'Phase 2: Backend Handlers, API Routes & Business Logic',
      prompt: `### 📌 MULTI-PART TASK [Part 2 of 3: Handlers & Business Logic]
> [!NOTE]
> This is Part 2 of 3. Building upon Part 1, implement server/system routes, controller methods, and operational handlers.

### 🎯 PROJECT GOAL:
${goal}

### 📋 SCOPE FOR PART 2:
- API endpoints, request validation, state mutations, and error boundaries.
- Label code blocks with explicit target file paths.

${bundle ? `### 📦 CONTEXT:\n${bundle.slice(0, 8000)}` : ''}`
    });

    parts.push({
      partNumber: 3,
      totalParts: 3,
      title: 'Phase 3: Frontend Views, Styling & End-to-End Integration',
      prompt: `### 📌 MULTI-PART TASK [Part 3 of 3: UI, Styling & Integration]
> [!NOTE]
> This is the final Part 3 of 3. Implement the presentation layer, layout, responsive styling, and wire up events.

### 🎯 PROJECT GOAL:
${goal}

### 📋 SCOPE FOR PART 3:
- Visual components, layout hierarchy, interactive controls, and production polish.
- Label code blocks with explicit target file paths.

${bundle ? `### 📦 CONTEXT:\n${bundle.slice(0, 8000)}` : ''}`
    });
  }

  return parts;
}

module.exports = {
  splitTaskIntoParts
};
