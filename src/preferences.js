/**
 * User preferences module - manages opt-in/opt-out for ticket notifications
 * Persists to JSON file for durability
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREFERENCES_FILE = path.join(__dirname, '..', 'preferences.json');

// In-memory cache: email -> { optedIn: boolean, updatedAt: timestamp }
const preferencesStore = new Map();

// Default behavior: opt-in by default
const DEFAULT_OPT_IN = process.env.DEFAULT_OPT_IN !== 'false'; // true unless explicitly set to 'false'

/**
 * Load preferences from file
 */
async function loadPreferences() {
  try {
    const data = await fs.readFile(PREFERENCES_FILE, 'utf-8');
    const prefs = JSON.parse(data);
    
    // Load into memory
    preferencesStore.clear();
    for (const [email, pref] of Object.entries(prefs)) {
      preferencesStore.set(email.toLowerCase(), pref);
    }
    
    console.log(`Loaded ${preferencesStore.size} preferences from file`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet - that's OK, start fresh
      console.log('No preferences file found, starting fresh');
    } else {
      console.error('Error loading preferences:', err);
    }
  }
}

/**
 * Save preferences to file
 */
async function savePreferences() {
  try {
    const prefs = Object.fromEntries(preferencesStore);
    await fs.writeFile(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving preferences:', err);
  }
}

// Load preferences on startup
loadPreferences().catch(err => {
  console.error('Failed to load preferences on startup:', err);
});

/**
 * Get user preference
 * @param {string} email - User email
 * @returns {boolean} - True if opted in, false if opted out
 */
export function isOptedIn(email) {
  if (!email) return DEFAULT_OPT_IN;
  
  const pref = preferencesStore.get(email.toLowerCase());
  if (pref === undefined) {
    // No preference set, use default
    return DEFAULT_OPT_IN;
  }
  
  return pref.optedIn;
}

/**
 * Set user preference
 * @param {string} email - User email
 * @param {boolean} optedIn - Opt-in status
 * @returns {Promise<Object>} - Updated preference
 */
export async function setPreference(email, optedIn) {
  if (!email) {
    throw new Error('Email is required');
  }
  
  const pref = {
    optedIn: Boolean(optedIn),
    updatedAt: Date.now()
  };
  
  preferencesStore.set(email.toLowerCase(), pref);
  
  // Save to file
  await savePreferences();
  
  return pref;
}

/**
 * Opt in a user
 * @param {string} email - User email
 * @returns {Promise<Object>} - Updated preference
 */
export async function optIn(email) {
  return await setPreference(email, true);
}

/**
 * Opt out a user
 * @param {string} email - User email
 * @returns {Promise<Object>} - Updated preference
 */
export async function optOut(email) {
  return await setPreference(email, false);
}

/**
 * Get preference stats
 * @returns {Object} - Stats about preferences
 */
export function getStats() {
  const total = preferencesStore.size;
  const optedIn = Array.from(preferencesStore.values()).filter(p => p.optedIn).length;
  const optedOut = total - optedIn;
  
  return {
    total,
    optedIn,
    optedOut,
    defaultOptIn: DEFAULT_OPT_IN
  };
}

/**
 * Get all preferences (for admin/debugging)
 * @returns {Array} - Array of { email, optedIn, updatedAt }
 */
export function getAllPreferences() {
  return Array.from(preferencesStore.entries()).map(([email, pref]) => ({
    email,
    ...pref
  }));
}
