/**
 * Main polling script for Intercom Tickets
 * Polls every 1-2 minutes and sends Slack notifications for new ticket assignments
 */

import 'dotenv/config';
import { searchTickets, getAdmin } from './tickets.js';
import { getLastCheckTime, updateLastCheckTime, initializeState } from './state.js';
import { sendTicketAssignmentDM, getTicketLink } from './ticket-notifier.js';
import { isOptedIn } from './preferences.js';

const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '120000', 10); // Default 2 minutes
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;

// Track processed assignments to avoid duplicates within a polling cycle
const processedAssignments = new Set();

/**
 * Generate a unique key for an assignment
 * @param {string} ticketId - Ticket ID
 * @param {string} assigneeId - Assignee ID
 * @param {number} assignedAt - Assignment timestamp
 * @returns {string} - Unique key
 */
function getAssignmentKey(ticketId, assigneeId, assignedAt) {
  return `${ticketId}:${assigneeId}:${assignedAt}`;
}

/**
 * Process a single ticket for assignments
 * @param {Object} ticket - Ticket object
 * @param {number} lastCheckTime - Last check timestamp
 * @returns {Promise<boolean>} - True if notification was sent
 */
async function processTicket(ticket, lastCheckTime) {
  const ticketId = ticket.id || ticket.ticket_id;
  const adminAssigneeId = ticket.admin_assignee_id;

  // Skip if no admin assignee
  if (!adminAssigneeId) {
    return false;
  }

  // Check if ticket was created or updated after last check
  // Note: We search by created_at, but also check updated_at to catch reassignments
  const createdAt = ticket.created_at || 0;
  const updatedAt = ticket.updated_at || createdAt;
  
  // Use the later of created_at or updated_at to catch assignments
  // This ensures we catch tickets that were assigned after our last check
  const relevantTimestamp = Math.max(createdAt, updatedAt);

  // Skip if ticket is older than our last check
  // Since we search by created_at >= lastCheckTime, this is mainly for updated_at checks
  if (createdAt < lastCheckTime && updatedAt < lastCheckTime) {
    return false;
  }

  // Generate assignment key for deduplication
  const assignmentKey = getAssignmentKey(ticketId, adminAssigneeId, relevantTimestamp);
  
  if (processedAssignments.has(assignmentKey)) {
    console.log(`Skipping duplicate assignment: ${assignmentKey}`);
    return false;
  }

  // Mark as processed
  processedAssignments.add(assignmentKey);

  try {
    // Fetch admin details to get email
    const admin = await getAdmin(adminAssigneeId);
    if (!admin || !admin.email) {
      console.log(`No email found for admin ${adminAssigneeId}`);
      return false;
    }

    // Map Intercom email if needed
    let assigneeEmail = admin.email;
    if (assigneeEmail && assigneeEmail.includes('@intercom-mail.com')) {
      const usernameMatch = assigneeEmail.match(/^([^@]+)@/);
      if (usernameMatch) {
        const emailMapping = process.env.EMAIL_DOMAIN || 'staytuned.digital';
        assigneeEmail = `${usernameMatch[1]}@${emailMapping}`;
      }
    }

    // Add admin info to ticket object
    ticket.admin_assignee = {
      id: admin.id,
      name: admin.name,
      email: admin.email
    };

    // Check opt-in preference
    const userOptedIn = isOptedIn(assigneeEmail);
    if (!userOptedIn) {
      console.log(`Skipping notification for ${assigneeEmail} - user opted out`);
      return false;
    }

    // Generate ticket link
    const ticketLink = getTicketLink(ticketId);

    // Send Slack notification
    const result = await sendTicketAssignmentDM(assigneeEmail, ticket, ticketLink);

    if (result.success) {
      console.log(`✅ Sent notification for ticket ${ticketId} assigned to ${assigneeEmail}`);
      return true;
    } else {
      console.error(`❌ Failed to send notification for ticket ${ticketId}: ${result.reason}`);
      return false;
    }
  } catch (err) {
    console.error(`Error processing ticket ${ticketId}:`, err);
    return false;
  }
}

/**
 * Main polling function
 */
async function poll() {
  const startTime = Date.now();
  const currentTimestamp = Math.floor(Date.now() / 1000);

  console.log(`\n[${new Date().toISOString()}] Starting poll...`);

  try {
    // Initialize state if needed
    await initializeState();

    // Get last check time
    let lastCheckTime = await getLastCheckTime();
    
    // If no last check time, start from 5 minutes ago to catch recent tickets
    if (!lastCheckTime) {
      lastCheckTime = currentTimestamp - 300; // 5 minutes ago
      console.log(`No previous check time found, starting from ${new Date(lastCheckTime * 1000).toISOString()}`);
    } else {
      console.log(`Last check time: ${new Date(lastCheckTime * 1000).toISOString()}`);
    }

    // Search for tickets created after last check
    const tickets = await searchTickets(lastCheckTime, {
      limit: 100 // Fetch up to 100 tickets per poll
    });

    console.log(`Found ${tickets.length} tickets to process`);

    // Process each ticket
    let notificationsSent = 0;
    for (const ticket of tickets) {
      const sent = await processTicket(ticket, lastCheckTime);
      if (sent) {
        notificationsSent++;
      }
    }

    // Update last check time
    await updateLastCheckTime(currentTimestamp);

    const duration = Date.now() - startTime;
    console.log(`Poll completed in ${duration}ms. Sent ${notificationsSent} notifications.`);
    console.log(`Next poll in ${CHECK_INTERVAL / 1000} seconds`);

    // Clear processed assignments set (keep it small)
    if (processedAssignments.size > 1000) {
      processedAssignments.clear();
    }
  } catch (err) {
    console.error('Error during poll:', err);
    // Don't update last check time on error - we'll retry next cycle
  }
}

/**
 * Start polling loop
 */
async function startPolling() {
  if (!INTERCOM_ACCESS_TOKEN) {
    console.error('ERROR: INTERCOM_ACCESS_TOKEN not configured');
    process.exit(1);
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('ERROR: SLACK_BOT_TOKEN not configured');
    process.exit(1);
  }

  console.log('Starting Intercom Tickets polling service...');
  console.log(`Check interval: ${CHECK_INTERVAL / 1000} seconds`);
  console.log(`Intercom API version: 2.11+`);

  // Run initial poll immediately
  await poll();

  // Set up interval for subsequent polls
  setInterval(async () => {
    await poll();
  }, CHECK_INTERVAL);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

// Start polling
startPolling().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
