/**
 * AI Bridge — Generic Multi-VPS / Remote Server Manager
 * Connects securely to ANY user-configured VPS profile using SSH2 / SFTP.
 * ZERO HARDCODED CREDENTIALS.
 */

const { Client } = require('ssh2');
const path = require('path');
const configManager = require('./config-manager');

class VpsManager {
  constructor() {
    this.conn = null;
    this.sftp = null;
    this.isConnected = false;
    this.currentProfileId = null;
  }

  getActiveProfile() {
    return configManager.getActiveVpsProfile();
  }

  getStatus() {
    const active = this.getActiveProfile();
    return {
      connected: this.isConnected && !!this.conn,
      currentProfileId: this.currentProfileId,
      profile: active ? {
        id: active.id,
        name: active.name || active.host,
        host: active.host,
        port: active.port || 22,
        username: active.username || 'root',
        remotePath: active.remotePath || '/root'
      } : null
    };
  }

  async connect(profileOverride = null) {
    const profile = profileOverride || this.getActiveProfile();
    if (!profile || !profile.host) {
      this.disconnect();
      return { connected: false, reason: 'No active VPS profile configured' };
    }

    // Reuse existing connection if same profile and still connected
    if (!profileOverride && this.isConnected && this.currentProfileId === profile.id && this.conn) {
      return { connected: true, profile: profile.name || profile.host };
    }

    this.disconnect();

    return new Promise((resolve, reject) => {
      this.conn = new Client();
      const sshConfig = {
        host: profile.host,
        port: Number(profile.port) || 22,
        username: profile.username || 'root',
        readyTimeout: 15000,
        keepaliveInterval: 10000,
      };

      if (profile.privateKey) {
        sshConfig.privateKey = profile.privateKey;
      } else if (profile.password) {
        sshConfig.password = profile.password;
      }

      this.conn.on('ready', () => {
        this.isConnected = true;
        this.currentProfileId = profile.id;
        console.log(`[VPSManager] Connected to ${profile.username}@${profile.host}:${sshConfig.port}`);

        this.conn.sftp((err, sftpClient) => {
          if (err) {
            console.warn('[VPSManager] SFTP initialization warning:', err.message);
          } else {
            this.sftp = sftpClient;
            console.log('[VPSManager] SFTP subsystem ready');
          }
          resolve({ connected: true, profile: profile.name || profile.host, host: profile.host });
        });
      });

      this.conn.on('error', (err) => {
        this.isConnected = false;
        this.currentProfileId = null;
        console.error('[VPSManager] SSH Error:', err.message);
        reject(err);
      });

      this.conn.on('close', () => {
        this.isConnected = false;
        this.currentProfileId = null;
      });

      try {
        this.conn.connect(sshConfig);
      } catch (err) {
        reject(err);
      }
    });
  }

  async testConnection(testProfile) {
    const profile = testProfile || this.getActiveProfile();
    if (!profile || !profile.host) {
      return { connected: false, reason: 'No VPS host provided to test' };
    }

    return new Promise((resolve) => {
      const conn = new Client();
      const sshConfig = {
        host: profile.host,
        port: Number(profile.port) || 22,
        username: profile.username || 'root',
        readyTimeout: 12000,
      };

      if (profile.privateKey) {
        sshConfig.privateKey = profile.privateKey;
      } else if (profile.password) {
        sshConfig.password = profile.password;
      }

      let resolved = false;
      const finish = (result) => {
        if (!resolved) {
          resolved = true;
          try { conn.end(); } catch (e) {}
          resolve(result);
        }
      };

      conn.on('ready', () => {
        finish({
          connected: true,
          profile: profile.name || profile.host,
          host: profile.host,
          username: profile.username || 'root',
          port: profile.port || 22
        });
      });

      conn.on('error', (err) => {
        finish({ connected: false, error: err.message, host: profile.host });
      });

      try {
        conn.connect(sshConfig);
      } catch (err) {
        finish({ connected: false, error: err.message });
      }
    });
  }

  disconnect() {
    if (this.conn) {
      try { this.conn.end(); } catch (e) {}
      this.conn = null;
    }
    this.sftp = null;
    this.isConnected = false;
    this.currentProfileId = null;
  }

  async exec(command) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('close', (code) => {
          resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  }

  async listDirectory(remotePath) {
    await this.connect();

    const activeVps = this.getActiveProfile();
    const remoteRoot = activeVps?.remotePath || '/root';
    const targetPath = remotePath ? (path.posix.isAbsolute(remotePath) ? remotePath : path.posix.join(remoteRoot, remotePath)) : remoteRoot;

    // Method 1: Use SFTP readdir if available (cleanest, accurate stats, supports spaces)
    if (this.sftp) {
      return new Promise((resolve, reject) => {
        this.sftp.readdir(targetPath, (err, list) => {
          if (err) return reject(err);

          const items = [];
          for (const item of list) {
            const name = item.filename;
            if (name === '.' || name === '..' || name === '.git' || name === 'node_modules') continue;

            const isDir = (item.attrs.mode & 0o40000) !== 0;
            const fullItemPath = path.posix.join(targetPath, name);
            const relativeItemPath = path.posix.relative(remoteRoot, fullItemPath);

            items.push({
              name,
              path: relativeItemPath || name,
              absolutePath: fullItemPath,
              isDirectory: isDir,
              size: item.attrs.size || 0,
              modified: item.attrs.mtime ? new Date(item.attrs.mtime * 1000).toISOString().replace('T', ' ').slice(0, 16) : ''
            });
          }

          // Sort directories first, then alphabetical
          items.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
          });

          resolve({
            currentPath: path.posix.relative(remoteRoot, targetPath) || '/',
            absolutePath: targetPath,
            items
          });
        });
      });
    }

    // Method 2: Fallback to standard ls -la via SSH exec
    const cmd = `ls -la "${targetPath}"`;
    const execRes = await this.exec(cmd);
    const lines = execRes.stdout.split('\n');
    const items = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('total')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 9) {
        const isDir = parts[0].startsWith('d');
        const size = parseInt(parts[4], 10) || 0;
        const name = parts.slice(8).join(' ');
        if (name === '.' || name === '..' || name === '.git' || name === 'node_modules') continue;

        const fullItemPath = path.posix.join(targetPath, name);
        const relativeItemPath = path.posix.relative(remoteRoot, fullItemPath);

        items.push({
          name,
          path: relativeItemPath || name,
          absolutePath: fullItemPath,
          isDirectory: isDir,
          size,
          modified: `${parts[5]} ${parts[6]} ${parts[7]}`
        });
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
      return a.isDirectory ? -1 : 1;
    });

    return {
      currentPath: path.posix.relative(remoteRoot, targetPath) || '/',
      absolutePath: targetPath,
      items
    };
  }

  async readFile(remotePath) {
    await this.connect();
    if (!this.sftp) {
      const res = await this.exec(`cat "${remotePath}"`);
      return res.stdout;
    }

    return new Promise((resolve, reject) => {
      let buffer = '';
      const stream = this.sftp.createReadStream(remotePath);
      stream.on('data', chunk => buffer += chunk.toString('utf8'));
      stream.on('end', () => resolve(buffer));
      stream.on('error', err => reject(err));
    });
  }

  async writeFile(remotePath, content) {
    await this.connect();

    // Ensure parent directory exists on remote VPS
    const parentDir = path.posix.dirname(remotePath);
    if (parentDir && parentDir !== '.' && parentDir !== '/') {
      try {
        await this.exec(`mkdir -p "${parentDir}"`);
      } catch (e) {}
    }

    if (!this.sftp) {
      const base64 = Buffer.from(content).toString('base64');
      await this.exec(`echo "${base64}" | base64 -d > "${remotePath}"`);
      return { success: true, path: remotePath };
    }

    return new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve({ success: true, path: remotePath }));
      stream.on('error', err => reject(err));
      stream.write(content);
      stream.end();
    });
  }

  async restartPM2(appName) {
    const profile = this.getActiveProfile();
    const targetApp = appName || profile?.pm2App;
    if (!targetApp) return { restarted: false, reason: 'No PM2 app configured' };
    const res = await this.exec(`pm2 restart ${targetApp}`);
    return res;
  }
}

module.exports = new VpsManager();
