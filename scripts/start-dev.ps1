# NovaMed — start całego środowiska dev jedną komendą.
# Użycie:  powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
# Stawia: 5 mock-serwisów (8101-8105), backend API (8000), frontend (5174).
# Procesy startują jako osobne, zminimalizowane okna — przeżyją zamknięcie terminala.
# Zatrzymanie: scripts\stop-dev.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

function Test-Port([int]$port) {
    # nasłuch może być na IPv4 (uvicorn) albo IPv6 ::1 (vite) — sprawdzamy tabelę połączeń
    return ($null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue))
}

function Start-Uvicorn([string]$workdir, [string]$appmodule, [int]$port, [string]$name) {
    if (Test-Port $port) {
        Write-Host "  [OK] $name już działa (:$port)" -ForegroundColor DarkGray
        return
    }
    Start-Process -WindowStyle Minimized -WorkingDirectory $workdir $py `
        -ArgumentList "-m", "uvicorn", $appmodule, "--port", $port
    Write-Host "  [START] $name (:$port)" -ForegroundColor Green
}

Write-Host "NovaMed — start środowiska dev" -ForegroundColor Cyan

if (-not (Test-Path $py)) {
    Write-Host "Brak venv backendu ($py). Najpierw: cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt" -ForegroundColor Red
    exit 1
}

# usługa PostgreSQL (lokalna)
$pg = Get-Service postgresql-x64-16 -ErrorAction SilentlyContinue
if ($pg -and $pg.Status -ne "Running") {
    Write-Host "  [UWAGA] PostgreSQL nie działa — uruchom usługę postgresql-x64-16" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] PostgreSQL działa" -ForegroundColor DarkGray
}

Write-Host "Mock-serwisy:" -ForegroundColor Cyan
Start-Uvicorn (Join-Path $root "mocks\p1")       "main:app" 8101 "mock P1"
Start-Uvicorn (Join-Path $root "mocks\zus")      "main:app" 8102 "mock ZUS e-ZLA"
Start-Uvicorn (Join-Path $root "mocks\ewus")     "main:app" 8103 "mock eWUŚ"
Start-Uvicorn (Join-Path $root "mocks\lab")      "main:app" 8104 "mock laboratorium"
Start-Uvicorn (Join-Path $root "mocks\payments") "main:app" 8105 "mock płatności"
Start-Uvicorn (Join-Path $root "mocks\sms")      "main:app" 8106 "mock SMS"

Write-Host "Backend API:" -ForegroundColor Cyan
# --host 0.0.0.0: dostęp także z innych urządzeń w sieci lokalnej.
# HTTPS gdy są certy dev (scripts\make-cert.py) — wymagane przez kamerę w LAN.
$certFile = Join-Path $root "certs\dev-cert.pem"
$keyFile = Join-Path $root "certs\dev-key.pem"
$useTls = (Test-Path $certFile) -and (Test-Path $keyFile)
if (Test-Port 8000) {
    Write-Host "  [OK] NovaMed API już działa (:8000)" -ForegroundColor DarkGray
} else {
    $uvArgs = @("-m", "uvicorn", "app.main:app", "--port", "8000", "--host", "0.0.0.0")
    if ($useTls) { $uvArgs += @("--ssl-certfile", $certFile, "--ssl-keyfile", $keyFile) }
    Start-Process -WindowStyle Minimized -WorkingDirectory (Join-Path $root "backend") $py -ArgumentList $uvArgs
    $proto = "http"; if ($useTls) { $proto = "https" }
    Write-Host "  [START] NovaMed API ($proto`://:8000)" -ForegroundColor Green
}

Write-Host "Seed danych demo (idempotentny):" -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
& $py -m app.seed_dev
Pop-Location

Write-Host "Frontend:" -ForegroundColor Cyan
if (Test-Port 5174) {
    Write-Host "  [OK] frontend już działa (:5174)" -ForegroundColor DarkGray
} else {
    Start-Process -WindowStyle Minimized -WorkingDirectory (Join-Path $root "frontend") `
        "cmd.exe" -ArgumentList "/c", "npm run dev"
    Write-Host "  [START] frontend (:5174)" -ForegroundColor Green
}

Start-Sleep -Seconds 5
Write-Host ""
Write-Host "Status:" -ForegroundColor Cyan
foreach ($svc in @(
    @(8101, "mock P1"), @(8102, "mock ZUS"), @(8103, "mock eWUS"),
    @(8104, "mock lab"), @(8105, "mock platnosci"), @(8106, "mock SMS"), @(8000, "backend API"), @(5174, "frontend")
)) {
    $ok = Test-Port $svc[0]
    if ($ok) {
        Write-Host "  [OK]   $($svc[1]) - :$($svc[0])" -ForegroundColor Green
    } else {
        Write-Host "  [BRAK] $($svc[1]) - :$($svc[0])" -ForegroundColor Red
    }
}
Write-Host ""
if ($useTls) {
    Write-Host "Aplikacja: https://localhost:5174   (API: https://localhost:8000/docs)" -ForegroundColor Cyan
    Write-Host "Z innego urzadzenia: zaakceptuj certyfikat dla OBU adresow (:5174 i :8000)." -ForegroundColor Yellow
} else {
    Write-Host "Aplikacja: http://localhost:5174   (API: http://localhost:8000/docs)" -ForegroundColor Cyan
}
