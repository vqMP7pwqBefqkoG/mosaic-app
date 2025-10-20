@echo off
echo "Mosaic App - Environment Setup & Run"
echo --------------------------------------

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH.
    echo Please install Python 3 and try again.
    pause
    exit /b
)

REM Create venv if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment 'venv'...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo Error: Failed to create virtual environment.
        pause
        exit /b
    )
)

echo Installing required libraries into virtual environment...
venv\Scripts\python.exe -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo Error: Failed to install required libraries.
    pause
    exit /b
)

echo Starting the application...
echo You can close this window to stop the server.
venv\Scripts\python.exe app.py

pause
