@echo off
setlocal enabledelayedexpansion
title AI CreatorForce
color 0D

echo.
echo  ========================================
echo   AI CreatorForce - Starting up...
echo  ========================================
echo.

REM ── Kill any previously launched servers (via saved PIDs) ─────────────────
if exist "D:\project\creatorforce-ai\logs\api.pid" (
  set /p OLDPID=<"D:\project\creatorforce-ai\logs\api.pid"
  taskkill /F /PID !OLDPID! >nul 2>&1
  del "D:\project\creatorforce-ai\logs\api.pid" >nul 2>&1
)
if exist "D:\project\creatorforce-ai\logs\web.pid" (
  set /p OLDPID=<"D:\project\creatorforce-ai\logs\web.pid"
  taskkill /F /PID !OLDPID! >nul 2>&1
  del "D:\project\creatorforce-ai\logs\web.pid" >nul 2>&1
)
REM Also clear by port as a fallback
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3007 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4007 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo  [1/6] Ports cleared.

REM ── Load .env ─────────────────────────────────────────────────────────────
echo  [2/6] Loading environment...
if not exist "D:\project\creatorforce-ai\.env" (
  echo  ERROR: .env not found.
  pause & exit /b 1
)
for /f "usebackq tokens=1,2 delims==" %%A in ("D:\project\creatorforce-ai\.env") do (
  set "line=%%A"
  if not "!line:~0,1!"=="#" if not "!line!"=="" set "%%A=%%B"
)

REM Sync .env.local and ONLY clear .next cache if NEXT_PUBLIC_ vars changed
set "ENVLOCAL=D:\project\creatorforce-ai\apps\web\.env.local"
set "ENVLOCAL_TMP=D:\project\creatorforce-ai\apps\web\.env.local.tmp"
powershell -Command "$root=Get-Content 'D:\project\creatorforce-ai\.env' -Raw;$api=[regex]::Match($root,'NEXT_PUBLIC_API_URL=([^\r\n]+)').Groups[1].Value.Trim();$ws=[regex]::Match($root,'NEXT_PUBLIC_WS_URL=([^\r\n]+)').Groups[1].Value.Trim();$mock=[regex]::Match($root,'NEXT_PUBLIC_USE_MOCK=([^\r\n]+)').Groups[1].Value.Trim();$nl=[char]10;\"NEXT_PUBLIC_API_URL=$api$nl NEXT_PUBLIC_WS_URL=$ws$nl NEXT_PUBLIC_USE_MOCK=$mock$nl\".Replace(' ','')|Set-Content '%ENVLOCAL_TMP%' -NoNewline -Encoding UTF8" >nul 2>&1
fc /b "%ENVLOCAL%" "%ENVLOCAL_TMP%" >nul 2>&1
if %errorlevel% neq 0 (
  copy /y "%ENVLOCAL_TMP%" "%ENVLOCAL%" >nul 2>&1
  if exist "D:\project\creatorforce-ai\apps\web\.next" (
    rmdir /s /q "D:\project\creatorforce-ai\apps\web\.next" >nul 2>&1
    echo       NEXT_PUBLIC_ vars changed - cache cleared.
  )
) else (
  echo       Env vars unchanged - keeping Next.js cache.
)
del "%ENVLOCAL_TMP%" >nul 2>&1

REM ── Check PostgreSQL ──────────────────────────────────────────────────────
echo  [3/6] Checking PostgreSQL and Redis...
powershell -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',5432);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% neq 0 (
  echo  WARNING: PostgreSQL not on 5432. Start: net start postgresql-x64-16
) else (
  echo       PostgreSQL ready.
)

REM ── Start Redis Windows service (required for agent queues) ─────────────
powershell -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',6379);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% neq 0 (
  echo  Redis not running. Starting Redis service...
  net start Redis >nul 2>&1
  if %errorlevel% neq 0 (
    echo  WARNING: Could not start Redis service. Agents will not work.
    echo           Install Redis: winget install Redis.Redis
  ) else (
    echo       Redis service started.
  )
) else (
  echo       Redis ready.
)

REM ── Install deps only if node_modules is missing ──────────────────────────
echo  [4/6] Checking dependencies...
if not exist "D:\project\creatorforce-ai\node_modules\.pnpm" (
  echo       Installing dependencies...
  cd /d "D:\project\creatorforce-ai"
  call pnpm install --prefer-offline >nul 2>&1
  if %errorlevel% neq 0 call pnpm install
) else (
  echo       Dependencies OK.
)

REM ── Prisma: generate only if schema changed, migrate always ───────────────
echo  [5/6] Checking Prisma...
set "SCHEMA=D:\project\creatorforce-ai\apps\api\prisma\schema.prisma"
set "CLIENT=D:\project\creatorforce-ai\apps\api\node_modules\.prisma\client\index.js"
set PRISMA_GEN=0
if not exist "%CLIENT%" set PRISMA_GEN=1
if !PRISMA_GEN!==0 (
  powershell -Command "$s=(Get-Item '%SCHEMA%').LastWriteTime;$c=(Get-Item '%CLIENT%').LastWriteTime;if($s -gt $c){exit 1}else{exit 0}" >nul 2>&1
  if %errorlevel%==1 set PRISMA_GEN=1
)
if !PRISMA_GEN!==1 (
  echo       Regenerating Prisma client...
  cd /d "D:\project\creatorforce-ai\apps\api"
  call node_modules\.bin\prisma generate >nul 2>&1
  cd /d "D:\project\creatorforce-ai"
) else (
  echo       Prisma client up to date.
)
cd /d "D:\project\creatorforce-ai\apps\api"
call node_modules\.bin\prisma migrate deploy >nul 2>&1
cd /d "D:\project\creatorforce-ai"
echo       Migrations applied.

REM ── Build shared package if source is newer than dist ────────────────────
set SHARED_SRC=D:\project\creatorforce-ai\packages\shared\src
set SHARED_DIST=D:\project\creatorforce-ai\packages\shared\dist\ai\index.js
set NEEDS_SHARED_BUILD=0
if not exist "%SHARED_DIST%" set NEEDS_SHARED_BUILD=1
if !NEEDS_SHARED_BUILD!==0 (
  powershell -Command "$d=(Get-Item '%SHARED_DIST%').LastWriteTime;$s=(Get-ChildItem '%SHARED_SRC%' -Recurse -Include '*.ts'|Sort-Object LastWriteTime -Descending|Select-Object -First 1).LastWriteTime;if($s -gt $d){exit 1}else{exit 0}" >nul 2>&1
  if %errorlevel%==1 set NEEDS_SHARED_BUILD=1
)
if !NEEDS_SHARED_BUILD!==1 (
  echo       Building shared package...
  cd /d "D:\project\creatorforce-ai\packages\shared"
  call node_modules\.bin\tsc -p tsconfig.json >nul 2>&1
  cd /d "D:\project\creatorforce-ai"
)

REM ── Build API only if source is newer than dist ───────────────────────────
echo  [6/6] Checking API build...
set NEEDS_BUILD=0
if not exist "D:\project\creatorforce-ai\apps\api\dist\main.js" set NEEDS_BUILD=1
if !NEEDS_BUILD!==0 (
  powershell -Command "$d=(Get-Item 'D:\project\creatorforce-ai\apps\api\dist\main.js').LastWriteTime;$s=(Get-ChildItem 'D:\project\creatorforce-ai\apps\api\src' -Recurse -Include '*.ts'|Sort-Object LastWriteTime -Descending|Select-Object -First 1).LastWriteTime;if($s -gt $d){exit 1}else{exit 0}" >nul 2>&1
  if %errorlevel%==1 set NEEDS_BUILD=1
)
if !NEEDS_BUILD!==0 if !NEEDS_SHARED_BUILD!==1 set NEEDS_BUILD=1
if !NEEDS_BUILD!==1 (
  echo       Building API...
  cd /d "D:\project\creatorforce-ai\apps\api"
  call node_modules\.bin\nest build
  cd /d "D:\project\creatorforce-ai"
) else (
  echo       API build fresh.
)

REM ── Prepare logs ──────────────────────────────────────────────────────────
if not exist "D:\project\creatorforce-ai\logs" mkdir "D:\project\creatorforce-ai\logs"
type nul > "D:\project\creatorforce-ai\logs\api.log"
type nul > "D:\project\creatorforce-ai\logs\web.log"

REM ── Launch servers as detached hidden processes (survive bat window close) ─
echo.
echo  Launching servers...

powershell -Command "$p=Start-Process 'node' -ArgumentList 'dist/main.js' -WorkingDirectory 'D:\project\creatorforce-ai\apps\api' -RedirectStandardOutput 'D:\project\creatorforce-ai\logs\api.log' -RedirectStandardError 'D:\project\creatorforce-ai\logs\api-err.log' -WindowStyle Hidden -PassThru; $p.Id | Out-File 'D:\project\creatorforce-ai\logs\api.pid' -Encoding ascii -NoNewline"

powershell -Command "$p=Start-Process 'node' -ArgumentList 'node_modules\next\dist\bin\next','dev','-p','3007' -WorkingDirectory 'D:\project\creatorforce-ai\apps\web' -RedirectStandardOutput 'D:\project\creatorforce-ai\logs\web.log' -RedirectStandardError 'D:\project\creatorforce-ai\logs\web-err.log' -WindowStyle Hidden -PassThru; $p.Id | Out-File 'D:\project\creatorforce-ai\logs\web.pid' -Encoding ascii -NoNewline"

echo  API  started  (logs\api.log)
echo  Web  started  (logs\web.log)

REM ── Wait for web server using curl ────────────────────────────────────────
echo  Waiting for web server...
set /a attempts=0
:wait_loop
set /a attempts+=1
curl -s -o nul -w "%%{http_code}" http://localhost:3007 2>nul | findstr /r "^[23]" >nul 2>&1
if %errorlevel%==0 goto app_ready
if %attempts% geq 45 goto open_browser
timeout /t 2 /nobreak >nul
goto wait_loop

:app_ready
echo  Web server ready!

:open_browser
start "" "http://localhost:3007"

echo.
echo  ============================================================
echo   AI CreatorForce is running!
echo.
echo   Web  ->  http://localhost:3007
echo   API  ->  http://localhost:4007/api/v1
echo   Docs ->  http://localhost:4007/api/docs
echo   Logs ->  logs\api.log  ^|  logs\web.log
echo.
echo   Press any key to STOP all servers and exit.
echo  ============================================================
echo.
pause >nul

REM ── Stop servers on exit (use saved PIDs) ────────────────────────────────
echo  Stopping servers...
if exist "D:\project\creatorforce-ai\logs\api.pid" (
  set /p APIPID=<"D:\project\creatorforce-ai\logs\api.pid"
  taskkill /F /PID !APIPID! >nul 2>&1
  del "D:\project\creatorforce-ai\logs\api.pid" >nul 2>&1
)
if exist "D:\project\creatorforce-ai\logs\web.pid" (
  set /p WEBPID=<"D:\project\creatorforce-ai\logs\web.pid"
  taskkill /F /PID !WEBPID! >nul 2>&1
  del "D:\project\creatorforce-ai\logs\web.pid" >nul 2>&1
)
REM Kill any remaining node on those ports
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3007 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4007 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo  Stopped. Goodbye!
timeout /t 1 /nobreak >nul
endlocal
