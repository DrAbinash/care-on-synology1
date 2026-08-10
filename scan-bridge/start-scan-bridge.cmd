@echo off
cd /d "%~dp0"
set ERP_BASE_URL=https://caredeoghar.com
set BRIDGE_SCAN_VENDOR=folder-watch
set SCAN_WATCH_FOLDER=C:\Scans
node src\index.js
