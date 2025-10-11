# Netgear MR1100 Router Stats Monitor

A beautiful, interactive Node.js CLI dashboard that monitors and displays real-time statistics from your Netgear Nighthawk M1 (MR1100) router.

## Features

### Core Monitoring
- Real-time monitoring with automatic updates every 5 seconds
- Network connection status with signal strength visualization (5-bar display)
- **WiFi and Ethernet Offloading support** - monitors when router uses external WiFi or wired connection
- Data usage tracking (session download/upload/total + lifetime usage)
- Aggregated data tracking across all connection types (cellular + WiFi offload + Ethernet offload)
- Live bandwidth calculation with real-time speeds
- ASCII histogram showing bandwidth history (last 20 samples)
- Network quality metrics (RSRP, RSRQ, SINR)
- LTE band information and IP address
- Device temperature with color-coded warnings
- WiFi status for primary and guest networks
- Connected devices counter

### Interactive Controls
- **Keyboard shortcuts** to toggle display sections on/off:
  - `[n]` - Network connection info
  - `[b]` - Bandwidth and data usage
  - `[h]` - Bandwidth history histogram
  - `[d]` - Device and WiFi status
  - `[v]` - Verbose mode (shows all connected devices with details)
  - `[q]` - Quit application
- Responsive, clean CLI interface with Unicode box drawing
- Color-coded output for better readability
- Temperature warnings (green < 50°C, yellow < 60°C, red >= 60°C)

## Requirements

- Node.js 14.0.0 or higher
- Access to your Netgear MR1100 router on local network

## Installation

```bash
# Clone the repository
git clone https://github.com/decrypted/netgear-mr1100-monitor.git
cd netgear-mr1100-monitor

# Install dependencies
npm install

# Run the application
npm start
```

On first run, you'll be prompted to enter your router credentials (IP, username, password). These will be securely stored in a local SQLite database.

## Configuration

### First-Time Setup

On first run, the application will prompt you interactively for:
- **Router IP address** (default: 192.168.2.1)
- **Username** (default: admin)
- **Password** (masked input with ***)

Credentials are securely stored in an SQLite database and automatically loaded on subsequent runs.

### Resetting Credentials

If you need to change router credentials:

**Option 1 - While running:**
- Press **`r`** key to reset credentials and restart

**Option 2 - At startup:**
```bash
npm run reset
# or
node router-stats.js --reset
# or
node router-stats.js --reset-credentials
```

## Usage

### Using npm scripts (recommended):
```bash
# Standard mode (Network + Bandwidth visible by default)
npm start
# or
npm run monitor

# Start with verbose mode (shows connected device details)
npm run verbose

# Debug mode (raw API output for troubleshooting)
npm run debug

# Reset credentials and re-prompt on startup
npm run reset
```

### Utility Tools:
```bash
# Migrate database schema (if upgrading from older version)
npm run migrate

# Test router API connection and dump raw response
npm run check-api

# Test counter direction (run while downloading to verify TX/RX)
npm run test-counters
```

### Run directly with Node.js:
```bash
# Standard mode
node router-stats.js

# With verbose mode
node router-stats.js --verbose

# Reset credentials
node router-stats.js --reset
```

### Or make it executable and run:
```bash
chmod +x router-stats.js
./router-stats.js
```

### Interactive Keyboard Controls

Once running, use these keys to toggle sections:
- **n** - Toggle Network connection panel
- **b** - Toggle Bandwidth & data usage panel
- **h** - Toggle bandwidth history histogram
- **d** - Toggle Device & WiFi status panel
- **v** - Toggle verbose mode (detailed device list)
- **r** - Reset credentials (deletes saved credentials and exits, restart to re-enter)
- **q** - Quit (or use Ctrl+C)

## Output

The service displays beautiful, interactive panels:

### 📡 Network Connection Panel
- Connection status with operator name (e.g., "Connected (4G+) via TelekomGR")
- **WiFi Offload detection** - shows when router is using external WiFi (SSID, signal bars, RSSI)
- **Ethernet Offload detection** - shows when router is using wired connection
- Signal strength with visual 5-bar indicator
- Signal quality metrics: RSRP, RSRQ, SINR (in dBm/dB)
- Current LTE band (e.g., "LTE B3", "LTE B7")
- IP address assignment
- Session duration counter
- Lifetime data usage (billing cycle tracking for cellular)

### 📊 Data Usage & Bandwidth Panel
**Session Data:**
- Download/Upload bars showing percentage distribution
- Total data transferred in current session (aggregated from all sources)
- Usage over time periods: 5m, 15m, 30m, 45m, 1h, 6h, 12h, 24h

**Current Speed:**
- Real-time download speed (with horizontal bar graph)
- Real-time upload speed (with horizontal bar graph)
- Scales dynamically based on peak speeds
- Aggregates bandwidth from cellular + WiFi offload + Ethernet offload

**Bandwidth History:**
- ASCII histogram showing last 66 data points (appears after 5+ samples)
- Separate download (cyan) and upload (magenta) graphs
- Timeline indicator (older ← → newer)
- Visual representation of bandwidth patterns over time

### 🖥️ Device & WiFi Status Panel (toggleable)
- Device temperature with color-coded warnings
- System uptime
- Power status
- Primary and Guest WiFi SSIDs with status
- Total connected devices count (e.g., "6/30 devices")
- **Verbose mode:** Detailed list of all connected devices with IP/MAC addresses

## How It Works

1. **Session Initialization**: Connects to router and establishes a session
2. **Authentication**: Logs in using admin credentials and security token
3. **Data Fetching**: Queries the router's internal API every 5 seconds
4. **Bandwidth Calculation**: Calculates current speeds by comparing data transferred between polls
5. **Display**: Clears screen and shows updated stats with color-coded output

## Authentication Flow

The router uses a session-based authentication system:

1. Request session from `/sess_cd_tmp` endpoint
2. Get security token from `/api/model.json?internalapi=1`
3. Login by posting credentials with token to `/Forms/config`
4. Use session cookie for subsequent API requests

## API Endpoint

The service queries: `http://192.168.2.1/api/model.json?internalapi=1&x=[timestamp]`

This endpoint returns comprehensive router information including:
- Network status (wwan, wwanadv)
- WiFi configuration
- Connected clients
- Data usage statistics
- Device information
- Power status

## Exit

Press `Ctrl+C` to stop the monitoring service.

## Troubleshooting

- **Connection failed**: Verify router IP address and network connectivity
- **Login failed**: Check username and password credentials
- **No data displayed**: Ensure router API is accessible and not blocked by firewall

## Known Issues

### WiFi and Ethernet Offload Counter Accuracy

**IMPORTANT**: The Netgear MR1100 router firmware has bugs in WiFi and Ethernet offload counter reporting:

- **Slow Updates**: Counters update in batches every 5-10 seconds instead of real-time
- **Counter Freezing**: Counters may stop updating entirely for extended periods
- **Severe Underreporting**: Actual data usage can be 3-5x higher than what the router reports
  - Example: Router may show 375 MB when actual download is 1+ GB

**This is a router firmware limitation and cannot be fixed by this application.**

When WiFi or Ethernet offloading is active, the application displays a warning message:
- Main UI: "⚠ Note: Offload counters may be inaccurate due to router firmware"
- Debug mode: Detailed warning about potential underreporting

**Cellular counters are accurate** - this issue only affects WiFi and Ethernet offload connections.

For troubleshooting, use debug mode to see raw counter values:
```bash
npm run debug
```

## Notes

- The service uses SQLite database for persistent storage and settings
- Data usage resets when router connection restarts
- Bandwidth calculation requires at least 2 polling cycles (first shows 0)
- Color output uses ANSI escape codes (works in most terminals)
- Historical data is kept for 7 days (configurable in code)

## License

MIT
