# Odtworzenie bazy NovaMed z kopii (NFR — restore / runbook DR).
# Domyslnie odtwarza do OSOBNEJ bazy testowej (bezpieczne sprawdzenie kopii).
# Nadpisanie bazy produkcyjnej wymaga jawnego -Force.
#
# Uzycie:
#   powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1                 # ostatnia kopia -> baza testowa
#   ... -DumpFile backups\novamed_..dump -TargetDb novamed_restore_test
#   ... -TargetDb novamed_dev -Force                                                # NADPISZ wskazana baze
[CmdletBinding()]
param(
    [string]$DumpFile,
    [string]$BackupDir = "$PSScriptRoot\..\backups",
    [string]$TargetDb = "novamed_restore_test",
    [switch]$Force
)
$ErrorActionPreference = "Stop"

# --- polaczenie z backend/.env ---
$envFile = Join-Path $PSScriptRoot "..\backend\.env"
$dbUrl = $null
if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
    if ($line) { $dbUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim() }
}
if (-not $dbUrl) { $dbUrl = "postgresql+psycopg://novamed:novamed@localhost:5432/novamed_dev" }
if ($dbUrl -notmatch '://(?<user>[^:]+):(?<pass>[^@]*)@(?<host>[^:/]+):(?<port>\d+)/(?<db>[^?]+)') {
    throw "Nie udalo sie sparsowac DATABASE_URL."
}
$user = $Matches.user; $pass = $Matches.pass; $dbHost = $Matches.host; $port = $Matches.port; $sourceDb = $Matches.db
$env:PGPASSWORD = $pass

# --- narzedzia ---
$bin = "C:\Program Files\PostgreSQL\16\bin"
function Tool($n) { $c = (Get-Command $n -ErrorAction SilentlyContinue).Source; if ($c) { $c } else { Join-Path $bin "$n.exe" } }
$pgRestore = Tool pg_restore; $psql = Tool psql

# --- wybor kopii (wskazana albo najnowsza) ---
if (-not $DumpFile) {
    $latest = Get-ChildItem -Path $BackupDir -Filter "novamed_*.dump" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "Brak kopii w $BackupDir - najpierw uruchom backup-db.ps1." }
    $DumpFile = $latest.FullName
}
if (-not (Test-Path $DumpFile)) { throw "Nie znaleziono pliku kopii: $DumpFile" }

# --- bezpiecznik: nadpisanie bazy zrodlowej tylko z -Force ---
if ($TargetDb -eq $sourceDb -and -not $Force) {
    throw "Odtworzenie do bazy zrodlowej '$sourceDb' nadpisze dane. Dodaj -Force albo wskaz -TargetDb."
}

Write-Host "Kopia:  $DumpFile"
Write-Host "Cel:    $TargetDb (host $dbHost`:$port)"

# --- utworz baze docelowa jesli nie istnieje (restore do testowej) ---
$exists = & $psql --host=$dbHost --port=$port --username=$user --dbname=postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TargetDb'"
if (-not $exists) {
    Write-Host "Tworze baze $TargetDb ..."
    & $psql --host=$dbHost --port=$port --username=$user --dbname=postgres -c "CREATE DATABASE $TargetDb" | Out-Null
}

# --- restore (--clean --if-exists: czysci obiekty przed odtworzeniem) ---
& $pgRestore --host=$dbHost --port=$port --username=$user --dbname=$TargetDb --clean --if-exists --no-owner --no-privileges $DumpFile
# pg_restore zwraca !=0 takze przy nieszkodliwych ostrzezeniach (np. brak obiektu do DROP),
# wiec zamiast kodu wyjscia weryfikujemy REALNY efekt: liczbe tabel w bazie docelowej.
$tableCount = (& $psql --host=$dbHost --port=$port --username=$user --dbname=$TargetDb -tAc `
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Trim()
if ([int]$tableCount -lt 1) { throw "Restore nieudany - baza '$TargetDb' nie ma tabel." }
Write-Host "OK: odtworzono do '$TargetDb' ($tableCount tabel)."
