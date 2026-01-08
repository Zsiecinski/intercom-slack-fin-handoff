import 'dotenv/config';
import { extractAssignmentInfo } from './webhook-handler.js';

/**
 * Test script to verify webhook extraction logic works correctly
 * Tests various payload structures including team+agent assignments
 */

// Mock console.log to capture structured logs
const capturedLogs = [];
const originalLog = console.log;
console.log = (...args) => {
  capturedLogs.push(args);
  originalLog(...args);
};

function testCase(name, payload, expectedResult) {
  console.log(`\n🧪 Test: ${name}`);
  console.log('─'.repeat(60));
  
  const result = extractAssignmentInfo(payload, 'test_' + Date.now());
  
  if (expectedResult === null) {
    if (result === null) {
      console.log('✅ PASS: Correctly returned null');
      return true;
    } else {
      console.log('❌ FAIL: Expected null but got:', result);
      return false;
    }
  }
  
  if (result === null) {
    console.log('❌ FAIL: Expected result but got null');
    console.log('   Captured logs:', capturedLogs.slice(-1)[0]);
    return false;
  }
  
  let passed = true;
  for (const [key, expectedValue] of Object.entries(expectedResult)) {
    const actualValue = result[key];
    if (actualValue !== expectedValue) {
      console.log(`❌ FAIL: ${key} - Expected: ${expectedValue}, Got: ${actualValue}`);
      passed = false;
    } else {
      console.log(`   ✓ ${key}: ${actualValue}`);
    }
  }
  
  if (passed) {
    console.log('✅ PASS');
  }
  
  return passed;
}

// Test payloads based on Intercom webhook structure
const testPayloads = {
  // Standard admin assignment
  standardAdmin: {
    id: 'notif_test_001',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        admin_assignee_id: 'admin_456',
        team_assignee_id: null,
        statistics: {
          last_assignment_at: 1704739200
        }
      }
    }
  },
  
  // Team + Agent assignment (the problematic case)
  teamAndAgent: {
    id: 'notif_test_002',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        admin_assignee_id: 'admin_456',
        team_assignee_id: 'team_789',
        statistics: {
          last_assignment_at: 1704739200
        }
      }
    }
  },
  
  // Assignment via conversation_parts
  conversationPartsAdmin: {
    id: 'notif_test_003',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        team_assignee_id: 'team_789',
        conversation_parts: {
          conversation_parts: [
            {
              part_type: 'assignment',
              assigned_to: {
                type: 'admin',
                id: 'admin_456',
                email: 'admin@example.com',
                name: 'Test Admin'
              }
            }
          ]
        }
      }
    }
  },
  
  // Team + Agent via conversation_parts
  conversationPartsTeamAndAgent: {
    id: 'notif_test_004',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        team_assignee_id: 'team_789',
        conversation_parts: {
          conversation_parts: [
            {
              part_type: 'assignment',
              assigned_to: {
                type: 'team',
                id: 'team_789'
              }
            },
            {
              part_type: 'assignment',
              assigned_to: {
                type: 'admin',
                id: 'admin_456',
                email: 'admin@example.com',
                name: 'Test Admin'
              }
            }
          ]
        }
      }
    }
  },
  
  // Admin assignee object format
  adminAssigneeObject: {
    id: 'notif_test_005',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        admin_assignee: {
          id: 'admin_456',
          email: 'admin@example.com',
          name: 'Test Admin'
        },
        team_assignee_id: 'team_789'
      }
    }
  },
  
  // Team only (should fail extraction)
  teamOnly: {
    id: 'notif_test_006',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        id: 'conv_123',
        team_assignee_id: 'team_789',
        admin_assignee_id: null
      }
    }
  },
  
  // Missing item (should fail)
  missingItem: {
    id: 'notif_test_007',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {}
  },
  
  // Missing conversationId (should fail)
  missingConversationId: {
    id: 'notif_test_008',
    topic: 'conversation.admin.assigned',
    created_at: 1704739200,
    data: {
      item: {
        admin_assignee_id: 'admin_456'
      }
    }
  }
};

async function runTests() {
  console.log('🚀 Testing Webhook Extraction Logic\n');
  console.log('='.repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Test 1: Standard admin assignment
  results.tests.push({
    name: 'Standard Admin Assignment',
    passed: testCase('Standard Admin Assignment', testPayloads.standardAdmin, {
      conversationId: 'conv_123',
      assigneeId: 'admin_456',
      teamAssigneeId: null
    })
  });
  
  // Test 2: Team + Agent assignment (critical fix)
  results.tests.push({
    name: 'Team + Agent Assignment',
    passed: testCase('Team + Agent Assignment', testPayloads.teamAndAgent, {
      conversationId: 'conv_123',
      assigneeId: 'admin_456',
      teamAssigneeId: 'team_789'
    })
  });
  
  // Test 3: Assignment via conversation_parts
  results.tests.push({
    name: 'Conversation Parts Admin',
    passed: testCase('Conversation Parts Admin', testPayloads.conversationPartsAdmin, {
      conversationId: 'conv_123',
      assigneeId: 'admin_456',
      teamAssigneeId: 'team_789',
      assigneeEmail: 'admin@example.com',
      assigneeName: 'Test Admin'
    })
  });
  
  // Test 4: Team + Agent via conversation_parts
  results.tests.push({
    name: 'Conversation Parts Team + Agent',
    passed: testCase('Conversation Parts Team + Agent', testPayloads.conversationPartsTeamAndAgent, {
      conversationId: 'conv_123',
      assigneeId: 'admin_456',
      teamAssigneeId: 'team_789',
      assigneeEmail: 'admin@example.com',
      assigneeName: 'Test Admin'
    })
  });
  
  // Test 5: Admin assignee object format
  results.tests.push({
    name: 'Admin Assignee Object Format',
    passed: testCase('Admin Assignee Object Format', testPayloads.adminAssigneeObject, {
      conversationId: 'conv_123',
      assigneeId: 'admin_456',
      teamAssigneeId: 'team_789',
      assigneeEmail: 'admin@example.com',
      assigneeName: 'Test Admin'
    })
  });
  
  // Test 6: Team only (should fail)
  results.tests.push({
    name: 'Team Only (Should Fail)',
    passed: testCase('Team Only', testPayloads.teamOnly, null)
  });
  
  // Test 7: Missing item (should fail)
  results.tests.push({
    name: 'Missing Item (Should Fail)',
    passed: testCase('Missing Item', testPayloads.missingItem, null)
  });
  
  // Test 8: Missing conversationId (should fail)
  results.tests.push({
    name: 'Missing ConversationId (Should Fail)',
    passed: testCase('Missing ConversationId', testPayloads.missingConversationId, null)
  });
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Results Summary:\n');
  
  results.tests.forEach(test => {
    results[test.passed ? 'passed' : 'failed']++;
    console.log(`   ${test.passed ? '✅' : '❌'} ${test.name}`);
  });
  
  console.log(`\n   Total: ${results.tests.length}`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  
  if (results.failed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Please review the extraction logic.');
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
