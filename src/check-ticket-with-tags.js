/**
 * Check a ticket and fetch tags from linked conversations
 * Usage: node src/check-ticket-with-tags.js <ticket-id>
 */

import 'dotenv/config';
import { getTicket } from './tickets.js';
import { getConversation } from './intercom.js';

const ticketId = process.argv[2];

if (!ticketId) {
  console.error('Usage: node src/check-ticket-with-tags.js <ticket-id>');
  console.error('Example: node src/check-ticket-with-tags.js 52391395');
  process.exit(1);
}

async function checkTicketWithTags() {
  console.log(`\n🔍 Checking ticket ${ticketId} for tags...\n`);
  
  try {
    // Step 1: Try to fetch as ticket
    console.log('1. Fetching ticket from Intercom API...');
    const ticket = await getTicket(ticketId);
    
    console.log('✅ Ticket found!');
    console.log(`   Ticket ID: ${ticket.id}`);
    console.log(`   Subject: ${ticket.subject || ticket.name || ticket.ticket_attributes?._default_title_ || 'N/A'}`);
    console.log(`   State: ${ticket.ticket_state?.internal_label || 'Unknown'}`);
    
    // Step 2: Check for linked conversations
    console.log('\n2. Checking for linked conversations...');
    let allTags = [];
    
    if (ticket.linked_objects?.data && ticket.linked_objects.data.length > 0) {
      console.log(`   Found ${ticket.linked_objects.data.length} linked object(s):`);
      
      for (const linked of ticket.linked_objects.data) {
        console.log(`   - Type: ${linked.type}, ID: ${linked.id}`);
        
        if (linked.type === 'conversation') {
          try {
            console.log(`     Fetching conversation ${linked.id}...`);
            const conversation = await getConversation(linked.id);
            
            console.log(`     ✅ Conversation fetched`);
            console.log(`        Conversation ID: ${conversation.id}`);
            console.log(`        State: ${conversation.state || 'Unknown'}`);
            
            // Get tags from conversation
            if (conversation.tags && Array.isArray(conversation.tags)) {
              console.log(`        Tags: ${conversation.tags.length} tag(s)`);
              conversation.tags.forEach(tag => {
                const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
                const isUnwarranted = tagName.toLowerCase().includes('unwarranted sla');
                console.log(`          - ${tagName}${isUnwarranted ? ' ⚠️ UNWARRANTED SLA' : ''}`);
                allTags.push(tagName);
              });
            } else {
              console.log(`        No tags found on conversation`);
            }
          } catch (convErr) {
            console.log(`     ❌ Error fetching conversation: ${convErr.message}`);
          }
        }
      }
    } else {
      console.log('   No linked objects found');
    }
    
    // Step 3: If no linked conversations, try fetching ticket ID as conversation
    if (allTags.length === 0) {
      console.log('\n3. No linked conversations found. Trying ticket ID as conversation...');
      try {
        const conversation = await getConversation(ticketId);
        console.log(`   ✅ Found as conversation!`);
        console.log(`   Conversation ID: ${conversation.id}`);
        console.log(`   State: ${conversation.state || 'Unknown'}`);
        
        // Tags are in conversation.tags.tags (nested structure)
        if (conversation.tags) {
          let tagsArray = [];
          
          // Handle different tag structures
          if (Array.isArray(conversation.tags)) {
            tagsArray = conversation.tags;
          } else if (conversation.tags.tags && Array.isArray(conversation.tags.tags)) {
            // Nested structure: tags.tags
            tagsArray = conversation.tags.tags;
          } else if (conversation.tags.data && Array.isArray(conversation.tags.data)) {
            // Alternative structure: tags.data
            tagsArray = conversation.tags.data;
          }
          
          if (tagsArray.length > 0) {
            console.log(`   Tags: ${tagsArray.length} tag(s)`);
            tagsArray.forEach(tag => {
              const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
              const isUnwarranted = tagName.toLowerCase().includes('unwarranted sla');
              console.log(`     - ${tagName}${isUnwarranted ? ' ⚠️ UNWARRANTED SLA' : ''}`);
              allTags.push(tagName);
            });
          }
        }
      } catch (convErr) {
        console.log(`   ⚠️  Could not fetch as conversation: ${convErr.message}`);
      }
    }
    
    // Step 4: Summary
    console.log('\n4. Summary:');
    if (allTags.length > 0) {
      const hasUnwarranted = allTags.some(tag => tag.toLowerCase().includes('unwarranted sla'));
      console.log(`   Total tags found: ${allTags.length}`);
      console.log(`   Tags: ${allTags.join(', ')}`);
      if (hasUnwarranted) {
        console.log(`   ⚠️  This ticket HAS the "unwarranted sla" tag`);
      } else {
        console.log(`   ✅ This ticket does NOT have the "unwarranted sla" tag`);
      }
    } else {
      console.log('   No tags found');
      console.log('   The ticket may not have tags, or tags may be on a conversation that\'s not linked');
    }
    
  } catch (err) {
    if (err.message.includes('404')) {
      console.log('❌ Ticket not found. Trying as conversation...\n');
      
      // Try as conversation
      try {
        const conversation = await getConversation(ticketId);
        console.log('✅ Found as conversation!');
        console.log(`   Conversation ID: ${conversation.id}`);
        console.log(`   State: ${conversation.state || 'Unknown'}`);
        
        if (conversation.tags && Array.isArray(conversation.tags)) {
          console.log(`\n📋 Tags (${conversation.tags.length}):`);
          conversation.tags.forEach(tag => {
            const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || 'Unknown');
            const isUnwarranted = tagName.toLowerCase().includes('unwarranted sla');
            console.log(`   - ${tagName}${isUnwarranted ? ' ⚠️ UNWARRANTED SLA' : ''}`);
          });
          
          const hasUnwarranted = conversation.tags.some(tag => {
            const tagName = typeof tag === 'string' ? tag : (tag.name || tag.id || '');
            return tagName.toLowerCase().includes('unwarranted sla');
          });
          
          if (hasUnwarranted) {
            console.log(`\n⚠️  This conversation HAS the "unwarranted sla" tag`);
          } else {
            console.log(`\n✅ This conversation does NOT have the "unwarranted sla" tag`);
          }
        } else {
          console.log('\n📋 No tags found on this conversation');
        }
      } catch (convErr) {
        console.error(`\n❌ Error: ${convErr.message}`);
        console.error('   This ID might not exist or might require different permissions');
      }
    } else {
      console.error(`\n❌ Error: ${err.message}`);
    }
  }
}

checkTicketWithTags().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
