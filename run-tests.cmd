@echo off
setlocal
title YueDu Trainer - Self Test
cd /d "%~dp0"

echo.
echo   ==================================================
echo      YueDu Trainer  -  Running all automated tests
echo   ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

node "%~dp0tools\selfcheck.js"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (echo   All tests passed.) else (echo   Some tests FAILED - see the output above.)
echo.
pause
exit /b %CODE%

:NONODE
echo   [ERROR] Node.js was not found, so the tests cannot run.
echo   Install it from  https://nodejs.org/
echo.
pause
exit /b 1
