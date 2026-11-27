# Atelier3D Studio — Serveur de Rendu Photoréaliste (Blender Cycles)

Ce microservice Python (**FastAPI + Blender Cycles Headless**) génère des rendus photo 2K/4K photoréalistes (vrai Path-Tracing, Global Illumination, ombres douces sur toutes les lumières, AgX, OpenImageDenoise + anti-aliasing équivalent **16× MSAA** par supersampling Lanczos + filtre Blackman-Harris).

## 1. Installation sur votre Serveur Maison (Windows / PC Ultra 5 135U)

1. Téléchargez et installez **Blender 4.2 LTS** (gratuit) : https://www.blender.org/download/
2. Installez **Python 3.10+** (avec « Add Python to PATH » coché).
3. Double-cliquez sur **`start_windows.bat`** (ou lancez dans un terminal) :
   ```powershell
   cd backend/render_server
   python -m venv .venv
   .\.venv\Scripts\pip install -r requirements.txt
   .\.venv\Scripts\uvicorn server:app --host 0.0.0.0 --port 8787
   ```
4. Vérifiez dans le navigateur : `http://localhost:8787/api/health` → doit afficher `"blenderFound": true`.

## 2. Accès depuis Téléphone, Tablette & PC (Maison ou Internet)

- **Sur le Wi-Fi de la maison** : utilisez l'IP locale du PC serveur, ex. `http://192.168.1.50:8787`, dans le panneau **« Rendu Pro (Cycles) »** de l'application (ou dans `.env` : `VITE_RENDER_SERVER_URL=http://192.168.1.50:8787`).
- **Depuis l'extérieur (4G/5G / site Vercel en HTTPS)** : utilisez **Cloudflare Tunnel** (gratuit, HTTPS automatique, zéro port à ouvrir sur le routeur) :
  ```powershell
  cloudflared tunnel --url http://localhost:8787
  ```
  Collez l'URL `https://xxxx.trycloudflare.com` (ou votre domaine fixe Cloudflare Tunnel) dans le champ **URL Serveur Cycles** de l'application !

## 3. Modes d'Anti-Aliasing disponibles

| Mode | Samples Cycles | Supersampling | Équivalence Anti-Aliasing |
|---|---|---|---|
| `aa4` (Rapide) | 64 SPP + Blackman-Harris | 1.0× | ~4×–8× MSAA + OIDN |
| `aa16` (Défaut — 16× MSAA) | 128 SPP + Blackman-Harris | 1.5× (downscale Lanczos) | **Équivalent 16× MSAA** sur géométrie, reflets et ombres |
| `aa16_ultra` (Studio Max) | 256 SPP + Blackman-Harris | 2.0× (downscale Lanczos) | **> 16× SSAA/MSAA** (qualité catalogue impression) |

## 4. Déploiement Docker (Linux / VPS / Serveur Maison Docker)

```bash
docker build -t atelier3d-render-server ./backend/render_server
docker run -d --restart unless-stopped -p 8787:8787 atelier3d-render-server
```
