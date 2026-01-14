/**
 * Check tags for a ticket or conversation ID
 * Usage: node src/check-ticket-tags.js <id>
 */

import 'dotenv/config';
import { getTicket } from './tickets.js';
import { getConversation } from './intercom.js';

const id = process.argv[2];

if (!id) {
  console.error('Usage: node src/check-ticket-tags.js <id>');
  process.exit(1);
}

async function checkTags() {
  console.log(`\n🔍 Checking tags for ID: ${id}\n`);
  
  // Try as ticket first
  try {
    console.log('1. Attempting to fetch as ticket...');
    const ticket = await getTicket(id);
    
    console.log('✅ Found as ticket!');
    console.log(`   Ticket ID: ${ticket.id}`);
    console.log(`   Subject: ${ticket.subject || ticket.name || 'N/A'}`);
    
    // Check tags
    const tags = ticket.tags || ticket.tag_list || [];
    console.log(`\n📋 Tags (${tags.length}):`);
    if (tags.length > 0) {
      tags.forEach(tag => {
        const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
        const isUnwarranted = tagName.toLowerCase().includes('unwarranted sla');
        console.log(`   - ${tagName}${isUnwarranted ? ' ⚠️ UNWARRANTED' : ''}`);
      });
      
      const hasUnwarranted = tags.some(tag => {
        const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || '');
        return tagName.toLowerCase().includes('unwarranted sla');
      });
      
      if (hasUnwarranted) {
        console.log(`\n⚠️  This ticket HAS the "unwarranted sla" tag`);
      } else {
        console.log(`\n✅ This ticket does NOT have the "unwarranted sla" tag`);
      }
    } else {
      console.log('   No tags found');
    }
    
    // Show full ticket structure for debugging
    console.log('\n📦 Ticket structure:');
    console.log(`   Keys: ${Object.keys(ticket).join(', ')}`);
    if (ticket.tags) {
      console.log(`   ticket.tags type: ${Array.isArray(ticket.tags) ? 'array' : typeof ticket.tags}`);
      console.log(`   ticket.tags value:`, JSON.stringify(ticket.tags, null, 2));
    }
    
    // Check ticket_attributes for tags
    if (ticket.ticket_attributes) {
      console.log(`\n📋 ticket_attributes keys: ${Object.keys(ticket.ticket_attributes).join(', ')}`);
      if (ticket.ticket_attributes.tags) {
        console.log(`   Found tags in ticket_attributes:`, JSON.stringify(ticket.ticket_attributes.tags, null, 2));
      }
    }
    
    // Check linked objects for tags
    if (ticket.linked_objects?.data) {
      console.log(`\n🔗 Checking ${ticket.linked_objects.data.length} linked object(s)...`);
      for (const linked of ticket.linked_objects.data) {
        if (linked.type === 'conversation') {
          console.log(`   Found linked conversation: ${linked.id}`);
          try {
            const conv = await getConversation(linked.id);
            const convTags = conv.tags || conv.tag_list || [];
            if (convTags.length > 0) {
              console.log(`   ✅ Conversation has ${convTags.length} tag(s):`);
              convTags.forEach(tag => {
                const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
                console.log(`      - ${tagName}`);
              });
            } else {
              console.log(`   ⚠️  Conversation has no tags`);
            }
          } catch (err) {
            console.log(`   ⚠️  Could not fetch conversation: ${err.message}`);
          }
        }
      }
    }
    
    return;
  } catch (err) {
    if (err.message.includes('404')) {
      console.log('   ❌ Not found as ticket, trying as conversation...\n');
    } else {
      console.log(`   ⚠️  Error: ${err.message}, trying as conversation...\n`);
    }
  }
  
  // Try as conversation
  try {
    console.log('2. Attempting to fetch as conversation...');
    const conversation = await getConversation(id);
    
    console.log('✅ Found as conversation!');
    console.log(`   Conversation ID: ${conversation.id}`);
    console.log(`   State: ${conversation.state || 'Unknown'}`);
    
    // Check tags
    const tags = conversation.tags || conversation.tag_list || [];
    console.log(`\n📋 Tags (${tags.length}):`);
    if (tags.length > 0) {
      tags.forEach(tag => {
        const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
        const isUnwarranted = tagName.toLowerCase().includes('unwarranted sla');
        console.log(`   - ${tagName}${isUnwarranted ? ' ⚠️ UNWARRANTED' : ''}`);
      });
      
      const hasUnwarranted = tags.some(tag => {
        const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || '');
        return tagName.toLowerCase().includes('unwarranted sla');
      });
      
      if (hasUnwarranted) {
        console.log(`\n⚠️  This conversation HAS the "unwarranted sla" tag`);
      } else {
        console.log(`\n✅ This conversation does NOT have the "unwarranted sla" tag`);
      }
    } else {
      console.log('   No tags found');
    }
    
    // Show full conversation structure for debugging
    console.log('\n📦 Conversation structure:');
    console.log(`   Keys: ${Object.keys(conversation).join(', ')}`);
    if (conversation.tags) {
      console.log(`   conversation.tags type: ${Array.isArray(conversation.tags) ? 'array' : typeof conversation.tags}`);
      console.log(`   conversation.tags value:`, JSON.stringify(conversation.tags, null, 2));
    }
    
  } catch (err) {
    console.error(`\n❌ Error fetching as conversation: ${err.message}`);
    console.error('   This ID might not exist or might require different permissions');
  }
}

checkTags().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
