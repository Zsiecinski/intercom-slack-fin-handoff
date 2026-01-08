# Troubleshooting "dispatch_failed" Error

If you're getting a `dispatch_failed` error when using `/fin-handoff`, here's how to debug and fix it.

## What "dispatch_failed" Means

Slack returns `dispatch_failed` when:
1. The endpoint doesn't respond within 3 seconds
2. The endpoint returns an error status code (4xx, 5xx)
3. The endpoint is not accessible (404, network error)
4. The response format is incorrect

## Step 1: Check Render Logs

1. Go to your Render dashboard: https://dashboard.render.com
2. Select your service: `intercom-slack-fin-handoff`
3. Click on **"Logs"** tab
4. Try the command again: `/fin-handoff status`
5. Look for log entries with `slash_command_received` or `handle_slash_command`

You should see structured JSON logs like:
```json
{
  "event": "slash_command_received",
  "path": "/slack/command",
  "method": "POST",
  "contentType": "application/x-www-form-urlencoded",
  "body": { ... },
  "timestamp": "..."
}
```

## Step 2: Verify Endpoint is Accessible

Test the endpoint directly:

```bash
curl -X POST https://intercom-slack-fin-handoff.onrender.com/slack/command \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "command=/fin-handoff&text=status&user_id=U123456"
```

Should return a JSON response (even if it's an error).

## Step 3: Check Slack App Configuration

1. Go to https://api.slack.com/apps
2. Select your app
3. Go to **"Slash Commands"**
4. Verify:
   - Command: `/fin-handoff`
   - Request URL: `https://intercom-slack-fin-handoff.onrender.com/slack/command`
   - URL is accessible (no typos)

## Step 4: Verify Bot Token

Check that `SLACK_BOT_TOKEN` is set in Render:

1. Render Dashboard → Your Service → **"Environment"** tab
2. Verify `SLACK_BOT_TOKEN` is set
3. Token should start with `xoxb-`

## Step 5: Check Bot Scopes

Your bot needs these scopes:
- `users:read` - To get user info
- `users:read.email` - To get user email
- `commands` - To handle slash commands

1. Go to https://api.slack.com/apps → Your App → **"OAuth & Permissions"**
2. Verify scopes are listed
3. If missing, add them and **"Reinstall to Workspace"**

## Step 6: Common Issues

### Issue: Endpoint Returns 404
**Solution**: Verify the URL in Slack app settings matches exactly:
- ✅ `https://intercom-slack-fin-handoff.onrender.com/slack/command`
- ❌ `https://intercom-slack-fin-handoff.onrender.com/slack/command/` (trailing slash)
- ❌ `http://intercom-slack-fin-handoff.onrender.com/slack/command` (http instead of https)

### Issue: Endpoint Times Out (>3 seconds)
**Solution**: 
- Check Render logs for slow operations
- The `getUserEmailFromSlackId` function might be slow
- Verify `SLACK_BOT_TOKEN` is correct

### Issue: Missing User Email
**Solution**:
- Ensure bot has `users:read.email` scope
- User's Slack profile must have an email set
- Check logs for `user_email_not_found` events

### Issue: Response Format Error
**Solution**: 
- Response must be JSON
- Must include `response_type: 'ephemeral'` or `'in_channel'`
- Check logs for the actual response being sent

## Step 7: Test with curl

Test the endpoint manually:

```bash
# Test status command
curl -X POST https://intercom-slack-fin-handoff.onrender.com/slack/command \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "command=/fin-handoff&text=status&user_id=YOUR_SLACK_USER_ID&team_id=T123456"
```

Replace `YOUR_SLACK_USER_ID` with your actual Slack user ID (starts with `U`).

## Step 8: Check Recent Deployments

If you just deployed new code:
1. Verify deployment completed successfully
2. Check Render logs for startup errors
3. Wait 1-2 minutes after deployment before testing

## Still Not Working?

1. **Check Render Logs**: Look for any error messages
2. **Verify Environment Variables**: All required vars are set
3. **Test Health Endpoint**: `curl https://intercom-slack-fin-handoff.onrender.com/health`
4. **Check Slack App Status**: Ensure app is installed in workspace
5. **Try Reinstalling App**: Reinstall to workspace to refresh permissions

## Debug Mode

The code now includes extensive logging. Check Render logs for:
- `slash_command_received` - Request received
- `handle_slash_command` - Processing started
- `fetching_user_email` - Getting user email
- `user_email_fetched` - Email retrieved
- `sending_slash_response` - Sending response
- Any `error` events

All logs are structured JSON for easy parsing.

