@echo off
cd /d "%~dp0"

echo.
echo  FLOW SDK Playground
echo  --------------------------------------------------
echo  Starting local server on http://localhost:3000
echo  Press Ctrl+C to stop.
echo  --------------------------------------------------
echo.

:: Check Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo  [error] Node.js not found. Install from https://nodejs.org ^(v18+^)
    pause & exit /b 1
)

:: Always sync dependencies
echo  [setup] Syncing dependencies...
npm install
if errorlevel 1 (
    echo  [error] npm install failed.
    pause & exit /b 1
)

:: Open browser after short delay (background)
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo.
echo  [ok] Starting server... (Ctrl+C to stop)
echo.

:: Run node IN THIS WINDOW so errors are visible
node server.js

echo.
echo  [server stopped]
pause
