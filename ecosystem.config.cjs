// PM2 Ecosystem file for SLA Dashboard
// Note: PM2 uses CommonJS, not ES modules

// Load .env file to read environment variables
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Debug: log what we're reading
console.log('Loading .env from:', path.join(__dirname, '.env'));
console.log('SLA_ALERT_CHANNEL from .env:', process.env.SLA_ALERT_CHANNEL);

module.exports = {
  apps: [{
    name: 'sla-dashboard',
    script: 'src/dashboard-server.js',
    cwd: '/root/intercom-slack-fin-handoff',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      // Explicitly pass SLA_ALERT_CHANNEL from .env (only if it exists)
      ...(process.env.SLA_ALERT_CHANNEL && { SLA_ALERT_CHANNEL: process.env.SLA_ALERT_CHANNEL })
    }
  }]
};
