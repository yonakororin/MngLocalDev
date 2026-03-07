@echo off
setlocal

echo ==========================================
echo   mnglocaldev Build Script
echo ==========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking npm dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)
echo.

echo [2/3] Building Tauri release...
call npm run tauri build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo.

echo [3/3] Copying build output...
set "OUT_DIR=%~dp0dist-release"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
copy /y "src-tauri\target\release\mnglocaldev-tauri.exe" "%OUT_DIR%\mnglocaldev.exe" >nul
echo.

echo ==========================================
echo   Build complete!
echo   Output: %OUT_DIR%\mnglocaldev.exe
echo ==========================================
echo.
pause
