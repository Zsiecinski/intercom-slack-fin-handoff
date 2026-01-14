/**
 * Update existing SLA state with assignee information
 * Reads sla-state.json and fetches assignee info for tickets that don't have it
 * Usage: node src/update-assignees.js
 */

import 'dotenv/config';
import { getTicket, getAdmin } from './tickets.js';
import { getConversation } from './intercom.js';
import { reloadSLAState } from './sla-monitor-enhanced.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SLA_STATE_FILE = path.join(__dirname, '..', 'sla-state.json');

async function updateAssignees() {
  try {
    // Reload current state
    await reloadSLAState();
    
    // Read the state file directly
    const stateData = await fs.readFile(SLA_STATE_FILE, 'utf-8');
    const state = JSON.parse(stateData);
    
    console.log(`\n🔄 Updating assignee information for ${Object.keys(state).length} tickets...\n`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const [ticketId, ticketState] of Object.entries(state)) {
      // Skip if already has assignee info
      if (ticketState.assignee_name) {
        skipped++;
        continue;
      }
      
      try {
        // Fetch ticket to get admin_assignee_id
        const ticket = await getTicket(ticketId);
        
        if (ticket.admin_assignee_id) {
          // Fetch admin details
          const admin = await getAdmin(ticket.admin_assignee_id);
          if (admin) {
            ticketState.assignee_name = admin.name;
            ticketState.assignee_email = admin.email;
            updated++;
            console.log(`✅ Updated ticket ${ticketId}: ${admin.name}`);
          } else {
            console.log(`⚠️  No admin found for ticket ${ticketId}`);
            skipped++;
          }
        } else {
          console.log(`⚠️  Ticket ${ticketId} has no admin_assignee_id`);
          skipped++;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (err) {
        errors++;
        console.error(`❌ Error updating ticket ${ticketId}:`, err.message);
      }
    }
    
    // Save updated state
    await fs.writeFile(SLA_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    
    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped} (already had assignee info)`);
    console.log(`   Errors: ${errors}`);
    console.log(`\n✅ Done! sla-state.json has been updated.`);
    
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

updateAssignees().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
