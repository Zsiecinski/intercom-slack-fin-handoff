#!/bin/bash
# Start both polling service and command server

# Start polling service in background
node src/poll.js &
POLL_PID=$!

# Start command server in background
node src/command-server.js &
COMMAND_PID=$!

echo "Started polling service (PID: $POLL_PID)"
echo "Started command server (PID: $COMMAND_PID)"
echo ""
echo "To stop both services:"
echo "  kill $POLL_PID $COMMAND_PID"
echo ""
echo "Or use PM2:"
echo "  pm2 start src/poll.js --name intercom-ticket-poller"
echo "  pm2 start src/command-server.js --name intercom-commands"
echo "  pm2 save"

# Wait for both processes
wait $POLL_PID $COMMAND_PID
