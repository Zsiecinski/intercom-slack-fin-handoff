# Deploying to Render

This guide walks you through deploying the Intercom-Slack Fin Handoff service to Render.

## Prerequisites

1. A Render account (sign up at https://render.com)
2. Your Intercom and Slack credentials ready
3. A GitHub repository (optional, but recommended)

## Step-by-Step Deployment

### Option 1: Deploy from GitHub (Recommended)

1. **Push your code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Create a new Web Service on Render**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository and branch

3. **Configure the service**
   - **Name**: `intercom-slack-fin-handoff` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free tier is fine for low volume

4. **Add Environment Variables**
   Click "Advanced" → "Add Environment Variable" and add:
   
   **Required:**
   ```
   INTERCOM_CLIENT_SECRET=your_intercom_client_secret
   INTERCOM_TOKEN=your_intercom_api_token
   SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
   ```
   
   **Optional:**
   ```
   FALLBACK_CHANNEL=#your-channel-id-or-name
   EMAIL_DOMAIN=staytuned.digital
   FIN_GATE_MODE=required
   SLA_NUDGE_MINUTES=5
   DEDUPE_TTL_SECONDS=600
   PORT=10000
   ```

5. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy automatically
   - Wait for deployment to complete (usually 2-3 minutes)

6. **Get your webhook URL**
   - Your Render service URL: `https://intercom-slack-fin-handoff.onrender.com`
   - Your webhook endpoint: `https://intercom-slack-fin-handoff.onrender.com/intercom/webhook`
   - Health check: `https://intercom-slack-fin-handoff.onrender.com/health`

### Option 2: Deploy from Render Dashboard (Manual)

1. **Create a new Web Service**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Select "Build and deploy from a Git repository" or "Deploy existing image"

2. **Follow steps 3-6 from Option 1**

## Configure Intercom Webhook

1. Go to your Intercom Developer Hub: https://app.intercom.com/a/apps/_/developer
2. Select your app
3. Go to "Webhooks" → "Subscriptions"
4. Create/Edit webhook subscription:
   - **Endpoint URL**: `https://intercom-slack-fin-handoff.onrender.com/intercom/webhook`
   - **Topic**: `conversation.admin.assigned`
   - **Permission**: `read_conversations`
5. Save the subscription

## Verify Deployment

1. **Check health endpoint:**
   ```bash
   curl https://intercom-slack-fin-handoff.onrender.com/health
   ```
   Should return:
   ```json
   {
     "status": "ok",
     "timestamp": "...",
     "dedupe": {...},
     "nudge": {...}
   }
   ```

2. **Test webhook (from Intercom):**
   - Use Intercom's "Send test notification" feature
   - Check Render logs to see if webhook was received

3. **Check Render logs:**
   - Go to your service dashboard
   - Click "Logs" tab
   - You should see structured JSON logs

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `INTERCOM_CLIENT_SECRET` | Yes | Intercom webhook client secret | `abc123...` |
| `INTERCOM_TOKEN` | Yes | Intercom API access token | `dGhpcyBpcyBhIHRva2Vu...` |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token | `xoxb-1234567890-...` |
| `FALLBACK_CHANNEL` | No | Slack channel for fallback posts | `#support-alerts` or `C1234567890` |
| `EMAIL_DOMAIN` | No | Domain for email mapping | `staytuned.digital` |
| `FIN_GATE_MODE` | No | `required` or `log_only` | `required` |
| `SLA_NUDGE_MINUTES` | No | Minutes before nudge check | `5` |
| `DEDUPE_TTL_SECONDS` | No | Deduplication TTL | `600` |
| `PORT` | No | Server port (Render sets this) | `10000` |

## Render-Specific Notes

1. **Port**: Render sets `PORT` automatically. The code uses `process.env.PORT || 3000`, so it will work automatically.

2. **HTTPS**: Render provides HTTPS automatically. Your webhook URL will be `https://...`

3. **Sleeping**: Free tier services sleep after 15 minutes of inactivity. For production, consider:
   - Using a paid tier (starts at $7/month)
   - Or use a service like UptimeRobot to ping your health endpoint every 5 minutes

4. **Logs**: All logs are structured JSON, making them easy to parse in Render's log viewer.

5. **Environment Variables**: Set them in Render dashboard under "Environment" tab. They're encrypted at rest.

## Monitoring

- **Health Check**: Monitor `/health` endpoint
- **Logs**: Check Render logs for structured JSON entries
- **Metrics**: Render provides basic metrics (requests, response time)

## Troubleshooting

### Service won't start
- Check build logs for npm install errors
- Verify `package.json` has correct `start` script
- Check that all required environment variables are set

### Webhooks not arriving
- Verify webhook URL in Intercom matches your Render service URL
- Check Render logs for incoming requests
- Verify signature verification isn't failing (check INTERCOM_CLIENT_SECRET)

### 401 Unauthorized
- Verify `INTERCOM_CLIENT_SECRET` matches Intercom webhook settings
- Check Render logs for signature verification errors

### Slack DMs not sending
- Verify `SLACK_BOT_TOKEN` is correct
- Check Slack bot has required scopes
- Review Render logs for Slack API errors

## Production Checklist

- [ ] All environment variables set in Render dashboard
- [ ] Intercom webhook configured with correct URL
- [ ] Health endpoint responding
- [ ] Test webhook received successfully
- [ ] Slack DM sent successfully
- [ ] Monitoring set up (optional: UptimeRobot for free tier)
- [ ] `FIN_GATE_MODE=required` set for production
- [ ] `FALLBACK_CHANNEL` set as safety net

## Keep Service Awake (Free Tier)

If using free tier, add a simple ping service:

1. Create a UptimeRobot account: https://uptimerobot.com
2. Add a monitor:
   - Type: HTTP(s)
   - URL: `https://intercom-slack-fin-handoff.onrender.com/health`
   - Interval: 5 minutes
3. This will ping your service every 5 minutes to prevent sleeping

## Updating Deployment

After pushing changes to GitHub:
- Render automatically detects changes
- Triggers a new build
- Deploys the new version
- Zero-downtime deployment (traffic switches after new version is ready)

