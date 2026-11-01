#!/usr/bin/env bash
# Builds the Windows app into app/windows/dist/ (zip always; installer needs wine)
set -e
cd "$(dirname "$0")/../core"
npm install
npx electron-builder --win --config ../windows/electron-builder.yml "$@"
