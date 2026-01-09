/**
 * Statistics tracking module
 * Tracks message counts and other metrics
 */

// In-memory store for stats
// Structure: { timestamp: count }
const messageStats = new Map();

// Keep stats for 48 hours (longer than 24h window)
const STATS_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Record a successful message send
 */
export function recordMessageSent() {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000)); // Hour bucket
  
  const current = messageStats.get(hourKey) || 0;
  messageStats.set(hourKey, current + 1);
  
  // Clean up old entries
  cleanup();
}

/**
 * Get message count for the last N hours
 * @param {number} hours - Number of hours to look back (default: 24)
 * @returns {Object} - Stats object with count and breakdown
 */
export function getMessageStats(hours = 24) {
  const now = Date.now();
  const currentHour = Math.floor(now / (60 * 60 * 1000));
  const cutoffHour = currentHour - hours;
  
  let total = 0;
  const breakdown = [];
  
  // Count messages in the time window
  for (const [hourKey, count] of messageStats.entries()) {
    if (hourKey > cutoffHour) {
      total += count;
      breakdown.push({
        hour: new Date(hourKey * 60 * 60 * 1000).toISOString(),
        count
      });
    }
  }
  
  // Sort breakdown by hour (oldest first)
  breakdown.sort((a, b) => a.hour.localeCompare(b.hour));
  
  return {
    total,
    hours,
    breakdown: breakdown.slice(-24) // Last 24 hours max
  };
}

/**
 * Clean up old stats entries
 */
function cleanup() {
  const now = Date.now();
  const cutoffHour = Math.floor((now - STATS_TTL_MS) / (60 * 60 * 1000));
  
  for (const hourKey of messageStats.keys()) {
    if (hourKey < cutoffHour) {
      messageStats.delete(hourKey);
    }
  }
}

// Clean up every hour
setInterval(cleanup, 60 * 60 * 1000);

/**
 * Get all stats (for debugging)
 */
export function getAllStats() {
  return {
    totalEntries: messageStats.size,
    entries: Array.from(messageStats.entries()).map(([hour, count]) => ({
      hour: new Date(hour * 60 * 60 * 1000).toISOString(),
      count
    }))
  };
}
