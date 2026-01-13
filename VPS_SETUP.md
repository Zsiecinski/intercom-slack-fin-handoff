# VPS Setup Guide (Hostinger)

This guide will help you set up the Intercom Ticket Polling Service on your Hostinger VPS.

## Prerequisites

- SSH access to your Hostinger VPS
- Node.js installed (v18+ recommended)
- Basic command line knowledge

## Step 1: Connect to Your VPS

```bash
ssh your-username@your-vps-ip
# or
ssh your-username@your-domain.com
```

## Step 2: Install Node.js (if not already installed)

Check if Node.js is installed:
```bash
node --version
npm --version
```

If not installed, install Node.js 20 LTS:
```bash
# Using NodeSource repository (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

## Step 3: Clone the Repository

```bash
# Navigate to your preferred directory (e.g., /var/www or ~/apps)
cd ~
# or
cd /var/www

# Clone the repository
git clone https://github.com/Zsiecinski/intercom-slack-fin-handoff.git
cd intercom-slack-fin-handoff

# Install dependencies
npm install --production
```

## Step 4: Set Up Environment Variables

Create a `.env` file:
```bash
nano .env
```

Add your configuration:
```bash
# Intercom Configuration
INTERCOM_ACCESS_TOKEN=your_intercom_api_token_here

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
FALLBACK_CHANNEL=#your-fallback-channel-id-or-name

# Email Mapping (optional)
EMAIL_DOMAIN=staytuned.digital

# Polling Configuration (optional)
CHECK_INTERVAL=120000

# Command Server Configuration (optional)
COMMAND_SERVER_PORT=3001  # Port for Slack commands server  # milliseconds (default: 120000 = 2 minutes)
```

Save and exit (Ctrl+X, then Y, then Enter)

## Step 5: Test the Setup

Test that everything works:
```bash
npm test
```

Run a single poll test:
```bash
npm run test-once
```

## Step 6: Set Up PM2 (Process Manager)

PM2 will keep your service running and restart it if it crashes.

### Install PM2 globally:
```bash
sudo npm install -g pm2
```

### Start both services with PM2:

**Option 1: Start both services separately (Recommended)**
```bash
# Start polling service
pm2 start src/poll.js --name intercom-ticket-poller

# Start command server (for Slack opt-in/opt-out)
pm2 start src/command-server.js --name intercom-commands
```

**Option 2: Use the start script**
```bash
chmod +x start-both.sh
./start-both.sh
```

### Save PM2 configuration:
```bash
pm2 save
```

### Set up PM2 to start on boot:
```bash
pm2 startup
# Follow the instructions it outputs (usually involves running a sudo command)
```

### Note on Ports:
- Polling service: No port needed (background worker)
- Command server: Runs on port 3001 (or COMMAND_SERVER_PORT env var)
- Make sure port 3001 is accessible if you want Slack commands to work

## Step 7: Monitor the Service

### Check status:
```bash
pm2 status
```

### View logs:
```bash
# View polling service logs
pm2 logs intercom-ticket-poller

# View command server logs
pm2 logs intercom-commands

# View all logs
pm2 logs

# Follow logs in real-time
pm2 logs intercom-ticket-poller --lines 50
```

### Restart services:
```bash
# Restart polling service
pm2 restart intercom-ticket-poller

# Restart command server
pm2 restart intercom-commands

# Restart both
pm2 restart all
```

### Stop services:
```bash
# Stop polling service
pm2 stop intercom-ticket-poller

# Stop command server
pm2 stop intercom-commands

# Stop both
pm2 stop all
```

## Step 8: Set Up Log Rotation (Optional but Recommended)

PM2 has built-in log rotation. Enable it:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## Alternative: Using systemd (if you prefer)

If you prefer systemd over PM2, create a service file:

```bash
sudo nano /etc/systemd/system/intercom-ticket-poller.service
```

Add this content (adjust paths as needed):
```ini
[Unit]
Description=Intercom Ticket Assignment Notifier
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/intercom-slack-fin-handoff
ExecStart=/usr/bin/node src/poll.js
Restart=always
RestartSec=10
EnvironmentFile=/home/your-username/intercom-slack-fin-handoff/.env

[Install]
WantedBy=multi-user.target
```

Then:
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable intercom-ticket-poller

# Start the service
sudo systemctl start intercom-ticket-poller

# Check status
sudo systemctl status intercom-ticket-poller

# View logs
sudo journalctl -u intercom-ticket-poller -f
```

## Updating the Service

When you push updates to GitHub:

```bash
cd ~/intercom-slack-fin-handoff
git pull
npm install --production

# Restart with PM2
pm2 restart intercom-ticket-poller

# Or with systemd
sudo systemctl restart intercom-ticket-poller
```

## Troubleshooting

### Service won't start
- Check logs: `pm2 logs intercom-ticket-poller` or `sudo journalctl -u intercom-ticket-poller`
- Verify environment variables are set correctly
- Check Node.js version: `node --version` (should be 18+)

### Service stops unexpectedly
- Check PM2 logs for errors
- Verify your VPS has enough memory/resources
- Check if the process is being killed by the system (OOM killer)

### Can't find state.json
- This is normal on first run - it will be created automatically
- Make sure the directory is writable: `chmod 755 ~/intercom-slack-fin-handoff`

### Permission errors
- Make sure the user running the service has read/write permissions
- Check file ownership: `ls -la ~/intercom-slack-fin-handoff`

## Security Notes

1. **Protect your .env file:**
   ```bash
   chmod 600 .env
   ```

2. **Keep Node.js updated:**
   ```bash
   sudo npm install -g npm@latest
   ```

3. **Use a non-root user** for running the service

4. **Set up firewall rules** if needed (usually not required for outbound polling)

## Monitoring

### Check if service is running:
```bash
pm2 status
# or
sudo systemctl status intercom-ticket-poller
```

### View resource usage:
```bash
pm2 monit
```

### Check state file:
```bash
cat state.json
```

## Quick Reference

```bash
# Start service
pm2 start src/poll.js --name intercom-ticket-poller

# Stop service
pm2 stop intercom-ticket-poller

# Restart service
pm2 restart intercom-ticket-poller

# View logs
pm2 logs intercom-ticket-poller

# Delete service
pm2 delete intercom-ticket-poller

# Save PM2 configuration
pm2 save
```
