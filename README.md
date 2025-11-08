# Homebridge Philips Air Purifier Plugin

Control your Philips Air Purifier with HomeKit via Homebridge.

## Features

- ✅ **Power On/Off** - Turn your air purifier on or off
- ✅ **4 Ventilation Modes** - Auto, Sleep, Medium, Turbo
- ✅ **Air Quality Sensor** - Real-time PM2.5 readings
- ✅ **Display Light Control** - Control brightness (Off, Dim, Bright)
- ✅ **HomeKit Native** - Full integration with Apple Home app

## Prerequisites

1. **Homebridge** installed and running
2. **Python 3** with `aioairctrl` package installed
3. Your Philips Air Purifier's **IP address**

## Installation

### Step 1: Install Python Dependencies

```bash
# If using a virtual environment (recommended)
python3 -m venv ~/philips-air-venv
source ~/philips-air-venv/bin/activate  # On macOS/Linux
# or
~/philips-air-venv/Scripts/activate  # On Windows

# Install aioairctrl
pip install aioairctrl
```

### Step 2: Preflight Check (connectivity)

After installing the plugin, you can test connectivity. The plugin will automatically use the bundled Python script, but you can test manually:

```bash
# Find the plugin directory (usually in Homebridge's node_modules)
# Then test connectivity:
AIOCOAP_CLIENT_TRANSPORT=udp4 python3 <plugin-dir>/philips_air_api.py <device-ip> sensors
```

You should see a JSON payload. If you get pktinfo/decrypt errors, re-run; these are often transient. The plugin includes timeouts and small retries.

**Note:** After installing via npm, the Python script is bundled with the plugin. The plugin will auto-detect it and your Python installation.

### Step 3: Install Homebridge Plugin

```bash
# Install via npm (recommended)
npm install -g homebridge-philips-air-purifier

# Or install via Homebridge UI:
# Go to Plugins → Search for "homebridge-philips-air-purifier" → Install
```

**Note:** The plugin includes the Python API script (`philips_air_api.py`) automatically. You only need to ensure Python 3 with `aioairctrl` is installed (Step 1).

### Step 4: Configure Homebridge

Add to your `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "PhilipsAirPurifier",
      "name": "Living Room Air Purifier",
      "host": "192.168.8.30"
    }
  ]
}
```

**Configuration Options:**

- `name` - Name shown in HomeKit (required)
- `host` - IP address of your air purifier (required)
- `pollInterval` - How often to poll device (milliseconds, default: 10000)
- `apiScriptPath` - Full path to `philips_air_api.py` (optional, auto-detected from plugin directory)
- `pythonPath` - Path to Python 3 with `aioairctrl` (optional, auto-detected)

**Note:** The plugin automatically finds the bundled Python script and detects Python installations with `aioairctrl`. You typically only need to specify `name` and `host`.

### Step 5: Restart Homebridge

```bash
# Restart homebridge to load the plugin
sudo systemctl restart homebridge
# or use Homebridge UI to restart
```

## Usage

Once configured, you'll see your air purifier in the Apple Home app with:

1. **Main Switch** - Power on/off
2. **Target State** - Auto vs Manual
3. **Rotation Speed (Manual)** - Discrete positions: 16% (Sleep), 50% (Medium), 83% (Turbo). Auto is managed by Target State to avoid slider jitter.
4. **Air Quality Sensor** - PM2.5 density and derived quality
5. **Display Light** - Toggle and adjust brightness (Off/Dim/Bright)
6. **Auto Mode Switch** - Quick toggle for auto mode

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

**Author:** [louiscrc](https://github.com/louiscrc)

Built using:

- [aioairctrl](https://github.com/betaboon/aioairctrl) - Python library for Philips Air devices
- [Homebridge](https://homebridge.io/) - HomeKit support for non-Apple devices

## Support

- **Issues:** [GitHub Issues](https://github.com/louiscrc/homebridge-philips-air-purifier/issues)
- **npm Package:** [homebridge-philips-air-purifier](https://www.npmjs.com/package/homebridge-philips-air-purifier)
