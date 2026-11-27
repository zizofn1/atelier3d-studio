@echo off
cd /d "%~dp0"
if not exist ".venv" (
  echo Creation de l'environnement Python...
  python -m venv .venv
  .venv\Scripts\pip install -r requirements.txt
)
echo Demarrage du serveur de rendu photoréaliste Atelier3D (Blender Cycles) sur le port 8787...
.venv\Scripts\uvicorn server:app --host 0.0.0.0 --port 8787
pause
