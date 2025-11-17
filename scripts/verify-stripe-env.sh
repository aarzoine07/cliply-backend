#!/bin/bash
# Verify Stripe environment variables are configured

set -e

ENV_FILE="apps/web/.env.local"

echo "🔍 Verifying Stripe environment configuration..."
echo ""

# Check if .env.local exists
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: $ENV_FILE not found"
  exit 1
fi

# Required variables
REQUIRED_VARS=(
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "STRIPE_PRICE_BASIC"
  "STRIPE_PRICE_PRO"
  "STRIPE_PRICE_PREMIUM"
  "APP_URL"
)

MISSING_VARS=()
INVALID_VARS=()

# Check each required variable
for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${var}=" "$ENV_FILE"; then
    MISSING_VARS+=("$var")
  else
    value=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2-)
    if [ -z "$value" ] || [ "$value" = "..." ] || [ "$value" = "sk_test_..." ] || [ "$value" = "whsec_..." ]; then
      INVALID_VARS+=("$var")
    fi
  fi
done

# Report results
if [ ${#MISSING_VARS[@]} -eq 0 ] && [ ${#INVALID_VARS[@]} -eq 0 ]; then
  echo "✅ All required Stripe environment variables are present and configured"
  echo ""
  echo "Configured variables:"
  for var in "${REQUIRED_VARS[@]}"; do
    value=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2-)
    if [[ "$var" == *"SECRET"* ]] || [[ "$var" == *"KEY"* ]]; then
      # Mask secrets
      masked=$(echo "$value" | sed 's/\(.\{8\}\).*/\1.../')
      echo "  $var=$masked"
    else
      echo "  $var=$value"
    fi
  done
  exit 0
else
  echo "❌ Configuration issues found:"
  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo ""
    echo "Missing variables:"
    for var in "${MISSING_VARS[@]}"; do
      echo "  - $var"
    done
  fi
  if [ ${#INVALID_VARS[@]} -gt 0 ]; then
    echo ""
    echo "Variables with placeholder values (need to be updated from Stripe Dashboard):"
    for var in "${INVALID_VARS[@]}"; do
      echo "  - $var"
    done
  fi
  echo ""
  echo "Please update $ENV_FILE with actual values from Stripe Dashboard"
  exit 1
fi

