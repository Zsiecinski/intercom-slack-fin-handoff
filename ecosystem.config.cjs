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

// Read SLA_ALERT_CHANNEL directly from .env file
let slaChannel = null;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  // Try to find SLA_ALERT_CHANNEL in the file (handle both with and without comments)
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SLA_ALERT_CHANNEL=')) {
      slaChannel = trimmed.split('=')[1].split('#')[0].trim();
      break;
    }
  }
}

// Fallback to process.env if file reading didn't work
if (!slaChannel) {
  slaChannel = process.env.SLA_ALERT_CHANNEL;
}

// Final fallback
if (!slaChannel) {
  slaChannel = '#intercom-pings';
}

// Debug output (will show in PM2 logs when starting)
console.log('Ecosystem config loaded:');
console.log('  .env path:', envPath);
console.log('  .env exists:', fs.existsSync(envPath));
console.log('  SLA_ALERT_CHANNEL from dotenv:', process.env.SLA_ALERT_CHANNEL);
console.log('  SLA_ALERT_CHANNEL final value:', slaChannel || '#intercom-pings');

const config = {
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

// Debug: log the config being exported
console.log('PM2 Ecosystem Config:');
console.log('  App name:', config.apps[0].name);
console.log('  SLA_ALERT_CHANNEL:', config.apps[0].env.SLA_ALERT_CHANNEL);

module.exports = config;
