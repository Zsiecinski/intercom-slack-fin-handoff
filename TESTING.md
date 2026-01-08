# Testing Guide

This guide explains how to test the Intercom-Slack Fin Handoff service.

## Quick Test Commands

```bash
# Test token configuration (no server needed)
npm run test-tokens

# Test extraction logic (no server needed)
npm run test-extraction

# Test webhook handling (requires server running)
npm start                    # Terminal 1: Start server
npm run test-webhook standard # Terminal 2: Send test webhook
```

## Test Types

### 1. Unit Tests (No Server Required)

#### Test Extraction Logic
```bash
npm run test-extraction
```

Tests the webhook payload extraction with 8 scenarios:
- ✅ Standard admin assignment
- ✅ Team + agent assignment (critical fix)
- ✅ Conversation parts assignments
- ✅ Admin assignee object format
- ✅ Edge cases (team-only, missing data, etc.)

**Expected Output:**
```
✅ All tests passed!
   Total: 8
   Passed: 8
   Failed: 0
```

### 2. Manual Webhook Tests (Server Required)

#### Start the Server
In Terminal 1:
```bash
npm start
```

You should see:
```
Server running on port 3000
```

#### Send Test Webhooks
In Terminal 2, run one of these:

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

**Expected Output:**
```
🚀 Sending test webhook: team-agent
────────────────────────────────────────────────────────────
URL: http://localhost:3000/intercom/webhook
Payload ID: notif_test_team_agent
Topic: conversation.admin.assigned

📥 Response:
   Status: 200
   Body: { status: 'received', requestId: '...' }

✅ Webhook accepted!
   Check server logs for processing details.
```

### 3. Token Configuration Tests

```bash
npm run test-tokens
```

Verifies:
- ✅ Intercom token is valid
- ✅ Slack token is valid
- ✅ Intercom client secret is configured
- ⚠️  Slack user lookup (optional, requires email argument)

**With email lookup:**
```bash
npm run test-tokens user@example.com
```

## Testing Scenarios

### Scenario: Standard Admin Assignment
Tests basic assignment extraction from `admin_assignee_id` field.

### Scenario: Team + Agent Assignment (Critical Fix)
Tests that when both team and agent are assigned, the system:
1. Extracts both `team_assignee_id` and `assigneeId`
2. Processes the assignment (doesn't skip it)
3. Sends DM to the agent even though team is also assigned

### Scenario: Team Only
Tests that team-only assignments are correctly identified and skipped (unless FALLBACK_CHANNEL is set).

### Scenario: Conversation Parts
Tests extraction from `conversation_parts` array, which is used when assignment info isn't in top-level fields.

## Troubleshooting

### "fetch failed" or "ECONNREFUSED" Error
**Problem:** Server is not running.

**Solution:**
1. Start the server: `npm start`
2. Wait for "Server running on port 3000"
3. Run the test again in another terminal

### "Missing signature" Error
**Problem:** INTERCOM_CLIENT_SECRET not set in `.env` file.

**Solution:**
1. Check `.env` file exists
2. Verify `INTERCOM_CLIENT_SECRET` is set
3. Restart server after adding it

### Tests Pass But Real Webhooks Fail
**Problem:** Payload structure might be different from test cases.

**Solution:**
1. Check server logs for structured JSON output
2. Look for `extraction_failed` entries
3. Review the `extractionStep` and `itemKeys` in logs
4. Update extraction logic if needed

## Checking Test Results

### Unit Test Results
Unit tests print results directly to console. Look for:
- ✅ PASS - Test passed
- ❌ FAIL - Test failed (shows expected vs actual)

### Webhook Test Results
After sending a test webhook:

1. **Check Test Script Output:**
   - Status code should be `200`
   - Response should show `{ status: 'received', requestId: '...' }`

2. **Check Server Logs:**
   Look for structured JSON logs showing:
   ```json
   {
     "requestId": "...",
     "webhookId": "notif_test_...",
     "topic": "conversation.admin.assigned",
     "conversationId": "conv_test_123",
     "assigneeId": "admin_test_456",
     "decision": "sent" | "ignored" | "failed",
     "reason": "..."
   }
   ```

3. **Check Processing Decision:**
   - `sent` - Webhook processed successfully
   - `ignored` - Skipped (check `reason` field)
   - `failed` - Error occurred (check logs)

## Integration Testing

For full integration testing with real Intercom webhooks:

1. **Start server locally:**
   ```bash
   npm start
   ```

2. **Expose with ngrok:**
   ```bash
   ngrok http 3000
   ```

3. **Configure Intercom webhook:**
   - URL: `https://your-ngrok-url.ngrok.io/intercom/webhook`
   - Topic: `conversation.admin.assigned`
   - Permission: `read_conversations`

4. **Assign a conversation in Intercom:**
   - Assign to an admin
   - Assign to both team and admin (tests the fix)
   - Check server logs and Slack

5. **Check results:**
   - Server logs show structured JSON
   - Slack DM received (or fallback channel if configured)
   - Health endpoint shows stats: `GET http://localhost:3000/health`

## Continuous Testing

Run all tests before committing:
```bash
npm run test-tokens && npm run test-extraction
```

This ensures:
- ✅ Tokens are configured correctly
- ✅ Extraction logic works for all scenarios
- ✅ No regressions introduced
