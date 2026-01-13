// PM2 Ecosystem file for SLA Dashboard
// Note: PM2 uses CommonJS, not ES modules

// Load .env file to read environment variables
require('dotenv').config({ path: '/root/intercom-slack-fin-handoff/.env' });

module.exports = {
  apps: [{
    name: 'sla-dashboard',
    script: 'src/dashboard-server.js',
    cwd: '/root/intercom-slack-fin-handoff',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      // Explicitly pass SLA_ALERT_CHANNEL from .env
      SLA_ALERT_CHANNEL: process.env.SLA_ALERT_CHANNEL || null
    }
  }]
};
