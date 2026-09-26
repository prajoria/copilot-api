@echo off
setlocal
title Claude Code via Copilot API

if not defined CLAUDE_MODEL set "CLAUDE_MODEL=claude-opus-4.8"
if not defined ANTHROPIC_BASE_URL set "ANTHROPIC_BASE_URL=http://127.0.0.1:4141"
set "ANTHROPIC_AUTH_TOKEN=dummy"
set "ANTHROPIC_MODEL=%CLAUDE_MODEL%"
set "ANTHROPIC_DEFAULT_SONNET_MODEL=%CLAUDE_MODEL%"
set "ANTHROPIC_SMALL_FAST_MODEL=%CLAUDE_MODEL%"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%CLAUDE_MODEL%"
set "DISABLE_NON_ESSENTIAL_MODEL_CALLS=1"
set "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"

where bun >nul 2>&1
if errorlevel 1 (
    echo [start-claude] Bun is required to run the proxy from source.
    echo Install it from https://bun.sh/docs/installation
    exit /b 1
)

set "USE_NPX=1"
where claude >nul 2>&1
if not errorlevel 1 (
    call claude --version >nul 2>&1
    if not errorlevel 1 set "USE_NPX=0"
)

if "%USE_NPX%"=="1" (
    where npx >nul 2>&1
    if errorlevel 1 (
        echo [start-claude] A working Claude Code installation was not found.
        echo Install it with: npm install --global @anthropic-ai/claude-code
        echo Or install Node.js 22+ and rerun this script to use npx without a global install.
        exit /b 1
    )
    echo [start-claude] Installed Claude Code is missing or broken; using the latest package through npx.
)

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri '%ANTHROPIC_BASE_URL%/' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
    echo [start-claude] Starting Copilot API with forced model %CLAUDE_MODEL%...
    start "Copilot API Proxy (:4141)" /D "%~dp0" cmd /k "set COPILOT_API_FORCE_MODEL=%CLAUDE_MODEL%&& call start.bat"
)

echo [start-claude] Waiting for Copilot API...
powershell -NoProfile -Command "for ($i=0; $i -lt 60; $i++) { try { $null = Invoke-WebRequest -Uri '%ANTHROPIC_BASE_URL%/v1/models' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
    echo [start-claude] ERROR: Copilot API did not start within 30 seconds.
    exit /b 1
)

powershell -NoProfile -Command "$models = (Invoke-WebRequest '%ANTHROPIC_BASE_URL%/v1/models' -UseBasicParsing).Content | ConvertFrom-Json; if ($models.data.id -notcontains '%CLAUDE_MODEL%') { Write-Host '[start-claude] ERROR: %CLAUDE_MODEL% is not available for this Copilot account.' -ForegroundColor Red; exit 1 }; exit 0"
if errorlevel 1 exit /b 1

echo [start-claude] Launching Claude Code with %CLAUDE_MODEL%...
if "%USE_NPX%"=="1" (
    call npx --yes --package=@anthropic-ai/claude-code@latest -- claude --model "%CLAUDE_MODEL%" %*
) else (
    call claude --model "%CLAUDE_MODEL%" %*
)
exit /b %errorlevel%
