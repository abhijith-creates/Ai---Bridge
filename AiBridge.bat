@echo off
cd /d "%~dp0"

:: 1. Launch native Electron executable directly (no cmd/terminal wrapper)
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
  exit /b 0
)

:: 2. Check if Node is installed if electron not found
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  msg * "Node.js is required to run AI Bridge. Please download it from https://nodejs.org"
  exit /b 1
)

:: 3. Start server if not running
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="1" (
  start /b node server.js
  timeout /t 2 /nobreak >nul
)

:: 4. Try Chrome App Mode (frameless standalone window, no address bar)
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist %CHROME_PATH% (
  start "" %CHROME_PATH% --app="http://localhost:3388" --window-size=1380,880
  exit /b 0
)

set CHROME_PATH_X86="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist %CHROME_PATH_X86% (
  start "" %CHROME_PATH_X86% --app="http://localhost:3388" --window-size=1380,880
  exit /b 0
)

:: 5. Fallback default browser
start "" "http://localhost:3388"
exit /b 0
