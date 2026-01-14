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
 * @returns {Promise<boolean>} - True if already notified
 */
export async function isAssignmentNotified(ticketId, assigneeId, assignmentTimestamp) {
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
  
  // If the timestamp is different but very close (within 60 seconds), 
  // it's likely the same assignment being reprocessed due to ticket updates
  // This handles cases where updated_at changes but assignment hasn't actually changed
  const timeDiff = Math.abs(notifiedAssignment.assignmentTimestamp - assignmentTimestamp);
  if (timeDiff < 60 && notifiedAssignment.assigneeId === assigneeId) {
    return true;
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
