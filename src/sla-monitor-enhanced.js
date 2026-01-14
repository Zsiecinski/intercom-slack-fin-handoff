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
const ASSIGNMENT_TRACKING_FILE = path.join(__dirname, '..', 'assignment-tracking.json');
const SLA_CHANNEL = process.env.SLA_ALERT_CHANNEL;

// In-memory cache: ticketId -> SLA tracking data
const slaStateCache = new Map();

// In-memory cache: ticketId -> assignment tracking data (all tickets, not just SLA)
const assignmentTrackingCache = new Map();

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

/**
 * Load assignment tracking from file
 */
async function loadAssignmentTracking() {
  try {
    const data = await fs.readFile(ASSIGNMENT_TRACKING_FILE, 'utf-8');
    const tracking = JSON.parse(data);
    
    assignmentTrackingCache.clear();
    for (const [ticketId, assignmentInfo] of Object.entries(tracking)) {
      assignmentTrackingCache.set(ticketId, assignmentInfo);
    }
    
    console.log(`Loaded assignment tracking for ${assignmentTrackingCache.size} tickets`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No assignment tracking file found, starting fresh');
    } else {
      console.error('Error loading assignment tracking:', err);
    }
  }
}

/**
 * Save assignment tracking to file
 */
async function saveAssignmentTracking() {
  try {
    const tracking = {};
    for (const [ticketId, assignmentInfo] of assignmentTrackingCache.entries()) {
      tracking[ticketId] = assignmentInfo;
    }
    await fs.writeFile(ASSIGNMENT_TRACKING_FILE, JSON.stringify(tracking, null, 2));
  } catch (err) {
    console.error('Error saving assignment tracking:', err);
  }
}

/**
 * Track a ticket assignment (all tickets, not just SLA)
 * @param {Object} ticket - Ticket object
 */
export async function trackAssignment(ticket) {
  const ticketId = ticket.id || ticket.ticket_id;
  if (!ticketId) return;
  
  const assigneeName = ticket.admin_assignee?.name || null;
  const assigneeEmail = ticket.admin_assignee?.email || null;
  const assignedAt = ticket.statistics?.first_assignment_at || 
                     ticket.statistics?.last_assignment_at || 
                     ticket.updated_at || 
                     null;
  
  if (!assignedAt) return; // Can't track without assignment timestamp
  
  // Check if already tracked
  const existing = assignmentTrackingCache.get(ticketId);
  if (existing && existing.assigned_at === assignedAt) {
    return; // Already tracked
  }
  
  assignmentTrackingCache.set(ticketId, {
    ticket_id: ticketId,
    assignee_name: assigneeName,
    assignee_email: assigneeEmail,
    assigned_at: assignedAt,
    ticket_created_at: ticket.created_at || null,
    tracked_at: Math.floor(Date.now() / 1000)
  });
  
  await saveAssignmentTracking();
}

// Load state on startup
loadSLAState().catch(err => {
  console.error('Failed to load SLA state on startup:', err);
});

loadAssignmentTracking().catch(err => {
  console.error('Failed to load assignment tracking on startup:', err);
});

/**
 * Reload SLA state from file (for dashboard to sync with polling service)
 * @returns {Promise<number>} - Number of tickets loaded
 */
export async function reloadSLAState() {
  await loadSLAState();
  await loadAssignmentTracking();
  return slaStateCache.size;
}

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
 * Check if ticket has "unwarranted sla" tag
 * @param {Object} ticket - Ticket object
 * @returns {boolean} - True if ticket has the tag
 */
function hasUnwarrantedSLATag(ticket) {
  // Check tags array (can be in different formats)
  const tags = ticket.tags || ticket.tag_list || [];
  
  if (!Array.isArray(tags)) {
    return false;
  }
  
  // Check for "unwarranted sla" tag (case-insensitive)
  return tags.some(tag => {
    const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || '');
    return tagName.toLowerCase().includes('unwarranted sla');
  });
}

/**
 * Get ticket tags as array of strings
 * Tags can be on conversations, and may be in nested structure (tags.tags)
 * @param {Object} ticket - Ticket object (may be ticket or conversation)
 * @returns {Array<string>} - Array of tag names
 */
function getTicketTags(ticket) {
  let tags = ticket.tags || ticket.tag_list || [];
  
  // Handle nested structure: tags.tags (common in conversation API responses)
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    if (tags.tags && Array.isArray(tags.tags)) {
      tags = tags.tags;
    } else if (tags.data && Array.isArray(tags.data)) {
      tags = tags.data;
    } else {
      tags = [];
    }
  }
  
  if (!Array.isArray(tags)) {
    return [];
  }
  
  return tags.map(tag => {
    return typeof tag === 'string' ? tag : (tag.name || tag.id || '');
  }).filter(tag => tag); // Remove empty strings
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
  
  // Debug: Log if ticket has linked_objects
  if (ticket.linked_objects?.data) {
    console.log(`[SLA Debug] Ticket ${ticketId} has ${ticket.linked_objects.data.length} linked objects`);
  }
  
  if (!slaApplied && ticket.linked_objects?.data) {
    for (const linked of ticket.linked_objects.data) {
      if (linked.type === 'conversation' && linked.sla_applied) {
        slaApplied = linked.sla_applied;
        console.log(`[SLA Debug] Found SLA in linked conversation for ticket ${ticketId}: ${slaApplied.sla_name || 'Unknown'}`);
        break;
      }
    }
  }
  
  // Debug: Log if SLA was found
  if (slaApplied && slaApplied.sla_status) {
    console.log(`[SLA Debug] Ticket ${ticketId} has SLA: ${slaApplied.sla_name || 'Unknown'} (status: ${slaApplied.sla_status})`);
  } else {
    console.log(`[SLA Debug] Ticket ${ticketId} has no SLA or SLA status is missing`);
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
  
  // Get ticket tags and assignee info
  const tags = getTicketTags(ticket);
  const hasUnwarrantedTag = hasUnwarrantedSLATag(ticket);
  const assigneeName = ticket.admin_assignee?.name || null;
  const assigneeEmail = ticket.admin_assignee?.email || null;
  
  // Get ticket metadata
  const ticketSubject = ticket.subject || ticket.name || ticket.ticket_attributes?._default_title_ || null;
  const ticketState = ticket.ticket_state?.internal_label || (ticket.open ? 'open' : 'closed') || null;
  const ticketCreatedAt = ticket.created_at || null;
  
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
    alert_history: previousState?.alert_history || [],
    tags: tags,
    has_unwarranted_tag: hasUnwarrantedTag,
    assignee_name: assigneeName,
    assignee_email: assigneeEmail,
    ticket_subject: ticketSubject,
    ticket_state: ticketState,
    ticket_created_at: ticketCreatedAt
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
          action_id: 'open_intercom',
          style: 'danger'
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔕 Stop notifications',
            emoji: true
          },
          action_id: 'opt_out',
          style: 'danger',
          confirm: {
            title: {
              type: 'plain_text',
              text: 'Stop notifications?'
            },
            text: {
              type: 'mrkdwn',
              text: 'You won\'t receive SLA violation notifications. You can opt back in anytime with `/cx-alerts opt-in`.'
            },
            confirm: {
              type: 'plain_text',
              text: 'Stop notifications'
            },
            deny: {
              type: 'plain_text',
              text: 'Cancel'
            }
          }
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
    
    // Calculate time since assignment
    const timeSinceAssignment = state.assigned_at ? (now - state.assigned_at) : null;
    const timeSinceAssignmentMinutes = timeSinceAssignment ? Math.floor(timeSinceAssignment / 60) : null;
    
    // Calculate progress percentage (0-100)
    let progressPercent = null;
    if (state.deadline && state.assigned_at) {
      const totalDuration = state.deadline - state.assigned_at;
      const elapsed = now - state.assigned_at;
      if (totalDuration > 0) {
        progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
      }
    }
    
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
      alert_count: state.alert_history?.length || 0,
      tags: state.tags || [],
      has_unwarranted_tag: state.has_unwarranted_tag || false,
      assignee_name: state.assignee_name || null,
      assignee_email: state.assignee_email || null,
      ticket_subject: state.ticket_subject || null,
      ticket_state: state.ticket_state || null,
      ticket_created_at: state.ticket_created_at || null,
      time_since_assignment: timeSinceAssignment,
      time_since_assignment_minutes: timeSinceAssignmentMinutes,
      progress_percent: progressPercent
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
/**
 * Get SLA stats, optionally from a filtered set of tickets
 * @param {Array} filteredTickets - Optional pre-filtered tickets array. If not provided, uses all tickets.
 * @returns {Object} - Stats object
 */
export function getSLAStats(filteredTickets = null) {
  const tickets = filteredTickets || getAllSLATickets();
  const now = Math.floor(Date.now() / 1000);
  
  const active = tickets.filter(t => t.sla_status === 'active').length;
  const missed = tickets.filter(t => t.sla_status === 'missed').length;
  const hit = tickets.filter(t => t.sla_status === 'hit').length;
  const overdue = tickets.filter(t => t.is_overdue && t.sla_status === 'active').length;
  const paused = tickets.filter(t => t.is_paused).length;
  const unwarranted = tickets.filter(t => t.has_unwarranted_tag).length;
  
  // Count tickets with < 5 minutes remaining
  const critical = tickets.filter(t => 
    t.sla_status === 'active' && 
    t.remaining_minutes !== null && 
    t.remaining_minutes < 5 && 
    !t.is_overdue
  ).length;
  
  // Calculate hit rate (excluding unwarranted)
  const validTickets = tickets.filter(t => !t.has_unwarranted_tag);
  const validHit = validTickets.filter(t => t.sla_status === 'hit').length;
  const hitRate = validTickets.length > 0 ? ((validHit / validTickets.length) * 100).toFixed(1) : 0;
  
  // Calculate average response time (for hit tickets)
  const hitTickets = tickets.filter(t => t.sla_status === 'hit' && t.time_since_assignment_minutes !== null);
  const avgResponseTime = hitTickets.length > 0
    ? Math.round(hitTickets.reduce((sum, t) => sum + t.time_since_assignment_minutes, 0) / hitTickets.length)
    : null;
  
  // Agent performance breakdown
  // First, count all assignments (from assignment tracking)
  const allAssignmentsByAgent = {};
  for (const [ticketId, assignment] of assignmentTrackingCache.entries()) {
    if (!assignment.assignee_name) continue;
    const agent = assignment.assignee_name;
    if (!allAssignmentsByAgent[agent]) {
      allAssignmentsByAgent[agent] = 0;
    }
    allAssignmentsByAgent[agent]++;
  }
  
  // Then, count SLA tickets
  const agentStats = {};
  tickets.forEach(ticket => {
    if (!ticket.assignee_name) return;
    const agent = ticket.assignee_name;
    if (!agentStats[agent]) {
      agentStats[agent] = { 
        total: 0, 
        total_assignments: allAssignmentsByAgent[agent] || 0,
        hit: 0, 
        missed: 0, 
        active: 0, 
        overdue: 0, 
        unwarranted: 0 
      };
    }
    agentStats[agent].total++;
    if (ticket.sla_status === 'hit') agentStats[agent].hit++;
    if (ticket.sla_status === 'missed') agentStats[agent].missed++;
    if (ticket.sla_status === 'active') agentStats[agent].active++;
    if (ticket.is_overdue) agentStats[agent].overdue++;
    if (ticket.has_unwarranted_tag) agentStats[agent].unwarranted++;
  });
  
  // Add total_assignments for agents that have assignments but no SLA tickets
  for (const [agent, totalAssignments] of Object.entries(allAssignmentsByAgent)) {
    if (!agentStats[agent]) {
      agentStats[agent] = { 
        total: 0, 
        total_assignments: totalAssignments,
        hit: 0, 
        missed: 0, 
        active: 0, 
        overdue: 0, 
        unwarranted: 0 
      };
    } else {
      agentStats[agent].total_assignments = totalAssignments;
    }
  }
  
  // SLA type breakdown
  const slaTypeStats = {};
  tickets.forEach(ticket => {
    const slaName = ticket.sla_name;
    if (!slaTypeStats[slaName]) {
      slaTypeStats[slaName] = { total: 0, hit: 0, missed: 0, active: 0, unwarranted: 0 };
    }
    slaTypeStats[slaName].total++;
    if (ticket.sla_status === 'hit') slaTypeStats[slaName].hit++;
    if (ticket.sla_status === 'missed') slaTypeStats[slaName].missed++;
    if (ticket.sla_status === 'active') slaTypeStats[slaName].active++;
    if (ticket.has_unwarranted_tag) slaTypeStats[slaName].unwarranted++;
  });
  
  return {
    enabled: !!SLA_CHANNEL,
    channel: SLA_CHANNEL || null,
    total_tracked: tickets.length,
    active,
    missed,
    hit,
    overdue,
    critical,
    paused,
    unwarranted,
    hit_rate: parseFloat(hitRate),
    avg_response_time_minutes: avgResponseTime,
    agent_stats: agentStats,
    sla_type_stats: slaTypeStats
  };
}
