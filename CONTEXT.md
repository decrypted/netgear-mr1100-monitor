# Netgear MR1100 Router Stats Monitor - Development Context

## Project Overview
A beautiful, interactive Node.js CLI dashboard that monitors and displays real-time statistics from a Netgear Nighthawk M1 (MR1100) router with support for WiFi and Ethernet offloading.

## Current State

### Core Features
- Real-time monitoring with 5-second updates
- Network connection status with signal strength visualization
- Data usage tracking (session + lifetime)
- Live bandwidth calculation with real-time speeds
- ASCII histogram showing bandwidth history
- Network quality metrics (RSRP, RSRQ, SINR)
- **WiFi Offloading support** - monitors when router uses external WiFi
- **Ethernet Offloading support** - monitors when router uses wired connection
- Interactive keyboard controls to toggle display sections
- SQLite database for historical data and settings persistence

### Database Schema

#### timeseries_data table
Stores granular time-series data every 5 seconds with:
- **Aggregated totals**: `total_rx_bytes`, `total_tx_bytes` (standard convention: RX=Download, TX=Upload)
- **Cellular data**: `cellular_download`, `cellular_upload` (standard convention)
- **Cellular signal**: `signal_rsrp`, `signal_rsrq`, `signal_sinr`
- **WiFi offload data**: `wifi_offload_download`, `wifi_offload_upload` (reversed convention!)
- **WiFi offload signal**: `wifi_offload_rssi`, `wifi_offload_bars`, `wifi_offload_ssid`
- **WiFi offload status**: `wifi_offload_active` (boolean)
- **Ethernet offload data**: `ethernet_offload_download`, `ethernet_offload_upload` (reversed convention!)
- **Ethernet offload status**: `ethernet_offload_active` (boolean)
- **Session info**: `session_duration`, `lifetime_bytes`
- **Timestamp**: `timestamp` (Unix milliseconds), `created_at`

## Critical Implementation Details

### TX/RX Counter Convention (IMPORTANT!)
The router API has **different conventions for different connection types**:

**Cellular (wwan) - STANDARD convention:**
- `wwan.dataTransferredTx` = Upload
- `wwan.dataTransferredRx` = Download

**Offload (WiFi/Ethernet) - REVERSED convention:**
- `wifi.offload.dataTransferred.tx` = Download (backwards!)
- `wifi.offload.dataTransferred.rx` = Upload (backwards!)
- `ethernet.offload.tx` = Download (backwards!)
- `ethernet.offload.rx` = Upload (backwards!)

**Why this matters:**
- Database stores aggregated totals in STANDARD convention (total_rx_bytes=Download, total_tx_bytes=Upload)
- When aggregating, we must convert offload counters to standard convention
- Code comments clearly mark where conversion happens

### Data Aggregation Logic
Located in `router-stats.js` around line 784-821:
```javascript
// Cellular uses standard convention
let totalDownload = parseInt(wwan.dataTransferredRx) || 0;  // RX = Download
let totalUpload = parseInt(wwan.dataTransferredTx) || 0;     // TX = Upload

// Offload uses reversed convention - must swap!
totalDownload += parseInt(wifiOffload.dataTransferred.tx) || 0;  // TX = Download
totalUpload += parseInt(wifiOffload.dataTransferred.rx) || 0;     // RX = Upload
```

### Network Status Display
When offloading is active:
- Show ONLY the offload connection prominently
- Display cellular as dimmed "Standby" status
- Hide cellular signal quality metrics (RSRP, RSRQ, SINR, Band) since they're not relevant
- Show offload signal strength for WiFi (bars, SSID)

## Files Structure

### Core Application
- `router-stats.js` - Main application with display logic and database operations
- `router-stats.db` - SQLite database (historical data, settings, credentials)

### Utility Scripts
- `router-stats-debug.js` - Debug mode with raw API field display (run via `npm run debug`)
- `tools/migrate-db.js` - Database migration script (run via `npm run migrate`)
- `tools/check-api.js` - Authenticates and dumps raw API response (run via `npm run check-api`)
- `tools/test-counters.js` - 60-second counter direction test (run via `npm run test-counters`)

### Documentation
- `README.md` - User-facing documentation
- `CONTEXT.md` - This file - developer context and technical details
- `package.json` - Dependencies and npm scripts

### Configuration
- `.github/workflows/test.yml` - CI testing on Node 20.x, 22.x, 24.x

## Recent Changes (Latest Session)

### 1. WiFi & Ethernet Offloading Support
- Added detection and display of WiFi offloading (when router uses external WiFi)
- Added detection and display of Ethernet offloading (when router uses wired connection)
- Display logic: Show only active connection, hide cellular details when offloading

### 2. TX/RX Counter Direction Fix
- Discovered offload counters use reversed convention (TX=Download, RX=Upload)
- Updated aggregation logic to correctly map counters for each source
- Added extensive comments documenting the convention difference

### 3. Enhanced Database Schema
- Added 11 new columns to track individual connection type breakdown
- Allows historical analysis of which connection type was used when
- Tracks signal quality for both cellular and WiFi
- Created `migrate-db.js` script to upgrade existing databases

### 4. Bandwidth Calculation Enhancement
- Fixed to aggregate from all sources (cellular + WiFi offload + Ethernet offload)
- Ensures accurate bandwidth display when switching between connections
- Properly handles convention conversion for each source

### 5. Usage Time Buckets Fix
- Fixed calculateUsageOverTime() to use aggregated total bytes instead of cellular-only lifetime bytes
- Time buckets (5m, 15m, 30m, 45m, 1h, 6h, 12h, 24h) now correctly track ALL traffic
- Previously only counted cellular data; now includes WiFi and Ethernet offload

### 6. Lifetime Display Reorganization
- Moved "Lifetime" (billing cycle data) from Bandwidth panel to Network Connection panel
- Only shows when cellular is the active connection (not during WiFi/Ethernet offload)
- Makes sense since Lifetime tracks cellular data plan usage, not offload usage

### 7. Debug Mode and Counter Accuracy Warnings
- Created `router-stats-debug.js` - debug mode that displays raw API fields without fancy UI
- Discovered router firmware bug: WiFi/Ethernet offload counters are severely inaccurate
  - Counters update slowly (batch every 5-10 seconds)
  - Counters may freeze completely and stop updating
  - Actual usage can be 3-5x higher than reported (375 MB shown vs 1 GB actual)
- Added prominent warnings in both UI modes when offloading is active
- Debug mode runs via `npm run debug` for easier troubleshooting

### 8. Project Organization and Testing
- Reorganized utility scripts into `tools/` directory for cleaner project structure
- Fixed migrate-db.js to correctly locate database in parent directory
- Added npm scripts for all tools: `migrate`, `check-api`, `test-counters`
- Enhanced test suite from 10 to 15 tests:
  - Added tests for tools directory and utility scripts existence
  - Added syntax validation tests for all utility scripts
  - Added tests for npm script definitions
- All tests passing, comprehensive validation of project structure

## Authentication Flow
1. GET `/sess_cd_tmp` - Initialize session, capture sessionId cookie
2. GET `/api/model.json?internalapi=1` - Get security token
3. POST `/Forms/config` - Login with password + token
4. Use sessionId cookie for all subsequent API requests
5. Auto re-authenticate when session expires (HTML response instead of JSON)

## API Data Structure

### Key Endpoints
- `/api/model.json?internalapi=1` - Main data endpoint

### Important Fields
```javascript
data.wwan.dataTransferredTx  // Cellular UPLOAD (standard)
data.wwan.dataTransferredRx  // Cellular DOWNLOAD (standard)
data.wwan.signalStrength.{rsrp,rsrq,sinr,bars}
data.wwan.connection  // e.g., "Connected"
data.wwan.connectionText  // e.g., "4G+"

data.wifi.offload.enabled
data.wifi.offload.status  // "On" or "Off"
data.wifi.offload.connectionSsid
data.wifi.offload.rssi  // Signal strength in dBm
data.wifi.offload.bars  // 0-5
data.wifi.offload.dataTransferred.tx  // WiFi DOWNLOAD (reversed!)
data.wifi.offload.dataTransferred.rx  // WiFi UPLOAD (reversed!)

data.ethernet.offload.enabled
data.ethernet.offload.on
data.ethernet.offload.ipv4Addr
data.ethernet.offload.tx  // Ethernet DOWNLOAD (reversed!)
data.ethernet.offload.rx  // Ethernet UPLOAD (reversed!)
```

## Database Migration

To migrate an existing database to the new schema:
```bash
npm run migrate
# or
node tools/migrate-db.js
```

The script:
- Checks existing columns
- Adds only missing columns
- Preserves all existing data
- Safe to run multiple times

## Development Notes

### Testing Counter Direction
Run `test-counters.js` while downloading a file:
```bash
npm run test-counters
# or
node tools/test-counters.js
```
- Monitors all counters (cellular, WiFi, Ethernet) for 60 seconds
- Shows which counter increases during download
- Confirms TX/RX convention for each source

### Display Toggle Keys
- `n` - Network connection panel
- `b` - Bandwidth & data usage panel
- `h` - Bandwidth history histogram
- `d` - Device & WiFi status panel
- `v` - Verbose mode (device details)
- `r` - Reset credentials
- `q` - Quit

### Color Codes
- Green: Good (signal ≥4 bars, temp <50°C)
- Yellow: Warning (signal 3 bars, temp 50-60°C)
- Red: Critical (signal <3 bars, temp ≥60°C)
- Cyan: Download data/speeds
- Magenta: Upload data/speeds

## Future Enhancement Ideas

### Connection Type Views
With individual connection tracking in DB, could add:
- Toggle between Total/Cellular/WiFi/Ethernet views
- Historical breakdown charts
- Connection type usage reports (e.g., "70% WiFi, 30% Cellular today")

### Signal Quality Analysis
- Track WiFi RSSI over time
- Alert when signal degrades
- Compare cellular vs WiFi signal quality

### Cost Optimization
- Flag when expensive cellular is used vs free WiFi/Ethernet
- Track data costs by connection type
- Alert to enable offloading when available

## Known Issues / Limitations

### Router Firmware Counter Bugs
**CRITICAL: WiFi and Ethernet offload counters are severely unreliable**

The Netgear MR1100 router firmware has serious bugs in WiFi and Ethernet offload counter reporting:

1. **Slow Updates**: Counters batch update every 5-10 seconds instead of real-time
2. **Counter Freezing**: Counters may stop updating entirely for extended periods
3. **Severe Underreporting**: Actual data usage can be 3-5x higher than reported
   - Example: Router showed 375 MB when actual download was 1+ GB
4. **Cannot be fixed**: This is a router firmware bug, not fixable from application code

**Our Mitigation**:
- Added warning messages in both main UI and debug mode (router-stats.js:796-799, router-stats-debug.js:206-210)
- Warnings display whenever WiFi or Ethernet offloading is active
- Users are informed that "actual usage may be significantly higher"

**Cellular counters are accurate** - this issue only affects offload connections.

### Other Limitations
- Database columns added via migration will be NULL for historical records
- Counter direction test requires manual file download to verify

## Dependencies
- `better-sqlite3` - SQLite database
- No other external dependencies (uses Node.js built-ins)

## License
MIT
