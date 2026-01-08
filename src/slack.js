/**
 * Slack integration with Block Kit and fallback channel support
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const FALLBACK_CHANNEL = process.env.FALLBACK_CHANNEL;
const SLACK_API_BASE_URL = 'https://slack.com/api';

/**
 * Look up Slack user by email address
 * @param {string} email - Email address to look up
 * @returns {Promise<string|null>} - Slack user ID or null if not found
 */
export async function lookupUserByEmail(email) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  if (!email) {
    return null;
  }

  const url = `${SLACK_API_BASE_URL}/users.lookupByEmail`;
  const formData = new URLSearchParams();
  formData.append('email', email);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const data = await response.json();

  if (!data.ok) {
    return null;
  }

  return data.user?.id || null;
}

/**
 * Open or get existing DM conversation with a user
 * @param {string} userId - Slack user ID
 * @returns {Promise<string|null>} - Channel ID or null if failed
 */
export async function openDM(userId) {
  if (!SLACK_BOT_TOKEN || !userId) {
    return null;
  }

  const url = `${SLACK_API_BASE_URL}/conversations.open`;
  const formData = new URLSearchParams();
  formData.append('users', userId);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const data = await response.json();

  if (!data.ok) {
    return null;
  }

  return data.channel?.id || null;
}

/**
 * Send a Block Kit message to a Slack channel
 * @param {string} channelId - Slack channel ID
 * @param {Array} blocks - Block Kit blocks
 * @returns {Promise<boolean>} - True if message sent successfully
 */
export async function sendBlockKitMessage(channelId, blocks) {
  if (!SLACK_BOT_TOKEN || !channelId || !blocks) {
    return false;
  }

  const url = `${SLACK_API_BASE_URL}/chat.postMessage`;
  
  const formData = new URLSearchParams();
  formData.append('channel', channelId);
  formData.append('blocks', JSON.stringify(blocks));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const data = await response.json();

  if (!data.ok) {
    console.error('Slack API error (chat.postMessage):', data.error);
    return false;
  }

  return true;
}

/**
 * Post to fallback channel if DM fails
 * @param {string} assigneeEmail - Assignee email
 * @param {string} conversationId - Conversation ID
 * @param {string} conversationLink - Conversation link
 * @returns {Promise<boolean>} - True if posted successfully
 */
export async function postToFallbackChannel(assigneeEmail, conversationId, conversationLink) {
  if (!FALLBACK_CHANNEL) {
    console.warn('FALLBACK_CHANNEL not configured, cannot post fallback message');
    return false;
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔔 *Conversation assigned after Fin handoff*\n*Assignee:* ${assigneeEmail}\n*Conversation ID:* ${conversationId}\n<${conversationLink}|Open in Intercom>`
      }
    }
  ];

  return await sendBlockKitMessage(FALLBACK_CHANNEL, blocks);
}

/**
 * Generate Block Kit blocks for assignment notification
 * @param {Object} params - Notification parameters
 * @returns {Array} - Block Kit blocks
 */
function generateAssignmentBlocks({
  assigneeName,
  conversationId,
  conversationLink,
  subject,
  brand,
  language,
  sourceType,
  priority,
  hasEmailLinks
}) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Assigned after Fin handoff',
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Assignee:*\n${assigneeName || 'Unknown'}`
        },
        {
          type: 'mrkdwn',
          text: `*Conversation ID:*\n${conversationId}`
        }
      ]
    }
  ];

  // Add subject if available
  if (subject && subject !== 'No subject') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Conversation:* ${subject}`
      }
    });
  }

  // Add brand/language if available
  const contextFields = [];
  if (brand) contextFields.push(`*Brand:* ${brand}`);
  if (language) contextFields.push(`*Language:* ${language}`);
  if (sourceType) contextFields.push(`*Source:* ${sourceType}`);
  if (priority && priority !== 'not_priority') contextFields.push(`*Priority:* ${priority}`);

  if (contextFields.length > 0) {
    blocks.push({
      type: 'context',
      elements: contextFields.map(text => ({
        type: 'mrkdwn',
        text
      }))
    });
  }

  // Add warning if email contains links
  if (hasEmailLinks) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '⚠️ Email may contain links/attachments. Open cautiously.'
      }
    });
  }

  // Add buttons: Open in Intercom + Opt-out
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Open in Intercom',
          emoji: true
        },
        url: conversationLink,
        action_id: 'open_intercom',
        style: 'primary'
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔕 Stop notifications',
          emoji: true
        },
        action_id: 'opt_out',
        style: 'danger',
        confirm: {
          title: {
            type: 'plain_text',
            text: 'Stop notifications?'
          },
          text: {
            type: 'mrkdwn',
            text: 'You won\'t receive notifications when Fin-handled conversations are assigned to you. You can opt back in anytime with `/fin-handoff opt-in`.'
          },
          confirm: {
            type: 'plain_text',
            text: 'Stop notifications'
          },
          deny: {
            type: 'plain_text',
            text: 'Cancel'
          }
        }
      }
    ]
  });

  return blocks;
}

/**
 * Send DM to assignee with Block Kit format
 * @param {string} assigneeEmail - Assignee email
 * @param {Object} conversation - Conversation object
 * @param {string} conversationLink - Conversation link
 * @returns {Promise<{success: boolean, usedFallback: boolean}>}
 */
export async function sendAssignmentDM(assigneeEmail, conversation, conversationLink) {
  // Look up user
  const userId = await lookupUserByEmail(assigneeEmail);
  
  if (!userId) {
    console.warn(`Could not find Slack user for email: ${assigneeEmail}`);
    // Try fallback channel
    if (FALLBACK_CHANNEL) {
      const posted = await postToFallbackChannel(
        assigneeEmail,
        conversation.id,
        conversationLink
      );
      return { success: posted, usedFallback: true };
    }
    return { success: false, usedFallback: false };
  }

  // Open DM
  const channelId = await openDM(userId);
  if (!channelId) {
    console.warn(`Could not open DM channel for user: ${userId}`);
    // Try fallback channel
    if (FALLBACK_CHANNEL) {
      const posted = await postToFallbackChannel(
        assigneeEmail,
        conversation.id,
        conversationLink
      );
      return { success: posted, usedFallback: true };
    }
    return { success: false, usedFallback: false };
  }

  // Extract conversation details
  const subject = conversation.title || 
                  conversation.conversation_message?.subject || 
                  conversation.source?.subject ||
                  'No subject';
  
  // Clean HTML from subject
  let cleanSubject = subject;
  if (typeof cleanSubject === 'string') {
    cleanSubject = cleanSubject.replace(/<[^>]*>/g, '').trim();
    cleanSubject = cleanSubject.replace(/&nbsp;/g, ' ')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'");
    if (cleanSubject.length > 100) {
      cleanSubject = cleanSubject.substring(0, 97) + '...';
    }
  }

  const brand = conversation.custom_attributes?.Brand;
  const language = conversation.custom_attributes?.Language;
  const sourceType = conversation.source?.type;
  const priority = conversation.priority;
  
  // Check if email source contains URLs
  const hasEmailLinks = sourceType === 'email' && 
                        conversation.source?.body && 
                        /https?:\/\//i.test(conversation.source.body);

  // Get assignee name from conversation parts or use email
  let assigneeName = assigneeEmail;
  const parts = conversation.conversation_parts?.conversation_parts || [];
  for (const part of parts) {
    if (part.part_type === 'assignment' && part.author?.name) {
      assigneeName = part.author.name;
      break;
    }
  }

  const blocks = generateAssignmentBlocks({
    assigneeName,
    conversationId: conversation.id,
    conversationLink,
    subject: cleanSubject,
    brand,
    language,
    sourceType,
    priority,
    hasEmailLinks
  });

  const success = await sendBlockKitMessage(channelId, blocks);
  return { success, usedFallback: false };
}
