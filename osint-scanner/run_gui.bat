@echo off
REM One-click launcher for Windows: creates .venv, installs deps, opens the GUI.
cd /d "%~dp0"
if not exist ".venv\Scripts\activate.bat" (
  echo Creating virtual environment...
  py -m venv .venv || goto :error
)
call ".venv\Scripts\activate.bat"
echo Installing requirements...
pip install -q -r requirements.txt || goto :error
python gui_app.py
if errorlevel 1 goto :error
goto :eof
:error
echo.
echo Something went wrong. See the message above.
pause
