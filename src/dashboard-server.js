/**
 * Dashboard server for SLA monitoring
 * Provides API endpoints for real-time SLA dashboard
 */

import 'dotenv/config';
import express from 'express';
import { getAllSLATickets, getSLAStats, reloadSLAState } from './sla-monitor-enhanced.js';
import { getStats as getPreferenceStats } from './preferences.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3002;

// Reload SLA state periodically to sync with polling service
// Since dashboard runs as separate process, it needs to reload the file
const RELOAD_INTERVAL = parseInt(process.env.SLA_STATE_RELOAD_INTERVAL || '10000', 10); // Default 10 seconds

setInterval(async () => {
  try {
    const count = await reloadSLAState();
    // Only log if there are tickets (to avoid spam when empty)
    if (count > 0) {
      console.log(`Reloaded SLA state: ${count} tickets`);
    }
  } catch (err) {
    console.error('Error reloading SLA state:', err);
  }
}, RELOAD_INTERVAL);

// Serve static files from dashboard directory
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// CORS for API endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * API: Get all SLA tickets
 * GET /api/sla/tickets
 * Query params: team, status, sla_name
 */
app.get('/api/sla/tickets', async (req, res) => {
  try {
    // Force reload before getting tickets
    await reloadSLAState();
    let tickets = getAllSLATickets();
    
    // Filter by status
    if (req.query.status) {
      tickets = tickets.filter(t => t.sla_status === req.query.status);
    }
    
    // Filter by SLA name
    if (req.query.sla_name) {
      tickets = tickets.filter(t => 
        t.sla_name.toLowerCase().includes(req.query.sla_name.toLowerCase())
      );
    }
    
    // Filter by unwarranted tag
    if (req.query.unwarranted === 'true') {
      tickets = tickets.filter(t => t.has_unwarranted_tag === true);
    } else if (req.query.unwarranted === 'false') {
      tickets = tickets.filter(t => !t.has_unwarranted_tag);
    }
    
    // Filter by assignee
    if (req.query.assignee) {
      tickets = tickets.filter(t => t.assignee_name === req.query.assignee);
    }
    
    // Filter by ticket state
    if (req.query.ticket_state) {
      tickets = tickets.filter(t => {
        const state = (t.ticket_state || '').toLowerCase();
        return state === req.query.ticket_state.toLowerCase();
      });
    }
    
    // Filter by date range
    // Default to assigned_at, but can filter by ticket_created_at if date_type=created
    const dateType = req.query.date_type || 'assigned';
    const dateField = dateType === 'created' ? 'ticket_created_at' : 'assigned_at';
    
    if (req.query.date_from) {
      const dateFrom = new Date(req.query.date_from).getTime() / 1000; // Convert to Unix timestamp
      tickets = tickets.filter(t => {
        const dateValue = t[dateField];
        if (!dateValue) return false;
        return dateValue >= dateFrom;
      });
    }
    
    if (req.query.date_to) {
      const dateTo = new Date(req.query.date_to).getTime() / 1000; // Convert to Unix timestamp
      // Add 24 hours to include the entire end date
      const dateToEnd = dateTo + (24 * 60 * 60);
      tickets = tickets.filter(t => {
        const dateValue = t[dateField];
        if (!dateValue) return false;
        return dateValue <= dateToEnd;
      });
    }
    
    // Sort options
    const sortBy = req.query.sort || 'deadline';
    if (sortBy === 'deadline') {
      tickets.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline - b.deadline;
      });
    } else if (sortBy === 'remaining') {
      tickets.sort((a, b) => {
        if (a.remaining_seconds === null && b.remaining_seconds === null) return 0;
        if (a.remaining_seconds === null) return 1;
        if (b.remaining_seconds === null) return -1;
        return a.remaining_seconds - b.remaining_seconds;
      });
    } else if (sortBy === 'assignee') {
      tickets.sort((a, b) => {
        const nameA = a.assignee_name || 'ZZZ';
        const nameB = b.assignee_name || 'ZZZ';
        return nameA.localeCompare(nameB);
      });
    } else if (sortBy === 'sla_name') {
      tickets.sort((a, b) => {
        return (a.sla_name || '').localeCompare(b.sla_name || '');
      });
    }
    
    res.json({
      success: true,
      count: tickets.length,
      tickets
    });
  } catch (err) {
    console.error('Error fetching SLA tickets:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * API: Get SLA stats
 * GET /api/sla/stats
 * Query params: date_from, date_to (optional date filters)
 */
app.get('/api/sla/stats', async (req, res) => {
  try {
    // Force reload before getting stats
    await reloadSLAState();
    let tickets = getAllSLATickets();
    
    // Apply date filters if provided (same logic as /api/sla/tickets)
    if (req.query.date_from) {
      const dateFrom = new Date(req.query.date_from).getTime() / 1000;
      tickets = tickets.filter(t => {
        if (!t.assigned_at) return false;
        return t.assigned_at >= dateFrom;
      });
    }
    
    if (req.query.date_to) {
      const dateTo = new Date(req.query.date_to).getTime() / 1000;
      const dateToEnd = dateTo + (24 * 60 * 60);
      tickets = tickets.filter(t => {
        if (!t.assigned_at) return false;
        return t.assigned_at <= dateToEnd;
      });
    }
    
    // Get stats with filtered tickets
    const stats = getSLAStats(tickets);
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('Error fetching SLA stats:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * API: Reload SLA state manually
 * GET /api/sla/reload
 */
app.get('/api/sla/reload', async (req, res) => {
  try {
    const count = await reloadSLAState();
    res.json({
      success: true,
      message: `Reloaded SLA state`,
      ticketCount: count
    });
  } catch (err) {
    console.error('Error reloading SLA state:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * API: Health check
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  const slaStats = getSLAStats();
  const preferenceStats = getPreferenceStats();
  
  res.json({
    status: 'ok',
    service: 'sla-dashboard',
    timestamp: new Date().toISOString(),
    sla: slaStats,
    preferences: preferenceStats
  });
});

/**
 * Serve dashboard HTML
 * GET /
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`SLA Dashboard Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/sla/tickets`);
});
