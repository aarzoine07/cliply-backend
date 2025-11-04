#!/bin/bash
# Test script for Stripe webhook endpoint
# Usage: ./test-webhook.sh

echo "🧪 Testing Stripe webhook endpoint..."
echo ""
echo "Prerequisites:"
echo "  1. Dev server running: pnpm dev"
echo "  2. Stripe CLI installed: brew install stripe/stripe-cli/stripe"
echo "  3. Environment variables set in apps/web/.env.local"
echo ""
echo "Commands to run:"
echo ""
echo "# Terminal 1: Start dev server"
echo "cd /Users/davidmaman/Desktop/cliply-backend"
echo "pnpm dev"
echo ""
echo "# Terminal 2: Forward Stripe webhooks"
echo "stripe listen --forward-to localhost:3000/api/stripe/webhook"
echo ""
echo "# Terminal 3: Trigger test event"
echo "stripe trigger checkout.session.completed"
echo ""
echo "Expected response: HTTP 200 with { \"received\": true }"

