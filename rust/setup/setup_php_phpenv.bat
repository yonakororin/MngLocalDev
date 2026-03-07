@echo off
REM PHP / phpenv Setup for WSL2
REM This batch file launches the PowerShell setup script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_php_phpenv.ps1"
