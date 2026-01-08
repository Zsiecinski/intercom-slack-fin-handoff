/**
 * Fin involvement detection with extensive logging
 * Checks multiple sources to determine if Fin/AI agent participated before assignment
 */

/**
 * Determine if Fin (AI agent) participated in a conversation before assignment
 * 
 * @param {Object} conversationJson - Full conversation object from Intercom API
 * @param {Object} webhookPayload - Webhook payload (for context)
 * @returns {{involved: boolean, reason: string, matchedRules: string[]}} - Detection result
 */
export function isFinInvolved(conversationJson, webhookPayload = {}) {
  const requestId = webhookPayload.id || 'unknown';
  const conversationId = conversationJson?.id || 'unknown';
  const matchedRules = [];
  
  if (!conversationJson) {
    console.warn(`[${requestId}] [${conversationId}] Fin check: No conversation data provided`);
    return { involved: false, reason: 'No conversation data', matchedRules: [] };
  }

  console.log(`[${requestId}] [${conversationId}] Starting Fin involvement check...`);

  // Rule 1: Check conversation_parts for AI agent indicators
  const parts = conversationJson.conversation_parts?.conversation_parts || [];
  for (const part of parts) {
    const author = part.author;
    if (!author) continue;

    // Check from_ai_agent flag
    if (author.from_ai_agent === true) {
      matchedRules.push(`conversation_parts.author.from_ai_agent=true (part:${part.id})`);
      console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: author.from_ai_agent=true`, {
        partId: part.id,
        authorId: author.id,
        authorName: author.name
      });
      return { involved: true, reason: 'AI agent flag in conversation parts', matchedRules };
    }

    // Check is_ai_answer flag
    if (author.is_ai_answer === true) {
      matchedRules.push(`conversation_parts.author.is_ai_answer=true (part:${part.id})`);
      console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: author.is_ai_answer=true`, {
        partId: part.id,
        authorId: author.id,
        authorName: author.name
      });
      return { involved: true, reason: 'AI answer flag in conversation parts', matchedRules };
    }

    // Check bot type
    if (author.type === 'bot') {
      matchedRules.push(`conversation_parts.author.type=bot (part:${part.id})`);
      console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: author.type=bot`, {
        partId: part.id,
        authorId: author.id,
        authorName: author.name
      });
      return { involved: true, reason: 'Bot author in conversation parts', matchedRules };
    }

    // Check metadata for AI indicators
    if (part.metadata) {
      const metadataStr = JSON.stringify(part.metadata).toLowerCase();
      if (metadataStr.includes('ai') || metadataStr.includes('fin') || metadataStr.includes('bot')) {
        matchedRules.push(`conversation_parts.metadata contains AI/Fin/Bot (part:${part.id})`);
        console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: metadata contains AI indicators`, {
          partId: part.id,
          metadata: part.metadata
        });
        return { involved: true, reason: 'AI indicators in part metadata', matchedRules };
      }
    }
  }

  // Rule 2: Check top-level AI agent fields
  if (conversationJson.ai_agent) {
    matchedRules.push('ai_agent field present');
    console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: ai_agent field present`, {
      aiAgent: conversationJson.ai_agent
    });
    return { involved: true, reason: 'AI agent field present', matchedRules };
  }

  if (conversationJson.ai_agent_participated === true) {
    matchedRules.push('ai_agent_participated=true');
    console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: ai_agent_participated=true`);
    return { involved: true, reason: 'AI agent participated flag', matchedRules };
  }

  // Rule 3: Check custom_attributes for Fin-related flags
  const customAttrs = conversationJson.custom_attributes || {};
  for (const [key, value] of Object.entries(customAttrs)) {
    const keyLower = key.toLowerCase();
    const valueStr = String(value).toLowerCase();
    
    if (keyLower.includes('fin') || keyLower.includes('ai') || keyLower.includes('bot')) {
      if (value === true || valueStr === 'true' || valueStr.includes('fin') || valueStr.includes('ai')) {
        matchedRules.push(`custom_attributes.${key}=${value}`);
        console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: custom_attributes.${key}=${value}`);
        return { involved: true, reason: `Fin indicator in custom_attributes.${key}`, matchedRules };
      }
    }
  }

  // Rule 4: Check conversation source for bot/AI indicators
  const source = conversationJson.source;
  if (source) {
    const sourceType = source.type?.toLowerCase() || '';
    if (sourceType === 'bot' || sourceType.includes('ai') || sourceType.includes('fin')) {
      matchedRules.push(`source.type=${sourceType}`);
      console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: source.type=${sourceType}`);
      return { involved: true, reason: `Bot/AI source type: ${sourceType}`, matchedRules };
    }
  }

  // Rule 5: Check statistics for AI-related data
  const statistics = conversationJson.statistics || {};
  const statsStr = JSON.stringify(statistics).toLowerCase();
  if (statsStr.includes('ai') || statsStr.includes('fin') || statsStr.includes('bot')) {
    matchedRules.push('statistics contains AI/Fin/Bot');
    console.log(`[${requestId}] [${conversationId}] ✅ Fin detected: statistics contains AI indicators`);
    return { involved: true, reason: 'AI indicators in statistics', matchedRules };
  }

  // No Fin involvement detected
  console.log(`[${requestId}] [${conversationId}] ❌ Fin not confirmed - no AI agent indicators found`);
  console.log(`[${requestId}] [${conversationId}] Checked:`, {
    partsCount: parts.length,
    hasAiAgent: !!conversationJson.ai_agent,
    aiAgentParticipated: conversationJson.ai_agent_participated,
    customAttrsKeys: Object.keys(customAttrs),
    sourceType: source?.type
  });

  return { involved: false, reason: 'No Fin involvement detected', matchedRules: [] };
}
