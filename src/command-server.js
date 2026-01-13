/**
 * Minimal Express server for Slack slash commands (opt-in/opt-out)
 * Runs alongside the polling service
 */

import 'dotenv/config';
import express from 'express';
import { handleSlashCommand, handleInteractiveAction } from './slack-commands.js';
import { getStats as getPreferenceStats, getAllPreferences } from './preferences.js';
import { getSLAStats } from './sla-monitor.js';

const app = express();
const PORT = process.env.COMMAND_SERVER_PORT || 3001; // Different port from polling

// URL-encoded parsing for Slack commands/interactions
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  const preferenceStats = getPreferenceStats();
  const slaStats = getSLAStats();
  
  res.status(200).json({ 
    status: 'ok', 
    service: 'slack-commands',
    timestamp: new Date().toISOString(),
    preferences: preferenceStats,
    sla: slaStats
  });
});

// Preferences endpoint - list all user preferences
app.get('/preferences', (req, res) => {
  const allPrefs = getAllPreferences();
  const stats = getPreferenceStats();
  
  // Separate opted in and opted out
  const optedIn = allPrefs.filter(p => p.optedIn);
  const optedOut = allPrefs.filter(p => !p.optedIn);
  
  res.status(200).json({
    stats,
    optedIn: optedIn.map(p => ({
      email: p.email,
      updatedAt: new Date(p.updatedAt).toISOString()
    })),
    optedOut: optedOut.map(p => ({
      email: p.email,
      updatedAt: new Date(p.updatedAt).toISOString()
    })),
    all: allPrefs.map(p => ({
      email: p.email,
      optedIn: p.optedIn,
      updatedAt: new Date(p.updatedAt).toISOString()
    }))
  });
});

// Slack slash command endpoint
app.post('/slack/command', async (req, res) => {
  try {
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

// Start server
app.listen(PORT, () => {
  console.log(`Slack Commands Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Preferences: http://localhost:${PORT}/preferences`);
});
