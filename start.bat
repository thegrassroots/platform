@echo off
REM ===========================================================================
REM  RBM Monitor - launcher
REM  Serves this folder locally and opens the app in your browser.
REM  (A server avoids file:// quirks; the app itself has no dependencies.)
REM ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
set PORT=8777

:checkport
set URL=http://localhost:!PORT!/index.html

REM --- Is something already listening on the port? ---
netstat -ano | findstr ":!PORT! " | findstr /i LISTENING >nul 2>nul
if not %errorlevel%==0 goto :serve

REM --- Port is busy. Only reuse it if it really serves this app's index.html
REM     (a leftover server from an old folder location would return 404). ---
set CODE=
where curl >nul 2>nul
if %errorlevel%==0 (
    for /f %%c in ('curl -s -o nul -w "%%{http_code}" "!URL!"') do set CODE=%%c
)
if "!CODE!"=="200" (
    echo RBM Monitor is already running on !URL!
    start "" "!URL!"
    goto :eof
)
echo Port !PORT! is in use by another server - trying the next port.
set /a PORT+=1
goto :checkport

:serve
echo Starting RBM Monitor on !URL!
echo Close this window to stop the server.
echo.

REM Open the browser once the server has had a moment to come up.
start "" cmd /c "timeout /t 1 >nul & start "" "!URL!""

REM Prefer the Python launcher, then python.
where py     >nul 2>nul && ( py     -m http.server !PORT! & goto :eof )
where python >nul 2>nul && ( python -m http.server !PORT! & goto :eof )

echo.
echo Python was not found on PATH. Opening index.html directly instead.
echo (Some browsers restrict IndexedDB on file:// - install Python for full features.)
start "" "%~dp0index.html"
