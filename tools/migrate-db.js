#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'router-stats.db');

console.log('🔄 Migrating database schema...\n');

const db = new Database(DB_PATH);

// Get current columns
const tableInfo = db.prepare("PRAGMA table_info(timeseries_data)").all();
const existingColumns = tableInfo.map(col => col.name);

console.log('Existing columns:', existingColumns.join(', '));
console.log('');

// Define new columns to add
const newColumns = [
  { name: 'cellular_download', type: 'INTEGER' },
  { name: 'cellular_upload', type: 'INTEGER' },
  { name: 'wifi_offload_download', type: 'INTEGER' },
  { name: 'wifi_offload_upload', type: 'INTEGER' },
  { name: 'wifi_offload_active', type: 'INTEGER' },
  { name: 'wifi_offload_ssid', type: 'TEXT' },
  { name: 'wifi_offload_rssi', type: 'INTEGER' },
  { name: 'wifi_offload_bars', type: 'INTEGER' },
  { name: 'ethernet_offload_download', type: 'INTEGER' },
  { name: 'ethernet_offload_upload', type: 'INTEGER' },
  { name: 'ethernet_offload_active', type: 'INTEGER' }
];

// Add missing columns
let addedCount = 0;
for (const col of newColumns) {
  if (!existingColumns.includes(col.name)) {
    console.log(`✓ Adding column: ${col.name} (${col.type})`);
    db.prepare(`ALTER TABLE timeseries_data ADD COLUMN ${col.name} ${col.type}`).run();
    addedCount++;
  } else {
    console.log(`  Column already exists: ${col.name}`);
  }
}

console.log('');
if (addedCount > 0) {
  console.log(`✅ Migration complete! Added ${addedCount} new columns.`);
} else {
  console.log('✅ Database is already up to date!');
}

db.close();
