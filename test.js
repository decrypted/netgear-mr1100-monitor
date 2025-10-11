#!/usr/bin/env node

// Simple test suite for router-stats monitor
// Tests basic functionality without requiring router connection

const fs = require('fs');
const path = require('path');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${colors.red}${error.message}${colors.reset}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

console.log('\n🧪 Running tests...\n');

// Test 1: Check if main file exists
test('router-stats.js exists', () => {
  assert(fs.existsSync('router-stats.js'), 'Main file not found');
});

// Test 2: Check if package.json exists and is valid
test('package.json exists and is valid', () => {
  assert(fs.existsSync('package.json'), 'package.json not found');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(pkg.name === 'netgear-mr1100-monitor', 'Invalid package name');
  assert(pkg.dependencies['better-sqlite3'], 'Missing better-sqlite3 dependency');
});

// Test 3: Check if LICENSE file exists
test('LICENSE file exists', () => {
  assert(fs.existsSync('LICENSE'), 'LICENSE file not found');
  const license = fs.readFileSync('LICENSE', 'utf8');
  assert(license.includes('MIT License'), 'Not an MIT license');
});

// Test 4: Check if README exists
test('README.md exists and has required sections', () => {
  assert(fs.existsSync('README.md'), 'README.md not found');
  const readme = fs.readFileSync('README.md', 'utf8');
  assert(readme.includes('## Installation'), 'Missing Installation section');
  assert(readme.includes('## Usage'), 'Missing Usage section');
  assert(readme.includes('## Features'), 'Missing Features section');
});

// Test 5: Check if .gitignore exists and excludes database
test('.gitignore exists and excludes database files', () => {
  assert(fs.existsSync('.gitignore'), '.gitignore not found');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert(gitignore.includes('router-stats.db'), 'Database not excluded');
  assert(gitignore.includes('node_modules'), 'node_modules not excluded');
});

// Test 6: Check main script for required functions
test('router-stats.js contains required functions', () => {
  const script = fs.readFileSync('router-stats.js', 'utf8');
  assert(script.includes('function initDatabase'), 'Missing initDatabase function');
  assert(script.includes('function saveCredentials'), 'Missing saveCredentials function');
  assert(script.includes('function loadCredentials'), 'Missing loadCredentials function');
  assert(script.includes('function promptForCredentials'), 'Missing promptForCredentials function');
  assert(script.includes('function formatBytes'), 'Missing formatBytes function');
});

// Test 7: Check if scripts are defined in package.json
test('package.json has required scripts', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(pkg.scripts.start, 'Missing start script');
  assert(pkg.scripts.test, 'Missing test script');
  assert(pkg.scripts.reset, 'Missing reset script');
  assert(pkg.scripts.verbose, 'Missing verbose script');
});

// Test 8: Check for command-line argument handling
test('router-stats.js handles command-line arguments', () => {
  const script = fs.readFileSync('router-stats.js', 'utf8');
  assert(script.includes('VERBOSE_MODE'), 'Missing verbose mode support');
  assert(script.includes('RESET_CREDENTIALS'), 'Missing reset credentials support');
});

// Test 9: Verify database table creation SQL
test('Database schema includes all required tables', () => {
  const script = fs.readFileSync('router-stats.js', 'utf8');
  assert(script.includes('CREATE TABLE IF NOT EXISTS bandwidth_history'), 'Missing bandwidth_history table');
  assert(script.includes('CREATE TABLE IF NOT EXISTS timeseries_data'), 'Missing timeseries_data table');
  assert(script.includes('CREATE TABLE IF NOT EXISTS settings'), 'Missing settings table');
});

// Test 10: Check for security - no hardcoded credentials
test('No hardcoded credentials in main script', () => {
  const script = fs.readFileSync('router-stats.js', 'utf8');
  const lines = script.split('\n');

  // Find credential variable declarations
  const ipLine = lines.find(l => l.includes('let ROUTER_IP'));
  const userLine = lines.find(l => l.includes('let USERNAME'));
  const passLine = lines.find(l => l.includes('let PASSWORD'));

  assert(ipLine && ipLine.includes('= null'), 'ROUTER_IP should be initialized as null');
  assert(userLine && userLine.includes('= null'), 'USERNAME should be initialized as null');
  assert(passLine && passLine.includes('= null'), 'PASSWORD should be initialized as null');
});

// Test 11: Check tools directory exists
test('tools/ directory exists with utility scripts', () => {
  assert(fs.existsSync('tools'), 'tools directory not found');
  assert(fs.statSync('tools').isDirectory(), 'tools is not a directory');
});

// Test 12: Check utility scripts exist
test('All utility scripts exist in tools/', () => {
  assert(fs.existsSync('tools/migrate-db.js'), 'migrate-db.js not found');
  assert(fs.existsSync('tools/check-api.js'), 'check-api.js not found');
  assert(fs.existsSync('tools/test-counters.js'), 'test-counters.js not found');
});

// Test 13: Check debug mode script exists
test('Debug mode script exists', () => {
  assert(fs.existsSync('router-stats-debug.js'), 'router-stats-debug.js not found');
  const script = fs.readFileSync('router-stats-debug.js', 'utf8');
  assert(script.includes('function displayDebugInfo'), 'Missing displayDebugInfo function');
});

// Test 14: Verify utility scripts have correct syntax
test('Utility scripts have valid syntax', () => {
  const { execSync } = require('child_process');

  try {
    execSync('node -c tools/migrate-db.js', { stdio: 'pipe' });
    execSync('node -c tools/check-api.js', { stdio: 'pipe' });
    execSync('node -c tools/test-counters.js', { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Syntax error in utility scripts: ${error.message}`);
  }
});

// Test 15: Check npm scripts for tools
test('npm scripts defined for all tools', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(pkg.scripts.migrate, 'Missing migrate script');
  assert(pkg.scripts['check-api'], 'Missing check-api script');
  assert(pkg.scripts['test-counters'], 'Missing test-counters script');
  assert(pkg.scripts.debug, 'Missing debug script');
});

console.log(`\n${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
console.log(`\n📊 Test Results:`);
console.log(`   ${colors.green}✓ ${passed} passed${colors.reset}`);
if (failed > 0) {
  console.log(`   ${colors.red}✗ ${failed} failed${colors.reset}`);
}
console.log(`\n${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

process.exit(failed > 0 ? 1 : 0);
