import 'dotenv/config';
import crypto from 'crypto';
import { verifyIntercomSignature } from './intercom.js';

/**
 * Manual webhook test script
 * Sends a test webhook payload to the local server
 * Usage: node src/test-webhook-manual.js [scenario]
 * Scenarios: standard, team-agent, team-only, conversation-parts
 */

const SCENARIOS = {
  standard: {
    id: 'notif_test_standard',
    topic: 'conversation.admin.assigned',
    created_at: Math.floor(Date.now() / 1000),
    data: {
      item: {
        id: 'conv_test_123',
        admin_assignee_id: 'admin_test_456',
        team_assignee_id: null,
        statistics: {
          last_assignment_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  },
  
  'team-agent': {
    id: 'notif_test_team_agent',
    topic: 'conversation.admin.assigned',
    created_at: Math.floor(Date.now() / 1000),
    data: {
      item: {
        id: 'conv_test_123',
        admin_assignee_id: 'admin_test_456',
        team_assignee_id: 'team_test_789',
        statistics: {
          last_assignment_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  },
  
  'team-only': {
    id: 'notif_test_team_only',
    topic: 'conversation.admin.assigned',
    created_at: Math.floor(Date.now() / 1000),
    data: {
      item: {
        id: 'conv_test_123',
        admin_assignee_id: null,
        team_assignee_id: 'team_test_789',
        statistics: {
          last_assignment_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  },
  
  'conversation-parts': {
    id: 'notif_test_conversation_parts',
    topic: 'conversation.admin.assigned',
    created_at: Math.floor(Date.now() / 1000),
    data: {
      item: {
        id: 'conv_test_123',
        team_assignee_id: 'team_test_789',
        conversation_parts: {
          conversation_parts: [
            {
              part_type: 'assignment',
              assigned_to: {
                type: 'team',
                id: 'team_test_789'
              }
            },
            {
              part_type: 'assignment',
              assigned_to: {
                type: 'admin',
                id: 'admin_test_456',
                email: 'test@example.com',
                name: 'Test Admin'
              }
            }
          ]
        }
      }
    }
  }
};

async function sendTestWebhook(scenario = 'standard') {
  const payload = SCENARIOS[scenario];
  
  if (!payload) {
    console.error(`❌ Unknown scenario: ${scenario}`);
    console.log(`\nAvailable scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  
  const secret = process.env.INTERCOM_CLIENT_SECRET;
  if (!secret) {
    console.error('❌ INTERCOM_CLIENT_SECRET not set');
    process.exit(1);
  }
  
  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha1', secret)
    .update(payloadString)
    .digest('hex');
  
  // Allow testing against production or local
  const testUrl = process.env.TEST_WEBHOOK_URL;
  const port = process.env.PORT || 3000;
  const url = testUrl || `http://localhost:${port}/intercom/webhook`;
  
  console.log(`\n🚀 Sending test webhook: ${scenario}`);
  console.log('─'.repeat(60));
  console.log(`URL: ${url}`);
  console.log(`Payload ID: ${payload.id}`);
  console.log(`Topic: ${payload.topic}`);
  console.log(`\nPayload:`);
  console.log(JSON.stringify(payload, null, 2));
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha1=${signature}`
      },
      body: payloadString
    });
    
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }
    
    console.log(`\n📥 Response:`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Body:`, responseData);
    
    if (response.status === 200) {
      console.log('\n✅ Webhook accepted!');
      console.log('   Check server logs for processing details.');
    } else {
      console.log('\n❌ Webhook rejected!');
    }
    
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      console.error('\n❌ Error: Could not connect to server');
      console.log('\n💡 To test webhooks, you need to:');
      console.log('   1. Start the server in another terminal: npm start');
      console.log('   2. Then run this test again: npm run test-webhook ' + scenario);
      console.log('\n   Or run unit tests (no server needed): npm run test-extraction');
    } else {
      console.error('\n❌ Error sending webhook:', err.message);
    }
    process.exit(1);
  }
}

const scenario = process.argv[2] || 'standard';
sendTestWebhook(scenario).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
