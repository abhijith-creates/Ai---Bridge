/**
 * AI Bridge — Generic Multi-VPS / Remote Server Manager
 * Connects securely to ANY user-configured VPS profile using SSH2 / SFTP.
 * ZERO HARDCODED CREDENTIALS.
 */

const { Client } = require('ssh2');
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

  async connect() {
    const profile = this.getActiveProfile();
    if (!profile || !profile.host) {
      this.disconnect();
      return { connected: false, reason: 'No active VPS profile configured' };
    }

    // Reuse existing connection if same profile
    if (this.isConnected && this.currentProfileId === profile.id && this.conn) {
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
          resolve({ connected: true, profile: profile.name || profile.host });
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
