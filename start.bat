@echo off
title MYOPC
cd /d "%~dp0"

echo Starting MYOPC. Please wait...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -OpenBrowser

if errorlevel 1 (
    echo.
    echo MYOPC failed to start. See the error above.
    pause
)
