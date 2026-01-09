@echo off
echo Deleting Shade config and data...
rmdir /s /q "%APPDATA%\Shade\data" 2>nul
if %errorlevel% equ 0 (
    echo Data folder deleted successfully!
) else (
    echo No data folder found or already deleted.
)
echo.
echo Now restart the app with: npm start
pause
