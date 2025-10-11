#!/usr/bin/env node

const http = require('http');

const ROUTER_IP = '192.168.2.1';
const PASSWORD = 'adaniel';
let sessionCookie = null;

function httpRequest(options, postData = null) {
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

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function authenticate() {
  // Init session
  await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: '/sess_cd_tmp',
    method: 'GET',
  });

  // Get token
  const apiResponse = await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: `/api/model.json?internalapi=1&x=${Date.now()}`,
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });

  const data = JSON.parse(apiResponse.data);
  const secToken = data.session.secToken;

  // Login
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

async function getCounters() {
  const response = await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: `/api/model.json?internalapi=1&x=${Date.now()}`,
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });

  const data = JSON.parse(response.data);

  return {
    cellular: {
      tx: parseInt(data.wwan.dataTransferredTx) || 0,
      rx: parseInt(data.wwan.dataTransferredRx) || 0
    },
    wifiOffload: data.wifi && data.wifi.offload && data.wifi.offload.dataTransferred ? {
      tx: parseInt(data.wifi.offload.dataTransferred.tx) || 0,
      rx: parseInt(data.wifi.offload.dataTransferred.rx) || 0,
      active: data.wifi.offload.enabled && data.wifi.offload.status === 'On',
      ssid: data.wifi.offload.connectionSsid || 'N/A'
    } : null,
    ethernetOffload: data.ethernet && data.ethernet.offload ? {
      tx: parseInt(data.ethernet.offload.tx) || 0,
      rx: parseInt(data.ethernet.offload.rx) || 0,
      active: data.ethernet.offload.enabled && data.ethernet.offload.on
    } : null
  };
}

async function main() {
  console.log('🧪 Data Counter Test Script');
  console.log('============================\n');
  console.log('This script will monitor data counters for 60 seconds.');
  console.log('Download a file now to see which counters increase!\n');

  await authenticate();
  console.log('✓ Authenticated\n');

  const startCounters = await getCounters();
  console.log('📊 Initial Counters:');
  console.log('-------------------');
  console.log('Cellular:');
  console.log(`  TX: ${formatBytes(startCounters.cellular.tx)}`);
  console.log(`  RX: ${formatBytes(startCounters.cellular.rx)}`);

  if (startCounters.wifiOffload) {
    console.log(`\nWiFi Offload (${startCounters.wifiOffload.active ? 'ACTIVE' : 'inactive'}):`);
    if (startCounters.wifiOffload.active) {
      console.log(`  SSID: ${startCounters.wifiOffload.ssid}`);
    }
    console.log(`  TX: ${formatBytes(startCounters.wifiOffload.tx)}`);
    console.log(`  RX: ${formatBytes(startCounters.wifiOffload.rx)}`);
  }

  if (startCounters.ethernetOffload) {
    console.log(`\nEthernet Offload (${startCounters.ethernetOffload.active ? 'ACTIVE' : 'inactive'}):`);
    console.log(`  TX: ${formatBytes(startCounters.ethernetOffload.tx)}`);
    console.log(`  RX: ${formatBytes(startCounters.ethernetOffload.rx)}`);
  }

  console.log('\n⏱️  Waiting 60 seconds...\n');

  // Wait 60 seconds
  await new Promise(resolve => setTimeout(resolve, 60000));

  const endCounters = await getCounters();

  console.log('📊 Final Counters:');
  console.log('------------------');
  console.log('Cellular:');
  console.log(`  TX: ${formatBytes(endCounters.cellular.tx)} (change: ${formatBytes(endCounters.cellular.tx - startCounters.cellular.tx)})`);
  console.log(`  RX: ${formatBytes(endCounters.cellular.rx)} (change: ${formatBytes(endCounters.cellular.rx - startCounters.cellular.rx)})`);

  if (endCounters.wifiOffload) {
    console.log(`\nWiFi Offload (${endCounters.wifiOffload.active ? 'ACTIVE' : 'inactive'}):`);
    if (endCounters.wifiOffload.active) {
      console.log(`  SSID: ${endCounters.wifiOffload.ssid}`);
    }
    console.log(`  TX: ${formatBytes(endCounters.wifiOffload.tx)} (change: ${formatBytes(endCounters.wifiOffload.tx - startCounters.wifiOffload.tx)})`);
    console.log(`  RX: ${formatBytes(endCounters.wifiOffload.rx)} (change: ${formatBytes(endCounters.wifiOffload.rx - startCounters.wifiOffload.rx)})`);
  }

  if (endCounters.ethernetOffload) {
    console.log(`\nEthernet Offload (${endCounters.ethernetOffload.active ? 'ACTIVE' : 'inactive'}):`);
    console.log(`  TX: ${formatBytes(endCounters.ethernetOffload.tx)} (change: ${formatBytes(endCounters.ethernetOffload.tx - startCounters.ethernetOffload.tx)})`);
    console.log(`  RX: ${formatBytes(endCounters.ethernetOffload.rx)} (change: ${formatBytes(endCounters.ethernetOffload.rx - startCounters.ethernetOffload.rx)})`);
  }

  console.log('\n💡 Analysis:');
  console.log('-----------');
  console.log('TX typically means "transmit" (upload from router)');
  console.log('RX typically means "receive" (download to router)');
  console.log('\nIf you downloaded a file:');
  console.log('  → The counter that increased significantly shows which field is download');
  console.log('  → It should be the RX field (receive = download)');
}

main().catch(console.error);
