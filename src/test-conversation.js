import 'dotenv/config';
import { getConversation, getAdmin } from './intercom.js';
import { extractAssignmentInfo } from './webhook-handler.js';

/**
 * Test script to fetch a specific conversation and see what data we get
 * Usage: node src/test-conversation.js <conversationId>
 */

async function testConversation(conversationId) {
  if (!conversationId) {
    console.error('❌ Please provide a conversation ID');
    console.log('Usage: node src/test-conversation.js <conversationId>');
    process.exit(1);
  }

  console.log(`\n🔍 Testing Conversation: ${conversationId}`);
  console.log('='.repeat(60));

  try {
    // Fetch conversation from Intercom
    console.log('\n📥 Fetching conversation from Intercom API...');
    const conversation = await getConversation(conversationId);

    console.log('\n✅ Conversation fetched successfully!\n');

    // Show basic info
    console.log('📋 Basic Information:');
    console.log('─'.repeat(60));
    console.log(`ID: ${conversation.id}`);
    console.log(`State: ${conversation.state}`);
    console.log(`Title: ${conversation.title || 'N/A'}`);
    console.log(`Created: ${conversation.created_at || 'N/A'}`);
    console.log(`Updated: ${conversation.updated_at || 'N/A'}`);

    // Show assignment info
    console.log('\n👤 Assignment Information:');
    console.log('─'.repeat(60));
    console.log(`admin_assignee_id: ${conversation.admin_assignee_id || 'null'}`);
    console.log(`team_assignee_id: ${conversation.team_assignee_id || 'null'}`);
    
    if (conversation.admin_assignee) {
      console.log(`admin_assignee:`, JSON.stringify(conversation.admin_assignee, null, 2));
    } else {
      console.log(`admin_assignee: null`);
    }

    if (conversation.team) {
      console.log(`team:`, JSON.stringify(conversation.team, null, 2));
    }

    // Check conversation_parts for assignments
    console.log('\n📝 Conversation Parts (Assignments):');
    console.log('─'.repeat(60));
    const parts = conversation.conversation_parts?.conversation_parts || [];
    console.log(`Total parts: ${parts.length}`);
    
    const assignmentParts = parts.filter(
      p => p.part_type === 'assignment' || p.part_type === 'default_assignment'
    );
    
    console.log(`Assignment parts: ${assignmentParts.length}`);
    
    if (assignmentParts.length > 0) {
      assignmentParts.forEach((part, index) => {
        console.log(`\n  Assignment Part ${index + 1}:`);
        console.log(`    part_type: ${part.part_type}`);
        console.log(`    created_at: ${part.created_at || 'N/A'}`);
        
        if (part.assigned_to) {
          console.log(`    assigned_to:`);
          console.log(`      type: ${part.assigned_to.type || 'N/A'}`);
          console.log(`      id: ${part.assigned_to.id || 'null'}`);
          console.log(`      email: ${part.assigned_to.email || 'N/A'}`);
          console.log(`      name: ${part.assigned_to.name || 'N/A'}`);
        } else {
          console.log(`    assigned_to: null`);
        }
        
        if (part.author) {
          console.log(`    author:`);
          console.log(`      type: ${part.author.type || 'N/A'}`);
          console.log(`      id: ${part.author.id || 'N/A'}`);
          console.log(`      email: ${part.author.email || 'N/A'}`);
          console.log(`      name: ${part.author.name || 'N/A'}`);
        }
      });
    } else {
      console.log('  No assignment parts found');
    }

    // Try to extract assignment info (simulating webhook payload)
    console.log('\n🧪 Testing Extraction Logic:');
    console.log('─'.repeat(60));
    
    // Simulate a webhook payload structure
    const mockWebhookPayload = {
      id: 'test_notif_' + Date.now(),
      topic: 'conversation.admin.assigned',
      created_at: conversation.updated_at || Date.now(),
      data: {
        item: {
          id: conversation.id,
          admin_assignee_id: conversation.admin_assignee_id,
          team_assignee_id: conversation.team_assignee_id,
          conversation_parts: conversation.conversation_parts,
          statistics: conversation.statistics
        }
      }
    };

    const extracted = extractAssignmentInfo(mockWebhookPayload, 'test_' + Date.now());
    
    if (extracted) {
      console.log('✅ Extraction succeeded:');
      console.log(`   conversationId: ${extracted.conversationId}`);
      console.log(`   assigneeId: ${extracted.assigneeId}`);
      console.log(`   assigneeEmail: ${extracted.assigneeEmail || 'null'}`);
      console.log(`   assigneeName: ${extracted.assigneeName || 'null'}`);
      console.log(`   teamAssigneeId: ${extracted.teamAssigneeId || 'null'}`);
    } else {
      console.log('❌ Extraction failed');
      console.log('   This explains why the webhook was ignored');
    }

    // If we found an assignee, try to get their details
    if (extracted?.assigneeId) {
      console.log('\n👤 Fetching Admin Details:');
      console.log('─'.repeat(60));
      try {
        const admin = await getAdmin(extracted.assigneeId);
        console.log(`✅ Admin found:`);
        console.log(`   ID: ${admin.id}`);
        console.log(`   Name: ${admin.name || 'N/A'}`);
        console.log(`   Email: ${admin.email || 'N/A'}`);
      } catch (err) {
        console.log(`❌ Failed to fetch admin: ${err.message}`);
      }
    }

    // Show full conversation structure (for debugging)
    console.log('\n📦 Full Conversation Structure (keys only):');
    console.log('─'.repeat(60));
    console.log('Top-level keys:', Object.keys(conversation).join(', '));
    
    if (conversation.statistics) {
      console.log('\nStatistics keys:', Object.keys(conversation.statistics).join(', '));
      if (conversation.statistics.last_assignment_at) {
        console.log(`Last assignment at: ${conversation.statistics.last_assignment_at}`);
      }
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log('─'.repeat(60));
    const hasTopLevelAssignee = !!conversation.admin_assignee_id;
    const hasPartsAssignee = assignmentParts.some(
      p => p.assigned_to?.type === 'admin' && p.assigned_to.id
    );
    
    console.log(`Has top-level admin_assignee_id: ${hasTopLevelAssignee ? '✅' : '❌'}`);
    console.log(`Has admin in conversation_parts: ${hasPartsAssignee ? '✅' : '❌'}`);
    console.log(`Extraction would succeed: ${extracted ? '✅' : '❌'}`);
    
    if (!extracted) {
      console.log('\n⚠️  This conversation would be skipped by the webhook handler');
      console.log('   Reason: No assignee ID could be extracted');
    } else {
      console.log('\n✅ This conversation would be processed by the webhook handler');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('404')) {
      console.log('\n💡 Conversation not found. Check the conversation ID.');
    } else if (err.message.includes('401') || err.message.includes('403')) {
      console.log('\n💡 Authentication error. Check your INTERCOM_TOKEN.');
    }
    process.exit(1);
  }
}

const conversationId = process.argv[2];
testConversation(conversationId).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
