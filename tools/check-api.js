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

async function main() {
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

  // Get full data
  const fullResponse = await httpRequest({
    hostname: ROUTER_IP,
    port: 80,
    path: `/api/model.json?internalapi=1&x=${Date.now()}`,
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });

  const fullData = JSON.parse(fullResponse.data);

  // Print relevant sections
  console.log('=== WWAN Data ===');
  console.log(JSON.stringify(fullData.wwan, null, 2));
  console.log('\n=== WWAN Advanced Data ===');
  console.log(JSON.stringify(fullData.wwanadv, null, 2));
  console.log('\n=== WiFi Data ===');
  console.log(JSON.stringify(fullData.wifi, null, 2));
}

main().catch(console.error);
