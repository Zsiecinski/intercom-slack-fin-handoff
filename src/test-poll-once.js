/**
 * Test polling script - runs once and exits
 * Useful for testing without starting the interval loop
 */

import 'dotenv/config';
import { searchTickets, getAdmin } from './tickets.js';
import { getLastCheckTime, updateLastCheckTime, initializeState } from './state.js';
import { sendTicketAssignmentDM, getTicketLink } from './ticket-notifier.js';

const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;

// Track processed assignments to avoid duplicates
const processedAssignments = new Set();

function getAssignmentKey(ticketId, assigneeId, assignedAt) {
  return `${ticketId}:${assigneeId}:${assignedAt}`;
}

async function processTicket(ticket, lastCheckTime) {
  const ticketId = ticket.id || ticket.ticket_id;
  const adminAssigneeId = ticket.admin_assignee_id;

  if (!adminAssigneeId) {
    return false;
  }

  const createdAt = ticket.created_at || 0;
  const updatedAt = ticket.updated_at || createdAt;
  const relevantTimestamp = Math.max(createdAt, updatedAt);

  if (createdAt < lastCheckTime && updatedAt < lastCheckTime) {
    return false;
  }

  const assignmentKey = getAssignmentKey(ticketId, adminAssigneeId, relevantTimestamp);
  
  if (processedAssignments.has(assignmentKey)) {
    console.log(`Skipping duplicate assignment: ${assignmentKey}`);
    return false;
  }

  processedAssignments.add(assignmentKey);

  try {
    const admin = await getAdmin(adminAssigneeId);
    if (!admin || !admin.email) {
      console.log(`No email found for admin ${adminAssigneeId}`);
      return false;
    }

    let assigneeEmail = admin.email;
    if (assigneeEmail && assigneeEmail.includes('@intercom-mail.com')) {
      const usernameMatch = assigneeEmail.match(/^([^@]+)@/);
      if (usernameMatch) {
        const emailMapping = process.env.EMAIL_DOMAIN || 'staytuned.digital';
        assigneeEmail = `${usernameMatch[1]}@${emailMapping}`;
      }
    }

    ticket.admin_assignee = {
      id: admin.id,
      name: admin.name,
      email: admin.email
    };

    const ticketLink = getTicketLink(ticketId);

    console.log(`\n📧 Sending notification for ticket ${ticketId} to ${assigneeEmail}...`);
    const result = await sendTicketAssignmentDM(assigneeEmail, ticket, ticketLink);

    if (result.success) {
      console.log(`✅ Notification sent successfully!`);
      return true;
    } else {
      console.error(`❌ Failed to send notification: ${result.reason}`);
      return false;
    }
  } catch (err) {
    console.error(`Error processing ticket ${ticketId}:`, err);
    return false;
  }
}

async function runOnce() {
  const startTime = Date.now();
  const currentTimestamp = Math.floor(Date.now() / 1000);

  console.log(`\n[${new Date().toISOString()}] Running single poll test...\n`);

  try {
    await initializeState();
    let lastCheckTime = await getLastCheckTime();
    
    // For testing: look back further if TEST_LOOKBACK_HOURS is set
    const lookbackHours = parseInt(process.env.TEST_LOOKBACK_HOURS || '0', 10);
    
    if (!lastCheckTime) {
      lastCheckTime = currentTimestamp - (lookbackHours > 0 ? lookbackHours * 3600 : 300); // Default 5 minutes ago, or use TEST_LOOKBACK_HOURS
      console.log(`No previous check time found, starting from ${new Date(lastCheckTime * 1000).toISOString()}`);
    } else if (lookbackHours > 0) {
      // Override with lookback hours for testing
      lastCheckTime = currentTimestamp - (lookbackHours * 3600);
      console.log(`Using TEST_LOOKBACK_HOURS=${lookbackHours}, checking from ${new Date(lastCheckTime * 1000).toISOString()}`);
    } else {
      console.log(`Last check time: ${new Date(lastCheckTime * 1000).toISOString()}`);
    }

    console.log(`Searching for tickets created after ${new Date(lastCheckTime * 1000).toISOString()}...`);
    const tickets = await searchTickets(lastCheckTime, { limit: 100 });

    console.log(`Found ${tickets.length} tickets to process\n`);

    let notificationsSent = 0;
    for (const ticket of tickets) {
      const sent = await processTicket(ticket, lastCheckTime);
      if (sent) {
        notificationsSent++;
      }
    }

    await updateLastCheckTime(currentTimestamp);

    const duration = Date.now() - startTime;
    console.log(`\n✅ Poll completed in ${duration}ms`);
    console.log(`   Processed: ${tickets.length} tickets`);
    console.log(`   Notifications sent: ${notificationsSent}`);
    console.log(`   Updated last check time to: ${new Date(currentTimestamp * 1000).toISOString()}`);

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error during poll:', err);
    process.exit(1);
  }
}

if (!INTERCOM_ACCESS_TOKEN) {
  console.error('ERROR: INTERCOM_ACCESS_TOKEN not configured');
  process.exit(1);
}

if (!process.env.SLACK_BOT_TOKEN) {
  console.error('ERROR: SLACK_BOT_TOKEN not configured');
  process.exit(1);
}

runOnce();
