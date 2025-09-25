#!/bin/bash

# Yazio MCP Server Setup and Test Script
echo "🚀 Setting up Yazio MCP Server for testing"
echo "=========================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building the project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please check the errors above."
    exit 1
fi

echo "✅ Build successful"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env template..."
    cat > .env << EOF
# Yazio Account Credentials
YAZIO_USERNAME=your_yazio_email@example.com
YAZIO_PASSWORD=your_yazio_password
EOF
    echo "⚠️  Please edit .env file with your actual Yazio credentials"
    echo "   Then run: npm test"
else
    echo "✅ .env file found"
fi

# Test the server
echo "🧪 Testing the server..."
if [ -f .env ]; then
    source .env
    if [ -n "$YAZIO_USERNAME" ] && [ -n "$YAZIO_PASSWORD" ]; then
        echo "Running tests with credentials from .env..."
        npm test
    else
        echo "⚠️  YAZIO_USERNAME or YAZIO_PASSWORD not set in .env"
        echo "   Please edit .env file and run: npm test"
    fi
else
    echo "⚠️  No .env file found. Please create one with your credentials."
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Yazio credentials"
echo "2. Run: npm test"
echo "3. Link globally: npm link"
echo "4. Configure your MCP client"
echo ""
echo "For detailed instructions, see TESTING.md"
