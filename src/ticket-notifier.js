/**
 * Send Slack DM notification for ticket assignment
 */

import { lookupUserByEmail, openDM, sendBlockKitMessage } from './slack.js';

/**
 * Generate ticket link
 * @param {string} ticketId - Intercom ticket ID
 * @returns {string} - Ticket URL
 */
export function getTicketLink(ticketId) {
  return `https://app.intercom.com/a/inbox/tickets/${ticketId}`;
}

/**
 * Generate Slack Block Kit blocks for ticket assignment notification
 * @param {Object} ticket - Ticket object
 * @param {string} assigneeName - Assignee name
 * @param {string} ticketLink - Ticket link
 * @returns {Array} - Block Kit blocks
 */
function generateTicketBlocks(ticket, assigneeName, ticketLink) {
  const subject = ticket.subject || ticket.name || 'No subject';
  const description = ticket.description || ticket.body || '';
  const ticketId = ticket.ticket_id || ticket.id;
  const state = ticket.state || 'unknown';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🎫 New Ticket Assigned',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Assignee:*\n${assigneeName}`
        },
        {
          type: 'mrkdwn',
          text: `*Ticket ID:*\n${ticketId}`
        },
        {
          type: 'mrkdwn',
          text: `*State:*\n${state}`
        },
        {
          type: 'mrkdwn',
          text: `*Created:*\n${new Date(ticket.created_at * 1000).toLocaleString()}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Subject:*\n${subject}`
      }
    },
    ...(description ? [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${description.substring(0, 500)}${description.length > 500 ? '...' : ''}`
      }
    }] : []),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Open in Intercom',
            emoji: true
          },
          url: ticketLink,
          style: 'primary'
        }
      ]
    }
  ];
}

/**
 * Send Slack DM notification for ticket assignment
 * @param {string} assigneeEmail - Assignee email address
 * @param {Object} ticket - Ticket object
 * @param {string} ticketLink - Ticket link
 * @returns {Promise<Object>} - Result object with success flag
 */
export async function sendTicketAssignmentDM(assigneeEmail, ticket, ticketLink) {
  try {
    // Look up Slack user by email
    const userId = await lookupUserByEmail(assigneeEmail);
    
    if (!userId) {
      console.log(`Could not find Slack user for email: ${assigneeEmail}`);
      // Try fallback channel if configured
      if (process.env.FALLBACK_CHANNEL) {
        return await sendTicketToFallbackChannel(ticket, ticketLink, assigneeEmail);
      }
      return { success: false, reason: 'user_not_found' };
    }

    // Open DM channel
    const channelId = await openDM(userId);
    if (!channelId) {
      console.log(`Could not open DM channel for user: ${userId}`);
      // Try fallback channel if configured
      if (process.env.FALLBACK_CHANNEL) {
        return await sendTicketToFallbackChannel(ticket, ticketLink, assigneeEmail);
      }
      return { success: false, reason: 'dm_failed' };
    }

    // Get assignee name from ticket or use email
    const assigneeName = ticket.admin_assignee?.name || assigneeEmail.split('@')[0];

    // Generate blocks
    const blocks = generateTicketBlocks(ticket, assigneeName, ticketLink);

    // Send message
    const success = await sendBlockKitMessage(channelId, blocks);

    if (success) {
      console.log(`Sent ticket assignment DM to ${assigneeEmail} (${userId})`);
      return { success: true, usedFallback: false };
    } else {
      console.error(`Failed to send DM to ${assigneeEmail}`);
      return { success: false, reason: 'send_failed' };
    }
  } catch (err) {
    console.error(`Error sending ticket assignment DM to ${assigneeEmail}:`, err);
    return { success: false, reason: err.message };
  }
}

/**
 * Send ticket notification to fallback channel
 * @param {Object} ticket - Ticket object
 * @param {string} ticketLink - Ticket link
 * @param {string} assigneeEmail - Assignee email
 * @returns {Promise<Object>} - Result object
 */
async function sendTicketToFallbackChannel(ticket, ticketLink, assigneeEmail) {
  const fallbackChannel = process.env.FALLBACK_CHANNEL;
  if (!fallbackChannel) {
    return { success: false, reason: 'no_fallback_channel' };
  }

  try {
    const assigneeName = ticket.admin_assignee?.name || assigneeEmail;
    const blocks = generateTicketBlocks(ticket, assigneeName, ticketLink);
    
    // Add mention of assignee email in fallback message
    blocks.unshift({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Assigned to:* ${assigneeEmail}`
      }
    });

    const success = await sendBlockKitMessage(fallbackChannel, blocks);

    if (success) {
      console.log(`Sent ticket notification to fallback channel: ${fallbackChannel}`);
      return { success: true, usedFallback: true };
    } else {
      return { success: false, reason: 'send_failed' };
    }
  } catch (err) {
    console.error(`Error sending to fallback channel:`, err);
    return { success: false, reason: err.message };
  }
}
