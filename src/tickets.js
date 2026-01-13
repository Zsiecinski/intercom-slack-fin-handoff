/**
 * Intercom Tickets API client
 * Uses REST API v2.11+ for ticket search
 */

const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;
const INTERCOM_BASE_URL = 'https://api.intercom.io';

/**
 * Search for tickets created after a specific timestamp
 * @param {number} sinceTimestamp - Unix timestamp in seconds
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} - Array of ticket objects
 */
export async function searchTickets(sinceTimestamp, options = {}) {
  if (!INTERCOM_ACCESS_TOKEN) {
    throw new Error('INTERCOM_ACCESS_TOKEN not configured');
  }

  const {
    limit = 50
  } = options;

  // Build search query
  // Using the Search API with timestamp filter
  // Note: Intercom expects timestamp as a number (Unix timestamp in seconds)
  const query = {
    query: {
      operator: 'AND',
      value: [
        {
          field: 'created_at',
          operator: '>=',
          value: sinceTimestamp // Unix timestamp in seconds
        }
      ]
    },
    pagination: {
      per_page: limit
    },
    sort: {
      field: 'created_at',
      order: 'ascending'
    }
  };

  const url = `${INTERCOM_BASE_URL}/tickets/search`;

  console.log(`Searching tickets created after ${new Date(sinceTimestamp * 1000).toISOString()}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': '2.11'
      },
      body: JSON.stringify(query)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Intercom Tickets API error:', response.status, errorText);
      throw new Error(`Intercom Tickets API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    // Intercom API v2.11 returns tickets in data._results or data.tickets
    const tickets = data._results || data.tickets || data.data || [];

    console.log(`Found ${tickets.length} tickets created after ${new Date(sinceTimestamp * 1000).toISOString()}`);

    return tickets;
  } catch (err) {
    console.error('Error searching tickets:', err);
    throw err;
  }
}

/**
 * Get ticket details by ID
 * @param {string} ticketId - Ticket ID
 * @returns {Promise<Object>} - Ticket object
 */
export async function getTicket(ticketId) {
  if (!INTERCOM_ACCESS_TOKEN) {
    throw new Error('INTERCOM_ACCESS_TOKEN not configured');
  }

  const url = `${INTERCOM_BASE_URL}/tickets/${ticketId}`;

  console.log(`Fetching ticket: ${ticketId}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        'Accept': 'application/json',
        'Intercom-Version': '2.11'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Intercom Tickets API error:', response.status, errorText);
      throw new Error(`Intercom Tickets API error: ${response.status} - ${errorText}`);
    }

    const ticket = await response.json();
    return ticket;
  } catch (err) {
    console.error(`Error fetching ticket ${ticketId}:`, err);
    throw err;
  }
}

/**
 * Get admin details from Intercom API
 * @param {string} adminId - Intercom admin ID
 * @returns {Promise<Object>} - Admin object with email and name
 */
export async function getAdmin(adminId) {
  if (!INTERCOM_ACCESS_TOKEN) {
    throw new Error('INTERCOM_ACCESS_TOKEN not configured');
  }

  const url = `${INTERCOM_BASE_URL}/admins/${adminId}`;

  console.log(`Fetching admin: ${adminId}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        'Accept': 'application/json',
        'Intercom-Version': '2.11'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Intercom API error (getAdmin):', response.status, errorText);
      throw new Error(`Intercom API error: ${response.status} - ${errorText}`);
    }

    const admin = await response.json();
    return admin;
  } catch (err) {
    console.error(`Error fetching admin ${adminId}:`, err);
    throw err;
  }
}
