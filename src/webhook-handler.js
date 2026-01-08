/**
 * Webhook handler with structured logging, deduplication, and Fin gate
 */

import { getConversation, getAdmin } from './intercom.js';
import { sendAssignmentDM } from './slack.js';
import { isFinInvolved } from './fin.js';
import { 
  isWebhookProcessed, 
  markWebhookProcessed, 
  isAssignmentNotified, 
  markAssignmentNotified 
} from './dedupe.js';
import { scheduleNudge } from './nudge.js';
import { isOptedIn } from './preferences.js';

const FIN_GATE_MODE = process.env.FIN_GATE_MODE || 'required'; // required | log_only
const FALLBACK_CHANNEL = process.env.FALLBACK_CHANNEL;

/**
 * Generate conversation link
 * @param {string} conversationId - Intercom conversation ID
 * @returns {string} - Conversation URL
 */
export function getConversationLink(conversationId) {
  return `https://app.intercom.com/a/inbox/${conversationId}`;
}

/**
 * Extract conversation ID and assignee ID from webhook payload
 * @param {Object} payload - Webhook payload
 * @returns {Object|null} - { conversationId, assigneeId, assigneeEmail, assigneeName, teamAssigneeId, lastAssignmentAt } or null
 */
function extractAssignmentInfo(payload) {
  try {
    const item = payload.data?.item || payload.item || payload.data;
    
    if (!item) {
      return null;
    }
    
    const conversationId = item.id || item.conversation_id || payload.conversation_id;
    const teamAssigneeId = item.team_assignee_id;
    const lastAssignmentAt = item.statistics?.last_assignment_at || payload.created_at;
    
    let assigneeId = null;
    let assigneeEmail = null;
    let assigneeName = null;
    
    // Check admin_assignee_id (most common format)
    if (item.admin_assignee_id) {
      assigneeId = String(item.admin_assignee_id);
    }
    
    // Check conversation_parts for assignment info
    if (item.conversation_parts?.conversation_parts) {
      for (const part of item.conversation_parts.conversation_parts) {
        if (part.part_type === 'assignment' || part.part_type === 'default_assignment') {
          if (part.assigned_to?.id) {
            assigneeId = String(part.assigned_to.id);
          }
          
          if (part.author?.id && part.author?.type === 'admin') {
            if (!assigneeId) {
              assigneeId = String(part.author.id);
            }
            if (part.author.email) {
              assigneeEmail = part.author.email;
            }
            if (part.author.name) {
              assigneeName = part.author.name;
            }
          }
        }
      }
    }
    
    // Fallback: check old format
    if (!assigneeId) {
      const assignee = item.assignee || item.admin || payload.assignee || payload.admin;
      if (assignee) {
        if (typeof assignee === 'string') {
          assigneeId = assignee;
        } else if (assignee.id) {
          assigneeId = String(assignee.id);
          assigneeEmail = assignee.email;
          assigneeName = assignee.name;
        } else if (assignee.type === 'admin' && assignee.id) {
          assigneeId = String(assignee.id);
          assigneeEmail = assignee.email;
          assigneeName = assignee.name;
        }
      }
    }

    if (!conversationId || !assigneeId) {
      return null;
    }

    return {
      conversationId: String(conversationId),
      assigneeId: String(assigneeId),
      assigneeEmail: assigneeEmail ? String(assigneeEmail) : null,
      assigneeName: assigneeName ? String(assigneeName) : null,
      teamAssigneeId: teamAssigneeId ? String(teamAssigneeId) : null,
      lastAssignmentAt: lastAssignmentAt ? (typeof lastAssignmentAt === 'number' ? lastAssignmentAt : new Date(lastAssignmentAt).getTime() / 1000) : null
    };
  } catch (err) {
    console.error('Error extracting assignment info:', err);
    return null;
  }
}

/**
 * Handle Intercom webhook payload with structured logging
 * @param {Object} payload - Webhook payload JSON
 */
export async function handleWebhook(payload) {
  const requestId = payload.id || `req_${Date.now()}`;
  const webhookId = payload.id;
  const topic = payload.topic || payload.type;
  
  // Structured log entry
  const logEntry = {
    requestId,
    webhookId,
    topic,
    timestamp: new Date().toISOString()
  };

  // Check topic
  if (topic !== 'conversation.admin.assigned') {
    console.log(JSON.stringify({ ...logEntry, decision: 'ignored', reason: 'wrong_topic' }));
    return;
  }

  // Check webhook deduplication
  if (isWebhookProcessed(webhookId)) {
    console.log(JSON.stringify({ ...logEntry, decision: 'ignored', reason: 'webhook_duplicate' }));
    return;
  }

  // Extract assignment info
  const assignmentInfo = extractAssignmentInfo(payload);
  if (!assignmentInfo) {
    console.log(JSON.stringify({ ...logEntry, decision: 'ignored', reason: 'extraction_failed' }));
    return;
  }

  const { 
    conversationId, 
    assigneeId, 
    assigneeEmail: extractedEmail, 
    assigneeName: extractedName,
    teamAssigneeId,
    lastAssignmentAt
  } = assignmentInfo;

  logEntry.conversationId = conversationId;
  logEntry.assigneeId = assigneeId;

  // Noise control: Skip team assignments unless FALLBACK_CHANNEL is set
  if (teamAssigneeId && !FALLBACK_CHANNEL) {
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'ignored', 
      reason: 'team_assignment_no_fallback' 
    }));
    return;
  }

  // Fetch admin details to get actual email
  let assigneeEmail = extractedEmail;
  let assigneeName = extractedName;
  
  try {
    const admin = await getAdmin(assigneeId);
    assigneeEmail = admin.email;
    assigneeName = admin.name || assigneeName;
    
    // Map Intercom email if needed
    if (assigneeEmail && assigneeEmail.includes('@intercom-mail.com')) {
      const usernameMatch = assigneeEmail.match(/^([^@]+)@/);
      if (usernameMatch) {
        const emailMapping = process.env.EMAIL_DOMAIN || 'staytuned.digital';
        assigneeEmail = `${usernameMatch[1]}@${emailMapping}`;
      }
    }
  } catch (err) {
    console.error(`[${requestId}] Failed to fetch admin details:`, err);
    if (!assigneeEmail) {
      console.log(JSON.stringify({ 
        ...logEntry, 
        decision: 'ignored', 
        reason: 'no_assignee_email' 
      }));
      return;
    }
  }

  if (!assigneeEmail) {
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'ignored', 
      reason: 'no_assignee_email' 
    }));
    return;
  }

  logEntry.assigneeEmail = assigneeEmail;

  // Check assignment deduplication
  if (lastAssignmentAt && isAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt)) {
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'ignored', 
      reason: 'assignment_already_notified' 
    }));
    markWebhookProcessed(webhookId, { conversationId, assigneeEmail });
    return;
  }

  // Fetch conversation details
  let conversation;
  try {
    conversation = await getConversation(conversationId);
  } catch (err) {
    console.error(`[${requestId}] Failed to fetch conversation:`, err);
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'error', 
      reason: 'conversation_fetch_failed' 
    }));
    return;
  }

  // Noise control: Skip if conversation not open
  if (conversation.state !== 'open') {
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'ignored', 
      reason: 'conversation_not_open',
      state: conversation.state
    }));
    markWebhookProcessed(webhookId, { conversationId, assigneeEmail });
    return;
  }

  // Fin involvement check
  const finCheck = isFinInvolved(conversation, payload);
  logEntry.finInvolved = finCheck.involved;
  logEntry.finMatchedRules = finCheck.matchedRules;

  // Apply Fin gate
  if (FIN_GATE_MODE === 'required') {
    if (!finCheck.involved) {
      console.log(JSON.stringify({ 
        ...logEntry, 
        decision: 'ignored', 
        reason: 'fin_not_involved',
        finReason: finCheck.reason
      }));
      markWebhookProcessed(webhookId, { conversationId, assigneeEmail });
      return;
    }
  } else if (FIN_GATE_MODE === 'log_only') {
    console.log(`[${requestId}] FIN_GATE_MODE=log_only: Fin involved=${finCheck.involved}, but sending anyway`);
  }

  // Check opt-in preference
  const userOptedIn = isOptedIn(assigneeEmail);
  if (!userOptedIn) {
    console.log(JSON.stringify({ 
      ...logEntry, 
      decision: 'ignored', 
      reason: 'user_opted_out',
      assigneeEmail
    }));
    markWebhookProcessed(webhookId, { conversationId, assigneeEmail });
    return;
  }

  // Generate conversation link
  const conversationLink = getConversationLink(conversationId);

  // Send Slack DM
  const result = await sendAssignmentDM(assigneeEmail, conversation, conversationLink);
  
  if (result.success) {
    logEntry.decision = 'sent';
    logEntry.usedFallback = result.usedFallback;
    
    // Mark as processed
    markWebhookProcessed(webhookId, { conversationId, assigneeEmail });
    if (lastAssignmentAt) {
      markAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt, { webhookId });
    }

    // Schedule SLA nudge if enabled
    // The scheduleNudge function checks if feature is enabled internally
    scheduleNudge(conversationId, assigneeEmail, conversationLink);

    console.log(JSON.stringify(logEntry));
  } else {
    logEntry.decision = 'failed';
    logEntry.reason = 'slack_send_failed';
    console.log(JSON.stringify(logEntry));
    
    // Don't mark as processed if send failed, so it can be retried
  }
}
