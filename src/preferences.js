/**
 * User preferences module - manages opt-in/opt-out for Fin handoff notifications
 * Can be replaced with database/Redis later
 */

// In-memory store: email -> { optedIn: boolean, updatedAt: timestamp }
// Default: optedIn = true (opt-in by default for existing users)
const preferencesStore = new Map();

// Default behavior: opt-in by default
const DEFAULT_OPT_IN = process.env.DEFAULT_OPT_IN !== 'false'; // true unless explicitly set to 'false'

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
 * @returns {Object} - Updated preference
 */
export function setPreference(email, optedIn) {
  if (!email) {
    throw new Error('Email is required');
  }
  
  const pref = {
    optedIn: Boolean(optedIn),
    updatedAt: Date.now()
  };
  
  preferencesStore.set(email.toLowerCase(), pref);
  return pref;
}

/**
 * Opt in a user
 * @param {string} email - User email
 * @returns {Object} - Updated preference
 */
export function optIn(email) {
  return setPreference(email, true);
}

/**
 * Opt out a user
 * @param {string} email - User email
 * @returns {Object} - Updated preference
 */
export function optOut(email) {
  return setPreference(email, false);
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

