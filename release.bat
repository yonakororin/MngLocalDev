@echo off
setlocal

:: Set path to include Node.js
set "PATH=C:\Program Files\nodejs;%PATH%"

cd /d "%~dp0"

echo.
echo ========================================
echo  MngLocalDev Build Script
echo ========================================
echo.

echo [1/3] Checking environment...
call npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: npm not found. Please ensure Node.js is installed.
    pause
    exit /b 1
)

echo [2/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Error: Failed to install dependencies.
    pause
    exit /b 1
)

echo [3/3] Building application...
call npm run build
if %errorlevel% neq 0 (
    echo Error: Build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Build Success!
echo  Installer is located in: release\
echo ========================================
echo.

pause
