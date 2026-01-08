/**
 * Deduplication module with TTL Map
 * Can be replaced with Redis later
 */

const DEDUPE_TTL_SECONDS = parseInt(process.env.DEDUPE_TTL_SECONDS || '600', 10); // 10 minutes default
const DEDUPE_TTL_MS = DEDUPE_TTL_SECONDS * 1000;

// In-memory deduplication stores
// Key: dedupe key, Value: { timestamp, metadata }
const dedupeStore = new Map();

/**
 * Check if a webhook was already processed
 * @param {string} webhookId - Webhook notification ID (notif_xxx)
 * @returns {boolean} - True if already processed
 */
export function isWebhookProcessed(webhookId) {
  if (!webhookId) return false;
  
  const entry = dedupeStore.get(`webhook:${webhookId}`);
  if (!entry) return false;

  const age = Date.now() - entry.timestamp;
  if (age > DEDUPE_TTL_MS) {
    dedupeStore.delete(`webhook:${webhookId}`);
    return false;
  }

  return true;
}

/**
 * Mark a webhook as processed
 * @param {string} webhookId - Webhook notification ID
 * @param {Object} metadata - Optional metadata to store
 */
export function markWebhookProcessed(webhookId, metadata = {}) {
  if (!webhookId) return;
  dedupeStore.set(`webhook:${webhookId}`, {
    timestamp: Date.now(),
    metadata
  });
}

/**
 * Check if an assignment was already notified
 * @param {string} conversationId - Conversation ID
 * @param {string} assigneeEmail - Assignee email
 * @param {number} lastAssignmentAt - Last assignment timestamp
 * @returns {boolean} - True if already notified
 */
export function isAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt) {
  if (!conversationId || !assigneeEmail || !lastAssignmentAt) return false;
  
  const key = `assignment:${conversationId}:${assigneeEmail}:${lastAssignmentAt}`;
  const entry = dedupeStore.get(key);
  if (!entry) return false;

  const age = Date.now() - entry.timestamp;
  if (age > DEDUPE_TTL_MS) {
    dedupeStore.delete(key);
    return false;
  }

  return true;
}

/**
 * Mark an assignment as notified
 * @param {string} conversationId - Conversation ID
 * @param {string} assigneeEmail - Assignee email
 * @param {number} lastAssignmentAt - Last assignment timestamp
 * @param {Object} metadata - Optional metadata
 */
export function markAssignmentNotified(conversationId, assigneeEmail, lastAssignmentAt, metadata = {}) {
  if (!conversationId || !assigneeEmail || !lastAssignmentAt) return;
  
  const key = `assignment:${conversationId}:${assigneeEmail}:${lastAssignmentAt}`;
  dedupeStore.set(key, {
    timestamp: Date.now(),
    metadata
  });
}

/**
 * Clean up expired entries
 */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of dedupeStore.entries()) {
    if (now - entry.timestamp > DEDUPE_TTL_MS) {
      dedupeStore.delete(key);
    }
  }
}

// Clean up every minute
setInterval(cleanup, 60 * 1000);

/**
 * Get dedupe store stats (for debugging)
 */
export function getStats() {
  return {
    size: dedupeStore.size,
    ttlSeconds: DEDUPE_TTL_SECONDS
  };
}

