/**
 * AI Bridge — Feature Guard & Anti-Regression Sentinel
 * Protects code integrity by verifying that generated code does not inadvertently
 * truncate, drop, or regress existing functions, React hooks, routes, or components.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function extractFeatureSignatures(code) {
  if (!code || typeof code !== 'string') {
    return { functions: [], hooks: [], imports: [], components: [], routes: [] };
  }

  const functions = new Set();
  const hooks = new Set();
  const imports = new Set();
  const components = new Set();
  const routes = new Set();

  // 1. Functions & Methods
  const funcRegexes = [
    /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g,
    /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?function/g,
    /([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g
  ];

  for (const re of funcRegexes) {
    let match;
    while ((match = re.exec(code)) !== null) {
      const name = match[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'useEffect', 'useState', 'useMemo', 'useCallback', 'useRef', 'require'].includes(name)) {
        functions.add(name);
      }
    }
  }

  // 2. React Hooks & State
  const hookRegex = /(?:const|let)\s+\[([a-zA-Z0-9_$,\s]+)\]\s*=\s*useState/g;
  let hookMatch;
  while ((hookMatch = hookRegex.exec(code)) !== null) {
    const vars = hookMatch[1].split(',').map(v => v.trim()).filter(Boolean);
    if (vars[0]) hooks.add(`state:${vars[0]}`);
  }

  const effectRegex = /useEffect\s*\(/g;
  let effectCount = 0;
  while (effectRegex.exec(code) !== null) effectCount++;
  if (effectCount > 0) hooks.add(`useEffect(${effectCount}x)`);

  // 3. Imports
  const importRegex = /import\s+(?:{[^}]+}|[a-zA-Z0-9_$]+|\*\s+as\s+[a-zA-Z0-9_$]+)?\s*from\s*['"]([^'"]+)['"]/g;
  let importMatch;
  while ((importMatch = importRegex.exec(code)) !== null) {
    imports.add(importMatch[1]);
  }
  const reqRegex = /require\(['"]([^'"]+)['"]\)/g;
  let reqMatch;
  while ((reqMatch = reqRegex.exec(code)) !== null) {
    imports.add(reqMatch[1]);
  }

  // 4. React Components
  const compRegex = /(?:function|const|let)\s+([A-Z][a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\()/g;
  let compMatch;
  while ((compMatch = compRegex.exec(code)) !== null) {
    components.add(compMatch[1]);
  }

  // 5. Express / API Routes
  const routeRegex = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let routeMatch;
  while ((routeMatch = routeRegex.exec(code)) !== null) {
    routes.add(`${routeMatch[1].toUpperCase()} ${routeMatch[2]}`);
  }

  return {
    functions: Array.from(functions),
    hooks: Array.from(hooks),
    imports: Array.from(imports),
    components: Array.from(components),
    routes: Array.from(routes)
  };
}

function compareFeatures(originalCode, newCode) {
  const orig = extractFeatureSignatures(originalCode);
  const updated = extractFeatureSignatures(newCode);

  const missingFunctions = orig.functions.filter(f => !updated.functions.includes(f));
  const missingHooks = orig.hooks.filter(h => !updated.hooks.includes(h));
  const missingImports = orig.imports.filter(i => !updated.imports.includes(i));
  const missingComponents = orig.components.filter(c => !updated.components.includes(c));
  const missingRoutes = orig.routes.filter(r => !updated.routes.includes(r));

  const totalOriginal = orig.functions.length + orig.hooks.length + orig.components.length + orig.routes.length;
  const totalMissing = missingFunctions.length + missingHooks.length + missingComponents.length + missingRoutes.length;
  const preservationScore = totalOriginal > 0 
    ? Math.max(0, Math.round(((totalOriginal - totalMissing) / totalOriginal) * 100))
    : 100;

  const regressionDetected = totalMissing > 0 && (newCode.length < originalCode.length * 0.7);

  return {
    preservationScore,
    regressionDetected,
    summary: {
      original: orig,
      updated,
      missing: {
        functions: missingFunctions,
        hooks: missingHooks,
        imports: missingImports,
        components: missingComponents,
        routes: missingRoutes
      }
    }
  };
}

async function verifySyntax(code, ext = '.js') {
  if (ext === '.json') {
    try {
      JSON.parse(code);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  // Temporary file for node check
  const tmpFile = path.join(__dirname, `.temp_check_${Date.now()}${ext}`);
  try {
    fs.writeFileSync(tmpFile, code, 'utf8');
    return new Promise((resolve) => {
      exec(`node --check "${tmpFile}"`, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
        if (err) {
          resolve({ valid: false, error: stderr || err.message });
        } else {
          resolve({ valid: true });
        }
      });
    });
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    return { valid: false, error: err.message };
  }
}

module.exports = {
  extractFeatureSignatures,
  compareFeatures,
  verifySyntax
};
