$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $appRoot "runtime\node.exe"
$serverScript = Join-Path $appRoot "tools\portable-server.js"
$bridgeScript = Join-Path $appRoot "modbus-bridge.js"
$sourceCheckScript = Join-Path $appRoot "tools\check-websocket-source.js"
$logRoot = Join-Path $appRoot "logs"
$buildVersion = (Split-Path -Leaf $appRoot) -replace '^ems_win_', ''

function Test-PortAvailable([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        $listener.Stop()
    }
}

function Wait-TcpPort([int]$Port, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $client = [Net.Sockets.TcpClient]::new()
        try {
            if ($client.ConnectAsync("127.0.0.1", $Port).Wait(300)) { return }
        }
        catch {}
        finally { $client.Dispose() }
        Start-Sleep -Milliseconds 200
    }
    throw "端口 $Port 未能在 $TimeoutSeconds 秒内启动。"
}

if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $serverScript) -or -not (Test-Path -LiteralPath $bridgeScript) -or -not (Test-Path -LiteralPath $sourceCheckScript)) {
    throw "便携包不完整：缺少runtime、页面服务或Modbus桥接程序。请复制整个ems_win文件夹。"
}
if (-not (Test-PortAvailable 8082)) {
    throw "真实数据端口8082已被占用。为避免误用其他EMS版本，请先关闭旧版本真实通讯服务后重试。"
}

# 8090..8099：始终选择空闲页面端口，不复用其他EMS版本的静态页面。
$pagePort = 8090..8099 | Where-Object { Test-PortAvailable $_ } | Select-Object -First 1
if ($null -eq $pagePort) { throw "页面端口8090～8099均被占用，无法启动本版本EMS。" }

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
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
    }
    catch {}
    Start-Sleep -Milliseconds 250
}
if ($null -eq $runtime -or $runtime.service -ne "VRFB_EMS_SETTINGS_API" -or $runtime.buildVersion -ne $buildVersion) {
    Stop-Process -Id $pageProcess.Id -Force -ErrorAction SilentlyContinue
    throw "本版本参数设置API启动失败或版本不匹配，请查看logs\page-service.err.log。"
}

$env:EMS_APP_ROOT = $appRoot
$env:EMS_WS_PORT = "8082"
$bridgeProcess = Start-Process -FilePath $nodePath -ArgumentList $bridgeScript -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "modbus-bridge.out.log") -RedirectStandardError (Join-Path $logRoot "modbus-bridge.err.log") -PassThru
Wait-TcpPort 8082 12
& $nodePath $sourceCheckScript "ws://127.0.0.1:8082" "live" "12000"
if ($LASTEXITCODE -ne 0) {
    Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $pageProcess.Id -Force -ErrorAction SilentlyContinue
    throw "8082未提供真实live数据，启动已中止。请关闭旧模拟服务并查看modbus-bridge日志。"
}

$previewUrl = "http://127.0.0.1:$pagePort/vrb_scada_premium.html?ws=ws://127.0.0.1:8082&source=live"
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') build=$buildVersion page=$pagePort data=8082" | Set-Content -LiteralPath (Join-Path $logRoot "本次启动信息.txt") -Encoding UTF8
Start-Process $previewUrl
