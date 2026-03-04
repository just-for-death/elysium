#!/bin/sh
# Elysium – generate VAPID keys for Web Push
# Run this once then add the keys to docker-compose.yml or a .env file

echo "Generating VAPID keys for Web Push notifications..."
echo ""

docker run --rm node:20-alpine sh -c "npm install -g web-push --silent && web-push generate-vapid-keys"

echo ""
echo "Add these keys to your docker-compose.yml under environment:"
echo "  - VAPID_PUBLIC_KEY=<Public Key above>"
echo "  - VAPID_PRIVATE_KEY=<Private Key above>"
echo "  - VAPID_EMAIL=mailto:you@example.com"
