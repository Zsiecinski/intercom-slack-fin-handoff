#!/bin/bash
# Quick setup script for VPS deployment
# Run this script on your VPS after cloning the repository

set -e

echo "🚀 Setting up Intercom Ticket Polling Service on VPS..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << EOF
# Intercom Configuration
INTERCOM_ACCESS_TOKEN=your_intercom_api_token_here

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
FALLBACK_CHANNEL=#your-fallback-channel-id-or-name

# Email Mapping (optional)
EMAIL_DOMAIN=staytuned.digital

# Polling Configuration (optional)
CHECK_INTERVAL=120000
EOF
    echo "✅ Created .env file. Please edit it with your credentials:"
    echo "   nano .env"
    chmod 600 .env
else
    echo "✅ .env file exists"
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
else
    echo "✅ PM2 is already installed"
fi

# Run tests
echo "🧪 Running tests..."
npm test

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your credentials: nano .env"
echo "2. Test the service: npm run test-once"
echo "3. Start with PM2: pm2 start src/poll.js --name intercom-ticket-poller"
echo "4. Save PM2 config: pm2 save"
echo "5. Set up auto-start: pm2 startup (follow instructions)"
echo ""
echo "View logs: pm2 logs intercom-ticket-poller"
