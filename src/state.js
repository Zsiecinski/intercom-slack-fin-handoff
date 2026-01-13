/**
 * State management for polling - tracks last check timestamp
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '..', 'state.json');

/**
 * Get the last check timestamp
 * @returns {Promise<number>} - Unix timestamp in seconds, or null if not set
 */
export async function getLastCheckTime() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    return state.lastCheckTime || null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet - return null (will start from now)
      return null;
    }
    console.error('Error reading state file:', err);
    throw err;
  }
}

/**
 * Update the last check timestamp
 * @param {number} timestamp - Unix timestamp in seconds
 */
export async function updateLastCheckTime(timestamp) {
  try {
    const state = {
      lastCheckTime: timestamp,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing state file:', err);
    throw err;
  }
}

/**
 * Initialize state file if it doesn't exist
 * @param {number} initialTimestamp - Initial timestamp to use (defaults to now)
 */
export async function initializeState(initialTimestamp = null) {
  try {
    await fs.access(STATE_FILE);
    // File exists, no need to initialize
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist - create it
      const timestamp = initialTimestamp || Math.floor(Date.now() / 1000);
      await updateLastCheckTime(timestamp);
      console.log(`Initialized state file with timestamp: ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);
    } else {
      throw err;
    }
  }
}
