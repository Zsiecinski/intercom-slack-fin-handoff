# Slack App Setup for Opt-In/Opt-Out

To enable the opt-in/opt-out feature, you need to configure a Slack slash command in your Slack app.

## Step 1: Create Slash Command in Slack App

1. Go to https://api.slack.com/apps
2. Select your app (or create a new one)
3. Go to **"Slash Commands"** in the left sidebar
4. Click **"Create New Command"**

## Step 2: Configure the Slash Command

Fill in the form:

- **Command**: `/cx-alerts`
- **Request URL**: `https://intercom-slack-fin-handoff.onrender.com/slack/command`
- **Short Description**: `Manage Fin handoff notifications`
- **Usage Hint**: `opt-in | opt-out | status`

Click **"Save"**

## Step 3: Configure Interactive Components (for Opt-Out Button)

1. In your Slack app settings, go to **"Interactivity & Shortcuts"**
2. Turn on **"Interactivity"**
3. Set **Request URL**: `https://intercom-slack-fin-handoff.onrender.com/slack/interactive`
4. Click **"Save Changes"**

## Step 4: Required Bot Scopes

Make sure your bot has these scopes:

- `users:read.email` - To look up user emails
- `im:write` - To send DMs
- `chat:write` - To post messages
- `commands` - To handle slash commands
- `users:read` - To get user info for opt-in/opt-out

## Step 5: Reinstall App to Workspace

After adding the slash command and interactive components:

1. Go to **"OAuth & Permissions"** in your Slack app
2. Click **"Reinstall to Workspace"**
3. Authorize the new scopes

## Usage

Once configured, users can:

- **Opt in**: `/cx-alerts opt-in`
- **Opt out**: `/cx-alerts opt-out`
- **Check status**: `/cx-alerts status`

Or click the **"🔕 Stop notifications"** button in any notification DM.

## Testing

1. Test the slash command:
   ```
   /cx-alerts status
   ```
   Should show your current opt-in status.

2. Test opt-out:
   ```
   /cx-alerts opt-out
   ```
   Should confirm notifications are disabled.

3. Test opt-in:
   ```
   /cx-alerts opt-in
   ```
   Should confirm notifications are enabled.

4. Test the button:
   - Receive a notification DM
   - Click "🔕 Stop notifications" button
   - Should show confirmation

## Troubleshooting

### Slash command not working
- Verify Request URL is correct and accessible
- Check Render logs for errors
- Ensure bot is installed in workspace

### Button not working
- Verify Interactivity is enabled
- Check Request URL is correct
- Ensure bot has `chat:write` scope

### Can't find user email
- Ensure bot has `users:read.email` scope
- Check that user's Slack email matches Intercom email

