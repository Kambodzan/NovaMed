# NovaMed — zatrzymanie środowiska dev (procesy nasłuchujące na portach projektu).
$ports = @(8000, 8101, 8102, 8103, 8104, 8105, 5174)
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        try {
            Stop-Process -Id $c.OwningProcess -Force -Confirm:$false -ErrorAction Stop
            Write-Host "[STOP] :$port (PID $($c.OwningProcess))" -ForegroundColor Yellow
        } catch { }
    }
}
Write-Host "Gotowe." -ForegroundColor Cyan
