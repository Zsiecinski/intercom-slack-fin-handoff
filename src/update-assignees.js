/**
 * Update existing SLA state with assignee information and tags
 * Reads sla-state.json and fetches missing info for tickets
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

/**
 * Get ticket tags as array of strings
 */
function getTicketTags(ticket) {
  const tags = ticket.tags || ticket.tag_list || [];
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.map(tag => {
    return typeof tag === 'string' ? tag : (tag.name || tag.id || '');
  });
}

/**
 * Check if ticket has "unwarranted sla" tag
 */
function hasUnwarrantedSLATag(ticket) {
  const tags = getTicketTags(ticket);
  return tags.some(tag => tag.toLowerCase().includes('unwarranted sla'));
}

async function updateAssignees() {
  try {
    // Reload current state
    await reloadSLAState();
    
    // Read the state file directly
    const stateData = await fs.readFile(SLA_STATE_FILE, 'utf-8');
    const state = JSON.parse(stateData);
    
    console.log(`\n🔄 Updating ticket information for ${Object.keys(state).length} tickets...\n`);
    
    let assigneesUpdated = 0;
    let tagsUpdated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const [ticketId, ticketState] of Object.entries(state)) {
      let needsUpdate = false;
      
      try {
        // Fetch ticket to get current info
        const ticket = await getTicket(ticketId);
        
        // Update assignee info if missing
        if (!ticketState.assignee_name && ticket.admin_assignee_id) {
          const admin = await getAdmin(ticket.admin_assignee_id);
          if (admin) {
            ticketState.assignee_name = admin.name;
            ticketState.assignee_email = admin.email;
            assigneesUpdated++;
            needsUpdate = true;
            console.log(`✅ Ticket ${ticketId}: Added assignee ${admin.name}`);
          }
        }
        
        // Update tags if missing
        if (!ticketState.tags || ticketState.tags.length === 0) {
          let tags = getTicketTags(ticket);
          
          // If no tags on ticket, check linked conversation
          if (tags.length === 0 && ticket.linked_objects?.data) {
            for (const linked of ticket.linked_objects.data) {
              if (linked.type === 'conversation') {
                try {
                  const conversation = await getConversation(linked.id);
                  const convTags = getTicketTags(conversation); // Reuse same function
                  if (convTags.length > 0) {
                    tags = convTags;
                    console.log(`   Found ${tags.length} tag(s) on linked conversation ${linked.id}`);
                    break;
                  }
                } catch (convErr) {
                  // Conversation fetch failed - continue
                }
              }
            }
          }
          
          if (tags.length > 0) {
            ticketState.tags = tags;
            ticketState.has_unwarranted_tag = tags.some(tag => {
              const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || '');
              return tagName.toLowerCase().includes('unwarranted sla');
            });
            tagsUpdated++;
            needsUpdate = true;
            if (ticketState.has_unwarranted_tag) {
              console.log(`🏷️  Ticket ${ticketId}: Found "unwarranted sla" tag`);
            } else {
              console.log(`🏷️  Ticket ${ticketId}: Found ${tags.length} tag(s)`);
            }
          }
        }
        
        // Update ticket metadata if missing
        if (!ticketState.ticket_subject) {
          const subject = ticket.subject || ticket.name || ticket.ticket_attributes?._default_title_ || null;
          if (subject) {
            ticketState.ticket_subject = subject;
            needsUpdate = true;
          }
        }
        
        if (!ticketState.ticket_state) {
          const ticketStateValue = ticket.ticket_state?.internal_label || (ticket.open ? 'open' : 'closed') || null;
          if (ticketStateValue) {
            ticketState.ticket_state = ticketStateValue;
            needsUpdate = true;
          }
        }
        
        if (!needsUpdate) {
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
    
    const unwarrantedCount = Object.values(state).filter(t => t.has_unwarranted_tag).length;
    
    console.log(`\n📊 Summary:`);
    console.log(`   Assignees updated: ${assigneesUpdated}`);
    console.log(`   Tags updated: ${tagsUpdated}`);
    console.log(`   Unwarranted tickets found: ${unwarrantedCount}`);
    console.log(`   Skipped: ${skipped} (already had info)`);
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
