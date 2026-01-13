/**
 * Enhanced SLA monitoring with deadline calculations, office hours, and pausing
 * Tracks assignment times, calculates deadlines, and monitors both proactive and status-based violations
 */

// Ensure dotenv is loaded first
import 'dotenv/config';

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendBlockKitMessage } from './slack.js';
import { getTicketLink } from './ticket-notifier.js';
import { isBusinessHours, getBusinessHoursConfig } from './business-hours.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLA_STATE_FILE = path.join(__dirname, '..', 'sla-state.json');
const SLA_CHANNEL = process.env.SLA_ALERT_CHANNEL;

// In-memory cache: ticketId -> SLA tracking data
const slaStateCache = new Map();

/**
 * Load SLA state from file
 */
async function loadSLAState() {
  try {
    const data = await fs.readFile(SLA_STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    
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
 * Calculate business hours between two timestamps
 * @param {number} startTimestamp - Start timestamp (seconds)
 * @param {number} endTimestamp - End timestamp (seconds)
 * @param {Object} config - Business hours config
 * @returns {number} - Business hours elapsed in seconds
 */
function calculateBusinessHoursElapsed(startTimestamp, endTimestamp, config) {
  if (!config.enabled) {
    // No business hours restriction - return full elapsed time
    return endTimestamp - startTimestamp;
  }

  let elapsed = 0;
  const start = new Date(startTimestamp * 1000);
  const end = new Date(endTimestamp * 1000);
  
  // Simple approximation: count business days and hours
  // This is a simplified version - for production, use a proper business hours library
  const oneDay = 24 * 60 * 60;
  const daysDiff = Math.floor((endTimestamp - startTimestamp) / oneDay);
  
  // For now, assume 8 business hours per day (can be refined)
  const businessHoursPerDay = 8 * 60 * 60;
  elapsed = daysDiff * businessHoursPerDay;
  
  // Add partial day if within business hours
  // This is simplified - proper implementation would check actual business hours
  return Math.max(0, elapsed);
}

/**
 * Check if ticket is in a paused state (snoozed or waiting on customer)
 * @param {Object} ticket - Ticket object
 * @returns {boolean} - True if paused
 */
function isTicketPaused(ticket) {
  // Check snoozed state
  if (ticket.snoozed_until) {
    const snoozedUntil = ticket.snoozed_until;
    const now = Math.floor(Date.now() / 1000);
    if (snoozedUntil > now) {
      return true; // Still snoozed
    }
  }
  
  // Check ticket state for "waiting on customer"
  const state = ticket.ticket_state?.category || ticket.state;
  if (state === 'waiting_on_customer' || state === 'waiting_on_customer') {
    return true;
  }
  
  return false;
}

/**
 * Extract assignment timestamp from ticket
 * @param {Object} ticket - Ticket object
 * @returns {number|null} - Assignment timestamp in seconds, or null
 */
function getAssignmentTimestamp(ticket) {
  // Try statistics.first_assignment_at (most accurate)
  if (ticket.statistics?.first_assignment_at) {
    return ticket.statistics.first_assignment_at;
  }
  
  // Try statistics.last_assignment_at
  if (ticket.statistics?.last_assignment_at) {
    return ticket.statistics.last_assignment_at;
  }
  
  // Fallback to updated_at if admin_assignee_id exists
  if (ticket.admin_assignee_id && ticket.updated_at) {
    return ticket.updated_at;
  }
  
  return null;
}

/**
 * Extract SLA duration from SLA applied object
 * @param {Object} slaApplied - SLA applied object
 * @returns {number|null} - Duration in seconds, or null
 */
function getSLADuration(slaApplied) {
  // SLA duration is typically stored in sla_events or calculated from SLA rules
  // For now, we'll need to get this from the SLA definition
  // Custom durations can be configured via environment variable SLA_DURATIONS
  // Format: "FRT:300,NRT:300,TTC:86400" (in seconds)
  
  // Check for custom durations from environment
  const customDurations = process.env.SLA_DURATIONS;
  if (customDurations) {
    const durations = {};
    customDurations.split(',').forEach(item => {
      const [key, value] = item.split(':');
      if (key && value) {
        durations[key.trim().toUpperCase()] = parseInt(value.trim(), 10);
      }
    });
    
    const slaName = slaApplied.sla_name?.toUpperCase() || '';
    if (slaName.includes('FIRST RESPONSE') || slaName.includes('FRT')) {
      return durations.FRT || 5 * 60; // Default 5 minutes
    } else if (slaName.includes('NEXT RESPONSE') || slaName.includes('NRT')) {
      return durations.NRT || 5 * 60; // Default 5 minutes
    } else if (slaName.includes('CLOSE') || slaName.includes('TTC')) {
      return durations.TTC || 24 * 60 * 60; // Default 24 hours
    }
  }
  
  // Default durations (customize these for your SLAs)
  const slaName = slaApplied.sla_name?.toLowerCase() || '';
  
  if (slaName.includes('first response') || slaName.includes('frt')) {
    return 5 * 60; // 5 minutes
  } else if (slaName.includes('next response') || slaName.includes('nrt')) {
    return 5 * 60; // 5 minutes
  } else if (slaName.includes('close') || slaName.includes('ttc')) {
    return 24 * 60 * 60; // 24 hours
  }
  
  // Default to 5 minutes if unknown (conservative for short SLAs)
  return 5 * 60;
}

/**
 * Calculate SLA deadline
 * @param {number} assignedAt - Assignment timestamp (seconds)
 * @param {number} slaDuration - SLA duration (seconds)
 * @param {Object} config - Business hours config
 * @returns {number} - Deadline timestamp (seconds)
 */
function calculateDeadline(assignedAt, slaDuration, config) {
  if (!config.enabled) {
    // No business hours - simple addition
    return assignedAt + slaDuration;
  }
  
  // With business hours, we need to calculate elapsed business time
  // For now, use simple addition (can be enhanced with proper business hours calculation)
  return assignedAt + slaDuration;
}

/**
 * Check and process SLA status for a ticket
 * @param {Object} ticket - Ticket object
 * @returns {Promise<Object>} - { alerted: boolean, violationType: string|null, deadline: number|null }
 */
export async function checkSLAStatus(ticket) {
  const ticketId = ticket.id || ticket.ticket_id;
  if (!ticketId) {
    return { alerted: false, violationType: null, deadline: null };
  }

  // Get SLA information
  let slaApplied = ticket.sla_applied;
  
  if (!slaApplied && ticket.linked_objects?.data) {
    for (const linked of ticket.linked_objects.data) {
      if (linked.type === 'conversation' && linked.sla_applied) {
        slaApplied = linked.sla_applied;
        break;
      }
    }
  }
  
  if (!slaApplied || !slaApplied.sla_status) {
    // No SLA - remove from cache
    if (slaStateCache.has(ticketId)) {
      slaStateCache.delete(ticketId);
      await saveSLAState();
    }
    return { alerted: false, violationType: null, deadline: null };
  }

  const currentStatus = slaApplied.sla_status;
  const slaName = slaApplied.sla_name || 'Unknown SLA';
  const config = getBusinessHoursConfig();
  
  // Get assignment timestamp
  const assignedAt = getAssignmentTimestamp(ticket);
  const slaDuration = getSLADuration(slaApplied);
  const isPaused = isTicketPaused(ticket);
  
  // Get previous state
  const previousState = slaStateCache.get(ticketId);
  
  // Calculate deadline
  let deadline = null;
  if (assignedAt && slaDuration) {
    deadline = calculateDeadline(assignedAt, slaDuration, config);
  }
  
  // Update cache with current state
  const now = Math.floor(Date.now() / 1000);
  const stateUpdate = {
    sla_status: currentStatus,
    sla_name: slaName,
    assigned_at: assignedAt,
    sla_duration: slaDuration,
    deadline: deadline,
    is_paused: isPaused,
    updated_at: now,
    alert_history: previousState?.alert_history || []
  };
  
  // Check for violations
  let violationType = null;
  let shouldAlert = false;
  
  // 1. Check official "missed" status
  if (currentStatus === 'missed') {
    const alreadyNotified = previousState?.alert_history?.some(
      a => a.type === 'status_missed' && a.status === 'missed'
    );
    
    if (!alreadyNotified) {
      violationType = 'status_missed';
      shouldAlert = true;
    }
  }
  
  // 2. Check proactive deadline violation (only if not paused and status is active)
  if (!isPaused && currentStatus === 'active' && deadline && now > deadline) {
    const alreadyNotified = previousState?.alert_history?.some(
      a => a.type === 'deadline_violation' && a.deadline === deadline
    );
    
    if (!alreadyNotified) {
      violationType = 'deadline_violation';
      shouldAlert = true;
    }
  }
  
  // Send alert if needed
  if (shouldAlert && SLA_CHANNEL) {
    try {
      const ticketLink = getTicketLink(ticketId);
      const blocks = generateSLAAlertBlocks(ticket, slaApplied, ticketLink, violationType, deadline);
      
      const success = await sendBlockKitMessage(SLA_CHANNEL, blocks);
      
      if (success) {
        // Record alert
        stateUpdate.alert_history.push({
          type: violationType,
          timestamp: now,
          deadline: deadline,
          status: currentStatus
        });
        
        slaStateCache.set(ticketId, stateUpdate);
        await saveSLAState();
        
        console.log(`⚠️  SLA ${violationType} alert sent for ticket ${ticketId} (${slaName})`);
        return { alerted: true, violationType, deadline };
      }
    } catch (err) {
      console.error(`Error sending SLA alert for ticket ${ticketId}:`, err);
    }
  }
  
  // Update cache even if no alert
  slaStateCache.set(ticketId, stateUpdate);
  await saveSLAState();
  
  return { alerted: shouldAlert && !!SLA_CHANNEL, violationType, deadline };
}

/**
 * Generate Slack alert blocks
 */
function generateSLAAlertBlocks(ticket, slaApplied, ticketLink, violationType, deadline) {
  const ticketId = ticket.ticket_id || ticket.id;
  const subject = ticket.ticket_attributes?._default_title_ || ticket.subject || 'No subject';
  const assigneeName = ticket.admin_assignee?.name || 'Unassigned';
  const assigneeEmail = ticket.admin_assignee?.email || null;
  const slaName = slaApplied.sla_name || 'Unknown SLA';
  
  const isDeadlineViolation = violationType === 'deadline_violation';
  const headerText = isDeadlineViolation ? '⏰ SLA Deadline Violated' : '⚠️ SLA Missed';
  
  const deadlineText = deadline 
    ? `Deadline: ${new Date(deadline * 1000).toLocaleString()}`
    : 'Deadline: Unknown';
  
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
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
          text: `${deadlineText} | Created: ${new Date(ticket.created_at * 1000).toLocaleString()}`
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
 * Get all tracked SLA tickets for dashboard
 * @returns {Array} - Array of SLA ticket data
 */
export function getAllSLATickets() {
  const tickets = [];
  const now = Math.floor(Date.now() / 1000);
  
  for (const [ticketId, state] of slaStateCache.entries()) {
    const remaining = state.deadline ? Math.max(0, state.deadline - now) : null;
    const isOverdue = state.deadline && now > state.deadline;
    const minutesRemaining = remaining ? Math.floor(remaining / 60) : null;
    
    tickets.push({
      ticket_id: ticketId,
      sla_name: state.sla_name,
      sla_status: state.sla_status,
      assigned_at: state.assigned_at,
      deadline: state.deadline,
      remaining_seconds: remaining,
      remaining_minutes: minutesRemaining,
      is_overdue: isOverdue,
      is_paused: state.is_paused,
      updated_at: state.updated_at,
      alert_count: state.alert_history?.length || 0
    });
  }
  
  // Sort by deadline (soonest first, then overdue)
  tickets.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline - b.deadline;
  });
  
  return tickets;
}

/**
 * Get SLA stats
 */
export function getSLAStats() {
  const tickets = getAllSLATickets();
  const now = Math.floor(Date.now() / 1000);
  
  const active = tickets.filter(t => t.sla_status === 'active').length;
  const missed = tickets.filter(t => t.sla_status === 'missed').length;
  const hit = tickets.filter(t => t.sla_status === 'hit').length;
  const overdue = tickets.filter(t => t.is_overdue && t.sla_status === 'active').length;
  const paused = tickets.filter(t => t.is_paused).length;
  
  // Count tickets with < 5 minutes remaining
  const critical = tickets.filter(t => 
    t.sla_status === 'active' && 
    t.remaining_minutes !== null && 
    t.remaining_minutes < 5 && 
    !t.is_overdue
  ).length;
  
  return {
    enabled: !!SLA_CHANNEL,
    channel: SLA_CHANNEL || null, // Keep as null (not string "null")
    total_tracked: tickets.length,
    active,
    missed,
    hit,
    overdue,
    critical,
    paused
  };
}
