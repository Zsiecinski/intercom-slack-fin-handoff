import 'dotenv/config';
import crypto from 'crypto';
import { getConversation } from './intercom.js';
import { lookupUserByEmail } from './slack.js';

/**
 * Test script to verify Intercom and Slack tokens are configured correctly
 */

async function testIntercomToken() {
  console.log('\n🔍 Testing Intercom Token...');
  
  const token = process.env.INTERCOM_TOKEN;
  if (!token) {
    console.error('❌ INTERCOM_TOKEN not set');
    return false;
  }

  console.log('✓ INTERCOM_TOKEN is set');
  
  // Test by making a simple API call (get current admin/workspace info)
  try {
    const response = await fetch('https://api.intercom.io/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Intercom-Version': '2.10'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Intercom API error: ${response.status}`);
      console.error(`   ${errorText}`);
      return false;
    }

    const data = await response.json();
    console.log('✓ Intercom token is valid');
    console.log(`   Workspace: ${data.name || 'N/A'}`);
    console.log(`   Admin ID: ${data.id || 'N/A'}`);
    return true;
  } catch (err) {
    console.error('❌ Failed to connect to Intercom API:', err.message);
    return false;
  }
}

async function testSlackToken() {
  console.log('\n🔍 Testing Slack Bot Token...');
  
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('❌ SLACK_BOT_TOKEN not set');
    return false;
  }

  console.log('✓ SLACK_BOT_TOKEN is set');
  
  // Test by calling auth.test endpoint
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!data.ok) {
      console.error(`❌ Slack API error: ${data.error}`);
      return false;
    }

    console.log('✓ Slack bot token is valid');
    console.log(`   Bot User: ${data.user || 'N/A'}`);
    console.log(`   Team: ${data.team || 'N/A'}`);
    console.log(`   User ID: ${data.user_id || 'N/A'}`);
    return true;
  } catch (err) {
    console.error('❌ Failed to connect to Slack API:', err.message);
    return false;
  }
}

function testIntercomSecret() {
  console.log('\n🔍 Testing Intercom Client Secret...');
  
  const secret = process.env.INTERCOM_CLIENT_SECRET;
  if (!secret) {
    console.error('❌ INTERCOM_CLIENT_SECRET not set');
    return false;
  }

  console.log('✓ INTERCOM_CLIENT_SECRET is set');
  console.log(`   Length: ${secret.length} characters`);
  
  // Test signature generation (doesn't verify with Intercom, just checks it works)
  try {
    const testPayload = 'test';
    const signature = crypto
      .createHmac('sha1', secret)
      .update(testPayload)
      .digest('hex');
    
    console.log('✓ Signature generation works');
    console.log(`   Test signature: sha1=${signature.substring(0, 8)}...`);
    return true;
  } catch (err) {
    console.error('❌ Failed to generate signature:', err.message);
    return false;
  }
}

async function testSlackUserLookup() {
  console.log('\n🔍 Testing Slack User Lookup (optional)...');
  
  // Prompt for email or skip
  const testEmail = process.argv[2]; // Get email from command line argument
  
  if (!testEmail) {
    console.log('ℹ️  Skipping user lookup test (no email provided)');
    console.log('   To test: node src/test-tokens.js <email@example.com>');
    return true;
  }

  try {
    const userId = await lookupUserByEmail(testEmail);
    if (userId) {
      console.log(`✓ Found Slack user: ${userId}`);
      return true;
    } else {
      console.log(`⚠️  Could not find Slack user for: ${testEmail}`);
      console.log('   (This might be okay if the email doesn\'t exist in your workspace)');
      return true; // Not a failure, just informational
    }
  } catch (err) {
    console.error('❌ Error looking up user:', err.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Token Configuration\n');
  console.log('=' .repeat(50));

  const results = {
    intercomSecret: testIntercomSecret(),
    intercomToken: await testIntercomToken(),
    slackToken: await testSlackToken(),
    slackLookup: await testSlackUserLookup()
  };

  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Test Results Summary:');
  console.log(`   Intercom Secret: ${results.intercomSecret ? '✓' : '❌'}`);
  console.log(`   Intercom Token: ${results.intercomToken ? '✓' : '❌'}`);
  console.log(`   Slack Token: ${results.slackToken ? '✓' : '❌'}`);
  console.log(`   Slack Lookup: ${results.slackLookup ? '✓' : '⚠️'}`);

  const allCritical = results.intercomSecret && results.intercomToken && results.slackToken;
  
  if (allCritical) {
    console.log('\n✅ All critical tokens are configured correctly!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tokens are missing or invalid. Please check your .env file.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

