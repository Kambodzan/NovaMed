# Kopia zapasowa bazy NovaMed (NFR M10 - backup).
# pg_dump w formacie custom (-Fc): skompresowany, pozwala na selektywny restore.
# Nazwa ze znacznikiem czasu; retencja - trzyma ostatnie N kopii.
#
# Uzycie:
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
#   ... -BackupDir D:\backups -KeepLast 30
[CmdletBinding()]
param(
    [string]$BackupDir = "$PSScriptRoot\..\backups",
    [int]$KeepLast = 14
)
$ErrorActionPreference = "Stop"

# --- polaczenie z backend/.env (DATABASE_URL) albo domyslne dev ---
$envFile = Join-Path $PSScriptRoot "..\backend\.env"
$dbUrl = $null
if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
    if ($line) { $dbUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim() }
}
if (-not $dbUrl) { $dbUrl = "***REMOVED***_dev" }

# postgresql+psycopg://user:pass@host:port/dbname
if ($dbUrl -notmatch '://(?<user>[^:]+):(?<pass>[^@]*)@(?<host>[^:/]+):(?<port>\d+)/(?<db>[^?]+)') {
    throw "Nie udalo sie sparsowac DATABASE_URL."
}
$user = $Matches.user; $pass = $Matches.pass; $dbHost = $Matches.host; $port = $Matches.port; $db = $Matches.db

# --- pg_dump ---
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) { $pgDump = "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" }
if (-not (Test-Path $pgDump)) { throw "Nie znaleziono pg_dump (ustaw PATH lub PostgreSQL\16\bin)." }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $BackupDir "novamed_${db}_$stamp.dump"

$env:PGPASSWORD = $pass
Write-Host "Backup $db -> $outFile ..."
& $pgDump --host=$dbHost --port=$port --username=$user --format=custom --compress=9 --file=$outFile $db
if ($LASTEXITCODE -ne 0) { throw "pg_dump zwrocil kod $LASTEXITCODE." }
$sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "OK: $outFile ($sizeMB MB)"

# --- retencja: usun najstarsze ponad KeepLast ---
$dumps = Get-ChildItem -Path $BackupDir -Filter "novamed_*.dump" | Sort-Object LastWriteTime -Descending
if ($dumps.Count -gt $KeepLast) {
    $dumps | Select-Object -Skip $KeepLast | ForEach-Object {
        Write-Host "Retencja: usuwam $($_.Name)"
        Remove-Item $_.FullName -Force
    }
}
Write-Host "Gotowe. Kopii w $BackupDir : $([math]::Min($dumps.Count, $KeepLast))"
