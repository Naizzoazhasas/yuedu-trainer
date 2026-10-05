@echo off
setlocal
title YueDu Trainer - Offline
cd /d "%~dp0"

set "APP=%~dp0index.html"
if exist "%~dp0dist\yuedu-trainer.html" set "APP=%~dp0dist\yuedu-trainer.html"

if not exist "%APP%" goto NOFILE

echo.
echo   Opening YueDu Trainer in your default browser...
echo   File: %APP%
echo.
echo   This offline mode does not need Node.js and does not
echo   need the internet.  Please note: the TUNER cannot use
echo   your microphone here, because browsers only allow the
echo   microphone on https:// or http://127.0.0.1 pages.
echo.
echo   For the tuner, use the shortcut "Local Server" instead.
echo.

start "" "%APP%"
exit /b 0

:NOFILE
echo.
echo   [ERROR] index.html was not found next to this script.
echo   The project folder may have been moved or renamed.
echo.
pause
exit /b 1
