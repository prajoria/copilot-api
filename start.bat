@echo off
setlocal
echo ================================================
echo GitHub Copilot API Server
echo ================================================
echo.

where bun >nul 2>&1
if errorlevel 1 (
    echo Bun is required. Install it from https://bun.sh/docs/installation
    exit /b 1
)

echo Installing dependencies from bun.lock...
call bun install --frozen-lockfile
if errorlevel 1 exit /b %errorlevel%

echo Building production CLI...
call bun run build
if errorlevel 1 exit /b %errorlevel%

echo Starting server in production mode...
echo The usage viewer will open in your default browser.
echo.

start "" "https://ericc-ch.github.io/copilot-api?endpoint=http://localhost:4141/usage"
call bun run .\dist\main.js start %*
exit /b %errorlevel%
