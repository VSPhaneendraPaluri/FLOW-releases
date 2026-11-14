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

:: ── Auto-detect local Windows SDK zip ───────────────────────────────────────
:: Priority 1: SDK_ZIP_PATH already set in the environment (highest priority)
:: Priority 2: Latest flow-sdk-*-Windows.zip in the sibling flow\dist\ folder
:: Priority 3: Any *.zip in the parent folder (original behaviour)
:: If none found, server falls back to the GitHub release (GITHUB_OWNER must be set).

if not defined SDK_ZIP_PATH (
    set "_FLOW_DIST=%~dp0..\..\flow\dist"
    for /f "delims=" %%F in ('dir /b /o-d "%_FLOW_DIST%\flow-sdk-*-Windows.zip" 2^>nul') do (
        if not defined SDK_ZIP_PATH (
            set "SDK_ZIP_PATH=%_FLOW_DIST%\%%F"
        )
    )
    set "_FLOW_DIST="
)

if defined SDK_ZIP_PATH (
    echo  [sdk] Using local zip: %SDK_ZIP_PATH%
) else (
    echo  [sdk] No local Windows zip found — will fetch from GitHub release.
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
