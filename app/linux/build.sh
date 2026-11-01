#!/usr/bin/env bash
# Builds the Linux AppImage into app/linux/dist/
set -e
cd "$(dirname "$0")/../core"
npm install
npx electron-builder --linux --config ../linux/electron-builder.yml
