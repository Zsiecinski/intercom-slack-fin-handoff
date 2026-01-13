# Finding Your VPS URL for Slack Commands

To configure Slack commands, you need to provide a publicly accessible URL pointing to your VPS.

## Option 1: Use Your VPS IP Address (Quickest)

### Find Your VPS IP Address:

**On your VPS:**
```bash
# Method 1: Using hostname
hostname -I

# Method 2: Using ip command
ip addr show

# Method 3: Using ifconfig
ifconfig

# Method 4: Check external IP
curl ifconfig.me
```

**From Hostinger Control Panel:**
1. Log into your Hostinger account
2. Go to **VPS** → **Your VPS**
3. Look for **IP Address** or **IPv4 Address**
4. Copy the IP address (e.g., `123.45.67.89`)

### Configure Slack with IP Address:

**Slash Command URL:**
```
http://YOUR_VPS_IP:3001/slack/command
```

**Interactive Components URL:**
```
http://YOUR_VPS_IP:3001/slack/interactive
```

**Example:**
- If your IP is `123.45.67.89`:
  - Command URL: `http://123.45.67.89:3001/slack/command`
  - Interactive URL: `http://123.45.67.89:3001/slack/interactive`

### Important Notes:
- ⚠️ **Slack requires HTTPS** for production, but allows HTTP for development/testing
- You'll need to open port 3001 in your firewall
- IP addresses can change if you restart your VPS (unless you have a static IP)

## Option 2: Use a Domain Name (Recommended for Production)

If you have a domain name pointing to your VPS:

### Set Up Domain:
1. Point your domain's A record to your VPS IP:
   ```
   Type: A
   Name: @ (or subdomain like "api")
   Value: YOUR_VPS_IP
   TTL: 3600
   ```

2. Wait for DNS propagation (can take a few minutes to 48 hours)

### Set Up HTTPS with Nginx (Recommended):

**Install Nginx:**
```bash
sudo apt update
sudo apt install nginx
```

**Install Certbot for SSL:**
```bash
sudo apt install certbot python3-certbot-nginx
```

**Configure Nginx:**
```bash
sudo nano /etc/nginx/sites-available/intercom-commands
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable the site:**
```bash
sudo ln -s /etc/nginx/sites-available/intercom-commands /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

**Get SSL Certificate:**
```bash
sudo certbot --nginx -d your-domain.com
```

### Configure Slack with Domain:

**Slash Command URL:**
```
https://your-domain.com/slack/command
```

**Interactive Components URL:**
```
https://your-domain.com/slack/interactive
```

## Option 3: Use ngrok (For Testing/Development)

If you want to test without setting up a domain:

### Install ngrok:
```bash
# Download from https://ngrok.com/download
# Or use snap
sudo snap install ngrok
```

### Start ngrok:
```bash
# Make sure your command server is running first
ngrok http 3001
```

### Use ngrok URL:
ngrok will give you a URL like `https://abc123.ngrok.io`

**Slash Command URL:**
```
https://abc123.ngrok.io/slack/command
```

**Interactive Components URL:**
```
https://abc123.ngrok.io/slack/interactive
```

**Note:** ngrok URLs change every time you restart (unless you have a paid plan)

## Firewall Configuration

Make sure port 3001 is open:

```bash
# Check firewall status
sudo ufw status

# Allow port 3001
sudo ufw allow 3001/tcp

# Or allow from specific IP (more secure)
sudo ufw allow from YOUR_IP to any port 3001

# Reload firewall
sudo ufw reload
```

## Testing Your URL

Once configured, test if your server is accessible:

```bash
# From your local machine or browser
curl http://YOUR_VPS_IP:3001/health

# Should return:
# {"status":"ok","service":"slack-commands",...}
```

Or visit in browser:
```
http://YOUR_VPS_IP:3001/health
```

## Quick Checklist

- [ ] Found your VPS IP address
- [ ] Opened port 3001 in firewall
- [ ] Started command server: `pm2 start src/command-server.js --name intercom-commands`
- [ ] Tested health endpoint: `curl http://YOUR_VPS_IP:3001/health`
- [ ] Configured Slack app with URLs
- [ ] Tested `/cx-alerts status` command in Slack

## Troubleshooting

### Can't access from outside:
- Check firewall: `sudo ufw status`
- Check if server is running: `pm2 status`
- Check server logs: `pm2 logs intercom-commands`
- Verify port is listening: `sudo netstat -tlnp | grep 3001`

### Slack says "URL not reachable":
- Make sure command server is running
- Check if port 3001 is accessible from internet
- Try accessing health endpoint in browser
- Check Slack app logs in Slack API dashboard

### HTTPS required:
- Use ngrok for testing (free HTTPS)
- Set up domain + Let's Encrypt for production
- Or use a reverse proxy like Cloudflare Tunnel
