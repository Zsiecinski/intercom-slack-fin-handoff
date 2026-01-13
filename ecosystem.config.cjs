// PM2 Ecosystem file for SLA Dashboard
// Note: PM2 uses CommonJS, not ES modules

module.exports = {
  apps: [{
    name: 'sla-dashboard',
    script: 'src/dashboard-server.js',
    cwd: '/root/intercom-slack-fin-handoff',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    // PM2 will automatically load .env from cwd if dotenv/config is used in the script
    // But we can also explicitly set env vars here if needed
  }]
};
