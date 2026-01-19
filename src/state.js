/**
 * State management for polling - tracks last check timestamp and notified assignments
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');

/**
 * Get the full state object
 * @returns {Promise<Object>} - State object
 */
async function getState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet - return default state
      return {
        lastCheckTime: null,
        notifiedAssignments: {}
      };
    }
    console.error('Error reading state file:', err);
    throw err;
  }
}

/**
 * Save the full state object
 * @param {Object} state - State object
 */
async function saveState(state) {
  try {
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing state file:', err);
    throw err;
  }
}

/**
 * Get the last check timestamp
 * @returns {Promise<number>} - Unix timestamp in seconds, or null if not set
 */
export async function getLastCheckTime() {
  const state = await getState();
  return state.lastCheckTime || null;
}

/**
 * Update the last check timestamp
 * @param {number} timestamp - Unix timestamp in seconds
 */
export async function updateLastCheckTime(timestamp) {
  const state = await getState();
  state.lastCheckTime = timestamp;
  await saveState(state);
}

/**
 * Check if an assignment has already been notified
 * @param {string} ticketId - Ticket ID
 * @param {string} assigneeId - Assignee ID
 * @param {number} assignmentTimestamp - Assignment timestamp in seconds
 * @param {Object} options - Additional options
 * @param {boolean} options.isUsingUpdatedAtAsAssignment - True if using updated_at as assignment timestamp (less reliable)
 * @returns {Promise<boolean>} - True if already notified
 */
export async function isAssignmentNotified(ticketId, assigneeId, assignmentTimestamp, options = {}) {
  const state = await getState();
  const assignmentKey = `${ticketId}:${assigneeId}`;
  const notifiedAssignment = state.notifiedAssignments?.[assignmentKey];
  
  if (!notifiedAssignment) {
    return false;
  }
  
  // If the assignment timestamp matches exactly, it's the same assignment
  if (notifiedAssignment.assignmentTimestamp === assignmentTimestamp) {
    return true;
  }
  
  // If the timestamp is different but very close (within 5 minutes), 
  // it's likely the same assignment being reprocessed due to ticket updates
  // This handles cases where updated_at changes but assignment hasn't actually changed
  // Increased to 5 minutes to handle cases where assignment timestamp is recalculated
  const timeDiff = Math.abs(notifiedAssignment.assignmentTimestamp - assignmentTimestamp);
  if (timeDiff < 300 && notifiedAssignment.assigneeId === assigneeId) {
    console.log(`Skipping duplicate assignment: ${ticketId}:${assigneeId} (timestamp diff: ${timeDiff}s, within 5min window)`);
    return true;
  }
  
  // If the assignment was notified very recently (within last 10 minutes), 
  // and assignee is the same, it's likely a duplicate
  const notifiedAgo = Math.floor(Date.now() / 1000) - notifiedAssignment.notifiedAt;
  if (notifiedAgo < 600 && notifiedAssignment.assigneeId === assigneeId) {
    console.log(`Skipping duplicate assignment: ${ticketId}:${assigneeId} (notified ${notifiedAgo}s ago)`);
    return true;
  }
  
  // CRITICAL: If we're using updated_at as assignment timestamp (statistics not available),
  // be VERY conservative. updated_at changes for many reasons (comments, status changes, etc.),
  // not just assignments. If we've already notified for this ticket+assignee, only allow
  // a new notification if it's been more than 24 hours since the last notification,
  // indicating it might be a real reassignment.
  if (options.isUsingUpdatedAtAsAssignment && notifiedAssignment.assigneeId === assigneeId) {
    // If it's been less than 24 hours since we last notified, skip it
    // This prevents duplicate notifications when tickets are updated for other reasons
    if (notifiedAgo < 86400) { // Less than 24 hours (86400 seconds)
      console.log(`Skipping notification for ticket ${ticketId} - already notified ${Math.floor(notifiedAgo / 60)} minutes ago (using updated_at, likely ticket update not reassignment)`);
      return true;
    }
    // If it's been more than 24 hours, allow it (might be a real reassignment)
    console.log(`Allowing notification for ticket ${ticketId} - last notified ${Math.floor(notifiedAgo / 3600)} hours ago (using updated_at, possible reassignment)`);
    return false;
  }
  
  // If we have statistics (first_assignment_at or last_assignment_at), we can be more precise.
  // If the assignment timestamp from statistics hasn't changed significantly, it's the same assignment.
  // Only allow if the assignment timestamp is significantly different (more than 1 hour),
  // indicating a real reassignment rather than just a ticket update.
  if (!options.isUsingUpdatedAtAsAssignment && notifiedAssignment.assigneeId === assigneeId) {
    // If the assignment timestamp difference is less than 1 hour, it's likely the same assignment
    // being reprocessed due to ticket updates (comments, status changes, etc.)
    if (timeDiff < 3600) { // Less than 1 hour difference
      console.log(`Skipping notification for ticket ${ticketId} - assignment timestamp diff: ${timeDiff}s (likely same assignment, ticket was updated)`);
      return true;
    }
    // If the assignment timestamp difference is more than 1 hour, it might be a real reassignment
    console.log(`Allowing notification for ticket ${ticketId} - assignment timestamp diff: ${timeDiff}s (possible reassignment)`);
    return false;
  }
  
  // Different timestamp and assignee is the same - could be a reassignment or ticket update
  // We'll allow it to proceed, but the timestamp check will help distinguish
  return false;
}

/**
 * Mark an assignment as notified
 * @param {string} ticketId - Ticket ID
 * @param {string} assigneeId - Assignee ID
 * @param {number} assignmentTimestamp - Assignment timestamp in seconds
 */
export async function markAssignmentNotified(ticketId, assigneeId, assignmentTimestamp) {
  const state = await getState();
  if (!state.notifiedAssignments) {
    state.notifiedAssignments = {};
  }
  
  const assignmentKey = `${ticketId}:${assigneeId}`;
  state.notifiedAssignments[assignmentKey] = {
    assigneeId,
    assignmentTimestamp,
    notifiedAt: Math.floor(Date.now() / 1000)
  };
  
  // Clean up old entries (older than 7 days) to prevent state file from growing too large
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  for (const [key, value] of Object.entries(state.notifiedAssignments)) {
    if (value.notifiedAt < sevenDaysAgo) {
      delete state.notifiedAssignments[key];
    }
  }
  
  await saveState(state);
}

/**
 * Initialize state file if it doesn't exist
 * @param {number} initialTimestamp - Initial timestamp to use (defaults to now)
 */
export async function initializeState(initialTimestamp = null) {
  try {
    await fs.access(STATE_FILE);
    // File exists, ensure it has the new structure
    const state = await getState();
    if (!state.notifiedAssignments) {
      state.notifiedAssignments = {};
      await saveState(state);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist - create it
      const timestamp = initialTimestamp || Math.floor(Date.now() / 1000);
      const state = {
        lastCheckTime: timestamp,
        notifiedAssignments: {}
      };
      await saveState(state);
      console.log(`Initialized state file with timestamp: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
    } else {
      throw err;
    }
  }
}
