# infra/dr/backup.ps1 — Windows-local PostgreSQL backup for CreatorForce dev
#
# Usage (PowerShell):
#   $env:DATABASE_URL = "postgresql://cf:cf@localhost:5434/creatorforce"
#   $env:BACKUP_DIR   = "C:\backups\creatorforce"   # optional; default: .\backups
#   $env:BACKUP_RETENTION_DAYS = "14"               # optional; default: 14
#   .\infra\dr\backup.ps1
#
# Requirements: pg_dump on PATH (installed with PostgreSQL or pgAdmin).
#
# RTO target: 1 hour  |  RPO target: 24 hours (daily backups)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Config with defaults ──────────────────────────────────────────────────────
$BackupDir           = if ($env:BACKUP_DIR)           { $env:BACKUP_DIR }           else { ".\backups" }
$RetentionDays       = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 14 }

# ── Validate required env ─────────────────────────────────────────────────────
if (-not $env:DATABASE_URL) {
    Write-Error "DATABASE_URL is not set."
    exit 1
}

# ── Parse DATABASE_URL ────────────────────────────────────────────────────────
# Format: postgresql://user:pass@host:port/dbname
$url = $env:DATABASE_URL -replace '^postgres(ql)?://', ''
$userInfoAndRest = $url -split '@', 2
if ($userInfoAndRest.Count -ne 2) {
    Write-Error "Cannot parse DATABASE_URL — expected postgresql://user:pass@host:port/dbname"
    exit 1
}
$userInfo   = $userInfoAndRest[0]
$hostAndDb  = $userInfoAndRest[1]

$pgUser     = $userInfo -split ':', 2 | Select-Object -First 1
$pgPassword = $userInfo -split ':', 2 | Select-Object -Last 1

$hostPart   = $hostAndDb -split '/', 2 | Select-Object -First 1
$pgDatabase = ($hostAndDb -split '/', 2 | Select-Object -Last 1) -split '\?' | Select-Object -First 1

if ($hostPart -match ':') {
    $pgHost = $hostPart -split ':', 2 | Select-Object -First 1
    $pgPort = $hostPart -split ':', 2 | Select-Object -Last 1
} else {
    $pgHost = $hostPart
    $pgPort = "5432"
}

# ── Prepare backup directory ──────────────────────────────────────────────────
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

# ── Build timestamped filename ────────────────────────────────────────────────
$timestamp  = Get-Date -Format "yyyy-MM-dd_HHmmss"
$backupFile = Join-Path $BackupDir "creatorforce_$timestamp.dump"

Write-Host "[backup] Starting pg_dump at $timestamp"

# ── Set PGPASSWORD for pg_dump (never printed) ────────────────────────────────
$env:PGPASSWORD = $pgPassword

try {
    & pg_dump `
        --host=$pgHost `
        --port=$pgPort `
        --username=$pgUser `
        --format=custom `
        --compress=9 `
        --no-password `
        --file=$backupFile `
        $pgDatabase

    if ($LASTEXITCODE -ne 0) {
        Write-Error "pg_dump exited with code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} finally {
    # Always clear password from environment
    $env:PGPASSWORD = $null
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$fileSizeKB = [math]::Round((Get-Item $backupFile).Length / 1KB, 1)
Write-Host "[backup] Dump written to $backupFile ($fileSizeKB KB)"

# ── Prune old backups ─────────────────────────────────────────────────────────
Write-Host "[backup] Pruning backups older than $RetentionDays days from $BackupDir"
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "creatorforce_*.dump" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Write-Host "[backup] Deleting old backup: $($_.Name)"
        Remove-Item $_.FullName -Force
    }

Write-Host "[backup] Done."
