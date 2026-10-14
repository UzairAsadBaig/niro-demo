@echo off
cd /d "%~dp0"
echo Starting Dark City at http://localhost:5173
echo Keep this window open while using the development server.
call npm.cmd run dev
pause
