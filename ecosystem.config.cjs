// PM2 Ecosystem file for SLA Dashboard
// Note: PM2 uses CommonJS, not ES modules

// Load .env file to read environment variables
const path = require('path');
const fs = require('fs');

// Try to load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

// Read SLA_ALERT_CHANNEL directly from .env file as fallback
let slaChannel = process.env.SLA_ALERT_CHANNEL;
if (!slaChannel && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/^SLA_ALERT_CHANNEL=(.+)$/m);
  if (match) {
    slaChannel = match[1].trim();
    // Remove any trailing comments
    slaChannel = slaChannel.split('#')[0].trim();
  }
}

// Debug output (will show in PM2 logs when starting)
console.log('Ecosystem config loaded:');
console.log('  .env path:', envPath);
console.log('  .env exists:', fs.existsSync(envPath));
console.log('  SLA_ALERT_CHANNEL from dotenv:', process.env.SLA_ALERT_CHANNEL);
console.log('  SLA_ALERT_CHANNEL final value:', slaChannel || '#intercom-pings');

module.exports = {
  apps: [{
    name: 'sla-dashboard',
    script: 'src/dashboard-server.js',
    cwd: '/root/intercom-slack-fin-handoff',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      // Explicitly pass SLA_ALERT_CHANNEL - use the value we found or fallback
      SLA_ALERT_CHANNEL: slaChannel || '#intercom-pings'
    }
  }]
};
