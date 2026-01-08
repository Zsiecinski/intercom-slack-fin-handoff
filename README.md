# Intercom-Slack Fin Handoff Service

A production-ready Node.js (ESM) + Express webhook service that sends Slack DMs to admins when Intercom conversations involving Fin (AI agent) are assigned to them.

## Features

- ✅ **Robust Fin Detection**: Multi-source AI agent detection with extensive logging
- ✅ **Assignment Change Control**: Only notifies on real assignment changes
- ✅ **Deduplication**: Prevents duplicate notifications (webhook ID + assignment-based)
- ✅ **Slack Block Kit**: Rich, formatted messages with context
- ✅ **Fallback Channel**: Posts to channel if DM lookup fails
- ✅ **SLA Nudge**: Optional follow-up reminders if no admin reply
- ✅ **Structured Logging**: JSON logs with requestId, webhookId, decision tracking
- ✅ **Operational Hardening**: Health checks, error handling, signature verification

## Architecture

```
src/
├── server.js          # Express server, routes, signature verification
├── intercom.js        # Intercom API client (conversations, admins)
├── fin.js             # Fin involvement detection with extensive logging
├── slack.js           # Slack integration (Block Kit, DM, fallback channel)
├── dedupe.js          # Deduplication with TTL Map (Redis-ready)
├── nudge.js           # SLA nudge scheduler
└── webhook-handler.js # Main webhook processing logic
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - `INTERCOM_CLIENT_SECRET` - Intercom webhook client secret
   - `INTERCOM_TOKEN` - Intercom API access token
   - `SLACK_BOT_TOKEN` - Slack bot token (starts with `xoxb-`)
   - `FALLBACK_CHANNEL` - (Optional) Slack channel ID/name for fallback posts
   - `EMAIL_DOMAIN` - Domain for mapping Intercom emails (default: staytuned.digital)
   - `FIN_GATE_MODE` - `required` (default) or `log_only`
   - `SLA_NUDGE_MINUTES` - (Optional) Minutes to wait before nudge check
   - `DEDUPE_TTL_SECONDS` - Deduplication TTL (default: 600)

3. **Start the server:**
   ```bash
   npm start
   ```

## Safe Rollout Guide

### Phase 1: Fallback Channel Only (Recommended Start)
1. Set `FALLBACK_CHANNEL=#your-channel-id` in `.env`
2. Set `FIN_GATE_MODE=log_only` to see Fin detection without blocking
3. Deploy and monitor logs
4. Verify notifications appear in fallback channel
5. Check Fin detection accuracy in logs

### Phase 2: Enable Direct DMs
1. Keep `FALLBACK_CHANNEL` set (for safety)
2. Set `FIN_GATE_MODE=required` (production mode)
3. Deploy and monitor
4. Verify DMs are sent correctly
5. Monitor for any issues

### Phase 3: Enable SLA Nudge (Optional)
1. Set `SLA_NUDGE_MINUTES=5` (or desired minutes)
2. Deploy and monitor
3. Verify nudges work correctly

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `INTERCOM_CLIENT_SECRET` | Intercom webhook client secret | Yes | - |
| `INTERCOM_TOKEN` | Intercom API access token | Yes | - |
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) | Yes | - |
| `FALLBACK_CHANNEL` | Slack channel for fallback posts | No | - |
| `EMAIL_DOMAIN` | Domain for email mapping | No | staytuned.digital |
| `FIN_GATE_MODE` | Fin gate mode: `required` or `log_only` | No | required |
| `SLA_NUDGE_MINUTES` | Minutes before SLA nudge check | No | disabled |
| `DEDUPE_TTL_SECONDS` | Deduplication TTL | No | 600 |
| `PORT` | Server port | No | 3000 |

### FIN_GATE_MODE Options

- **`required`** (default): Only send DMs when Fin is confirmed involved. Fail closed.
- **`log_only`**: Log Fin detection results but send DMs regardless. Useful for initial rollout.

## API Endpoints

### POST /intercom/webhook
Receives Intercom webhooks. Verifies signature and processes `conversation.admin.assigned` events.

**Headers:**
- `X-Hub-Signature`: HMAC-SHA1 signature (required)

**Response:**
- `200` - Webhook received and processed
- `401` - Invalid or missing signature

### POST /slack/command
Handles Slack slash commands for opt-in/opt-out.

**Commands:**
- `/cx-alerts opt-in` - Enable notifications
- `/cx-alerts opt-out` - Disable notifications
- `/cx-alerts status` - Check current status

### POST /slack/interactive
Handles Slack interactive button actions (opt-out button in DMs).

### GET /health
Health check endpoint with stats.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dedupe": {
    "size": 42,
    "ttlSeconds": 600
  },
  "nudge": {
    "enabled": true,
    "scheduled": 3,
    "slaMinutes": 5
  },
  "preferences": {
    "total": 10,
    "optedIn": 8,
    "optedOut": 2,
    "defaultOptIn": true
  }
}
```

## How It Works

1. **Webhook Reception**: Server receives POST at `/intercom/webhook`
2. **Signature Verification**: Validates `X-Hub-Signature` using HMAC-SHA1
3. **Deduplication**: Checks webhook ID and assignment-based dedupe
4. **Assignment Extraction**: Extracts conversation ID, assignee ID, and assignment timestamp
5. **Noise Control**: Skips if:
   - Conversation not open
   - Team assignment (unless FALLBACK_CHANNEL set)
   - Missing assignee email
6. **Fin Detection**: Checks multiple sources for AI agent involvement
7. **Fin Gate**: Applies FIN_GATE_MODE (required or log_only)
8. **Slack Notification**: Sends Block Kit DM or posts to fallback channel
9. **SLA Nudge**: Schedules follow-up check if enabled

## Fin Detection

The service checks multiple sources for Fin/AI agent involvement:

1. **Conversation Parts**: `author.from_ai_agent`, `author.is_ai_answer`, `author.type === 'bot'`
2. **Top-level Fields**: `ai_agent`, `ai_agent_participated`
3. **Custom Attributes**: Fields containing "Fin", "AI", or "Bot"
4. **Source Type**: Bot/AI source indicators
5. **Statistics**: AI-related metadata

All checks are logged with matched rules for debugging.

## Deduplication

Two-level deduplication:

1. **Webhook ID**: Uses `payload.id` (notif_xxx) for 10 minutes
2. **Assignment Key**: Uses `conversationId + assigneeEmail + lastAssignmentAt` for 10 minutes

Prevents:
- Duplicate webhook deliveries
- Rapid reassignment spam
- Multiple notifications for same assignment

## Slack Block Kit Format

Messages include:
- **Header**: "Assigned after Fin handoff"
- **Section**: Assignee name, conversation ID, brand/language
- **Context**: Source type, priority, language
- **Warning**: If email contains links
- **Button**: "Open in Intercom" link

## Testing

### Unit Tests

#### Test Token Configuration
```bash
npm run test-tokens
```
Verifies that Intercom and Slack tokens are configured correctly.

#### Test Webhook Extraction Logic
```bash
npm run test-extraction
```
Tests the webhook payload extraction logic with various scenarios:
- Standard admin assignment
- Team + agent assignment (critical fix)
- Conversation parts assignments
- Edge cases (team-only, missing data, etc.)

### Manual Testing

#### 1. Start Server
```bash
npm start
```

#### 2. Send Test Webhook
In another terminal, send a test webhook:
```bash
# Standard admin assignment
npm run test-webhook standard

# Team + agent assignment (tests the fix)
npm run test-webhook team-agent

# Team only (should be ignored)
npm run test-webhook team-only

# Conversation parts format
npm run test-webhook conversation-parts
```

#### 3. Expose with ngrok (for real Intercom webhooks)
```bash
ngrok http 3000
```

#### 4. Configure Intercom Webhook
- **Production URL**: `https://intercom-slack-fin-handoff.onrender.com/intercom/webhook`
- **Local Testing URL**: `https://your-ngrok-url.ngrok.io/intercom/webhook`
- Topic: `conversation.admin.assigned`
- Permission: `read_conversations`

#### 5. Test Real Webhook
Assign a conversation in Intercom and check:
- Server logs (structured JSON)
- Slack DM or fallback channel
- Health endpoint stats (`GET /health`)

## Logging

All logs are structured JSON with:
- `requestId` - Unique request identifier
- `webhookId` - Intercom webhook ID
- `conversationId` - Conversation ID
- `assigneeEmail` - Assignee email
- `finInvolved` - Fin detection result
- `decision` - Processing decision (sent/ignored/failed)
- `reason` - Decision reason
- `timestamp` - ISO timestamp

Example log:
```json
{
  "requestId": "req_1234567890_abc123",
  "webhookId": "notif_xxx",
  "conversationId": "215472586672049",
  "assigneeEmail": "admin@example.com",
  "finInvolved": true,
  "finMatchedRules": ["conversation_parts.author.from_ai_agent=true"],
  "decision": "sent",
  "usedFallback": false,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Troubleshooting

### Fin Not Detected
- Check logs for `finMatchedRules` - see which rules were checked
- Verify conversation has AI agent indicators
- Try `FIN_GATE_MODE=log_only` to see detection without blocking

### Duplicate Notifications
- Check dedupe stats in `/health` endpoint
- Verify `DEDUPE_TTL_SECONDS` is appropriate
- Check logs for `decision: ignored, reason: webhook_duplicate`

### Slack DM Not Sending
- Verify `SLACK_BOT_TOKEN` has required scopes:
  - `users:read.email`
  - `im:write`
  - `chat:write`
- Check if fallback channel is being used
- Review logs for Slack API errors

### Team Assignments Not Notifying
- Set `FALLBACK_CHANNEL` to receive team assignment notifications
- Or modify code to handle team assignments differently

## Production Deployment

1. **Set Environment Variables**: Use secure secret management
2. **Enable FIN_GATE_MODE=required**: Production mode
3. **Set FALLBACK_CHANNEL**: Safety net for failed DMs
4. **Monitor Logs**: Use structured JSON logs with log aggregation
5. **Health Checks**: Monitor `/health` endpoint
6. **Deduplication**: Consider Redis for distributed deployments

## Deployment

See [DEPLOY.md](./DEPLOY.md) for detailed deployment instructions, including Render.com setup.

### Production URLs

- **Service**: https://intercom-slack-fin-handoff.onrender.com
- **Webhook Endpoint**: https://intercom-slack-fin-handoff.onrender.com/intercom/webhook
- **Health Check**: https://intercom-slack-fin-handoff.onrender.com/health
- **Slack Command**: https://intercom-slack-fin-handoff.onrender.com/slack/command
- **Slack Interactive**: https://intercom-slack-fin-handoff.onrender.com/slack/interactive

## License

ISC
