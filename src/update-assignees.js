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
        console.log(`\n📋 Processing ticket ${ticketId}...`);
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
        
        // Always update tags from conversations (tags are on conversations, not tickets)
        // Force update even if tags already exist, since we might have missed conversation tags before
        let tags = [];
        
        // Check linked conversations for tags
        if (ticket.linked_objects?.data) {
          for (const linked of ticket.linked_objects.data) {
            if (linked.type === 'conversation') {
              try {
                const conversation = await getConversation(linked.id);
                // Tags are on the conversation object
                if (conversation.tags && Array.isArray(conversation.tags)) {
                  tags = tags.concat(conversation.tags);
                  console.log(`   Found ${conversation.tags.length} tag(s) on linked conversation ${linked.id}`);
                }
              } catch (convErr) {
                // Conversation fetch failed - continue
                console.log(`   ⚠️  Could not fetch conversation ${linked.id}: ${convErr.message}`);
              }
            }
          }
        }
        
        // If no linked conversations found, try fetching ticket ID as conversation
        // (tickets created from conversations may use conversation ID as ticket ID)
        if (tags.length === 0) {
          try {
            const conversation = await getConversation(ticketId);
            if (conversation.tags && Array.isArray(conversation.tags)) {
              tags = conversation.tags;
              console.log(`   Found ${tags.length} tag(s) on conversation ${ticketId}`);
            }
          } catch (convErr) {
            // Not a conversation or conversation fetch failed - that's okay
          }
        }
        
        // Convert tags to array of strings
        const tagNames = tags.map(tag => {
          return typeof tag === 'string' ? tag : (tag.name || tag.id || '');
        }).filter(tag => tag); // Remove empty strings
        
        // Always update tags (even if empty) to ensure we have the latest state
        const previousTagCount = ticketState.tags?.length || 0;
        ticketState.tags = tagNames;
        ticketState.has_unwarranted_tag = tagNames.some(tagName => 
          tagName.toLowerCase().includes('unwarranted sla')
        );
        
        if (tagNames.length > 0 || previousTagCount !== tagNames.length) {
          tagsUpdated++;
          needsUpdate = true;
          if (ticketState.has_unwarranted_tag) {
            console.log(`🏷️  Ticket ${ticketId}: Found "unwarranted sla" tag`);
          } else if (tagNames.length > 0) {
            console.log(`🏷️  Ticket ${ticketId}: Found ${tagNames.length} tag(s)`);
          } else {
            console.log(`🏷️  Ticket ${ticketId}: No tags found`);
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
