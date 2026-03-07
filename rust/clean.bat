@echo off
setlocal

echo ==========================================
echo   mnglocaldev Clean Script
echo ==========================================
echo.

cd /d "%~dp0"

echo Cleaning build artifacts...
echo.

echo [1/3] Removing Rust target directory...
if exist "src-tauri\target" (
    rmdir /s /q "src-tauri\target"
    echo       Removed src-tauri\target
) else (
    echo       Already clean
)
echo.

echo [2/3] Removing frontend dist...
if exist "dist" (
    rmdir /s /q "dist"
    echo       Removed dist
) else (
    echo       Already clean
)
echo.

echo [3/3] Removing release output...
if exist "dist-release" (
    rmdir /s /q "dist-release"
    echo       Removed dist-release
) else (
    echo       Already clean
)
echo.

echo ==========================================
echo   Clean complete!
echo ==========================================
echo.
pause
