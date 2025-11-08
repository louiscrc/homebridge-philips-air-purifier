#!/bin/bash
# Setup script for Philips Air Purifier Homebridge Plugin
# Installs Python dependencies automatically

echo "🔧 Setting up Philips Air Purifier Plugin..."
echo ""

# Get plugin directory
PLUGIN_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$PLUGIN_DIR"

# Check if Python3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed!"
    echo "   Please install Python 3 first:"
    echo "   - macOS: brew install python3"
    echo "   - Ubuntu: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

echo "✅ Found Python: $(which python3)"
echo ""

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv .venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate venv and install aioairctrl
echo ""
echo "📥 Installing aioairctrl..."
source .venv/bin/activate
pip install --upgrade pip > /dev/null 2>&1
pip install aioairctrl

if [ $? -eq 0 ]; then
    echo "✅ aioairctrl installed successfully"
else
    echo "❌ Failed to install aioairctrl"
    exit 1
fi

# Test the installation
echo ""
echo "🧪 Testing Python API..."
if python3 philips_air_api.py --help > /dev/null 2>&1 || python3 -c "import aioairctrl" 2>&1; then
    echo "✅ Python API is working"
else
    echo "⚠️  Python API test failed (but aioairctrl is installed)"
fi

echo ""
echo "=================================="
echo "✅ Setup Complete!"
echo "=================================="
echo ""
echo "The plugin is now ready to use with:"
echo "  - Python: $PLUGIN_DIR/.venv/bin/python3"
echo "  - Script: $PLUGIN_DIR/philips_air_api.py"
echo ""
echo "Add to your Homebridge config.json:"
echo '{
  "accessory": "PhilipsAirPurifier",
  "name": "Living Room Air Purifier",
  "host": "192.168.8.30"
}'
echo ""
echo "Note: apiScriptPath and pythonPath will be auto-detected!"
echo ""

