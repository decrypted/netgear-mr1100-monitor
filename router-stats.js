#!/usr/bin/env node

const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Configuration
const POLL_INTERVAL = 5000; // 5 seconds
const DB_PATH = path.join(__dirname, 'router-stats.db');

// Router credentials (loaded from database on startup)
let ROUTER_IP = null;
let USERNAME = null;
let PASSWORD = null;

// ANSI color codes for nice CLI output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Check for command-line flags
const VERBOSE_MODE = process.argv.includes('--verbose') || process.argv.includes('-v');
const RESET_CREDENTIALS = process.argv.includes('--reset-credentials') || process.argv.includes('--reset');
const SHOW_HELP = process.argv.includes('--help') || process.argv.includes('-h');

// Show help and exit
if (SHOW_HELP) {
  console.log(`
${colors.bright}${colors.cyan}Netgear MR1100 Router Stats Monitor${colors.reset}

${colors.bright}Usage:${colors.reset}
  node router-stats.js [options]
  npm start              (recommended)

${colors.bright}Options:${colors.reset}
  --verbose, -v          Start with verbose mode enabled (shows device details)
  --reset                Reset saved credentials and prompt for new ones
  --reset-credentials    Same as --reset
  --help, -h             Show this help message

${colors.bright}First Run:${colors.reset}
  On first run, you'll be prompted to enter:
  - Router IP address (default: 192.168.2.1)
  - Username (default: admin)
  - Password (masked input)

  Credentials are securely stored in SQLite database.

${colors.bright}Interactive Keyboard Controls:${colors.reset}
  ${colors.cyan}[n]${colors.reset}  Toggle Network connection panel
  ${colors.cyan}[b]${colors.reset}  Toggle Bandwidth & data usage panel
  ${colors.cyan}[h]${colors.reset}  Toggle bandwidth History histogram
  ${colors.cyan}[d]${colors.reset}  Toggle Device & WiFi status panel
  ${colors.cyan}[v]${colors.reset}  Toggle Verbose mode (device details)
  ${colors.cyan}[r]${colors.reset}  Reset credentials (exits and prompts on restart)
  ${colors.cyan}[q]${colors.reset}  Quit application

${colors.bright}Examples:${colors.reset}
  npm start                          # Standard mode
  npm run verbose                    # Start with verbose mode
  npm run reset                      # Reset credentials
  node router-stats.js --verbose     # Start with verbose mode
  node router-stats.js --reset       # Reset credentials

${colors.bright}Documentation:${colors.reset}
  https://github.com/decrypted/netgear-mr1100-monitor

${colors.bright}License:${colors.reset} MIT
`);
  process.exit(0);
}

let sessionCookie = null;
let previousStats = null;
let bandwidthHistory = {
  download: [],
  upload: [],
  maxSamples: 66  // Fill most of the panel width
};
let displayOptions = {
  showNetwork: true,
  showBandwidth: true,
  showDevice: false,
  showVerbose: VERBOSE_MODE,
  showHistory: false
};

let db = null;

// Database functions
function initDatabase() {
  db = new Database(DB_PATH);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS bandwidth_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      download_speed REAL NOT NULL,
      upload_speed REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS timeseries_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      total_rx_bytes INTEGER NOT NULL,
      total_tx_bytes INTEGER NOT NULL,
      session_duration INTEGER NOT NULL,
      lifetime_bytes INTEGER,
      signal_rsrp INTEGER,
      signal_rsrq INTEGER,
      signal_sinr INTEGER,
      cellular_download INTEGER,
      cellular_upload INTEGER,
      wifi_offload_download INTEGER,
      wifi_offload_upload INTEGER,
      wifi_offload_active INTEGER,
      wifi_offload_ssid TEXT,
      wifi_offload_rssi INTEGER,
      wifi_offload_bars INTEGER,
      ethernet_offload_download INTEGER,
      ethernet_offload_upload INTEGER,
      ethernet_offload_active INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_bandwidth_timestamp ON bandwidth_history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_timeseries_timestamp ON timeseries_data(timestamp DESC);
  `);

  console.log(`${colors.green}✓${colors.reset} Database initialized`);
}

function saveBandwidthData(downloadSpeed, uploadSpeed) {
  if (!db) return;

  const stmt = db.prepare('INSERT INTO bandwidth_history (timestamp, download_speed, upload_speed) VALUES (?, ?, ?)');
  stmt.run(Date.now(), downloadSpeed, uploadSpeed);
}

function loadBandwidthHistory(maxSamples = 20) {
  if (!db) return { download: [], upload: [] };

  // Load last maxSamples entries from database
  const stmt = db.prepare('SELECT download_speed, upload_speed FROM bandwidth_history ORDER BY timestamp DESC LIMIT ?');
  const rows = stmt.all(maxSamples);

  // Reverse to get oldest first (for correct histogram display)
  rows.reverse();

  return {
    download: rows.map(r => r.download_speed),
    upload: rows.map(r => r.upload_speed)
  };
}

function saveSettings() {
  if (!db) return;

  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  stmt.run('displayOptions', JSON.stringify(displayOptions));
}

function loadSettings() {
  if (!db) return;

  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get('displayOptions');

  if (row) {
    const saved = JSON.parse(row.value);
    // Merge saved settings with defaults (in case new options were added)
    displayOptions = { ...displayOptions, ...saved };
    console.log(`${colors.green}✓${colors.reset} Settings loaded from database`);
  }
}

function saveCredentials(ip, username, password) {
  if (!db) return;

  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const credentials = { ip, username, password };
  stmt.run('credentials', JSON.stringify(credentials));
}

function loadCredentials() {
  if (!db) return null;

  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get('credentials');

  if (row) {
    return JSON.parse(row.value);
  }
  return null;
}

// Helper function for masked password input
function readPasswordMasked(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    // Make sure stdin is in raw mode before reading
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let pass = '';

    const onData = (char) => {
      char = char.toString('utf8');

      if (char === '\n' || char === '\r' || char === '\u0004') {
        // Enter pressed
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pass);
      } else if (char === '\u0003') {
        // Ctrl+C pressed
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(0);
      } else if (char === '\u007f' || char === '\b') {
        // Backspace pressed
        if (pass.length > 0) {
          pass = pass.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char >= ' ' && char <= '~') {
        // Printable ASCII character
        pass += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

// Prompt user for credentials on first run
async function promptForCredentials() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  console.log(`\n${colors.bright}${colors.cyan}First-time setup${colors.reset}`);
  console.log(`${colors.dim}Please enter your router credentials:${colors.reset}\n`);

  const ip = await question(`Router IP address ${colors.dim}(default: 192.168.2.1)${colors.reset}: `) || '192.168.2.1';
  const username = await question(`Username ${colors.dim}(default: admin)${colors.reset}: `) || 'admin';

  // Close readline interface before entering raw mode for password
  rl.close();

  // Hide password input using raw mode
  const password = await readPasswordMasked(`Password: `);

  console.log(`${colors.green}✓${colors.reset} Credentials saved to database\n`);

  return { ip, username, password };
}

function saveTimeseriesData(timestamp, totalRx, totalTx, sessionDuration, lifetimeBytes, signalRsrp, signalRsrq, signalSinr,
                            cellularDownload, cellularUpload, wifiOffloadDownload, wifiOffloadUpload, wifiOffloadActive, wifiOffloadSsid,
                            wifiOffloadRssi, wifiOffloadBars, ethernetOffloadDownload, ethernetOffloadUpload, ethernetOffloadActive) {
  if (!db) return;

  const stmt = db.prepare(`
    INSERT INTO timeseries_data (
      timestamp, total_rx_bytes, total_tx_bytes, session_duration, lifetime_bytes, signal_rsrp, signal_rsrq, signal_sinr,
      cellular_download, cellular_upload, wifi_offload_download, wifi_offload_upload, wifi_offload_active, wifi_offload_ssid,
      wifi_offload_rssi, wifi_offload_bars, ethernet_offload_download, ethernet_offload_upload, ethernet_offload_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(timestamp, totalRx, totalTx, sessionDuration, lifetimeBytes, signalRsrp, signalRsrq, signalSinr,
           cellularDownload, cellularUpload, wifiOffloadDownload, wifiOffloadUpload, wifiOffloadActive ? 1 : 0, wifiOffloadSsid,
           wifiOffloadRssi, wifiOffloadBars, ethernetOffloadDownload, ethernetOffloadUpload, ethernetOffloadActive ? 1 : 0);
}

// Detect gap in data and interpolate missing lifetime usage
function handleDataGap(currentTimestamp, lifetimeBytes) {
  if (!db) return false;

  // Get the last recorded entry
  const lastEntry = db.prepare(`
    SELECT timestamp, lifetime_bytes
    FROM timeseries_data
    WHERE lifetime_bytes IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
  `).get();

  if (!lastEntry) {
    return false; // No previous data, nothing to interpolate
  }

  const timeSinceLastPoll = currentTimestamp - lastEntry.timestamp;
  const gapThreshold = POLL_INTERVAL * 3; // Consider it a gap if >15 seconds (3x poll interval)

  // If there's a significant gap AND lifetime bytes increased
  if (timeSinceLastPoll > gapThreshold && lifetimeBytes > lastEntry.lifetime_bytes) {
    const lifetimeDelta = lifetimeBytes - lastEntry.lifetime_bytes;
    const numIntervals = Math.floor(timeSinceLastPoll / POLL_INTERVAL);

    // Only interpolate if the gap is reasonable (less than 24 hours) and we have significant data
    if (numIntervals > 0 && numIntervals < (24 * 60 * 60 * 1000 / POLL_INTERVAL) && lifetimeDelta > 0) {
      const bytesPerInterval = lifetimeDelta / numIntervals;

      console.log(`${colors.yellow}⚠${colors.reset} Detected ${Math.floor(timeSinceLastPoll / 1000 / 60)}min gap - interpolating ${formatBytes(lifetimeDelta)} across ${numIntervals} intervals`);

      // Insert interpolated records
      const insertStmt = db.prepare(`
        INSERT INTO timeseries_data (timestamp, total_rx_bytes, total_tx_bytes, session_duration, lifetime_bytes, signal_rsrp, signal_rsrq, signal_sinr)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 1; i < numIntervals; i++) {
        const interpolatedTimestamp = lastEntry.timestamp + (i * POLL_INTERVAL);
        const interpolatedLifetime = Math.floor(lastEntry.lifetime_bytes + (bytesPerInterval * i));

        // Use 0 for session counters as we don't know the session state during the gap
        // Use NULL for signal values as we don't have that data
        insertStmt.run(interpolatedTimestamp, 0, 0, 0, interpolatedLifetime, null, null, null);
      }

      return true;
    }
  }

  return false;
}

// Calculate data usage over time periods
function calculateUsageOverTime() {
  if (!db) return null;

  const now = Date.now();
  const periods = {
    '5m': now - (5 * 60 * 1000),
    '15m': now - (15 * 60 * 1000),
    '30m': now - (30 * 60 * 1000),
    '45m': now - (45 * 60 * 1000),
    '1h': now - (60 * 60 * 1000),
    '6h': now - (6 * 60 * 60 * 1000),
    '12h': now - (12 * 60 * 60 * 1000),
    '24h': now - (24 * 60 * 60 * 1000)
  };

  const result = {};

  for (const [label, cutoffTime] of Object.entries(periods)) {
    // Get the earliest and latest total bytes (RX+TX) within the period
    // This includes ALL connection types (cellular + WiFi offload + Ethernet offload)
    const stmt = db.prepare(`
      SELECT
        MIN(total_rx_bytes + total_tx_bytes) as start_bytes,
        MAX(total_rx_bytes + total_tx_bytes) as end_bytes
      FROM timeseries_data
      WHERE timestamp >= ?
    `);

    const row = stmt.get(cutoffTime);

    if (row && row.start_bytes !== null && row.end_bytes !== null) {
      result[label] = row.end_bytes - row.start_bytes;
    } else {
      result[label] = null;
    }
  }

  return result;
}

function calculateSpeedsFromTimeseries(limit = 20) {
  if (!db) return { download: [], upload: [], timestamps: [] };

  // Get last N+1 records to calculate N speed deltas
  const stmt = db.prepare(`
    SELECT timestamp, total_rx_bytes, total_tx_bytes
    FROM timeseries_data
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit + 1);

  if (rows.length < 2) {
    return { download: [], upload: [], timestamps: [] };
  }

  // Reverse to get oldest first
  rows.reverse();

  const downloadSpeeds = [];
  const uploadSpeeds = [];
  const timestamps = [];

  // Calculate speeds between consecutive data points
  for (let i = 1; i < rows.length; i++) {
    const current = rows[i];
    const previous = rows[i - 1];

    const timeDiffMs = current.timestamp - previous.timestamp;
    const timeDiffSec = timeDiffMs / 1000;

    // Calculate bytes transferred and convert to bytes/second
    // NOTE: Database stores aggregated totals (already converted to standard convention)
    const rxDiff = current.total_rx_bytes - previous.total_rx_bytes;
    const txDiff = current.total_tx_bytes - previous.total_tx_bytes;

    // Handle counter rollover (router reset) - skip negative values
    if (rxDiff >= 0 && txDiff >= 0 && timeDiffSec > 0) {
      const downloadSpeed = rxDiff / timeDiffSec;  // RX = Download (standard)
      const uploadSpeed = txDiff / timeDiffSec;    // TX = Upload (standard)

      downloadSpeeds.push(downloadSpeed);
      uploadSpeeds.push(uploadSpeed);
      timestamps.push(current.timestamp);
    }
  }

  return {
    download: downloadSpeeds,
    upload: uploadSpeeds,
    timestamps: timestamps
  };
}

function cleanOldData(daysToKeep = 7) {
  if (!db) return;

  const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

  const stmt1 = db.prepare('DELETE FROM bandwidth_history WHERE timestamp < ?');
  const result1 = stmt1.run(cutoffTime);

  const stmt2 = db.prepare('DELETE FROM timeseries_data WHERE timestamp < ?');
  const result2 = stmt2.run(cutoffTime);

  const totalCleaned = result1.changes + result2.changes;
  if (totalCleaned > 0) {
    console.log(`${colors.dim}Cleaned ${totalCleaned} old records (${result1.changes} speeds, ${result2.changes} timeseries)${colors.reset}`);
  }
}

// Helper function to make HTTP requests with timeout
function httpRequest(options, postData = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';

      // Capture Set-Cookie header
      if (res.headers['set-cookie']) {
        const cookieHeader = res.headers['set-cookie'].find(c => c.startsWith('sessionId='));
        if (cookieHeader) {
          sessionCookie = cookieHeader.split(';')[0];
        }
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode: res.statusCode, data, headers: res.headers });
      });
    });

    // Set timeout for connection
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

// Initialize session
async function initSession() {
  try {
    const options = {
      hostname: ROUTER_IP,
      port: 80,
      path: '/sess_cd_tmp',
      method: 'GET',
    };

    await httpRequest(options);
    console.log(`${colors.green}✓${colors.reset} Session initialized`);
    return true;
  } catch (error) {
    console.error(`${colors.red}✗${colors.reset} Failed to initialize session:`, error.message);
    return false;
  }
}

// Login to router
async function login() {
  try {
    // First get the security token
    const apiOptions = {
      hostname: ROUTER_IP,
      port: 80,
      path: `/api/model.json?internalapi=1&x=${Date.now()}`,
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    };

    const apiResponse = await httpRequest(apiOptions);
    const data = JSON.parse(apiResponse.data);
    const secToken = data.session.secToken;

    // Now login with credentials
    const loginOptions = {
      hostname: ROUTER_IP,
      port: 80,
      path: '/Forms/config',
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    };

    const postData = `session.password=${PASSWORD}&token=${secToken}`;
    await httpRequest(loginOptions, postData);

    console.log(`${colors.green}✓${colors.reset} Logged in as ${USERNAME}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}✗${colors.reset} Login failed:`, error.message);
    return false;
  }
}

// Re-authenticate when session expires
async function reAuthenticate() {
  console.log(`${colors.yellow}⟳${colors.reset} Session expired, re-authenticating...`);

  if (await initSession() && await login()) {
    console.log(`${colors.green}✓${colors.reset} Re-authentication successful`);
    return true;
  }

  console.error(`${colors.red}✗${colors.reset} Re-authentication failed`);
  return false;
}

// Fetch router stats with automatic re-authentication
async function fetchStats(retryOnAuthFailure = true) {
  try {
    const options = {
      hostname: ROUTER_IP,
      port: 80,
      path: `/api/model.json?internalapi=1&x=${Date.now()}`,
      method: 'GET',
      headers: {
        'Cookie': sessionCookie
      }
    };

    const response = await httpRequest(options);

    // Check if we got HTML instead of JSON (session expired)
    if (response.data.trim().startsWith('<!DOCTYPE') || response.data.trim().startsWith('<html')) {
      if (retryOnAuthFailure) {
        // Session expired, try to re-authenticate
        if (await reAuthenticate()) {
          // Retry the request with new session (but don't retry again to avoid infinite loop)
          return await fetchStats(false);
        }
      }
      return null;
    }

    const data = JSON.parse(response.data);
    return data;
  } catch (error) {
    // Handle network errors (EHOSTUNREACH, ENETUNREACH, ECONNRESET)
    if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH' || error.code === 'ECONNRESET') {
      console.error(`${colors.red}✗${colors.reset} Network error: ${error.message}`);
      console.log(`${colors.dim}Waiting for network to recover...${colors.reset}`);
      return null;
    }

    // Handle JSON parse errors (session expired)
    if (error.message.includes('Unexpected token') && retryOnAuthFailure) {
      if (await reAuthenticate()) {
        return await fetchStats(false);
      }
    }

    console.error(`${colors.red}✗${colors.reset} Failed to fetch stats:`, error.message);
    return null;
  }
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Calculate bandwidth (bytes per second)
function calculateBandwidth(currentBytes, previousBytes, timeInterval) {
  if (!previousBytes) return 0;
  const bytesDiff = currentBytes - previousBytes;
  const bytesPerSecond = (bytesDiff / timeInterval) * 1000; // timeInterval is in ms
  return Math.max(0, bytesPerSecond);
}

// Format signal strength bars
function getSignalBars(bars) {
  const filled = '█'.repeat(bars);
  const empty = '░'.repeat(5 - bars);
  let color = colors.red;
  if (bars >= 4) color = colors.green;
  else if (bars >= 3) color = colors.yellow;
  return `${color}${filled}${colors.dim}${empty}${colors.reset}`;
}

// Create ASCII histogram
function createHistogram(data, maxWidth = 40, color = colors.cyan) {
  if (data.length === 0) return '';

  const max = Math.max(...data, 1);
  const lines = [];

  // Create 5 rows for the histogram (from top to bottom)
  for (let row = 4; row >= 0; row--) {
    let line = '  ';
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const normalizedHeight = (value / max) * 5;

      if (normalizedHeight > row + 0.75) {
        line += color + '█' + colors.reset;
      } else if (normalizedHeight > row + 0.25) {
        line += color + '▄' + colors.reset;
      } else if (normalizedHeight > row) {
        line += color + '▁' + colors.reset;
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

// Create horizontal bar graph
function createBarGraph(label, value, maxValue, width = 30, color = colors.cyan) {
  const percentage = maxValue > 0 ? (value / maxValue) : 0;
  const filledWidth = Math.floor(percentage * width);
  const emptyWidth = width - filledWidth;

  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);

  return `  ${label.padEnd(12)} ${color}${filled}${colors.dim}${empty}${colors.reset} ${formatBytes(value)}/s`;
}

// Format data usage bar
function createDataBar(label, current, total, width = 30, color = colors.cyan) {
  const percentage = total > 0 ? (current / total) : 0;
  const filledWidth = Math.floor(percentage * width);
  const emptyWidth = width - filledWidth;

  const filled = '▓'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  const percentStr = (percentage * 100).toFixed(1) + '%';
  const sizeStr = formatBytes(current);

  return `  ${label.padEnd(10)} ${color}${filled}${colors.dim}${empty}${colors.reset} ${percentStr.padStart(5)} ${sizeStr.padStart(10)}`;
}

// Display stats
function displayStats(data) {
  console.clear();

  // Validate data structure
  if (!data || !data.wwan || !data.general || !data.power) {
    console.error(`${colors.red}✗${colors.reset} Invalid data received from router`);
    console.log(`${colors.dim}The router may not be properly authenticated or the API format has changed${colors.reset}`);
    console.log(`${colors.dim}Current config: IP=${ROUTER_IP}, User=${USERNAME}${colors.reset}\n`);
    console.log(`${colors.yellow}To reset credentials:${colors.reset}`);
    console.log(`  • Press ${colors.cyan}[r]${colors.reset} to reset credentials and restart`);
    console.log(`  • Or restart with: ${colors.cyan}npm run reset${colors.reset}`);
    console.log(`  • Or press ${colors.cyan}Ctrl+C${colors.reset} to exit\n`);
    return;
  }

  const now = new Date().toLocaleTimeString();
  const uptime = Math.floor(data.general.upTime / 60);

  // Header - 76 chars wide to match panels (74 chars between ║ symbols)
  const titleText = `Netgear ${data.general.model} Router Monitor`;
  const titlePadding = ' '.repeat(Math.max(0, 72 - titleText.length));

  const powerText = `Power: ${data.power.PMState}`;
  const statusLine = `  ${now}`;
  const statusPadding = ' '.repeat(Math.max(0, 72 - statusLine.length - powerText.length));

  console.log(`${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}  ${colors.bright}${titleText}${colors.reset}${titlePadding}${colors.bright}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╠══════════════════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║${colors.reset}${colors.dim}${statusLine}${statusPadding}${powerText}${colors.reset}  ${colors.bright}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Network Connection
  const wwan = data.wwan;
  const wwanAdv = data.wwanadv;
  const signal = wwan.signalStrength;

  if (displayOptions.showNetwork) {
    console.log(`${colors.bright}${colors.white}┌─ 📶 Network Connection ────────────────────────────────────────────────┐${colors.reset}`);

    // Check for WiFi offloading
    const wifiOffload = data.wifi && data.wifi.offload;
    const wifiOffloadActive = wifiOffload && wifiOffload.enabled && wifiOffload.status === 'On' && wifiOffload.connectionSsid;

    // Check for Ethernet offloading
    const ethOffload = data.ethernet && data.ethernet.offload;
    const ethOffloadActive = ethOffload && ethOffload.enabled && ethOffload.on && ethOffload.ipv4Addr && ethOffload.ipv4Addr !== '0.0.0.0';

    if (wifiOffloadActive) {
      // WiFi offloading is active - show offload info only
      const offloadBars = getSignalBars(wifiOffload.bars || 0);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Status:${colors.reset}    📡 ${colors.green}WiFi Offload${colors.reset} via ${colors.bright}${wifiOffload.connectionSsid}${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Signal:${colors.reset}    ${offloadBars} ${wifiOffload.bars || 0}/5 bars`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}IP:${colors.reset}        ${colors.magenta}${wifiOffload.stationIPv4 || 'N/A'}${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Cellular:${colors.reset}  ${colors.dim}${wwan.connection} (${wwan.connectionText}) via ${wwan.registerNetworkDisplay} - Standby${colors.reset}`);
    } else if (ethOffloadActive) {
      // Ethernet offloading is active - show offload info only
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Status:${colors.reset}    🔌 ${colors.green}Ethernet Offload${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}IP:${colors.reset}        ${colors.magenta}${ethOffload.ipv4Addr}${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Cellular:${colors.reset}  ${colors.dim}${wwan.connection} (${wwan.connectionText}) via ${wwan.registerNetworkDisplay} - Standby${colors.reset}`);
    } else {
      // No offloading - show normal cellular connection info
      const dataUsage = wwan.dataUsage && wwan.dataUsage.generic;
      const lifetimeData = dataUsage ? parseInt(dataUsage.dataTransferred || 0) : 0;
      const roamingData = dataUsage ? parseInt(dataUsage.dataTransferredRoaming || 0) : 0;
      const totalLifetimeBytes = lifetimeData + roamingData;

      console.log(`${colors.white}│${colors.reset} ${colors.bright}Status:${colors.reset}    ${colors.green}${wwan.connection}${colors.reset} (${wwan.connectionText}) via ${colors.bright}${wwan.registerNetworkDisplay}${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Signal:${colors.reset}    ${getSignalBars(signal.bars)} ${signal.bars}/5 bars`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Quality:${colors.reset}   RSRP ${colors.cyan}${signal.rsrp} dBm${colors.reset} │ RSRQ ${colors.cyan}${signal.rsrq} dB${colors.reset} │ SINR ${colors.cyan}${signal.sinr} dB${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Band:${colors.reset}      ${colors.yellow}${wwanAdv.curBand}${colors.reset} │ IP: ${colors.magenta}${wwan.IP}${colors.reset}`);
      if (totalLifetimeBytes > 0) {
        console.log(`${colors.white}│${colors.reset} ${colors.bright}Lifetime:${colors.reset}  ${colors.yellow}${formatBytes(totalLifetimeBytes)}${colors.reset} ${colors.dim}(billing cycle)${colors.reset}`);
      }
    }

    console.log(`${colors.white}│${colors.reset} ${colors.bright}Session:${colors.reset}   ${Math.floor(wwan.sessDuration / 60)}m ${wwan.sessDuration % 60}s`);

    // Warning about offload counter accuracy
    if (wifiOffloadActive || ethOffloadActive) {
      console.log(`${colors.white}│${colors.reset} ${colors.yellow}⚠ Note:${colors.reset}     ${colors.dim}Offload counters may be inaccurate due to router firmware${colors.reset}`);
    }

    console.log(`${colors.white}└────────────────────────────────────────────────────────────────────────┘${colors.reset}\n`);
  }

  // Data Usage - with safety checks for data structure
  if (!wwan.dataUsage || !wwan.dataUsage.generic) {
    console.error(`${colors.red}✗${colors.reset} Invalid data structure received from router`);
    console.log(`${colors.dim}This might indicate authentication issues or API changes${colors.reset}`);
    console.log(`${colors.dim}Current config: IP=${ROUTER_IP}, User=${USERNAME}${colors.reset}\n`);
    console.log(`${colors.yellow}To reset credentials:${colors.reset}`);
    console.log(`  • Press ${colors.cyan}[r]${colors.reset} to reset credentials and restart`);
    console.log(`  • Or restart with: ${colors.cyan}npm run reset${colors.reset}`);
    console.log(`  • Or press ${colors.cyan}Ctrl+C${colors.reset} to exit\n`);
    return;
  }

  const dataUsage = wwan.dataUsage.generic;

  // Aggregate data from all sources (cellular + WiFi offload + Ethernet offload)
  // NOTE: Cellular uses standard convention (TX=Upload, RX=Download)
  // BUT offload counters are reversed (TX=Download, RX=Upload)!
  let totalDownload = parseInt(wwan.dataTransferredRx) || 0;  // Cellular: RX = Download
  let totalUpload = parseInt(wwan.dataTransferredTx) || 0;     // Cellular: TX = Upload

  // Add WiFi offload data if available (reversed convention!)
  const wifiOffload = data.wifi && data.wifi.offload;
  if (wifiOffload && wifiOffload.dataTransferred) {
    totalDownload += parseInt(wifiOffload.dataTransferred.tx) || 0;  // Offload: TX = Download
    totalUpload += parseInt(wifiOffload.dataTransferred.rx) || 0;     // Offload: RX = Upload
  }

  // Add Ethernet offload data if available (reversed convention!)
  const ethOffload = data.ethernet && data.ethernet.offload;
  if (ethOffload) {
    totalDownload += parseInt(ethOffload.tx) || 0;  // Offload: TX = Download
    totalUpload += parseInt(ethOffload.rx) || 0;     // Offload: RX = Upload
  }

  const totalData = totalDownload + totalUpload;

  // Calculate lifetime usage
  const lifetimeData = parseInt(dataUsage.dataTransferred || 0);
  const roamingData = parseInt(dataUsage.dataTransferredRoaming || 0);
  const totalLifetimeBytes = lifetimeData + roamingData;

  if (displayOptions.showBandwidth) {
    // Check if offloading is active for warning display in header
    const isOffloadActive = (wifiOffload && wifiOffload.enabled && wifiOffload.status === 'On' && wifiOffload.connectionSsid) ||
                            (ethOffload && ethOffload.enabled && ethOffload.on && ethOffload.ipv4Addr && ethOffload.ipv4Addr !== '0.0.0.0');

    // Show warning in header if offloading is active
    if (isOffloadActive) {
      console.log(`${colors.bright}${colors.white}┌─ Data Usage & Bandwidth ${colors.yellow}⚠ May be inaccurate${colors.white} ───────────────────────┐${colors.reset}`);
    } else {
      console.log(`${colors.bright}${colors.white}┌─ Data Usage & Bandwidth ───────────────────────────────────────────────┐${colors.reset}`);
    }
    console.log(`${colors.white}│${colors.reset} ${colors.bright}Session Data:${colors.reset}`);
    console.log(`${colors.white}│${colors.reset}${createDataBar('Download', totalDownload, totalData, 35, colors.cyan)}`);
    console.log(`${colors.white}│${colors.reset}${createDataBar('Upload', totalUpload, totalData, 35, colors.magenta)}`);
    console.log(`${colors.white}│${colors.reset}   ${colors.dim}Total: ${colors.yellow}${formatBytes(totalData)}${colors.reset}`);

    // Calculate usage over time periods
    const usage = calculateUsageOverTime();
    if (usage) {
      // Helper function to format usage entry with fixed width (padded labels, right-aligned values)
      const formatUsageEntry = (label, bytes) => {
        const formatted = bytes === null ? '---' : formatBytes(bytes);
        const paddedLabel = label.padEnd(3); // Pad label to 3 chars (e.g., "5m ", "1h ", "24h")
        const value = formatted.padStart(9); // Right-align the value part
        // Colorize: cyan label, yellow value
        return `${colors.cyan}${paddedLabel}${colors.reset}:${colors.yellow}${value}${colors.reset} `;
      };

      // Minutes line
      const minuteParts = [];
      if (usage['5m'] !== null || usage['15m'] !== null || usage['30m'] !== null || usage['45m'] !== null) {
        minuteParts.push(formatUsageEntry('5m', usage['5m']));
        minuteParts.push(formatUsageEntry('15m', usage['15m']));
        minuteParts.push(formatUsageEntry('30m', usage['30m']));
        minuteParts.push(formatUsageEntry('45m', usage['45m']));

        console.log(`${colors.white}│${colors.reset}   ${minuteParts.join('')}`);
      }

      // Hours line
      const hourParts = [];
      if (usage['1h'] !== null || usage['6h'] !== null || usage['12h'] !== null || usage['24h'] !== null) {
        hourParts.push(formatUsageEntry('1h', usage['1h']));
        hourParts.push(formatUsageEntry('6h', usage['6h']));
        hourParts.push(formatUsageEntry('12h', usage['12h']));
        hourParts.push(formatUsageEntry('24h', usage['24h']));

        console.log(`${colors.white}│${colors.reset}   ${hourParts.join('')}`);
      }
    }
  }

  // Save timeseries data (raw byte counters) - do this on every poll
  const timestamp = Date.now();

  // Check for gaps and interpolate missing data before saving current data
  handleDataGap(timestamp, totalLifetimeBytes);

  // Calculate individual connection type breakdown
  const cellularDownload = parseInt(wwan.dataTransferredRx) || 0;
  const cellularUpload = parseInt(wwan.dataTransferredTx) || 0;

  const wifiOffloadDownload = (wifiOffload && wifiOffload.dataTransferred) ? (parseInt(wifiOffload.dataTransferred.tx) || 0) : 0;
  const wifiOffloadUpload = (wifiOffload && wifiOffload.dataTransferred) ? (parseInt(wifiOffload.dataTransferred.rx) || 0) : 0;
  const wifiOffloadActive = wifiOffload && wifiOffload.enabled && wifiOffload.status === 'On' && wifiOffload.connectionSsid;
  const wifiOffloadSsid = wifiOffloadActive ? wifiOffload.connectionSsid : null;
  const wifiOffloadRssi = wifiOffloadActive ? (wifiOffload.rssi || null) : null;
  const wifiOffloadBars = wifiOffloadActive ? (wifiOffload.bars || null) : null;

  const ethernetOffloadDownload = ethOffload ? (parseInt(ethOffload.tx) || 0) : 0;
  const ethernetOffloadUpload = ethOffload ? (parseInt(ethOffload.rx) || 0) : 0;
  const ethernetOffloadActive = ethOffload && ethOffload.enabled && ethOffload.on && ethOffload.ipv4Addr && ethOffload.ipv4Addr !== '0.0.0.0';

  saveTimeseriesData(
    timestamp,
    totalUpload,
    totalDownload,
    wwan.sessDuration,
    totalLifetimeBytes,
    signal.rsrp,
    signal.rsrq,
    signal.sinr,
    cellularDownload,
    cellularUpload,
    wifiOffloadDownload,
    wifiOffloadUpload,
    wifiOffloadActive,
    wifiOffloadSsid,
    wifiOffloadRssi,
    wifiOffloadBars,
    ethernetOffloadDownload,
    ethernetOffloadUpload,
    ethernetOffloadActive
  );

  // Calculate bandwidth if we have previous stats
  if (previousStats) {
    const timeDiff = POLL_INTERVAL;
    // Cellular: standard convention (TX=Upload, RX=Download)
    // Offload: reversed convention (TX=Download, RX=Upload)
    // Aggregate previous totals from all sources (just like we did for current totals)
    let prevDownload = parseInt(previousStats.wwan.dataTransferredRx) || 0;  // Cellular: RX = Download
    let prevUpload = parseInt(previousStats.wwan.dataTransferredTx) || 0;     // Cellular: TX = Upload

    // Add previous WiFi offload data if available (reversed!)
    const prevWifiOffload = previousStats.wifi && previousStats.wifi.offload;
    if (prevWifiOffload && prevWifiOffload.dataTransferred) {
      prevDownload += parseInt(prevWifiOffload.dataTransferred.tx) || 0;  // Offload: TX = Download
      prevUpload += parseInt(prevWifiOffload.dataTransferred.rx) || 0;     // Offload: RX = Upload
    }

    // Add previous Ethernet offload data if available (reversed!)
    const prevEthOffload = previousStats.ethernet && previousStats.ethernet.offload;
    if (prevEthOffload) {
      prevDownload += parseInt(prevEthOffload.tx) || 0;  // Offload: TX = Download
      prevUpload += parseInt(prevEthOffload.rx) || 0;     // Offload: RX = Upload
    }

    const downloadSpeed = calculateBandwidth(totalDownload, prevDownload, timeDiff);
    const uploadSpeed = calculateBandwidth(totalUpload, prevUpload, timeDiff);

    // Save calculated speed to legacy table (for backward compatibility)
    saveBandwidthData(downloadSpeed, uploadSpeed);

    // Add to history
    bandwidthHistory.download.push(downloadSpeed);
    bandwidthHistory.upload.push(uploadSpeed);
    if (bandwidthHistory.download.length > bandwidthHistory.maxSamples) {
      bandwidthHistory.download.shift();
      bandwidthHistory.upload.shift();
    }

    // Use max of current speeds for bar graphs (not historical max, which can make current speeds look tiny)
    const currentMaxSpeed = Math.max(downloadSpeed, uploadSpeed, 1);
    // Use historical max for histogram scaling
    const historicalMaxSpeed = Math.max(...bandwidthHistory.download, ...bandwidthHistory.upload, 1);

    if (displayOptions.showBandwidth) {
      console.log(`${colors.white}│${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Current Speed:${colors.reset}`);
      console.log(`${colors.white}│${colors.reset}${createBarGraph('Download', downloadSpeed, currentMaxSpeed, 35, colors.cyan)}`);
      console.log(`${colors.white}│${colors.reset}${createBarGraph('Upload', uploadSpeed, currentMaxSpeed, 35, colors.magenta)}`);

      // Show histogram if we have enough data AND it's enabled
      if (displayOptions.showHistory && bandwidthHistory.download.length >= 5) {
        console.log(`${colors.white}│${colors.reset}`);
        console.log(`${colors.white}│${colors.reset} ${colors.bright}History:${colors.reset} ${colors.dim}(${bandwidthHistory.download.length} samples)${colors.reset}`);
        const histoDownload = createHistogram(bandwidthHistory.download, 66, colors.cyan);
        const histoUpload = createHistogram(bandwidthHistory.upload, 66, colors.magenta);

        console.log(`${colors.white}│${colors.reset}   ${colors.cyan}DL:${colors.reset}`);
        histoDownload.split('\n').forEach(line => console.log(`${colors.white}│${colors.reset}${line}`));
        console.log(`${colors.white}│${colors.reset}   ${colors.magenta}UL:${colors.reset}`);
        histoUpload.split('\n').forEach(line => console.log(`${colors.white}│${colors.reset}${line}`));
      }
    }
  }

  if (displayOptions.showBandwidth) {
    console.log(`${colors.white}└────────────────────────────────────────────────────────────────────────┘${colors.reset}\n`);
  }

  // Device Information
  const power = data.power;
  const general = data.general;
  const wifi = data.wifi;
  const clients = data.router.clientList.filter(c => c.IP);

  if (displayOptions.showDevice) {
    // Temperature color
    let tempColor = colors.green;
    if (general.devTemperature > 60) tempColor = colors.red;
    else if (general.devTemperature > 50) tempColor = colors.yellow;

    console.log(`${colors.bright}${colors.white}┌─ 🖥️  Device & WiFi Status ─────────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.white}│${colors.reset} ${colors.bright}Device:${colors.reset}    🌡️  ${tempColor}${general.devTemperature}°C${colors.reset} │ ⏱️  Uptime ${Math.floor(general.upTime / 60)}m ${general.upTime % 60}s │ 🔌 ${power.PMState}`);
    console.log(`${colors.white}│${colors.reset} ${colors.bright}WiFi:${colors.reset}      📡 ${colors.cyan}${wifi.SSID}${colors.reset} (${wifi.status}) │ 🔓 ${colors.magenta}${wifi.guest.SSID}${colors.reset} (${wifi.guest.status})`);
    console.log(`${colors.white}│${colors.reset} ${colors.bright}Clients:${colors.reset}   👥 ${colors.yellow}${clients.length}${colors.reset}/${wifi.maxClientLimit} devices connected`);

    if (displayOptions.showVerbose) {
      console.log(`${colors.white}│${colors.reset}`);
      console.log(`${colors.white}│${colors.reset} ${colors.bright}Connected Devices:${colors.reset}`);
      clients.forEach((client, index) => {
        const deviceName = client.name === '*' ? 'Unknown Device' : client.name;
        const source = client.source === 'PrimaryAP' ? '📡' : '🔓';
        console.log(`${colors.white}│${colors.reset}   ${index + 1}. ${colors.green}${deviceName}${colors.reset}`);
        console.log(`${colors.white}│${colors.reset}      ${source} ${client.IP} │ MAC: ${client.MAC}`);
      });
    }

    console.log(`${colors.white}└────────────────────────────────────────────────────────────────────────┘${colors.reset}\n`);
  }

  // Help text
  const shortcutsLine1 = ['[n] Network', '[b] Bandwidth', '[h] History', '[d] Device/WiFi'];
  const shortcutsLine2 = ['[v] Verbose', '[r] Reset Credentials', '[q] Quit'];

  console.log(`${colors.dim}${shortcutsLine1.join(' │ ')}${colors.reset}`);
  console.log(`${colors.dim}${shortcutsLine2.join(' │ ')}${colors.reset}`);
}

// Setup keyboard input
function setupKeyboardInput(refreshCallback) {
  const readline = require('readline');
  readline.emitKeypressEvents(process.stdin);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      console.log(`\n\n${colors.yellow}Shutting down...${colors.reset}`);
      process.exit(0);
    }

    let shouldRefresh = false;

    switch (key.name) {
      case 'n':
        displayOptions.showNetwork = !displayOptions.showNetwork;
        shouldRefresh = true;
        break;
      case 'b':
        displayOptions.showBandwidth = !displayOptions.showBandwidth;
        shouldRefresh = true;
        break;
      case 'h':
        displayOptions.showHistory = !displayOptions.showHistory;
        shouldRefresh = true;
        break;
      case 'd':
        displayOptions.showDevice = !displayOptions.showDevice;
        shouldRefresh = true;
        break;
      case 'v':
        displayOptions.showVerbose = !displayOptions.showVerbose;
        shouldRefresh = true;
        break;
      case 'r':
        console.log(`\n\n${colors.yellow}⟳${colors.reset} Resetting credentials...`);
        console.log(`${colors.dim}The application will restart and prompt for new credentials${colors.reset}\n`);
        if (db) {
          db.prepare('DELETE FROM settings WHERE key = ?').run('credentials');
          db.close();
        }
        process.exit(0);
        break;
      case 'q':
        console.log(`\n\n${colors.yellow}Shutting down...${colors.reset}`);
        if (db) db.close();
        process.exit(0);
        break;
    }

    // Save settings and instant refresh on keypress
    if (shouldRefresh) {
      saveSettings();
      if (refreshCallback) {
        refreshCallback();
      }
    }
  });
}

// Main loop
async function main() {
  console.log(`${colors.bright}${colors.blue}Netgear Router Stats Monitor${colors.reset}\n`);

  // Initialize database
  initDatabase();

  // Load saved settings
  loadSettings();

  // Check if user wants to reset credentials
  if (RESET_CREDENTIALS) {
    console.log(`${colors.yellow}⟳${colors.reset} Resetting credentials...`);
    db.prepare('DELETE FROM settings WHERE key = ?').run('credentials');
  }

  // Load or prompt for credentials
  let credentials = loadCredentials();
  if (!credentials) {
    credentials = await promptForCredentials();
    saveCredentials(credentials.ip, credentials.username, credentials.password);
  } else {
    console.log(`${colors.green}✓${colors.reset} Credentials loaded from database`);
  }

  // Set global variables from credentials
  ROUTER_IP = credentials.ip;
  USERNAME = credentials.username;
  PASSWORD = credentials.password;

  // Try to load bandwidth history from timeseries data first (preferred method)
  const timeseriesHistory = calculateSpeedsFromTimeseries(bandwidthHistory.maxSamples);
  if (timeseriesHistory.download.length > 0) {
    bandwidthHistory.download = timeseriesHistory.download;
    bandwidthHistory.upload = timeseriesHistory.upload;
    console.log(`${colors.green}✓${colors.reset} Loaded ${bandwidthHistory.download.length} historical bandwidth samples from timeseries data`);
  } else {
    // Fallback to legacy bandwidth_history table if timeseries data is not available
    const historyFromDb = loadBandwidthHistory(bandwidthHistory.maxSamples);
    bandwidthHistory.download = historyFromDb.download;
    bandwidthHistory.upload = historyFromDb.upload;

    if (bandwidthHistory.download.length > 0) {
      console.log(`${colors.green}✓${colors.reset} Loaded ${bandwidthHistory.download.length} historical bandwidth samples (legacy)`);
    }
  }

  // Clean old data (keep last 7 days)
  cleanOldData(7);

  // Initialize session and login with retry on failure
  let loginSuccess = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!loginSuccess && retryCount < maxRetries) {
    if (!(await initSession())) {
      console.log(`${colors.red}Failed to connect to router at ${ROUTER_IP}${colors.reset}`);
      console.log(`${colors.dim}Please check IP address and network connection${colors.reset}\n`);

      // Delete bad credentials and prompt again
      db.prepare('DELETE FROM settings WHERE key = ?').run('credentials');
      credentials = await promptForCredentials();
      saveCredentials(credentials.ip, credentials.username, credentials.password);
      ROUTER_IP = credentials.ip;
      USERNAME = credentials.username;
      PASSWORD = credentials.password;
      retryCount++;
      continue;
    }

    if (!(await login())) {
      console.log(`${colors.red}Login failed - wrong password?${colors.reset}\n`);

      // Delete bad credentials and prompt again
      db.prepare('DELETE FROM settings WHERE key = ?').run('credentials');
      credentials = await promptForCredentials();
      saveCredentials(credentials.ip, credentials.username, credentials.password);
      ROUTER_IP = credentials.ip;
      USERNAME = credentials.username;
      PASSWORD = credentials.password;
      retryCount++;
      continue;
    }

    loginSuccess = true;
  }

  if (!loginSuccess) {
    console.error(`${colors.red}✗${colors.reset} Failed to login after ${maxRetries} attempts`);
    if (db) db.close();
    process.exit(1);
  }

  console.log(`${colors.green}✓${colors.reset} Starting stats monitoring...\n`);

  // Refresh function
  const refresh = async () => {
    const stats = await fetchStats();
    if (stats) {
      displayStats(stats);
      previousStats = stats;
    }
  };

  // Setup keyboard input with refresh callback
  setupKeyboardInput(refresh);

  // Initial fetch
  await refresh();

  // Poll for updates
  setInterval(refresh, POLL_INTERVAL);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${colors.yellow}Shutting down...${colors.reset}`);
  if (db) db.close();
  process.exit(0);
});

// Start the service
main().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
