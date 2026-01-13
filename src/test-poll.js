/**
 * Test script for polling functionality
 * Tests individual components before running full poll
 */

import 'dotenv/config';
import { searchTickets, getAdmin } from './tickets.js';
import { getLastCheckTime, updateLastCheckTime, initializeState } from './state.js';

const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;

async function testStateManagement() {
  console.log('\n=== Testing State Management ===');
  try {
    await initializeState();
    const lastCheck = await getLastCheckTime();
    console.log(`✅ State initialized. Last check time: ${lastCheck ? new Date(lastCheck * 1000).toISOString() : 'null'}`);
    
    // Test update
    const testTime = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
    await updateLastCheckTime(testTime);
    const updated = await getLastCheckTime();
    console.log(`✅ State updated. New last check time: ${new Date(updated * 1000).toISOString()}`);
    return true;
  } catch (err) {
    console.error('❌ State management test failed:', err);
    return false;
  }
}

async function testTicketsAPI() {
  console.log('\n=== Testing Tickets API ===');
  
  if (!INTERCOM_ACCESS_TOKEN) {
    console.error('❌ INTERCOM_ACCESS_TOKEN not configured');
    return false;
  }

  try {
    // Search for tickets created in the last hour
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    console.log(`Searching for tickets created after ${new Date(oneHourAgo * 1000).toISOString()}`);
    
    const tickets = await searchTickets(oneHourAgo, { limit: 10 });
    console.log(`✅ Found ${tickets.length} tickets`);
    
    if (tickets.length > 0) {
      const ticket = tickets[0];
      console.log('\nSample ticket:');
      console.log(`  ID: ${ticket.id || ticket.ticket_id}`);
      console.log(`  Subject: ${ticket.subject || ticket.name || 'N/A'}`);
      console.log(`  State: ${ticket.state || 'N/A'}`);
      console.log(`  Admin Assignee ID: ${ticket.admin_assignee_id || 'None'}`);
      console.log(`  Created: ${ticket.created_at ? new Date(ticket.created_at * 1000).toISOString() : 'N/A'}`);
      
      // Test admin lookup if there's an assignee
      if (ticket.admin_assignee_id) {
        console.log(`\nTesting admin lookup for ID: ${ticket.admin_assignee_id}`);
        const admin = await getAdmin(ticket.admin_assignee_id);
        console.log(`✅ Admin found: ${admin.name} (${admin.email})`);
      }
    }
    
    return true;
  } catch (err) {
    console.error('❌ Tickets API test failed:', err);
    console.error('Error details:', err.message);
    if (err.message.includes('401')) {
      console.error('   → Check your INTERCOM_ACCESS_TOKEN');
    } else if (err.message.includes('403')) {
      console.error('   → Token may not have Tickets API permissions');
    }
    return false;
  }
}

async function testSlackIntegration() {
  console.log('\n=== Testing Slack Integration ===');
  
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('❌ SLACK_BOT_TOKEN not configured');
    return false;
  }

  try {
    const { lookupUserByEmail } = await import('./slack.js');
    
    // Test with a known email (you can change this)
    const testEmail = process.env.TEST_EMAIL || 'test@example.com';
    console.log(`Testing user lookup for: ${testEmail}`);
    
    const userId = await lookupUserByEmail(testEmail);
    if (userId) {
      console.log(`✅ User found: ${userId}`);
    } else {
      console.log(`⚠️  User not found (this is OK if email doesn't exist in Slack)`);
    }
    
    return true;
  } catch (err) {
    console.error('❌ Slack integration test failed:', err);
    if (err.message.includes('invalid_auth')) {
      console.error('   → Check your SLACK_BOT_TOKEN');
    }
    return false;
  }
}

async function runTests() {
  console.log('🧪 Testing Intercom Ticket Polling System\n');
  console.log('Environment check:');
  console.log(`  INTERCOM_ACCESS_TOKEN: ${INTERCOM_ACCESS_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`  SLACK_BOT_TOKEN: ${process.env.SLACK_BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`  CHECK_INTERVAL: ${process.env.CHECK_INTERVAL || '120000'}ms`);

  const results = {
    state: await testStateManagement(),
    tickets: await testTicketsAPI(),
    slack: await testSlackIntegration()
  };

  console.log('\n=== Test Summary ===');
  console.log(`State Management: ${results.state ? '✅' : '❌'}`);
  console.log(`Tickets API: ${results.tickets ? '✅' : '❌'}`);
  console.log(`Slack Integration: ${results.slack ? '✅' : '❌'}`);

  const allPassed = Object.values(results).every(r => r);
  
  if (allPassed) {
    console.log('\n✅ All tests passed! You can run `npm start` to start polling.');
  } else {
    console.log('\n⚠️  Some tests failed. Please fix the issues above before running the full poll.');
  }

  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
