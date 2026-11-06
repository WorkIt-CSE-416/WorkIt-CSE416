# WorkIt

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CSE 416 Final Project Group

By Xiang, Brian, Andrew, Lisul, Vedant

## Clone

```bash
git clone --recurse-submodules https://github.com/workitjobs/workit.git
```

The Fill engine is a private submodule. You need read access to
`workitjobs/fill-engine`. If you cloned before the rename, read
[docs/whats-new-2026-11-05.md](docs/whats-new-2026-11-05.md).

## Requirements
Frontend:  

Check with `node -v`. If you need to install or switch versions:

- **macOS / Linux:** [nvm](https://github.com/nvm-sh/nvm), then `nvm use` in this folder
- **Windows:** [nvm-windows](https://github.com/coreybutler/nvm-windows) or the [official installer](https://nodejs.org)

Backend: 

**macOS**: 
```bash
brew install uv
``` 
**Windows**: 
```bash
winget install --id=astral-sh.uv -e 
pip install uv
```

Databases: 
```bash
 cd backend/ 
 uv run alembic upgrade head 
```
## Deployment 
```bash 
https://workitjobs.ai/jobs
```

## Local Development 
```bash
cd frontend
npm install
npm run dev
```

```bash 
cd backend
```

```bash
uv sync
uv run uvicorn app.main:app --reload
```

## Cross-platform notes
**Windows only:** if `npm install` fails on long paths inside
`frontend/node_modules`,
enable long path support once:

```powershell
git config --global core.longpaths true
``` 
If `uv` doesn't work, run 
```bash
python -m uv
```

## License

[MIT](LICENSE) — © 2026 Xiang Liu, Brian Cao, Andrew Shi, Lisul Elvitigala,
Vedant Vyas.

You are free to use, modify, and redistribute this code, including
commercially, as long as the copyright notice and license text travel with it.
The software comes with no warranty.
