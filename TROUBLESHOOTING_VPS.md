# VPS Troubleshooting Guide

## Intercom API Token Issues

### Error: "Access Token Invalid" (401)

This means your Intercom access token is either:
1. **Incorrect** - Wrong token value
2. **Expired** - Token has been revoked or expired
3. **Missing Permissions** - Token doesn't have Tickets API access

#### Solution Steps:

1. **Verify your token is correct:**
   ```bash
   # Check your .env file
   cat .env | grep INTERCOM_ACCESS_TOKEN
   ```
   
   Make sure there are no extra spaces or quotes around the token.

2. **Get a new Intercom Access Token:**
   - Go to https://app.intercom.com/a/apps/_/settings/api-keys
   - Create a new "Server-side" access token
   - Make sure it has **"Read"** permission for **"Tickets"**
   - Copy the token (it starts with something like `dGhpcyBpcyBhIHRva2Vu...`)

3. **Update your .env file:**
   ```bash
   nano .env
   ```
   
   Update the line:
   ```bash
   INTERCOM_ACCESS_TOKEN=your_new_token_here
   ```
   
   Save and exit (Ctrl+X, Y, Enter)

4. **Test again:**
   ```bash
   npm test
   ```

### Token Permissions Required

Your Intercom access token needs these permissions:
- ✅ **Tickets** - Read access
- ✅ **Admins** - Read access (to get admin email/name)

### Testing Token Manually

You can test if your token works by making a direct API call:

```bash
# Replace YOUR_TOKEN with your actual token
curl -X GET "https://api.intercom.io/admins" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Intercom-Version: 2.11" \
  -H "Accept: application/json"
```

If this returns a 401, your token is invalid.
If it returns admin data, your token works but might not have Tickets API access.

## Common Issues

### Issue: Token works for Conversations but not Tickets

**Cause:** Your token might be from an older app that doesn't have Tickets API access.

**Solution:** 
1. Create a new access token in Intercom
2. Make sure your Intercom workspace has Tickets enabled
3. Ensure the token has Tickets API permissions

### Issue: Token has spaces or quotes

**Cause:** Sometimes tokens get copied with extra characters.

**Solution:**
```bash
# Edit .env and make sure token has no quotes or spaces
INTERCOM_ACCESS_TOKEN=dGhpcyBpcyBhIHRva2Vu...  # No quotes!
```

### Issue: Using INTERCOM_TOKEN instead of INTERCOM_ACCESS_TOKEN

**Solution:** The code supports both, but make sure you're using the right one:
```bash
# Either works:
INTERCOM_ACCESS_TOKEN=your_token
# OR
INTERCOM_TOKEN=your_token
```

## Verifying Token Permissions

1. Go to Intercom Developer Hub: https://app.intercom.com/a/apps/_/developer
2. Select your app
3. Go to "Authentication" → "Access Tokens"
4. Check that your token has:
   - Tickets API access
   - Read permissions

## Getting Help

If you're still having issues:

1. **Check Intercom API status:** https://status.intercom.com/
2. **Verify your Intercom plan** includes Tickets API access
3. **Check token format** - Should be a long base64-encoded string
4. **Try creating a new token** from scratch

## Testing After Fix

Once you've updated your token:

```bash
# Test components
npm test

# Test single poll
npm run test-once

# If tests pass, start the service
pm2 start src/poll.js --name intercom-ticket-poller
pm2 logs intercom-ticket-poller
```
