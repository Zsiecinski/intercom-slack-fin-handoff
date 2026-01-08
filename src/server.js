import 'dotenv/config';
import express from 'express';
import { verifyIntercomSignature } from './intercom.js';
import { handleWebhook } from './webhook-handler.js';
import { getStats as getDedupeStats } from './dedupe.js';
import { getNudgeStats } from './nudge.js';
import { handleSlashCommand, handleInteractiveAction } from './slack-commands.js';
import { getStats as getPreferenceStats } from './preferences.js';

const app = express();
const PORT = process.env.PORT || 3000;

// URL-encoded parsing for Slack commands/interactions (must come before JSON)
app.use(express.urlencoded({ extended: true }));

// JSON parsing for routes that need it (but NOT /intercom/webhook or /slack/*)
app.use((req, res, next) => {
  // Skip JSON parsing for webhook endpoint and Slack endpoints - they use form-encoded
  if (req.path === '/intercom/webhook' || req.path.startsWith('/slack/')) {
    return next();
  }
  express.json()(req, res, next);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const dedupeStats = getDedupeStats();
  const nudgeStats = getNudgeStats();
  const preferenceStats = getPreferenceStats();
  
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dedupe: dedupeStats,
    nudge: nudgeStats,
    preferences: preferenceStats
  });
});

// Slack slash command endpoint
app.post('/slack/command', async (req, res) => {
  try {
    // Log incoming request for debugging
    console.log(JSON.stringify({
      event: 'slash_command_received',
      path: req.path,
      method: req.method,
      contentType: req.headers['content-type'],
      body: req.body,
      timestamp: new Date().toISOString()
    }));

    await handleSlashCommand(req, res);
  } catch (err) {
    console.error(JSON.stringify({
      event: 'slash_command_error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    
    // Make sure we always send a response
    if (!res.headersSent) {
      res.json({
        response_type: 'ephemeral',
        text: '❌ An error occurred. Please try again later.'
      });
    }
  }
});

// Slack interactive actions endpoint (for buttons)
app.post('/slack/interactive', async (req, res) => {
  try {
    const payload = req.body.payload;
    const response = await handleInteractiveAction(payload);
    res.json(response);
  } catch (err) {
    console.error('Error handling interactive action:', err);
    res.json({
      response_type: 'ephemeral',
      text: '❌ An error occurred. Please try again later.'
    });
  }
});

// Intercom webhook endpoint
app.post('/intercom/webhook', (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Capture raw body for signature verification
  const chunks = [];
  req.on('data', chunk => {
    chunks.push(chunk);
  });
  
  req.on('end', async () => {
    try {
      const rawBody = Buffer.concat(chunks);
      const signatureHeader = req.headers['x-hub-signature'] || req.headers['X-Hub-Signature'];

      // Verify signature
      if (!signatureHeader) {
        console.error(JSON.stringify({
          requestId,
          event: 'signature_missing',
          timestamp: new Date().toISOString()
        }));
        return res.status(401).json({ error: 'Missing signature' });
      }

      const isValid = verifyIntercomSignature(rawBody, signatureHeader);
      if (!isValid) {
        console.error(JSON.stringify({
          requestId,
          event: 'signature_invalid',
          timestamp: new Date().toISOString()
        }));
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Parse webhook payload
      let payload;
      try {
        payload = JSON.parse(rawBody.toString());
        payload._requestId = requestId; // Add requestId to payload for logging
      } catch (err) {
        console.error(JSON.stringify({
          requestId,
          event: 'parse_error',
          error: err.message,
          timestamp: new Date().toISOString()
        }));
        return res.status(200).json({ status: 'ignored', reason: 'invalid_json' });
      }

      // Handle webhook asynchronously (don't block response)
      handleWebhook(payload).catch(err => {
        console.error(JSON.stringify({
          requestId: payload._requestId || requestId,
          webhookId: payload.id,
          event: 'handler_error',
          error: err.message,
          stack: err.stack,
          timestamp: new Date().toISOString()
        }));
      });

      // Always return 200 after signature verification
      res.status(200).json({ status: 'received', requestId });
    } catch (err) {
      console.error(JSON.stringify({
        requestId,
        event: 'unexpected_error',
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
      }));
      res.status(200).json({ status: 'error', message: err.message });
    }
  });
  
  req.on('error', (err) => {
    console.error(JSON.stringify({
      requestId,
      event: 'stream_error',
      error: err.message,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Request error' });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/intercom/webhook`);
  console.log(`FIN_GATE_MODE: ${process.env.FIN_GATE_MODE || 'required'}`);
  console.log(`FALLBACK_CHANNEL: ${process.env.FALLBACK_CHANNEL || 'not set'}`);
  const nudgeStats = getNudgeStats();
  console.log(`SLA_NUDGE: ${nudgeStats.enabled ? `enabled (${nudgeStats.slaMinutes} minutes)` : 'disabled'}`);
});
