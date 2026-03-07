@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo =======================================
echo Docker / Container Setup
echo =======================================
echo.

echo [1/2] Checking for Docker installed...
docker --version > nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Docker Desktop is not installed or not running.
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
    echo or via winget: winget install -e --id Docker.DockerDesktop
    echo.
    echo After installation, start Docker Desktop and run this script again.
    pause
    exit /b 1
) else (
    echo Docker is installed and running:
    docker --version
)

echo.
echo [2/2] Setting up containers...
REM Assuming docker-compose is located in the `container` directory relative to this project root.
set COMPOSE_DIR=..\..\..\container

if exist "!COMPOSE_DIR!\docker-compose.yml" (
    echo docker-compose.yml found in !COMPOSE_DIR!
    cd /d "!COMPOSE_DIR!"
    echo Building and starting containers...
    docker-compose up -d --build
    cd /d "%~dp0"
) else (
    echo [WARNING] docker-compose.yml not found at !COMPOSE_DIR!.
    echo Please ensure the container environment is set up manually if needed.
)

echo.
echo =======================================
echo Setup complete!
echo =======================================
pause
