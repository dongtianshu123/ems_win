param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $appRoot "runtime\node.exe"
$serverScript = Join-Path $appRoot "tools\portable-server.js"
$bridgeScript = Join-Path $appRoot "modbus-bridge.js"
$sourceCheckScript = Join-Path $appRoot "tools\check-websocket-source.js"
$configPath = Join-Path $appRoot "vrfb_modbus_config.json"
$logRoot = Join-Path $appRoot "logs"
$launcherLog = Join-Path $logRoot "live-launcher.log"
$runtimeFile = Join-Path $logRoot "live-runtime.json"
$buildVersion = (Split-Path -Leaf $appRoot) -replace '^ems_win_', ''

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
function Write-LaunchLog([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -LiteralPath $launcherLog -Value $line -Encoding ASCII
    Write-Host $line
}

function Test-PortAvailable([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true }
    catch { return $false }
    finally { $listener.Stop() }
}

function Wait-TcpPort([int]$Port, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $client = [Net.Sockets.TcpClient]::new()
        try { if ($client.ConnectAsync("127.0.0.1", $Port).Wait(300)) { return } }
        catch {}
        finally { $client.Dispose() }
        Start-Sleep -Milliseconds 200
    }
    throw "Port $Port did not start within $TimeoutSeconds seconds."
}

Write-LaunchLog "START build=$buildVersion"
foreach ($required in @($nodePath, $serverScript, $bridgeScript, $sourceCheckScript, $configPath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Portable package is incomplete. Missing: $required" }
}
if (-not (Test-PortAvailable 8082)) { throw "Live data port 8082 is already in use. Stop the old live EMS service first." }

$pagePort = 8090..8099 | Where-Object { Test-PortAvailable $_ } | Select-Object -First 1
if ($null -eq $pagePort) { throw "All page ports 8090..8099 are in use." }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$targets = @($config.devices | Where-Object { $_.enabled })
foreach ($target in $targets) {
    Write-LaunchLog "TARGET id=$($target.id) type=$($target.type) endpoint=$($target.host):$($target.port) unit=$($target.unitId)"
}

$env:EMS_DATA_MODE = "external"
$env:EMS_HTTP_PORT = [string]$pagePort
$env:EMS_BUILD_VERSION = $buildVersion
$pageProcess = Start-Process -FilePath $nodePath -ArgumentList $serverScript -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "page-service.out.log") -RedirectStandardError (Join-Path $logRoot "page-service.err.log") -PassThru

$runtimeUrl = "http://127.0.0.1:$pagePort/api/runtime"
$deadline = [DateTime]::UtcNow.AddSeconds(12)
$runtime = $null
while ([DateTime]::UtcNow -lt $deadline) {
    try {
        $runtime = Invoke-RestMethod -Uri $runtimeUrl -TimeoutSec 2
        if ($runtime.service -eq "VRFB_EMS_SETTINGS_API" -and $runtime.buildVersion -eq $buildVersion) { break }
    } catch {}
    Start-Sleep -Milliseconds 250
}
if ($null -eq $runtime -or $runtime.service -ne "VRFB_EMS_SETTINGS_API" -or $runtime.buildVersion -ne $buildVersion) {
    Stop-Process -Id $pageProcess.Id -Force -ErrorAction SilentlyContinue
    throw "The settings API failed to start or its build version does not match. See logs/page-service.err.log."
}

$env:EMS_APP_ROOT = $appRoot
$env:EMS_WS_PORT = "8082"
$bridgeProcess = Start-Process -FilePath $nodePath -ArgumentList $bridgeScript -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "modbus-bridge.out.log") -RedirectStandardError (Join-Path $logRoot "modbus-bridge.err.log") -PassThru
Wait-TcpPort 8082 12
& $nodePath $sourceCheckScript "ws://127.0.0.1:8082" "live" "12000"
if ($LASTEXITCODE -ne 0) {
    Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pageProcess.Id -Force -ErrorAction SilentlyContinue
    throw "Port 8082 is not serving live data. See logs/modbus-bridge.err.log."
}

$runtimeInfo = [ordered]@{
    buildVersion = $buildVersion
    startedAt = (Get-Date).ToString("s")
    pagePort = [int]$pagePort
    dataPort = 8082
    pagePid = $pageProcess.Id
    bridgePid = $bridgeProcess.Id
    targets = @($targets | ForEach-Object { [ordered]@{ id=$_.id; type=$_.type; host=$_.host; port=$_.port; unitId=$_.unitId } })
}
$runtimeInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $runtimeFile -Encoding ASCII
Write-LaunchLog "READY page=$pagePort data=8082 pagePid=$($pageProcess.Id) bridgePid=$($bridgeProcess.Id)"
$previewUrl = "http://127.0.0.1:$pagePort/vrb_scada_premium.html?ws=ws://127.0.0.1:8082&source=live"
if (-not $NoBrowser) { Start-Process $previewUrl }
