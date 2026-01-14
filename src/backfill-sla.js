/**
 * Backfill script to process historical tickets for SLA tracking
 * Processes tickets without sending assignment notifications
 * Usage: node src/backfill-sla.js [hours-back] [--dry-run]
 * Example: node src/backfill-sla.js 24 (process last 24 hours)
 */

import 'dotenv/config';
import { searchTickets, getTicket, getAdmin } from './tickets.js';
import { getConversation } from './intercom.js';
import { checkSLAStatus } from './sla-monitor-enhanced.js';
import { initializeState } from './state.js';

const hoursBack = parseInt(process.argv[2] || '24', 10);
const isDryRun = process.argv.includes('--dry-run');

console.log(`\n🔄 SLA Backfill Script`);
console.log(`   Processing tickets from last ${hoursBack} hours`);
console.log(`   Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

async function backfillSLA() {
  try {
    await initializeState();
    
    // Calculate timestamp for X hours ago
    const now = Math.floor(Date.now() / 1000);
    const sinceTimestamp = now - (hoursBack * 3600);
    
    console.log(`Searching tickets created or updated after: ${new Date(sinceTimestamp * 1000).toISOString()}`);
    console.log(`Current time: ${new Date(now * 1000).toISOString()}\n`);
    
    // Search for tickets
    // Note: Intercom API limit is 150 per page
    console.log('Fetching tickets from Intercom API...');
    console.log('(This may take a moment if there are many tickets)\n');
    
    let tickets;
    try {
      // Add a timeout wrapper
      const searchPromise = searchTickets(sinceTimestamp, {
        limit: 150, // Maximum allowed by Intercom API
        includeUpdated: true
      });
      
      // Set a 60 second timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API call timed out after 60 seconds')), 60000);
      });
      
      tickets = await Promise.race([searchPromise, timeoutPromise]);
      console.log(`✅ Found ${tickets.length} tickets to process\n`);
    } catch (err) {
      console.error(`❌ Error searching tickets:`, err.message);
      if (err.message.includes('timed out')) {
        console.error('   The API call is taking too long. This might indicate:');
        console.error('   - Network connectivity issues');
        console.error('   - Intercom API is slow or overloaded');
        console.error('   - Try reducing the time window (e.g., 12 hours instead of 24)');
      }
      throw err;
    }
    
    let processedCount = 0;
    let slaFoundCount = 0;
    let slaTrackedCount = 0;
    let errors = 0;
    
    for (const ticket of tickets) {
      const ticketId = ticket.id || ticket.ticket_id;
      
      if (!ticketId) {
        continue;
      }
      
      try {
        // Fetch full ticket details
        const fullTicket = await getTicket(ticketId);
        
        // Fetch assignee info if available
        if (fullTicket.admin_assignee_id) {
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
        
        // If ticket doesn't have SLA, try fetching the conversation
        if (!fullTicket.sla_applied && (!fullTicket.linked_objects?.data || fullTicket.linked_objects.data.length === 0)) {
          try {
            const conversation = await getConversation(ticketId);
            if (conversation.sla_applied) {
              fullTicket.sla_applied = conversation.sla_applied;
              slaFoundCount++;
              console.log(`✅ Ticket ${ticketId}: Found SLA "${conversation.sla_applied.sla_name || 'Unknown'}" (status: ${conversation.sla_applied.sla_status})`);
            }
          } catch (convErr) {
            // Not a conversation or fetch failed - continue
          }
        } else if (fullTicket.sla_applied) {
          slaFoundCount++;
          console.log(`✅ Ticket ${ticketId}: Found SLA "${fullTicket.sla_applied.sla_name || 'Unknown'}" (status: ${fullTicket.sla_applied.sla_status})`);
        }
        
        // Check SLA status (this will update the cache and save to sla-state.json)
        // Note: This won't send alerts because we're not setting SLA_CHANNEL or it will only send if configured
        if (!isDryRun) {
          const slaResult = await checkSLAStatus(fullTicket);
          if (slaResult.alerted || fullTicket.sla_applied) {
            slaTrackedCount++;
          }
        } else {
          // In dry run, just check if SLA would be tracked
          if (fullTicket.sla_applied && fullTicket.sla_applied.sla_status) {
            slaTrackedCount++;
          }
        }
        
        processedCount++;
        
        // Progress indicator
        if (processedCount % 10 === 0) {
          console.log(`   Processed ${processedCount}/${tickets.length} tickets...`);
        }
        
      } catch (err) {
        errors++;
        console.error(`❌ Error processing ticket ${ticketId}:`, err.message);
      }
    }
    
    console.log(`\n📊 Backfill Summary:`);
    console.log(`   Total tickets processed: ${processedCount}`);
    console.log(`   Tickets with SLA found: ${slaFoundCount}`);
    console.log(`   SLAs tracked: ${slaTrackedCount}`);
    console.log(`   Errors: ${errors}`);
    
    if (isDryRun) {
      console.log(`\n⚠️  DRY RUN - No changes were made`);
      console.log(`   Run without --dry-run to actually update sla-state.json`);
    } else {
      console.log(`\n✅ Backfill complete! Check sla-state.json for tracked SLAs`);
    }
    
  } catch (err) {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  }
}

// Check if required env vars are set
if (!process.env.INTERCOM_ACCESS_TOKEN && !process.env.INTERCOM_TOKEN) {
  console.error('ERROR: INTERCOM_ACCESS_TOKEN or INTERCOM_TOKEN not configured');
  process.exit(1);
}

backfillSLA().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
