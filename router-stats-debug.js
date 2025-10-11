#!/usr/bin/env node

const http = require('http');

const ROUTER_IP = process.argv[2] || '192.168.2.1';
const PASSWORD = process.argv[3] || 'adaniel';
const POLL_INTERVAL = 5000; // 5 seconds

let sessionCookie = null;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function httpRequest(options, postData = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';

      if (res.headers['set-cookie']) {
        const cookieHeader = res.headers['set-cookie'].find(c => c.startsWith('sessionId='));
        if (cookieHeader) {
          sessionCookie = cookieHeader.split(';')[0];
        }
      }

      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve({ statusCode: res.statusCode, data }); });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function initSession() {
  await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: '/sess_cd_tmp',
    method: 'GET',
  });
}

async function login() {
  const apiResponse = await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: `/api/model.json?internalapi=1&x=${Date.now()}`,
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });

  const data = JSON.parse(apiResponse.data);
  const secToken = data.session.secToken;

  await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: '/Forms/config',
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }, `session.password=${PASSWORD}&token=${secToken}`);
}

async function fetchStats() {
  const response = await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: `/api/model.json?internalapi=1&x=${Date.now()}`,
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });

  return JSON.parse(response.data);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function displayDebugInfo(data) {
  const timestamp = new Date().toLocaleTimeString();

  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bright}${colors.cyan}[${timestamp}] Router API Debug Output${colors.reset}`);
  console.log('='.repeat(80));

  // WWAN (Cellular) Data
  console.log(`\n${colors.bright}${colors.yellow}CELLULAR (WWAN):${colors.reset}`);
  console.log(`  Connection: ${colors.green}${data.wwan.connection}${colors.reset} (${data.wwan.connectionText})`);
  console.log(`  Network: ${data.wwan.registerNetworkDisplay}`);
  console.log(`  Band: ${data.wwanadv.curBand}`);
  console.log(`  IP: ${data.wwan.IP}`);
  console.log(`  Signal Bars: ${data.wwan.signalStrength.bars}/5`);
  console.log(`  RSRP: ${data.wwan.signalStrength.rsrp} dBm`);
  console.log(`  RSRQ: ${data.wwan.signalStrength.rsrq} dB`);
  console.log(`  SINR: ${data.wwan.signalStrength.sinr} dB`);
  console.log(`  ${colors.cyan}TX (Upload):${colors.reset}   ${formatBytes(parseInt(data.wwan.dataTransferredTx))}`);
  console.log(`  ${colors.magenta}RX (Download):${colors.reset} ${formatBytes(parseInt(data.wwan.dataTransferredRx))}`);
  console.log(`  Session Duration: ${Math.floor(data.wwan.sessDuration / 60)}m ${data.wwan.sessDuration % 60}s`);

  // WiFi Offload Data
  const wifiOffload = data.wifi && data.wifi.offload;
  console.log(`\n${colors.bright}${colors.yellow}WiFi OFFLOAD:${colors.reset}`);
  if (wifiOffload) {
    const isActive = wifiOffload.enabled && wifiOffload.status === 'On' && wifiOffload.connectionSsid;
    console.log(`  Enabled: ${wifiOffload.enabled ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
    console.log(`  Status: ${wifiOffload.status}`);
    console.log(`  ${colors.bright}Active:${colors.reset} ${isActive ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);

    if (isActive) {
      console.log(`  SSID: ${colors.bright}${wifiOffload.connectionSsid}${colors.reset}`);
      console.log(`  IP: ${wifiOffload.stationIPv4 || 'N/A'}`);
      console.log(`  Signal Bars: ${wifiOffload.bars}/5`);
      console.log(`  RSSI: ${wifiOffload.rssi} dBm`);
    }

    if (wifiOffload.dataTransferred) {
      console.log(`  ${colors.cyan}TX (REVERSED=Download):${colors.reset} ${formatBytes(parseInt(wifiOffload.dataTransferred.tx) || 0)}`);
      console.log(`  ${colors.magenta}RX (REVERSED=Upload):${colors.reset}   ${formatBytes(parseInt(wifiOffload.dataTransferred.rx) || 0)}`);
    } else {
      console.log(`  ${colors.dim}No data transfer info available${colors.reset}`);
    }
  } else {
    console.log(`  ${colors.dim}WiFi offload not available${colors.reset}`);
  }

  // Ethernet Offload Data
  const ethOffload = data.ethernet && data.ethernet.offload;
  console.log(`\n${colors.bright}${colors.yellow}ETHERNET OFFLOAD:${colors.reset}`);
  if (ethOffload) {
    const isActive = ethOffload.enabled && ethOffload.on && ethOffload.ipv4Addr && ethOffload.ipv4Addr !== '0.0.0.0';
    console.log(`  Enabled: ${ethOffload.enabled ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
    console.log(`  On: ${ethOffload.on ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
    console.log(`  ${colors.bright}Active:${colors.reset} ${isActive ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);

    if (isActive) {
      console.log(`  IP: ${ethOffload.ipv4Addr}`);
    }

    console.log(`  ${colors.cyan}TX (REVERSED=Download):${colors.reset} ${formatBytes(parseInt(ethOffload.tx) || 0)}`);
    console.log(`  ${colors.magenta}RX (REVERSED=Upload):${colors.reset}   ${formatBytes(parseInt(ethOffload.rx) || 0)}`);
  } else {
    console.log(`  ${colors.dim}Ethernet offload not available${colors.reset}`);
  }

  // Aggregated Totals
  console.log(`\n${colors.bright}${colors.yellow}AGGREGATED TOTALS (with convention conversion):${colors.reset}`);

  // Cellular (standard convention)
  let totalDownload = parseInt(data.wwan.dataTransferredRx) || 0;
  let totalUpload = parseInt(data.wwan.dataTransferredTx) || 0;

  console.log(`  Cellular: DL=${formatBytes(totalDownload)} UL=${formatBytes(totalUpload)}`);

  // WiFi offload (reversed convention)
  let wifiOffloadActive = false;
  if (wifiOffload && wifiOffload.dataTransferred) {
    const wifiDL = parseInt(wifiOffload.dataTransferred.tx) || 0;
    const wifiUL = parseInt(wifiOffload.dataTransferred.rx) || 0;
    totalDownload += wifiDL;
    totalUpload += wifiUL;
    wifiOffloadActive = wifiOffload.enabled && wifiOffload.status === 'On' && wifiOffload.connectionSsid;
    console.log(`  WiFi:     DL=${formatBytes(wifiDL)} UL=${formatBytes(wifiUL)}`);
  }

  // Ethernet offload (reversed convention)
  let ethOffloadActive = false;
  if (ethOffload) {
    const ethDL = parseInt(ethOffload.tx) || 0;
    const ethUL = parseInt(ethOffload.rx) || 0;
    totalDownload += ethDL;
    totalUpload += ethUL;
    ethOffloadActive = ethOffload.enabled && ethOffload.on && ethOffload.ipv4Addr && ethOffload.ipv4Addr !== '0.0.0.0';
    console.log(`  Ethernet: DL=${formatBytes(ethDL)} UL=${formatBytes(ethUL)}`);
  }

  console.log(`  ${colors.bright}---`);
  console.log(`  ${colors.cyan}Total Download: ${formatBytes(totalDownload)}${colors.reset}`);
  console.log(`  ${colors.magenta}Total Upload:   ${formatBytes(totalUpload)}${colors.reset}`);
  console.log(`  ${colors.green}Total Data:     ${formatBytes(totalDownload + totalUpload)}${colors.reset}`);

  // Warning about offload counter accuracy
  if (wifiOffloadActive || ethOffloadActive) {
    console.log(`\n  ${colors.red}⚠ WARNING:${colors.reset} ${colors.yellow}Offload counters may be inaccurate!${colors.reset}`);
    console.log(`  ${colors.dim}The router firmware updates offload counters slowly and may${colors.reset}`);
    console.log(`  ${colors.dim}stop updating entirely. Actual usage may be significantly higher.${colors.reset}`);
  }

  // Lifetime (billing cycle)
  const dataUsage = data.wwan.dataUsage && data.wwan.dataUsage.generic;
  if (dataUsage) {
    const lifetimeData = parseInt(dataUsage.dataTransferred || 0);
    const roamingData = parseInt(dataUsage.dataTransferredRoaming || 0);
    console.log(`\n${colors.bright}${colors.yellow}LIFETIME (Billing Cycle - Cellular Only):${colors.reset}`);
    console.log(`  Cellular: ${formatBytes(lifetimeData)}`);
    console.log(`  Roaming:  ${formatBytes(roamingData)}`);
    console.log(`  ${colors.bright}Total:    ${formatBytes(lifetimeData + roamingData)}${colors.reset}`);
  }
}

async function main() {
  console.log(`${colors.bright}${colors.cyan}Router Debug Monitor${colors.reset}`);
  console.log(`Connecting to ${ROUTER_IP}...`);
  console.log(`Polling every ${POLL_INTERVAL / 1000} seconds`);
  console.log(`${colors.dim}Press Ctrl+C to exit${colors.reset}\n`);

  try {
    await initSession();
    console.log(`${colors.green}✓${colors.reset} Session initialized`);

    await login();
    console.log(`${colors.green}✓${colors.reset} Logged in`);
    console.log(`${colors.green}✓${colors.reset} Starting debug monitor...\n`);

    // Continuous polling
    setInterval(async () => {
      try {
        const data = await fetchStats();
        displayDebugInfo(data);
      } catch (error) {
        console.error(`${colors.red}✗ Error fetching stats:${colors.reset}`, error.message);
      }
    }, POLL_INTERVAL);

    // Initial fetch
    const data = await fetchStats();
    displayDebugInfo(data);

  } catch (error) {
    console.error(`${colors.red}✗ Failed to connect:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${colors.yellow}Shutting down...${colors.reset}`);
  process.exit(0);
});

main().catch(console.error);
