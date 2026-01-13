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
 * @returns {Date} - Next time business hours start (in UTC)
 */
export function getNextBusinessHoursStart() {
  const now = new Date();
  const startTime = parseTime(DEFAULT_START_TIME);
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long'
  });
  
  const dayMap = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };
  
  // Get current time in target timezone
  const currentParts = formatter.formatToParts(now);
  const currentTzHour = parseInt(currentParts.find(p => p.type === 'hour').value);
  const currentTzMinute = parseInt(currentParts.find(p => p.type === 'minute').value);
  const currentTzMinutes = currentTzHour * 60 + currentTzMinute;
  const startMinutes = startTime.hours * 60 + startTime.minutes;
  const currentWeekday = currentParts.find(p => p.type === 'weekday').value;
  const currentDayOfWeek = dayMap[currentWeekday];
  
  // Check if today is a business day and we haven't passed start time
  if (DEFAULT_BUSINESS_DAYS.includes(currentDayOfWeek) && currentTzMinutes < startMinutes) {
    // Today at start time - find the UTC time that corresponds to startTime in the timezone
    return findUTCTimeForTimezoneTime(now, startTime.hours, startTime.minutes, DEFAULT_TIMEZONE);
  }
  
  // Find next business day
  for (let daysAhead = 1; daysAhead < 14; daysAhead++) {
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const futureParts = formatter.formatToParts(futureDate);
    const futureWeekday = futureParts.find(p => p.type === 'weekday').value;
    const futureDayOfWeek = dayMap[futureWeekday];
    
    if (DEFAULT_BUSINESS_DAYS.includes(futureDayOfWeek)) {
      return findUTCTimeForTimezoneTime(futureDate, startTime.hours, startTime.minutes, DEFAULT_TIMEZONE);
    }
  }
  
  // Fallback (shouldn't reach here)
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Find UTC time that corresponds to a specific local time in a timezone
 * @param {Date} referenceDate - Reference date (used to determine which day)
 * @param {number} targetHour - Target hour (0-23) in the timezone
 * @param {number} targetMinute - Target minute (0-59) in the timezone
 * @param {string} timezone - Target timezone
 * @returns {Date} - UTC Date object
 */
function findUTCTimeForTimezoneTime(referenceDate, targetHour, targetMinute, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  // Get the date parts in the timezone for the reference date
  const refParts = formatter.formatToParts(referenceDate);
  const targetYear = parseInt(refParts.find(p => p.type === 'year').value);
  const targetMonth = parseInt(refParts.find(p => p.type === 'month').value) - 1;
  const targetDay = parseInt(refParts.find(p => p.type === 'day').value);
  
  // Start with a guess: use the reference date and set UTC hours to target
  // Then adjust until the timezone formatter shows our target time
  let candidate = new Date(referenceDate);
  candidate.setUTCHours(targetHour, targetMinute, 0, 0);
  
  // Binary search approach: try different UTC times until we find one that
  // when formatted in the timezone, gives us our target time
  let minOffset = -12 * 60; // -12 hours in minutes
  let maxOffset = 12 * 60;  // +12 hours in minutes
  
  // Try a simpler approach: iterate through possible UTC offsets
  for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
    const testDate = new Date(referenceDate);
    testDate.setUTCHours(targetHour + offsetHours, targetMinute, 0, 0);
    
    const testParts = formatter.formatToParts(testDate);
    const testHour = parseInt(testParts.find(p => p.type === 'hour').value);
    const testMinute = parseInt(testParts.find(p => p.type === 'minute').value);
    const testDay = parseInt(testParts.find(p => p.type === 'day').value);
    const testYear = parseInt(testParts.find(p => p.type === 'year').value);
    const testMonth = parseInt(testParts.find(p => p.type === 'month').value) - 1;
    
    if (testYear === targetYear && testMonth === targetMonth && testDay === targetDay && 
        testHour === targetHour && testMinute === targetMinute) {
      return testDate;
    }
  }
  
  // If simple approach didn't work, use a more precise search
  // Calculate timezone offset for the reference date
  const refTime = referenceDate.getTime();
  const refTzStr = formatter.format(referenceDate);
  const refTzParts = formatter.formatToParts(referenceDate);
  const refTzHour = parseInt(refTzParts.find(p => p.type === 'hour').value);
  
  // Estimate offset based on difference
  const refUTCHour = referenceDate.getUTCHours();
  const estimatedOffset = refTzHour - refUTCHour;
  
  // Try around the estimated offset
  for (let offsetHours = estimatedOffset - 2; offsetHours <= estimatedOffset + 2; offsetHours++) {
    const testDate = new Date(referenceDate);
    testDate.setUTCHours(targetHour + offsetHours, targetMinute, 0, 0);
    
    const testParts = formatter.formatToParts(testDate);
    const testHour = parseInt(testParts.find(p => p.type === 'hour').value);
    const testMinute = parseInt(testParts.find(p => p.type === 'minute').value);
    const testDay = parseInt(testParts.find(p => p.type === 'day').value);
    
    if (testDay === targetDay && testHour === targetHour && testMinute === targetMinute) {
      return testDate;
    }
  }
  
  // Last resort: use a library-like approach with more iterations
  const baseDate = new Date(referenceDate);
  baseDate.setUTCHours(12, 0, 0, 0); // Noon UTC as reference
  
  for (let hours = 0; hours < 24; hours++) {
    for (let minutes = 0; minutes < 60; minutes += 15) {
      const testDate = new Date(baseDate);
      testDate.setUTCHours(hours, minutes, 0, 0);
      
      const testParts = formatter.formatToParts(testDate);
      const testHour = parseInt(testParts.find(p => p.type === 'hour').value);
      const testMinute = parseInt(testParts.find(p => p.type === 'minute').value);
      const testDay = parseInt(testParts.find(p => p.type === 'day').value);
      const testYear = parseInt(testParts.find(p => p.type === 'year').value);
      const testMonth = parseInt(testParts.find(p => p.type === 'month').value) - 1;
      
      if (testYear === targetYear && testMonth === targetMonth && testDay === targetDay && 
          testHour === targetHour && testMinute === targetMinute) {
        return testDate;
      }
    }
  }
  
  // Ultimate fallback
  return new Date(referenceDate.getTime() + 12 * 60 * 60 * 1000);
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
