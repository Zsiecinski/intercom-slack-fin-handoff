/**
 * Test script to check SLA detection for a specific ticket
 * Usage: node src/test-sla-check.js <ticket-id>
 */

import 'dotenv/config';
import { getTicket } from './tickets.js';
import { getConversation } from './intercom.js';
import { checkSLAStatus } from './sla-monitor-enhanced.js';

const ticketId = process.argv[2];

if (!ticketId) {
  console.error('Usage: node src/test-sla-check.js <ticket-id>');
  console.error('Example: node src/test-sla-check.js 215472664598163');
  process.exit(1);
}

async function testSLACheck() {
  console.log(`\n🔍 Testing SLA detection for ticket: ${ticketId}\n`);
  
  try {
    // Fetch the ticket
    console.log('1. Fetching ticket from Intercom API...');
    const ticket = await getTicket(ticketId);
    
    console.log('\n2. Ticket fetched successfully!');
    console.log(`   Ticket ID: ${ticket.id || ticket.ticket_id}`);
    console.log(`   State: ${ticket.ticket_state?.internal_label || 'Unknown'}`);
    console.log(`   Created: ${new Date((ticket.created_at || 0) * 1000).toISOString()}`);
    console.log(`   Updated: ${new Date((ticket.updated_at || 0) * 1000).toISOString()}`);
    
    // Check for SLA directly on ticket
    console.log('\n3. Checking for SLA information...');
    console.log(`   Direct SLA (ticket.sla_applied):`, ticket.sla_applied ? 'Found' : 'Not found');
    
    if (ticket.sla_applied) {
      console.log(`   SLA Name: ${ticket.sla_applied.sla_name || 'Unknown'}`);
      console.log(`   SLA Status: ${ticket.sla_applied.sla_status || 'Unknown'}`);
    }
    
    // Check linked objects
    console.log(`   Linked objects:`, ticket.linked_objects ? 'Found' : 'Not found');
    
    let conversationId = null;
    if (ticket.linked_objects?.data) {
      console.log(`   Number of linked objects: ${ticket.linked_objects.data.length}`);
      
      for (const linked of ticket.linked_objects.data) {
        console.log(`   - Type: ${linked.type}, ID: ${linked.id}`);
        if (linked.type === 'conversation') {
          conversationId = linked.id;
          if (linked.sla_applied) {
            console.log(`     ✅ Found SLA in linked conversation!`);
            console.log(`     SLA Name: ${linked.sla_applied.sla_name || 'Unknown'}`);
            console.log(`     SLA Status: ${linked.sla_applied.sla_status || 'Unknown'}`);
          }
        }
      }
    }
    
    // If no linked conversation found, try fetching the conversation directly
    // (sometimes the ticket ID is actually a conversation ID)
    if (!conversationId && ticketId) {
      console.log('\n7. Attempting to fetch as conversation (ticket might be conversation ID)...');
      try {
        const conversation = await getConversation(ticketId);
        console.log(`   ✅ Conversation fetched!`);
        console.log(`   Conversation ID: ${conversation.id}`);
        console.log(`   State: ${conversation.state || 'Unknown'}`);
        
        if (conversation.sla_applied) {
          console.log(`   ✅ Found SLA on conversation!`);
          console.log(`   SLA Name: ${conversation.sla_applied.sla_name || 'Unknown'}`);
          console.log(`   SLA Status: ${conversation.sla_applied.sla_status || 'Unknown'}`);
          
          // Merge SLA into ticket object for testing
          ticket.sla_applied = conversation.sla_applied;
        } else {
          console.log(`   ⚠️  No SLA found on conversation either`);
        }
      } catch (err) {
        console.log(`   ⚠️  Could not fetch as conversation: ${err.message}`);
      }
    }
    
    // Try to get full ticket details (sometimes SLA is in nested data)
    console.log('\n4. Full ticket structure:');
    console.log('   Keys in ticket object:', Object.keys(ticket).join(', '));
    
    // Check for nested SLA data
    if (ticket.statistics) {
      console.log('   Statistics found:', Object.keys(ticket.statistics).join(', '));
    }
    
    // Now run the actual SLA check function
    console.log('\n5. Running checkSLAStatus() function...');
    const slaResult = await checkSLAStatus(ticket);
    
    console.log('\n6. SLA Check Result:');
    console.log(`   Alerted: ${slaResult.alerted}`);
    console.log(`   Violation Type: ${slaResult.violationType || 'None'}`);
    console.log(`   Deadline: ${slaResult.deadline ? new Date(slaResult.deadline * 1000).toISOString() : 'None'}`);
    
    if (!slaResult.alerted && !ticket.sla_applied && !ticket.linked_objects?.data?.some(l => l.sla_applied)) {
      console.log('\n⚠️  No SLA found on this ticket.');
      console.log('   This could mean:');
      console.log('   - The ticket doesn\'t have an SLA assigned');
      console.log('   - The SLA is in a different location in the API response');
      console.log('   - The ticket needs to be fetched with additional parameters');
    } else if (slaResult.alerted || ticket.sla_applied || ticket.linked_objects?.data?.some(l => l.sla_applied)) {
      console.log('\n✅ SLA detected! The system should track this ticket.');
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

testSLACheck().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
