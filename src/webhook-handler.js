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
 * @param {string} requestId - Request ID for logging
 * @returns {Object|null} - { conversationId, assigneeId, assigneeEmail, assigneeName, teamAssigneeId, lastAssignmentAt } or null
 */
export function extractAssignmentInfo(payload, requestId = 'unknown') {
  try {
    const item = payload.data?.item || payload.item || payload.data;
    
    if (!item) {
      // Log payload structure for debugging in structured format
      const debugInfo = {
        requestId,
        extractionStep: 'no_item',
        hasData: !!payload.data,
        hasItem: !!payload.item,
        payloadKeys: Object.keys(payload).slice(0, 30),
        dataKeys: payload.data ? Object.keys(payload.data).slice(0, 30) : null,
        topic: payload.topic || payload.type
      };
      console.log(JSON.stringify({ ...debugInfo, decision: 'extraction_failed', reason: 'no_item' }));
      return null;
    }
    
    const conversationId = item.id || item.conversation_id || payload.conversation_id || payload.data?.id;
    const teamAssigneeId = item.team_assignee_id || item.team?.id || payload.data?.team_assignee_id;
    const lastAssignmentAt = item.statistics?.last_assignment_at || item.last_assignment_at || payload.created_at || payload.timestamp;
    
    let assigneeId = null;
    let assigneeEmail = null;
    let assigneeName = null;
    
    // Check admin_assignee_id (most common format)
    if (item.admin_assignee_id) {
      assigneeId = String(item.admin_assignee_id);
    }
    
    // Check admin_assignee object format
    if (!assigneeId && item.admin_assignee) {
      if (typeof item.admin_assignee === 'string') {
        assigneeId = item.admin_assignee;
      } else if (item.admin_assignee.id) {
        assigneeId = String(item.admin_assignee.id);
        assigneeEmail = item.admin_assignee.email;
        assigneeName = item.admin_assignee.name;
      }
    }
    
    // Check data level admin_assignee_id
    if (!assigneeId && payload.data?.admin_assignee_id) {
      assigneeId = String(payload.data.admin_assignee_id);
    }
    
    // Check conversation_parts for assignment info
    if (item.conversation_parts?.conversation_parts) {
      for (const part of item.conversation_parts.conversation_parts) {
        if (part.part_type === 'assignment' || part.part_type === 'default_assignment') {
          // Check assigned_to field (can be admin or team)
          if (part.assigned_to) {
            // If assigned_to is an admin (not a team), use it
            if (part.assigned_to.type === 'admin' && part.assigned_to.id) {
              assigneeId = String(part.assigned_to.id);
              if (part.assigned_to.email) {
                assigneeEmail = part.assigned_to.email;
              }
              if (part.assigned_to.name) {
                assigneeName = part.assigned_to.name;
              }
            } else if (part.assigned_to.type === 'team' && !assigneeId) {
              // Skip team assignments, but don't overwrite if we already have an admin
              // This handles cases where both team and admin are in conversation_parts
            } else if (part.assigned_to.id && !assigneeId) {
              // Fallback: use id even if type is not explicitly 'admin' or 'team'
              // Only if type is not 'team'
              if (part.assigned_to.type !== 'team') {
                assigneeId = String(part.assigned_to.id);
              }
            }
          }
          
          // Check author field as fallback
          if (part.author?.id && part.author?.type === 'admin') {
            if (!assigneeId) {
              assigneeId = String(part.author.id);
            }
            if (part.author.email && !assigneeEmail) {
              assigneeEmail = part.author.email;
            }
            if (part.author.name && !assigneeName) {
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

    // If we have a conversationId but no assigneeId, log for debugging
    // (This can happen when only a team is assigned, which is handled later)
    if (!conversationId) {
      const debugInfo = {
        requestId,
        extractionStep: 'missing_conversationId',
        hasDataItem: !!payload.data?.item,
        hasItem: !!payload.item,
        hasData: !!payload.data,
        payloadKeys: Object.keys(payload).slice(0, 30),
        itemKeys: item ? Object.keys(item).slice(0, 30) : null
      };
      console.log(JSON.stringify({ ...debugInfo, decision: 'extraction_failed', reason: 'missing_conversationId' }));
      return null;
    }
    
    if (!assigneeId) {
      // This is OK if only team is assigned - we'll handle that in the handler
      // But log it for debugging when both might be expected
      const debugInfo = {
        requestId,
        extractionStep: 'missing_assigneeId',
        conversationId,
        teamAssigneeId: teamAssigneeId || null,
        hasAdminAssigneeId: !!item.admin_assignee_id,
        hasAdminAssignee: !!item.admin_assignee,
        hasConversationParts: !!item.conversation_parts?.conversation_parts,
        conversationPartsCount: item.conversation_parts?.conversation_parts?.length || 0,
        itemKeys: Object.keys(item).slice(0, 30),
        payloadDataKeys: payload.data ? Object.keys(payload.data).slice(0, 30) : null
      };
      
      // Check conversation_parts for any assignment info
      if (item.conversation_parts?.conversation_parts) {
        const assignmentParts = item.conversation_parts.conversation_parts.filter(
          p => p.part_type === 'assignment' || p.part_type === 'default_assignment'
        );
        debugInfo.assignmentPartsCount = assignmentParts.length;
        if (assignmentParts.length > 0) {
          debugInfo.assignmentParts = assignmentParts.map(p => ({
            part_type: p.part_type,
            assigned_to_type: p.assigned_to?.type,
            assigned_to_id: p.assigned_to?.id,
            author_type: p.author?.type,
            author_id: p.author?.id
          }));
        }
      }
      
      console.log(JSON.stringify({ ...debugInfo, decision: 'extraction_failed', reason: 'missing_assigneeId' }));
      // Return null if no assigneeId - we need an agent to send DM
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
    const errorInfo = {
      requestId,
      extractionStep: 'exception',
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5)
    };
    console.log(JSON.stringify({ ...errorInfo, decision: 'extraction_failed', reason: 'exception' }));
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
  let assignmentInfo = extractAssignmentInfo(payload, requestId);
  
  // Fallback: if extraction failed but we have a conversationId, try fetching from API
  if (!assignmentInfo) {
    // Try to get conversationId from payload for fallback fetch
    const item = payload.data?.item || payload.item || payload.data;
    const conversationId = item?.id || item?.conversation_id || payload.conversation_id || payload.data?.id;
    
    if (conversationId) {
      console.log(`[${requestId}] Extraction failed, attempting fallback fetch for conversation ${conversationId}`);
      try {
        const conversation = await getConversation(conversationId);
        
        // Extract assignment from fetched conversation
        const teamAssigneeId = conversation.team?.id || conversation.team_assignee_id;
        const assigneeId = conversation.admin_assignee_id || conversation.admin_assignee?.id;
        const lastAssignmentAt = conversation.statistics?.last_assignment_at || conversation.last_assignment_at;
        
        if (assigneeId) {
          assignmentInfo = {
            conversationId: String(conversationId),
            assigneeId: String(assigneeId),
            assigneeEmail: conversation.admin_assignee?.email || null,
            assigneeName: conversation.admin_assignee?.name || null,
            teamAssigneeId: teamAssigneeId ? String(teamAssigneeId) : null,
            lastAssignmentAt: lastAssignmentAt ? (typeof lastAssignmentAt === 'number' ? lastAssignmentAt : new Date(lastAssignmentAt).getTime() / 1000) : null
          };
          console.log(`[${requestId}] Fallback extraction succeeded`, { assigneeId, teamAssigneeId });
        } else {
          console.log(`[${requestId}] Fallback fetch found conversation but no admin assignee`, { 
            conversationId, 
            teamAssigneeId,
            hasAdminAssigneeId: !!conversation.admin_assignee_id,
            hasAdminAssignee: !!conversation.admin_assignee
          });
        }
      } catch (err) {
        console.error(`[${requestId}] Fallback fetch failed:`, err);
      }
    }
    
    if (!assignmentInfo) {
      console.log(JSON.stringify({ ...logEntry, decision: 'ignored', reason: 'extraction_failed' }));
      return;
    }
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

  // Noise control: Skip team-only assignments (no agent) unless FALLBACK_CHANNEL is set
  // If both team and agent are assigned, we should still send DM to the agent
  if (teamAssigneeId && !assigneeId && !FALLBACK_CHANNEL) {
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
