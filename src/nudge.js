/**
 * SLA Nudge module - schedules follow-up notifications if no admin reply
 */

import { getConversation } from './intercom.js';
import { sendAssignmentDM } from './slack.js';
import { isAssignmentNotified, markAssignmentNotified } from './dedupe.js';

function getConversationLink(conversationId) {
  return `https://app.intercom.com/a/inbox/${conversationId}`;
}

// Parse SLA_NUDGE_MINUTES - if not set, empty, or "disabled", feature is disabled
const SLA_NUDGE_MINUTES_ENV = process.env.SLA_NUDGE_MINUTES;
const SLA_NUDGE_MINUTES = (SLA_NUDGE_MINUTES_ENV && 
                           SLA_NUDGE_MINUTES_ENV.toLowerCase() !== 'disabled' && 
                           SLA_NUDGE_MINUTES_ENV !== '') 
  ? parseInt(SLA_NUDGE_MINUTES_ENV, 10) 
  : null;
const SLA_NUDGE_ENABLED = SLA_NUDGE_MINUTES !== null && SLA_NUDGE_MINUTES > 0;
const FALLBACK_CHANNEL = process.env.FALLBACK_CHANNEL;

// In-memory queue of scheduled nudges
// Key: conversationId, Value: { timeoutId, assigneeEmail, conversationId, scheduledAt }
const nudgeQueue = new Map();

/**
 * Schedule an SLA nudge for a conversation
 * @param {string} conversationId - Conversation ID
 * @param {string} assigneeEmail - Assignee email
 * @param {string} conversationLink - Conversation link
 */
export function scheduleNudge(conversationId, assigneeEmail, conversationLink) {
  if (!SLA_NUDGE_ENABLED) {
    return; // Feature disabled
  }

  // Cancel existing nudge for this conversation if any
  cancelNudge(conversationId);

  const delayMs = SLA_NUDGE_MINUTES * 60 * 1000;
  
  const timeoutId = setTimeout(async () => {
    try {
      await checkAndSendNudge(conversationId, assigneeEmail, conversationLink);
    } catch (err) {
      console.error(`[${conversationId}] Error in SLA nudge check:`, err);
    } finally {
      nudgeQueue.delete(conversationId);
    }
  }, delayMs);

  nudgeQueue.set(conversationId, {
    timeoutId,
    assigneeEmail,
    conversationId,
    scheduledAt: Date.now()
  });

  console.log(`[${conversationId}] Scheduled SLA nudge in ${SLA_NUDGE_MINUTES} minutes for ${assigneeEmail}`);
}

/**
 * Cancel a scheduled nudge
 * @param {string} conversationId - Conversation ID
 */
export function cancelNudge(conversationId) {
  const nudge = nudgeQueue.get(conversationId);
  if (nudge) {
    clearTimeout(nudge.timeoutId);
    nudgeQueue.delete(conversationId);
    console.log(`[${conversationId}] Cancelled scheduled SLA nudge`);
  }
}

/**
 * Check conversation and send nudge if no admin reply
 * @param {string} conversationId - Conversation ID
 * @param {string} assigneeEmail - Assignee email
 * @param {string} conversationLink - Conversation link
 */
async function checkAndSendNudge(conversationId, assigneeEmail, conversationLink) {
  console.log(`[${conversationId}] Checking SLA nudge - fetching conversation...`);

  // Fetch current conversation state
  let conversation;
  try {
    conversation = await getConversation(conversationId);
  } catch (err) {
    console.error(`[${conversationId}] Failed to fetch conversation for nudge:`, err);
    return;
  }

  // Check if conversation is still open
  if (conversation.state !== 'open') {
    console.log(`[${conversationId}] Conversation is ${conversation.state}, skipping nudge`);
    return;
  }

  // Check if admin has replied
  const parts = conversation.conversation_parts?.conversation_parts || [];
  const hasAdminReply = parts.some(part => {
    const author = part.author;
    return author && 
           author.type === 'admin' && 
           part.part_type !== 'assignment' &&
           part.created_at > conversation.statistics?.last_assignment_at;
  });

  if (hasAdminReply) {
    console.log(`[${conversationId}] Admin has replied, skipping nudge`);
    return;
  }

  // Check deduplication - use a special key for nudges
  const lastAssignmentAt = conversation.statistics?.last_assignment_at || Date.now() / 1000;
  const nudgeKey = `nudge:${conversationId}:${assigneeEmail}:${lastAssignmentAt}`;
  
  // Use a simple in-memory check for nudge deduplication
  const nudgeDedupeKey = `nudge_sent:${conversationId}`;
  if (isAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt)) {
    console.log(`[${conversationId}] Nudge already sent for this assignment, skipping`);
    return;
  }

  console.log(`[${conversationId}] No admin reply after ${SLA_NUDGE_MINUTES} minutes, sending nudge...`);

  // Send nudge DM
  const result = await sendAssignmentDM(assigneeEmail, conversation, conversationLink);
  
  if (result.success) {
    console.log(`[${conversationId}] SLA nudge sent successfully`, {
      usedFallback: result.usedFallback
    });
    
    // Mark as notified to prevent duplicate nudges
    markAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt, { type: 'nudge' });

    // Optionally post to fallback channel
    if (FALLBACK_CHANNEL && !result.usedFallback) {
      // Could add a separate fallback post here if needed
    }
  } else {
    console.error(`[${conversationId}] Failed to send SLA nudge`);
  }
}

/**
 * Get nudge queue stats
 */
export function getNudgeStats() {
  return {
    enabled: SLA_NUDGE_ENABLED,
    scheduled: nudgeQueue.size,
    slaMinutes: SLA_NUDGE_MINUTES
  };
}

