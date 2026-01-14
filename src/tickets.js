/**
 * Intercom Tickets API client
 * Uses REST API v2.11+ for ticket search
 */

// Support both INTERCOM_ACCESS_TOKEN and INTERCOM_TOKEN for backward compatibility
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN || process.env.INTERCOM_TOKEN;

// Validate token is set
if (!INTERCOM_ACCESS_TOKEN) {
  console.warn('⚠️  INTERCOM_ACCESS_TOKEN not set. Please set it in your .env file.');
}
const INTERCOM_BASE_URL = 'https://api.intercom.io';

/**
 * Search for tickets created or updated after a specific timestamp
 * @param {number} sinceTimestamp - Unix timestamp in seconds
 * @param {Object} options - Additional options
 * @param {boolean} options.includeUpdated - Also search by updated_at (default: true)
 * @returns {Promise<Array>} - Array of ticket objects
 */
export async function searchTickets(sinceTimestamp, options = {}) {
  if (!INTERCOM_ACCESS_TOKEN) {
    throw new Error('INTERCOM_ACCESS_TOKEN not configured');
  }

  const {
    limit = 50,
    includeUpdated = true // Default to true to catch SLA status changes
  } = options;

  // Build search query
  // Search for tickets created OR updated after timestamp
  // This ensures we catch SLA status changes on older tickets
  const query = {
    query: {
      operator: includeUpdated ? 'OR' : 'AND',
      value: [
        {
          field: 'created_at',
          operator: '>=',
          value: sinceTimestamp
        },
        ...(includeUpdated ? [{
          field: 'updated_at',
          operator: '>=',
          value: sinceTimestamp
        }] : [])
      ]
    },
    pagination: {
      per_page: limit
    },
    sort: {
      field: 'updated_at', // Sort by updated_at to prioritize recently changed tickets
      order: 'descending'
    }
  };

  const url = `${INTERCOM_BASE_URL}/tickets/search`;

  console.log(`Searching tickets ${includeUpdated ? 'created or updated' : 'created'} after ${new Date(sinceTimestamp * 1000).toISOString()}`);

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
    let tickets = data._results || data.tickets || data.data || [];
    
    // Handle pagination if there are more results
    let nextPage = data.pages?.next;
    let pageCount = 1;
    
    while (nextPage && tickets.length < 1000) { // Limit to 1000 tickets max to avoid infinite loops
      try {
        const nextResponse = await fetch(nextPage.url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${INTERCOM_ACCESS_TOKEN}`,
            'Accept': 'application/json',
            'Intercom-Version': '2.11'
          }
        });
        
        if (!nextResponse.ok) {
          console.warn(`Failed to fetch next page: ${nextResponse.status}`);
          break;
        }
        
        const nextData = await nextResponse.json();
        const nextTickets = nextData._results || nextData.tickets || nextData.data || [];
        tickets = tickets.concat(nextTickets);
        pageCount++;
        nextPage = nextData.pages?.next;
        
        console.log(`Fetched page ${pageCount}: ${nextTickets.length} tickets (total: ${tickets.length})`);
      } catch (err) {
        console.error('Error fetching next page:', err);
        break;
      }
    }

    console.log(`Found ${tickets.length} tickets ${includeUpdated ? 'created or updated' : 'created'} after ${new Date(sinceTimestamp * 1000).toISOString()} (${pageCount} page${pageCount > 1 ? 's' : ''})`);

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
