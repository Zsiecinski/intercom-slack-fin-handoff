/**
 * Slack slash command handlers for opt-in/opt-out
 */

import { optIn, optOut, isOptedIn, getStats } from './preferences.js';
import { lookupUserByEmail } from './slack.js';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_API_BASE_URL = 'https://slack.com/api';

/**
 * Handle Slack slash command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleSlashCommand(req, res) {
  // Log request body for debugging
  console.log(JSON.stringify({
    event: 'handle_slash_command',
    body: req.body,
    bodyKeys: Object.keys(req.body || {}),
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  }));

  const { command, text, user_id, response_url } = req.body;

  // Verify it's from Slack
  if (!command || command !== '/cx-alerts') {
    console.warn(JSON.stringify({
      event: 'unknown_command',
      command: command,
      timestamp: new Date().toISOString()
    }));
    return res.status(400).json({ error: 'Unknown command' });
  }

  if (!user_id) {
    console.error(JSON.stringify({
      event: 'missing_user_id',
      body: req.body,
      timestamp: new Date().toISOString()
    }));
    return res.json({
      response_type: 'ephemeral',
      text: '❌ Missing user information. Please try again.'
    });
  }

  // Parse command text
  const action = text?.trim().toLowerCase() || 'status';
  
  // Get user email from Slack user ID
  let userEmail = null;
  try {
    console.log(JSON.stringify({
      event: 'fetching_user_email',
      user_id: user_id,
      timestamp: new Date().toISOString()
    }));
    
    userEmail = await getUserEmailFromSlackId(user_id);
    
    console.log(JSON.stringify({
      event: 'user_email_fetched',
      user_id: user_id,
      email: userEmail ? `${userEmail.substring(0, 3)}***` : 'not found',
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    console.error(JSON.stringify({
      event: 'user_email_error',
      user_id: user_id,
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    
    return res.json({
      response_type: 'ephemeral',
      text: '❌ Could not retrieve your email. Please contact an administrator.'
    });
  }

  if (!userEmail) {
    console.warn(JSON.stringify({
      event: 'user_email_not_found',
      user_id: user_id,
      timestamp: new Date().toISOString()
    }));
    
    return res.json({
      response_type: 'ephemeral',
      text: '❌ Could not find your email address. Please contact an administrator.'
    });
  }

  // Handle different commands
  let response;
  
  try {
    switch (action) {
      case 'opt-in':
      case 'on':
      case 'enable':
        optIn(userEmail);
        response = {
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '✅ *You\'re now opted in*\n\nYou\'ll receive notifications when Fin-handled conversations are assigned to you.\n\nUse `/cx-alerts opt-out` to stop notifications.'
              }
            }
          ]
        };
        break;

      case 'opt-out':
      case 'off':
      case 'disable':
        optOut(userEmail);
        response = {
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '🔕 *Notifications disabled*\n\nYou won\'t receive notifications when Fin-handled conversations are assigned to you.\n\nUse `/cx-alerts opt-in` to re-enable notifications.'
              }
            }
          ]
        };
        break;

      case 'status':
      default:
        const optedIn = isOptedIn(userEmail);
        response = {
          response_type: 'ephemeral',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: optedIn 
                ? '✅ *You\'re opted in*\n\nYou\'ll receive notifications when Fin-handled conversations are assigned to you.\n\nUse `/cx-alerts opt-out` to stop notifications.'
                : '🔕 *You\'re opted out*\n\nYou won\'t receive notifications when Fin-handled conversations are assigned to you.\n\nUse `/cx-alerts opt-in` to start receiving notifications.'
              }
            }
          ]
        };
        break;
    }

    console.log(JSON.stringify({
      event: 'sending_slash_response',
      user_id: user_id,
      action: action,
      response_type: response.response_type,
      timestamp: new Date().toISOString()
    }));

    res.json(response);
  } catch (err) {
    console.error(JSON.stringify({
      event: 'slash_command_processing_error',
      user_id: user_id,
      action: action,
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    
    res.json({
      response_type: 'ephemeral',
      text: '❌ An error occurred processing your request. Please try again later.'
    });
  }
}

/**
 * Handle Slack interactive button actions (opt-out button)
 * @param {Object} payload - Slack interaction payload (JSON string)
 * @returns {Promise<Object>} - Response object
 */
export async function handleInteractiveAction(payload) {
  const action = JSON.parse(payload);
  
  if (action.type !== 'block_actions') {
    return { text: 'Unknown action type' };
  }

  const actionItem = action.actions[0];
  const userId = action.user.id;

  // Get user email
  let userEmail = null;
  try {
    userEmail = await getUserEmailFromSlackId(userId);
  } catch (err) {
    console.error('Failed to get user email:', err);
    return {
      response_type: 'ephemeral',
      text: '❌ Could not retrieve your email. Please contact an administrator.'
    };
  }

  if (!userEmail) {
    return {
      response_type: 'ephemeral',
      text: '❌ Could not find your email address.'
    };
  }

  if (actionItem.action_id === 'opt_out') {
    optOut(userEmail);
    return {
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🔕 *Notifications disabled*\n\nYou won\'t receive notifications when Fin-handled conversations are assigned to you.\n\nUse `/fin-handoff opt-in` to re-enable notifications.'
          }
        }
      ]
    };
  }

  return { text: 'Unknown action' };
}

/**
 * Get user email from Slack user ID
 * @param {string} userId - Slack user ID
 * @returns {Promise<string|null>} - User email or null
 */
async function getUserEmailFromSlackId(userId) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  const url = `${SLACK_API_BASE_URL}/users.info`;
  const formData = new URLSearchParams();
  formData.append('user', userId);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const data = await response.json();

  if (!data.ok || !data.user) {
    return null;
  }

  return data.user.profile?.email || data.user.email || null;
}

