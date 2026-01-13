/**
 * SLA monitoring - tracks SLA status and notifies when SLAs are missed
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendBlockKitMessage } from './slack.js';
import { getTicketLink } from './ticket-notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLA_STATE_FILE = path.join(__dirname, '..', 'sla-state.json');
const SLA_CHANNEL = process.env.SLA_ALERT_CHANNEL; // Channel for SLA missed alerts

// In-memory cache: ticketId -> { sla_status, sla_name, notifiedAt }
const slaStateCache = new Map();

/**
 * Load SLA state from file
 */
async function loadSLAState() {
  try {
    const data = await fs.readFile(SLA_STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    
    // Load into memory
    slaStateCache.clear();
    for (const [ticketId, slaInfo] of Object.entries(state)) {
      slaStateCache.set(ticketId, slaInfo);
    }
    
    console.log(`Loaded SLA state for ${slaStateCache.size} tickets`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No SLA state file found, starting fresh');
    } else {
      console.error('Error loading SLA state:', err);
    }
  }
}

/**
 * Save SLA state to file
 */
async function saveSLAState() {
  try {
    const state = Object.fromEntries(slaStateCache);
    await fs.writeFile(SLA_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving SLA state:', err);
  }
}

// Load state on startup
loadSLAState().catch(err => {
  console.error('Failed to load SLA state on startup:', err);
});

/**
 * Generate Slack Block Kit blocks for SLA missed notification
 * @param {Object} ticket - Ticket object
 * @param {Object} slaApplied - SLA applied object
 * @param {string} ticketLink - Ticket link
 * @returns {Array} - Block Kit blocks
 */
function generateSLAMissedBlocks(ticket, slaApplied, ticketLink) {
  const ticketId = ticket.ticket_id || ticket.id;
  const subject = ticket.ticket_attributes?._default_title_ || ticket.subject || 'No subject';
  const assigneeName = ticket.admin_assignee?.name || 'Unassigned';
  const assigneeEmail = ticket.admin_assignee?.email || null;
  const slaName = slaApplied.sla_name || 'Unknown SLA';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '⚠️ SLA Missed',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*SLA Name:*\n${slaName}`
        },
        {
          type: 'mrkdwn',
          text: `*Ticket ID:*\n${ticketId}`
        },
        {
          type: 'mrkdwn',
          text: `*Assignee:*\n${assigneeName}${assigneeEmail ? ` (${assigneeEmail})` : ''}`
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${ticket.ticket_state?.internal_label || ticket.open ? 'Open' : 'Closed'}`
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
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Created: ${new Date(ticket.created_at * 1000).toLocaleString()}`
        }
      ]
    },
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
          style: 'danger'
        }
      ]
    }
  ];
}

/**
 * Check and process SLA status for a ticket
 * @param {Object} ticket - Ticket object
 * @returns {Promise<boolean>} - True if SLA missed notification was sent
 */
export async function checkSLAStatus(ticket) {
  // Check if SLA monitoring is enabled
  if (!SLA_CHANNEL) {
    return false; // SLA alerts not configured
  }

  const ticketId = ticket.id || ticket.ticket_id;
  if (!ticketId) {
    return false;
  }

  // Get SLA information from ticket
  // Note: Tickets converted from conversations may have sla_applied
  // Also check if ticket has linked conversation with SLA
  let slaApplied = ticket.sla_applied;
  
  // If ticket doesn't have sla_applied directly, check linked conversation
  if (!slaApplied && ticket.linked_objects?.data) {
    // Look for linked conversation with SLA
    for (const linked of ticket.linked_objects.data) {
      if (linked.type === 'conversation' && linked.sla_applied) {
        slaApplied = linked.sla_applied;
        break;
      }
    }
  }
  
  if (!slaApplied || !slaApplied.sla_status) {
    // No SLA applied or status is null (cancelled)
    // Remove from cache if exists
    if (slaStateCache.has(ticketId)) {
      slaStateCache.delete(ticketId);
      await saveSLAState();
    }
    return false;
  }

  const currentStatus = slaApplied.sla_status;
  const slaName = slaApplied.sla_name || 'Unknown SLA';

  // Get previous status from cache
  const previousState = slaStateCache.get(ticketId);
  const previousStatus = previousState?.sla_status;

  // Update cache
  slaStateCache.set(ticketId, {
    sla_status: currentStatus,
    sla_name: slaName,
    updatedAt: Date.now()
  });

  // Check if status changed to "missed"
  if (currentStatus === 'missed') {
    // Check if we've already notified for this missed SLA
    if (previousState?.notifiedAt) {
      // Already notified, skip
      return false;
    }

    // Status is "missed" and we haven't notified yet
    try {
      const ticketLink = getTicketLink(ticketId);
      const blocks = generateSLAMissedBlocks(ticket, slaApplied, ticketLink);

      const success = await sendBlockKitMessage(SLA_CHANNEL, blocks);

      if (success) {
        // Mark as notified
        slaStateCache.set(ticketId, {
          sla_status: currentStatus,
          sla_name: slaName,
          notifiedAt: Date.now(),
          updatedAt: Date.now()
        });
        await saveSLAState();

        console.log(`⚠️  SLA missed notification sent for ticket ${ticketId} (${slaName})`);
        return true;
      } else {
        console.error(`Failed to send SLA missed notification for ticket ${ticketId}`);
        return false;
      }
    } catch (err) {
      console.error(`Error sending SLA missed notification for ticket ${ticketId}:`, err);
      return false;
    }
  }

  // Status is not "missed" - save state but don't notify
  await saveSLAState();
  return false;
}

/**
 * Get SLA monitoring stats
 * @returns {Object} - Stats about SLA monitoring
 */
export function getSLAStats() {
  const totalTracked = slaStateCache.size;
  const missedCount = Array.from(slaStateCache.values()).filter(
    s => s.sla_status === 'missed'
  ).length;
  const activeCount = Array.from(slaStateCache.values()).filter(
    s => s.sla_status === 'active'
  ).length;
  const hitCount = Array.from(slaStateCache.values()).filter(
    s => s.sla_status === 'hit'
  ).length;

  return {
    enabled: !!SLA_CHANNEL,
    channel: SLA_CHANNEL || null,
    totalTracked,
    missed: missedCount,
    active: activeCount,
    hit: hitCount
  };
}
