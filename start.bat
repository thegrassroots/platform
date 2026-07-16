@echo off
REM ===========================================================================
REM  RBM Monitor - launcher
REM  Serves this folder locally and opens the app in your browser.
REM  (A server avoids file:// quirks; the app itself has no dependencies.)
REM ===========================================================================
setlocal
cd /d "%~dp0"
set PORT=8777
set URL=http://localhost:%PORT%/index.html

REM --- If a server is already listening on the port, just open the browser. ---
netstat -ano | findstr ":%PORT% " | findstr /i LISTENING >nul 2>nul
if %errorlevel%==0 (
    echo RBM Monitor is already running on %URL%
    start "" "%URL%"
    goto :eof
)

echo Starting RBM Monitor on %URL%
echo Close this window to stop the server.
echo.

REM Open the browser once the server has had a moment to come up.
start "" cmd /c "timeout /t 1 >nul & start "" "%URL%""

REM Prefer the Python launcher, then python.
where py     >nul 2>nul && ( py     -m http.server %PORT% & goto :eof )
where python >nul 2>nul && ( python -m http.server %PORT% & goto :eof )

echo.
echo Python was not found on PATH. Opening index.html directly instead.
echo (Some browsers restrict IndexedDB on file:// - install Python for full features.)
start "" "%~dp0index.html"
