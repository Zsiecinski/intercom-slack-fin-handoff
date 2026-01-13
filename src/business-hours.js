/**
 * Business hours configuration and checking
 */

// Default business hours (can be overridden via environment variables)
// Format: "HH:MM" in 24-hour format
const DEFAULT_START_TIME = process.env.BUSINESS_HOURS_START || '09:00'; // 9 AM
const DEFAULT_END_TIME = process.env.BUSINESS_HOURS_END || '17:00';   // 5 PM

// Default timezone (can be overridden)
const DEFAULT_TIMEZONE = process.env.BUSINESS_HOURS_TIMEZONE || 'America/New_York';

// Default business days (comma-separated: 0=Sunday, 1=Monday, ..., 6=Saturday)
// Default: Monday-Friday (1,2,3,4,5)
const DEFAULT_BUSINESS_DAYS = process.env.BUSINESS_HOURS_DAYS 
  ? process.env.BUSINESS_HOURS_DAYS.split(',').map(d => parseInt(d.trim()))
  : [1, 2, 3, 4, 5]; // Monday-Friday

/**
 * Parse time string (HH:MM) to hours and minutes
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {Object} - { hours, minutes }
 */
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Check if current time is within business hours
 * @param {Date} date - Date to check (defaults to now)
 * @returns {boolean} - True if within business hours
 */
export function isBusinessHours(date = new Date()) {
  // Check if business hours are enabled
  if (process.env.BUSINESS_HOURS_ENABLED === 'false') {
    return true; // If disabled, always return true (no restrictions)
  }

  try {
    // Get current time in specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long'
    });

    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour').value);
    const minute = parseInt(parts.find(p => p.type === 'minute').value);
    const weekday = parts.find(p => p.type === 'weekday').value;

    // Map weekday name to day number (0=Sunday, 1=Monday, ..., 6=Saturday)
    const dayMap = {
      'Sunday': 0,
      'Monday': 1,
      'Tuesday': 2,
      'Wednesday': 3,
      'Thursday': 4,
      'Friday': 5,
      'Saturday': 6
    };
    const dayOfWeek = dayMap[weekday];

    // Check if it's a business day
    if (!DEFAULT_BUSINESS_DAYS.includes(dayOfWeek)) {
      return false; // Not a business day
    }

    // Parse start and end times
    const startTime = parseTime(DEFAULT_START_TIME);
    const endTime = parseTime(DEFAULT_END_TIME);

    // Convert current time to minutes since midnight
    const currentMinutes = hour * 60 + minute;
    const startMinutes = startTime.hours * 60 + startTime.minutes;
    const endMinutes = endTime.hours * 60 + endTime.minutes;

    // Check if current time is within business hours
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch (err) {
    console.error('Error checking business hours:', err);
    // On error, default to allowing (fail open)
    return true;
  }
}

/**
 * Get next business hours start time
 * @returns {Date} - Next time business hours start
 */
export function getNextBusinessHoursStart() {
  const now = new Date();
  const startTime = parseTime(DEFAULT_START_TIME);
  
  // Create a date for today at start time in the specified timezone
  // This is a simplified calculation - for production, use a proper timezone library
  const nextStart = new Date(now);
  nextStart.setHours(startTime.hours, startTime.minutes, 0, 0);
  
  // If we've already passed today's start time, move to tomorrow
  if (nextStart <= now) {
    nextStart.setDate(nextStart.getDate() + 1);
  }
  
  // Skip weekends if needed
  while (!DEFAULT_BUSINESS_DAYS.includes(nextStart.getDay())) {
    nextStart.setDate(nextStart.getDate() + 1);
  }
  
  return nextStart;
}

/**
 * Get business hours configuration
 * @returns {Object} - Configuration object
 */
export function getBusinessHoursConfig() {
  return {
    enabled: process.env.BUSINESS_HOURS_ENABLED !== 'false',
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    timezone: DEFAULT_TIMEZONE,
    businessDays: DEFAULT_BUSINESS_DAYS,
    businessDaysNames: DEFAULT_BUSINESS_DAYS.map(d => {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[d];
    })
  };
}
