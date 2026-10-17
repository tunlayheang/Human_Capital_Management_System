#!/bin/bash
# Production startup script for Render

# Set environment variables
export NODE_ENV=production
export PORT=${PORT:-3000}

# Wait for database to be ready (if needed)
echo "Starting HR System..."

# Start the application
npm start
