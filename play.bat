@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Slither.io Local Server
cd /d "%~dp0"

set "PORT=5173"
set "URL=http://localhost:%PORT%"

echo ========================================================
echo   Slither.io - Neon Arena Launcher
echo ========================================================
echo.

:: 1. Verify Node.js and npm are installed
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    echo Please reinstall Node.js from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

:: 2. Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install npm dependencies.
        pause
        exit /b 1
    )
    echo.
)

:: 3. Locate Google Chrome (falls back to default browser if not found)
set "CHROME_EXE="
for /f "delims=" %%I in ('where chrome 2^>nul') do (
    if not defined CHROME_EXE set "CHROME_EXE=%%I"
)
if not defined CHROME_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

:: 4. Start lightweight background readiness waiter that opens Chrome once server responds
echo [INFO] Starting local server and waiting for %URL% ...
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$url = $env:URL; $chrome = $env:CHROME_EXE; $ready = $false; for ($i = 0; $i -lt 120; $i++) { try { $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 } }; if ($ready) { if ($chrome -and (Test-Path $chrome)) { Start-Process -FilePath $chrome -ArgumentList $url } else { Start-Process $url } }"

echo.
echo Server running at %URL% - Keep this window open while playing. Press Ctrl+C to stop.
echo.

:: 5. Keep Vite server running in foreground so closing this window stops it cleanly
call npx vite --port %PORT%
if errorlevel 1 (
    echo.
    echo [ERROR] Vite server exited with an error.
    pause
    exit /b 1
)

endlocal
