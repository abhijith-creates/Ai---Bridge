/**
 * AI Bridge — Local Workspace Operations
 * Enables full autonomous code editing, syntax checking, and file browsing
 * directly on the user's local machine without requiring any VPS or SSH.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const configManager = require('./config-manager');

class LocalWorkspace {
  getWorkspaceRoot() {
    return configManager.config.localWorkspace.path;
  }

  resolveSafePath(userPath = '') {
    const root = this.getWorkspaceRoot();
    if (path.isAbsolute(userPath)) {
      if (userPath.startsWith(root)) return userPath;
      // If outside root, join with root
      return path.join(root, userPath.replace(/^[/\\]+/, ''));
    }
    return path.join(root, userPath);
  }

  async listFiles(relPath = '') {
    const targetDir = this.resolveSafePath(relPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue;

      const fullPath = path.join(targetDir, entry.name);
      const isDir = entry.isDirectory();
      let size = 0;
      let modified = new Date();

      try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        modified = stat.mtime;
      } catch (e) {}

      items.push({
        name: entry.name,
        path: path.relative(this.getWorkspaceRoot(), fullPath).replace(/\\/g, '/'),
        isDirectory: isDir,
        size,
        modified: modified.toISOString()
      });
    }

    // Sort directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      currentPath: path.relative(this.getWorkspaceRoot(), targetDir).replace(/\\/g, '/') || '/',
      absolutePath: targetDir,
      items
    };
  }

  async readFile(filePath) {
    const target = this.resolveSafePath(filePath);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(target, 'utf8');
  }

  async writeFile(filePath, content) {
    const target = this.resolveSafePath(filePath);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, content, 'utf8');
    return {
      success: true,
      path: target,
      bytes: Buffer.byteLength(content, 'utf8')
    };
  }

  async checkSyntax(filePath) {
    const target = this.resolveSafePath(filePath);
    if (!fs.existsSync(target)) {
      return { valid: false, error: 'File does not exist' };
    }

    const ext = path.extname(target).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      return new Promise((resolve) => {
        exec(`node --check "${target}"`, (err, stdout, stderr) => {
          if (err) {
            resolve({ valid: false, error: stderr || err.message });
          } else {
            resolve({ valid: true });
          }
        });
      });
    }

    if (ext === '.json') {
      try {
        JSON.parse(fs.readFileSync(target, 'utf8'));
        return { valid: true };
      } catch (e) {
        return { valid: false, error: e.message };
      }
    }

    return { valid: true, skipped: true };
  }
}

module.exports = new LocalWorkspace();
