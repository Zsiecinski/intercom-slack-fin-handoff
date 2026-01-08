import crypto from 'crypto';

const INTERCOM_CLIENT_SECRET = process.env.INTERCOM_CLIENT_SECRET;
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const INTERCOM_BASE_URL = 'https://api.intercom.io';

/**
 * Verify Intercom webhook signature using HMAC-SHA1
 * @param {Buffer} rawBody - Raw request body buffer
 * @param {string} signature - X-Hub-Signature header value (format: sha1=hexdigest)
 * @returns {boolean} - True if signature is valid
 */
export function verifyIntercomSignature(rawBody, signature) {
  if (!INTERCOM_CLIENT_SECRET) {
    console.error('INTERCOM_CLIENT_SECRET not configured');
    return false;
  }

  // Ensure rawBody is a Buffer
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  // Extract hash from signature header (format: sha1=hexdigest)
  const parts = signature.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha1') {
    console.error('Invalid signature format:', signature);
    console.error('Expected format: sha1=hexdigest');
    return false;
  }

  const receivedHash = parts[1];

  // Compute HMAC-SHA1 hash
  const computedHash = crypto
    .createHmac('sha1', INTERCOM_CLIENT_SECRET)
    .update(bodyBuffer)
    .digest('hex');

  // Only log on mismatch for production
  if (receivedHash !== computedHash) {
    console.warn('Signature verification failed:', {
      receivedHash: receivedHash.substring(0, 8) + '...',
      computedHash: computedHash.substring(0, 8) + '...'
    });
  }

  // Compare hashes using constant-time comparison
  // Handle case where buffers might be different lengths
  if (receivedHash.length !== computedHash.length) {
    console.error('Hash length mismatch:', {
      received: receivedHash.length,
      computed: computedHash.length
    });
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(receivedHash, 'hex'),
    Buffer.from(computedHash, 'hex')
  );
}

/**
 * Fetch conversation details from Intercom API
 * @param {string} conversationId - Intercom conversation ID
 * @returns {Promise<Object>} - Conversation JSON object
 */
export async function getConversation(conversationId) {
  if (!INTERCOM_TOKEN) {
    throw new Error('INTERCOM_TOKEN not configured');
  }

  const url = `${INTERCOM_BASE_URL}/conversations/${conversationId}`;

  console.log('Fetching conversation from Intercom:', conversationId);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${INTERCOM_TOKEN}`,
      'Accept': 'application/json',
      'Intercom-Version': '2.10'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Intercom API error:', response.status, errorText);
    throw new Error(`Intercom API error: ${response.status} - ${errorText}`);
  }

  const conversation = await response.json();
  console.log('Fetched conversation:', {
    id: conversation.id,
    state: conversation.state,
    partsCount: conversation.conversation_parts?.conversation_parts?.length || 0
  });

  return conversation;
}

/**
 * Fetch admin details from Intercom API
 * @param {string} adminId - Intercom admin ID
 * @returns {Promise<Object>} - Admin object with email and name
 */
export async function getAdmin(adminId) {
  if (!INTERCOM_TOKEN) {
    throw new Error('INTERCOM_TOKEN not configured');
  }

  const url = `${INTERCOM_BASE_URL}/admins/${adminId}`;

  console.log('Fetching admin from Intercom:', adminId);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${INTERCOM_TOKEN}`,
      'Accept': 'application/json',
      'Intercom-Version': '2.10'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Intercom API error (getAdmin):', response.status, errorText);
    throw new Error(`Intercom API error: ${response.status} - ${errorText}`);
  }

  const admin = await response.json();
  console.log('Fetched admin:', {
    id: admin.id,
    name: admin.name,
    email: admin.email
  });

  return admin;
}

