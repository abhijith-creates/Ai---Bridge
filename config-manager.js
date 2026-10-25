/**
 * AI Bridge — Configuration Manager
 * Handles local workspace paths, optional multi-VPS profiles, and target chat platforms.
 * Data is stored in config.json locally (ignored by git).
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  version: '1.0.0',
  mode: 'local', // 'local' or 'vps'
  localWorkspace: {
    path: path.join(__dirname, 'workspace'),
    autoCreate: true
  },
  activeVpsId: null,
  vpsProfiles: [
    // Empty by default (zero hardcoded credentials)
  ],
  defaultTargetPlatform: 'aistudio_apps',
  targetPlatforms: [
    {
      id: 'aistudio_apps',
      name: 'Google AI Studio (App Builder)',
      url: 'https://aistudio.google.com/apps',
      category: 'Google AI'
    },
    {
      id: 'aistudio_chat',
      name: 'Google AI Studio (Playground)',
      url: 'https://aistudio.google.com/prompts/new_chat',
      category: 'Google AI'
    },
    {
      id: 'gemini_web',
      name: 'Google Gemini Web',
      url: 'https://gemini.google.com/app',
      category: 'Google AI'
    },
    {
      id: 'chatgpt_web',
      name: 'ChatGPT (OpenAI)',
      url: 'https://chatgpt.com',
      category: 'OpenAI'
    },
    {
      id: 'claude_web',
      name: 'Claude (Anthropic)',
      url: 'https://claude.ai/new',
      category: 'Anthropic'
    }
  ]
};

function ensureWorkspaceDir(wsPath) {
  try {
    if (!fs.existsSync(wsPath)) {
      fs.mkdirSync(wsPath, { recursive: true });
    }
  } catch (e) {}
}

class ConfigManager {
  constructor() {
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const merged = { ...DEFAULT_CONFIG, ...parsed };
        if (merged.mode === 'vps' && (!merged.vpsProfiles || merged.vpsProfiles.length === 0)) {
          merged.mode = 'local';
        }
        if (merged.localWorkspace?.path) {
          ensureWorkspaceDir(merged.localWorkspace.path);
        }
        return merged;
      }
    } catch (err) {
      console.warn('[ConfigManager] Error reading config.json, using defaults:', err.message);
    }
    this.save(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  save(data = this.config) {
    try {
      this.config = data;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[ConfigManager] Save failed:', err.message);
      return false;
    }
  }

  getPublicConfig() {
    // Return sanitized config (mask passwords and keys for UI safety)
    const sanitized = JSON.parse(JSON.stringify(this.config));
    if (Array.isArray(sanitized.vpsProfiles)) {
      sanitized.vpsProfiles = sanitized.vpsProfiles.map(p => ({
        ...p,
        password: p.password ? '••••••••' : '',
        privateKey: p.privateKey ? '[SSH KEY CONFIGURED]' : ''
      }));
    }
    return sanitized;
  }

  setMode(mode) {
    if (mode === 'local' || mode === 'vps') {
      this.config.mode = mode;
      this.save();
    }
  }

  setLocalWorkspace(newPath) {
    if (newPath && typeof newPath === 'string') {
      const resolved = path.resolve(newPath);
      ensureWorkspaceDir(resolved);
      this.config.localWorkspace.path = resolved;
      this.save();
      return resolved;
    }
    return this.config.localWorkspace.path;
  }

  addOrUpdateVpsProfile(profile, activateImmediately = false) {
    if (!profile.id) profile.id = 'vps_' + Date.now();
    const existingIdx = this.config.vpsProfiles.findIndex(p => p.id === profile.id);
    
    // Preserve existing password if user sends masked string
    if (existingIdx !== -1 && profile.password === '••••••••') {
      profile.password = this.config.vpsProfiles[existingIdx].password;
    }
    if (existingIdx !== -1 && profile.privateKey === '[SSH KEY CONFIGURED]') {
      profile.privateKey = this.config.vpsProfiles[existingIdx].privateKey;
    }

    if (existingIdx >= 0) {
      this.config.vpsProfiles[existingIdx] = profile;
    } else {
      this.config.vpsProfiles.push(profile);
    }

    // Auto-set as active if this is the only profile or requested
    if (!this.config.activeVpsId || activateImmediately || this.config.vpsProfiles.length === 1) {
      this.config.activeVpsId = profile.id;
      this.config.mode = 'vps';
    }

    this.save();
    return profile;
  }

  deleteVpsProfile(id) {
    this.config.vpsProfiles = this.config.vpsProfiles.filter(p => p.id !== id);
    if (this.config.activeVpsId === id) {
      this.config.activeVpsId = this.config.vpsProfiles[0]?.id || null;
      if (!this.config.activeVpsId) {
        this.config.mode = 'local';
      }
    }
    this.save();
  }

  setActiveVps(id) {
    const found = this.config.vpsProfiles.find(p => p.id === id);
    if (found || id === null) {
      this.config.activeVpsId = id;
      if (found) {
        this.config.mode = 'vps';
      }
      this.save();
      return true;
    }
    return false;
  }

  getActiveVpsProfile() {
    if (!this.config.activeVpsId) return null;
    return this.config.vpsProfiles.find(p => p.id === this.config.activeVpsId) || null;
  }
}

module.exports = new ConfigManager();
