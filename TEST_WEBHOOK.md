# Testing Webhooks

## Quick Reference

### Test Against Local Server (See Logs in Terminal)

1. **Start local server:**
   ```bash
   npm start
   ```

2. **In another terminal, send test webhook:**
   ```bash
   npm run test-webhook team-agent
   ```

3. **Check terminal logs** - You'll see all the processing logs directly

### Test Against Production (Render)

1. **Send test webhook to production:**
   ```bash
   TEST_WEBHOOK_URL=https://intercom-slack-fin-handoff.onrender.com/intercom/webhook npm run test-webhook team-agent
   ```

2. **Check Render logs:**
   - Go to https://dashboard.render.com
   - Navigate to your service
   - Click on "Logs" tab
   - Look for structured JSON logs

## Available Test Scenarios

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

## What to Look For in Logs

### ✅ Success Indicators

When testing `team-agent` scenario, you should see:

1. **Extraction Success:**
   ```json
   {
     "decision": "extraction_success",
     "reason": "team_and_agent_assigned",
     "conversationId": "conv_test_123",
     "assigneeId": "admin_test_456",
     "teamAssigneeId": "team_test_789"
   }
   ```

2. **Processing Continues:**
   - Should NOT see `"reason": "team_assignment_no_fallback"`
   - Should NOT see `"reason": "extraction_failed"`
   - Will see `"reason": "no_assignee_email"` with test data (expected)

### ❌ Failure Indicators

If you see these, something is wrong:

- `"reason": "extraction_failed"` - Extraction didn't work
- `"reason": "team_assignment_no_fallback"` - Skipped due to team assignment (shouldn't happen with agent)

## Viewing Render Logs

### Option 1: Render Dashboard
1. Go to https://dashboard.render.com
2. Click on your service
3. Click "Logs" tab
4. Filter by searching for your webhook ID (e.g., `notif_test_team_agent`)

### Option 2: Render CLI (if installed)
```bash
render logs --service intercom-slack-fin-handoff
```

### Option 3: Check Logs via API
Render provides log streaming - check Render docs for API access

## Testing with Real Data

For full end-to-end testing:

1. **Use real Intercom conversation ID:**
   - Get a real conversation ID from Intercom
   - Modify test payload to use real IDs
   - Or use ngrok to receive real webhooks

2. **Use ngrok for local testing:**
   ```bash
   # Terminal 1: Start server
   npm start
   
   # Terminal 2: Start ngrok
   ngrok http 3000
   
   # Configure Intercom webhook to use ngrok URL
   # Then assign a conversation in Intercom
   ```

## Troubleshooting

### No Logs Appearing

**If testing locally:**
- Make sure server is running (`npm start`)
- Check terminal where server is running
- Look for JSON log entries

**If testing production:**
- Logs are in Render dashboard, not your terminal
- Check Render service logs tab
- Logs may take a few seconds to appear

### Webhook Not Received

- Check URL is correct
- Verify INTERCOM_CLIENT_SECRET matches
- Check signature is being generated correctly
- Look for signature errors in logs

### Extraction Failing

- Check payload structure matches expected format
- Look for `extraction_failed` logs with detailed debug info
- Review `itemKeys` and `payloadKeys` in logs to see what's available
