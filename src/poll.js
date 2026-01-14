/**
 * Main polling script for Intercom Tickets
 * Polls every 1-2 minutes and sends Slack notifications for new ticket assignments
 */

import 'dotenv/config';
import { searchTickets, getAdmin, getTicket } from './tickets.js';
import { getConversation } from './intercom.js';
import { getLastCheckTime, updateLastCheckTime, initializeState, isAssignmentNotified, markAssignmentNotified } from './state.js';
import { sendTicketAssignmentDM, getTicketLink } from './ticket-notifier.js';
import { isOptedIn } from './preferences.js';
import { isBusinessHours, getBusinessHoursConfig, getNextBusinessHoursStart } from './business-hours.js';
import { checkSLAStatus } from './sla-monitor-enhanced.js';

// Default to 30 seconds for short SLAs (5 minutes)
// This ensures we catch violations before they occur
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '30000', 10); // Default 30 seconds
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;

// Track processed assignments to avoid duplicates within a polling cycle
const processedAssignments = new Set();

/**
 * Get the actual assignment timestamp from ticket
 * Uses statistics.first_assignment_at or statistics.last_assignment_at if available
 * Falls back to updated_at if admin_assignee_id exists
 * @param {Object} ticket - Ticket object
 * @returns {number|null} - Assignment timestamp in seconds, or null
 */
function getAssignmentTimestamp(ticket) {
  // Try statistics.first_assignment_at (most accurate for initial assignment)
  if (ticket.statistics?.first_assignment_at) {
    return ticket.statistics.first_assignment_at;
  }
  
  // Try statistics.last_assignment_at (for reassignments)
  if (ticket.statistics?.last_assignment_at) {
    return ticket.statistics.last_assignment_at;
  }
  
  // Fallback to updated_at if admin_assignee_id exists
  // This is less accurate but better than nothing
  if (ticket.admin_assignee_id && ticket.updated_at) {
    return ticket.updated_at;
  }
  
  return null;
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

  // Get the actual assignment timestamp (not just updated_at)
  let assignmentTimestamp = getAssignmentTimestamp(ticket);
  
  // If statistics are not available in search results, fetch full ticket details
  // This ensures we get accurate assignment timestamps and avoid false positives
  if (!assignmentTimestamp && ticketId) {
    try {
      const fullTicket = await getTicket(ticketId);
      assignmentTimestamp = getAssignmentTimestamp(fullTicket);
      // Merge statistics into ticket object for later use
      if (fullTicket.statistics) {
        ticket.statistics = fullTicket.statistics;
      }
    } catch (err) {
      console.error(`Failed to fetch full ticket ${ticketId} for assignment timestamp:`, err.message);
      // Fall through to use updated_at as last resort
    }
  }
  
  // If we still can't determine assignment timestamp, use updated_at as fallback
  // but only if admin_assignee_id exists (indicating it's actually assigned)
  if (!assignmentTimestamp && ticket.admin_assignee_id && ticket.updated_at) {
    assignmentTimestamp = ticket.updated_at;
  }
  
  // If we can't determine assignment timestamp at all, skip
  // This prevents false positives from tickets that were updated for other reasons
  if (!assignmentTimestamp) {
    return false;
  }

  // Check if ticket was created or updated after last check
  // Note: We search by created_at, but also check updated_at to catch reassignments
  const createdAt = ticket.created_at || 0;
  const updatedAt = ticket.updated_at || createdAt;

  // Skip if ticket is older than our last check
  // Since we search by created_at >= lastCheckTime, this is mainly for updated_at checks
  if (createdAt < lastCheckTime && updatedAt < lastCheckTime) {
    return false;
  }

  // Check if this assignment has already been notified (persistent check)
  const alreadyNotified = await isAssignmentNotified(ticketId, adminAssigneeId, assignmentTimestamp);
  if (alreadyNotified) {
    console.log(`Skipping duplicate assignment: ${ticketId}:${adminAssigneeId}:${assignmentTimestamp} (already notified)`);
    return false;
  }

  // Check for duplicates within this polling cycle
  const assignmentKey = `${ticketId}:${adminAssigneeId}:${assignmentTimestamp}`;
  if (processedAssignments.has(assignmentKey)) {
    console.log(`Skipping duplicate assignment: ${assignmentKey} (within same poll cycle)`);
    return false;
  }

  // Mark as processed in this cycle
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
      // Mark as notified in persistent state
      await markAssignmentNotified(ticketId, adminAssigneeId, assignmentTimestamp);
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

  // Check if we're in business hours
  if (!isBusinessHours()) {
    const config = getBusinessHoursConfig();
    const nextStart = getNextBusinessHoursStart();
    const waitMinutes = Math.ceil((nextStart - Date.now()) / 1000 / 60);
    
    console.log(`⏰ Outside business hours (${config.startTime}-${config.endTime} ${config.timezone})`);
    console.log(`   Business days: ${config.businessDaysNames.join(', ')}`);
    console.log(`   Next poll at: ${nextStart.toISOString()} (in ~${waitMinutes} minutes)`);
    return; // Skip polling outside business hours
  }

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

    // Search for tickets created or updated after last check
    // This catches both new tickets and tickets with SLA status changes
    const tickets = await searchTickets(lastCheckTime, {
      limit: 100, // Fetch up to 100 tickets per poll
      includeUpdated: true // Include updated_at to catch SLA status changes
    });

    console.log(`Found ${tickets.length} tickets to process`);

    // Process each ticket
    let notificationsSent = 0;
    let slaAlertsSent = 0;
    
    for (const ticket of tickets) {
      // Process assignment notification
      const sent = await processTicket(ticket, lastCheckTime);
      if (sent) {
        notificationsSent++;
      }

      // Check SLA status with enhanced monitoring
      // Note: SLA info might be in linked conversation, so we fetch full ticket details
      // to get complete information including linked_objects and statistics
      if (ticket.id) {
        try {
          const fullTicket = await getTicket(ticket.id);
          // Merge admin_assignee info if we have it
          if (ticket.admin_assignee) {
            fullTicket.admin_assignee = ticket.admin_assignee;
          }
          
          // Fetch assignee info if missing but admin_assignee_id exists
          if (!fullTicket.admin_assignee && fullTicket.admin_assignee_id) {
            try {
              const admin = await getAdmin(fullTicket.admin_assignee_id);
              if (admin) {
                fullTicket.admin_assignee = {
                  id: admin.id,
                  name: admin.name,
                  email: admin.email
                };
              }
            } catch (adminErr) {
              // Admin fetch failed - continue without assignee info
            }
          }
          
          // Fetch tags from linked conversations (tags are on conversations, not tickets)
          let conversationTags = [];
          if (fullTicket.linked_objects?.data) {
            for (const linked of fullTicket.linked_objects.data) {
              if (linked.type === 'conversation') {
                try {
                  const conversation = await getConversation(linked.id);
                  // Tags are on the conversation object, may be nested in conversation.tags.tags
                  let convTags = [];
                  if (conversation.tags) {
                    if (Array.isArray(conversation.tags)) {
                      convTags = conversation.tags;
                    } else if (conversation.tags.tags && Array.isArray(conversation.tags.tags)) {
                      convTags = conversation.tags.tags;
                    } else if (conversation.tags.data && Array.isArray(conversation.tags.data)) {
                      convTags = conversation.tags.data;
                    }
                  }
                  if (convTags.length > 0) {
                    conversationTags = conversationTags.concat(convTags);
                  }
                  // Also merge SLA if ticket doesn't have it
                  if (!fullTicket.sla_applied && conversation.sla_applied) {
                    fullTicket.sla_applied = conversation.sla_applied;
                    console.log(`[SLA] Found SLA on conversation for ticket ${ticket.id}: ${conversation.sla_applied.sla_name || 'Unknown'}`);
                  }
                } catch (convErr) {
                  // Conversation fetch failed - continue
                }
              }
            }
          }
          
          // If no linked conversations found, try fetching ticket ID as conversation
          // (tickets created from conversations may use conversation ID as ticket ID)
          if (conversationTags.length === 0 && (!fullTicket.sla_applied || !fullTicket.linked_objects?.data || fullTicket.linked_objects.data.length === 0)) {
            try {
              const conversation = await getConversation(ticket.id);
              // Tags may be nested in conversation.tags.tags
              if (conversation.tags) {
                if (Array.isArray(conversation.tags)) {
                  conversationTags = conversation.tags;
                } else if (conversation.tags.tags && Array.isArray(conversation.tags.tags)) {
                  conversationTags = conversation.tags.tags;
                } else if (conversation.tags.data && Array.isArray(conversation.tags.data)) {
                  conversationTags = conversation.tags.data;
                }
              }
              if (conversation.sla_applied) {
                fullTicket.sla_applied = conversation.sla_applied;
                console.log(`[SLA] Found SLA on conversation for ticket ${ticket.id}: ${conversation.sla_applied.sla_name || 'Unknown'}`);
              }
            } catch (convErr) {
              // Not a conversation or conversation fetch failed - that's okay
            }
          }
          
          // Merge conversation tags into ticket object for SLA check
          if (conversationTags.length > 0) {
            fullTicket.tags = conversationTags;
          }
          
          const slaResult = await checkSLAStatus(fullTicket);
          if (slaResult.alerted) {
            slaAlertsSent++;
            console.log(`⚠️  SLA ${slaResult.violationType} alert sent for ticket ${ticket.id}`);
          }
        } catch (err) {
          console.error(`Failed to fetch ticket ${ticket.id} for SLA check:`, err.message);
          // Try with basic ticket info
          const slaResult = await checkSLAStatus(ticket);
          if (slaResult.alerted) {
            slaAlertsSent++;
          }
        }
      } else {
        // No ticket ID, skip SLA check
        const slaResult = await checkSLAStatus(ticket);
        if (slaResult.alerted) {
          slaAlertsSent++;
        }
      }
    }

    // Update last check time
    await updateLastCheckTime(currentTimestamp);

    const duration = Date.now() - startTime;
    console.log(`Poll completed in ${duration}ms. Sent ${notificationsSent} notifications.`);
    if (slaAlertsSent > 0) {
      console.log(`⚠️  Sent ${slaAlertsSent} SLA missed alerts.`);
    }
    console.log(`Next poll in ${CHECK_INTERVAL / 1000} seconds`);

    // Clear processed assignments set periodically (keep it small for in-memory deduplication)
    // Note: Persistent deduplication is handled by state.js
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
  
  // Display business hours configuration
  const bhConfig = getBusinessHoursConfig();
  if (bhConfig.enabled) {
    console.log(`Business hours: ${bhConfig.startTime}-${bhConfig.endTime} ${bhConfig.timezone}`);
    console.log(`Business days: ${bhConfig.businessDaysNames.join(', ')}`);
  } else {
    console.log(`Business hours: Disabled (polling 24/7)`);
  }

  // Run initial poll immediately (will check business hours inside)
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
