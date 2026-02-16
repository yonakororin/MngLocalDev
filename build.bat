@echo off
cd /d "%~dp0"

echo.
echo ========================================
echo  MngLocalDev Build Launcher
echo ========================================
echo.

:: Check for Administrative privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running with Administrator privileges.
    call "%~dp0release.bat"
) else (
    echo [Request] Need Administrator privileges to create symlinks.
    echo Requesting elevation...
    powershell -Command "Start-Process -FilePath '%comspec%' -ArgumentList '/c pushd %~dp0 && call release.bat' -Verb RunAs"
)
