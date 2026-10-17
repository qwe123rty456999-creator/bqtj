# Compare real-world speed: bqtj.top (Tencent EdgeOne) vs bqtj.pages.dev (Cloudflare direct).
# Usage (turn OFF any proxy / VPN first):
#   powershell -ExecutionPolicy Bypass -File tools\speed-check.ps1
#   powershell -ExecutionPolicy Bypass -File tools\speed-check.ps1 -N 10
#
# What it reports:
#   1. DNS: which EdgeOne edge IP you get (geo-locate it separately - HK is good, SG is a long haul)
#   2. TTFB (time to first byte) median for HTML on both domains
#   3. Cache status of a static asset (should be HIT on bqtj.top after the first hit)
#
# NOTE: results only mean something on a Chinese mainland network. If curl egresses
# through a VPN, both numbers are meaningless.

param([int]$N = 5)

function Get-Median($arr) {
  $s = @($arr | Sort-Object)
  $n = $s.Count
  if ($n -eq 0) { return 0 }
  if ($n % 2 -eq 1) { return $s[[int](($n - 1) / 2)] }
  return ($s[$n / 2 - 1] + $s[$n / 2]) / 2
}

function Get-Min($arr) {
  if (@($arr).Count -eq 0) { return 0 }
  return ($arr | Measure-Object -Minimum).Minimum
}

function Get-Max($arr) {
  if (@($arr).Count -eq 0) { return 0 }
  return ($arr | Measure-Object -Maximum).Maximum
}

function Get-Ms($seconds) {
  return [int]([math]::Round($seconds * 1000))
}

# DNS  = time_namelookup    解析域名（含 CNAME 链，最容易被忽略的一段）
# TCP  = connect - namelookup  纯握手 ≈ 1 RTT -> 判断边缘节点远近
# TLS  = appconnect - connect  握手
# TTFB = starttransfer        首字节（MISS 时还含跨境回源）
function Probe([string]$url, [string]$label) {
  $dns = @(); $tcp = @(); $tls = @(); $ttfb = @(); $code = ''; $ip = ''
  for ($i = 0; $i -lt $N; $i++) {
    $out = & curl.exe --noproxy '*' -s -o NUL -m 25 -w '%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{remote_ip}' $url
    $p = $out -split ' '
    if ($p.Count -ge 6) {
      $code = $p[0]
      $nl = [double]$p[1]; $cn = [double]$p[2]; $ap = [double]$p[3]; $st = [double]$p[4]
      $dns += $nl
      $tcp += ($cn - $nl)
      $tls += ($ap - $cn)
      $ttfb += $st
      $ip = $p[5]
    }
  }
  [pscustomobject]@{
    Target = $label
    Code = $code
    EdgeIP = $ip
    'DNS min/med' = ((Get-Ms (Get-Min $dns)).ToString() + ' / ' + (Get-Ms (Get-Median $dns)).ToString())
    'TCP min/med' = ((Get-Ms (Get-Min $tcp)).ToString() + ' / ' + (Get-Ms (Get-Median $tcp)).ToString())
    'TLS min/med' = ((Get-Ms (Get-Min $tls)).ToString() + ' / ' + (Get-Ms (Get-Median $tls)).ToString())
    'TTFB min/med' = ((Get-Ms (Get-Min $ttfb)).ToString() + ' / ' + (Get-Ms (Get-Median $ttfb)).ToString())
    Spread = ((Get-Ms (Get-Min $ttfb)).ToString() + '~' + (Get-Ms (Get-Max $ttfb)).ToString())
  }
}

Write-Output '=== 1. DNS: bqtj.top A records (what EdgeOne hands you) ==='
try {
  $a = Resolve-DnsName bqtj.top -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress
  Write-Output ($a -join ', ')
} catch {
  Write-Output ('resolve failed: ' + $_.Exception.Message)
}

Write-Output ''
Write-Output ('=== 2. TTFB, ' + $N + ' runs each (ms) ===')
$rows = @()
$rows += Probe 'https://bqtj.top/'               'bqtj.top   HTML'
$rows += Probe 'https://bqtj.pages.dev/'         'pages.dev  HTML'
$rows += Probe 'https://bqtj.top/assets/css/style.css?v=22'    'bqtj.top   CSS'
$rows += Probe 'https://bqtj.pages.dev/assets/css/style.css?v=22' 'pages.dev  CSS'
$rows | Format-Table -AutoSize | Out-String

Write-Output '=== 3. EdgeOne cache status (2nd hit should be HIT) ==='
1..2 | ForEach-Object {
  $h = & curl.exe --noproxy '*' -s -D - -o NUL 'https://bqtj.top/assets/css/style.css?v=22' |
       Select-String -Pattern 'EO-Cache-Status|^Age:'
  Write-Output ('try ' + $_ + ' -> ' + (($h | ForEach-Object { $_.ToString().Trim() }) -join ' | '))
}

Write-Output ''
Write-Output 'How to read it:'
Write-Output '  TCP(min) ~= 1 RTT  -> <60ms: node is near (HK/TW); 60-130ms: JP/SG; >200ms: far away'
Write-Output '  CSS hit + TTFB close to TLS time -> served straight from the edge, no cross-border fetch'
Write-Output '  HTML is never cached -> TTFB always includes the origin fetch (expected)'
Write-Output '  If Spread is huge (e.g. 700~2600), the link is noisy: trust MIN, ignore the median'
