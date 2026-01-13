# Intercom-Slack Ticket Assignment Notifier

A Node.js polling service that monitors Intercom Tickets API and sends Slack DMs to admins when tickets are assigned to them.

## Features

- ✅ **Polling-Based**: Polls Intercom Tickets API every 1-2 minutes
- ✅ **Efficient Search**: Uses Intercom REST API v2.11+ Search endpoint with timestamp filtering
- ✅ **State Management**: Tracks last check timestamp in JSON file to avoid duplicate notifications
- ✅ **Slack Integration**: Sends rich Block Kit formatted DMs to assigned agents
- ✅ **Fallback Channel**: Posts to channel if DM lookup fails
- ✅ **Deduplication**: Prevents duplicate notifications within polling cycles
- ✅ **Error Handling**: Robust error handling and logging
- ✅ **Rate Limit Safe**: Respects Intercom's 10,000 calls/minute limit

## Architecture

```
src/
├── poll.js           # Main polling script
├── tickets.js         # Intercom Tickets API client
├── state.js           # State management (last check timestamp)
├── ticket-notifier.js # Slack notification logic
└── slack.js           # Slack API integration
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file:
   ```bash
   # Intercom Configuration
   INTERCOM_ACCESS_TOKEN=your_intercom_api_token_here
   
   # Slack Configuration
   SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
   FALLBACK_CHANNEL=#your-fallback-channel-id-or-name
   
   # Email Mapping (optional)
   EMAIL_DOMAIN=staytuned.digital
   
   # Polling Configuration (optional)
   CHECK_INTERVAL=120000  # milliseconds (default: 120000 = 2 minutes)
   ```

3. **Start the services:**
   
   **For polling only:**
   ```bash
   npm start
   ```
   
   **For polling + Slack commands (opt-in/opt-out):**
   ```bash
   # Terminal 1: Start polling service
   npm start
   
   # Terminal 2: Start command server
   npm run start:commands
   ```
   
   **Or use PM2 (recommended for production):**
   ```bash
   pm2 start src/poll.js --name intercom-ticket-poller
   pm2 start src/command-server.js --name intercom-commands
   pm2 save
   ```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `INTERCOM_ACCESS_TOKEN` | Intercom API access token | Yes | - |
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) | Yes | - |
| `FALLBACK_CHANNEL` | Slack channel for fallback posts | No | - |
| `EMAIL_DOMAIN` | Domain for email mapping | No | staytuned.digital |
| `CHECK_INTERVAL` | Polling interval in milliseconds | No | 120000 (2 min) |
| `BUSINESS_HOURS_ENABLED` | Enable business hours restriction | No | true |
| `BUSINESS_HOURS_START` | Business hours start time (HH:MM) | No | 09:00 |
| `BUSINESS_HOURS_END` | Business hours end time (HH:MM) | No | 17:00 |
| `BUSINESS_HOURS_TIMEZONE` | Timezone for business hours | No | America/New_York |
| `BUSINESS_HOURS_DAYS` | Business days (0-6, comma-separated) | No | 1,2,3,4,5 (Mon-Fri) |

### CHECK_INTERVAL Recommendations

- **Minimum**: 60000ms (1 minute) - More frequent checks, higher API usage
- **Recommended**: 120000ms (2 minutes) - Good balance
- **Maximum**: 300000ms (5 minutes) - Less frequent, may miss rapid assignments

### Business Hours Configuration

By default, polling only runs during business hours to save API calls and avoid off-hours notifications.

**Example `.env` configuration:**
```bash
# Enable business hours (default: enabled)
BUSINESS_HOURS_ENABLED=true

# Business hours: 9 AM - 5 PM Eastern Time
BUSINESS_HOURS_START=09:00
BUSINESS_HOURS_END=17:00
BUSINESS_HOURS_TIMEZONE=America/New_York

# Business days: Monday-Friday (1=Monday, 2=Tuesday, ..., 5=Friday)
BUSINESS_HOURS_DAYS=1,2,3,4,5

# To disable business hours and poll 24/7:
BUSINESS_HOURS_ENABLED=false
```

**Day numbers:**
- `0` = Sunday
- `1` = Monday
- `2` = Tuesday
- `3` = Wednesday
- `4` = Thursday
- `5` = Friday
- `6` = Saturday

**Common timezones:**
- `America/New_York` (Eastern)
- `America/Chicago` (Central)
- `America/Denver` (Mountain)
- `America/Los_Angeles` (Pacific)
- `Europe/London` (UK)
- `UTC` (Coordinated Universal Time)

## How It Works

1. **Initialization**: On first run, creates `state.json` with current timestamp
2. **Polling Loop**: Every CHECK_INTERVAL milliseconds:
   - Reads last check timestamp from `state.json`
   - Searches Intercom Tickets API for tickets created after last check
   - Processes each ticket to find admin assignments
   - Sends Slack DM to assigned admin
   - Updates `state.json` with new timestamp
3. **Deduplication**: Tracks processed assignments within each polling cycle
4. **Error Handling**: Continues polling even if individual tickets fail

## API Endpoints Used

### Intercom Tickets API v2.11+

- **POST /tickets/search** - Search for tickets with filters
  - Filters by `created_at >= lastCheckTime`
  - Returns tickets with `admin_assignee_id` field
  - Supports pagination (up to 100 tickets per poll)

- **GET /tickets/{id}** - Get ticket details (if needed)

- **GET /admins/{id}** - Get admin details (email, name)

### Slack Web API

- **POST /users.lookupByEmail** - Find Slack user by email
- **POST /conversations.open** - Open DM channel
- **POST /chat.postMessage** - Send message with Block Kit

## State Management

The service stores its state in `state.json`:

```json
{
  "lastCheckTime": 1704067200,
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

- `lastCheckTime`: Unix timestamp (seconds) of last successful poll
- `updatedAt`: ISO timestamp for debugging

**Note**: `state.json` is gitignored and created automatically on first run.

## Slack Notification Format

Notifications include:
- **Header**: "🎫 New Ticket Assigned"
- **Fields**: Assignee name, Ticket ID, State, Created time
- **Subject**: Ticket subject/name
- **Description**: Ticket description (truncated to 500 chars)
- **Button**: "Open in Intercom" link

## Rate Limiting

Intercom API allows **10,000 calls per minute**. With default settings:
- Poll every 2 minutes = 30 polls/hour
- Each poll makes ~1-3 API calls (search + admin lookups)
- **Well within limits** even at 1-minute intervals

## Error Handling

- **API Errors**: Logged and polling continues
- **Missing Assignee**: Skipped (team-only assignments)
- **Slack Errors**: Falls back to channel if configured
- **State File Errors**: Creates new state file if corrupted

## Logging

The service logs:
- Poll start/end times
- Number of tickets found
- Notifications sent
- Errors and warnings

Example log output:
```
[2024-01-01T00:00:00.000Z] Starting poll...
Last check time: 2023-12-31T23:58:00.000Z
Found 5 tickets to process
✅ Sent notification for ticket 12345 assigned to admin@example.com
Poll completed in 1234ms. Sent 3 notifications.
Next poll in 120 seconds
```

## Troubleshooting

### No Notifications Being Sent

1. **Check state.json**: Verify `lastCheckTime` is updating
2. **Check logs**: Look for API errors or missing assignees
3. **Verify tokens**: Ensure `INTERCOM_ACCESS_TOKEN` and `SLACK_BOT_TOKEN` are valid
4. **Check ticket assignments**: Verify tickets actually have `admin_assignee_id`

### Duplicate Notifications

- Deduplication is per polling cycle
- If you restart the service, it may re-process recent tickets
- Consider adjusting `lastCheckTime` in `state.json` if needed

### High API Usage

- Increase `CHECK_INTERVAL` to poll less frequently
- Check logs for unnecessary API calls

## Production Deployment

### VPS Deployment (Hostinger, DigitalOcean, etc.)

See **[VPS_SETUP.md](./VPS_SETUP.md)** for a complete guide.

**Quick setup:**
```bash
# On your VPS
git clone https://github.com/Zsiecinski/intercom-slack-fin-handoff.git
cd intercom-slack-fin-handoff
chmod +x setup-vps.sh
./setup-vps.sh
# Edit .env with your credentials
nano .env
# Start with PM2
pm2 start src/poll.js --name intercom-ticket-poller
pm2 save
pm2 startup
```

### Running as a Service

**Using PM2 (Recommended):**
```bash
npm install -g pm2
pm2 start src/poll.js --name intercom-ticket-poller
pm2 save
pm2 startup  # Follow instructions to enable auto-start
```

**Using systemd:**
Create `/etc/systemd/system/intercom-ticket-poller.service`:
```ini
[Unit]
Description=Intercom Ticket Assignment Notifier
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/intercom-slack-fin-handoff
ExecStart=/usr/bin/node src/poll.js
Restart=always
RestartSec=10
EnvironmentFile=/path/to/intercom-slack-fin-handoff/.env

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable intercom-ticket-poller
sudo systemctl start intercom-ticket-poller
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "src/poll.js"]
```

### Environment Variables in Production

Use secure secret management:
- **Render**: Environment variables in dashboard
- **Heroku**: `heroku config:set INTERCOM_ACCESS_TOKEN=...`
- **AWS**: Secrets Manager or Parameter Store
- **Docker**: Environment file or secrets

## Development

### Testing

```bash
# Test token configuration
npm run test-tokens

# Run in development mode (with watch)
npm run dev
```

### Manual State Reset

To reset polling state (start from now):
```bash
rm state.json
npm start
```

To start from a specific time:
```bash
# Edit state.json and set lastCheckTime to desired Unix timestamp
```

## License

ISC
