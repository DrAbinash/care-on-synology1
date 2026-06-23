#!/bin/bash
# Robust wrapper to start the mobile app server
# Keeps the server running and logs to a file

cd "$(dirname "$0")" || exit 1
PORT=3003 BASE_PATH=/mobile/ exec node server/serve.js >> /tmp/mobile-serve.log 2>&1
