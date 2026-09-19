# ===========================================================================
#  net-check.ps1 —— 检查某个域名在国内「不走代理」时能不能直连
#
#  用法：
#      powershell -ExecutionPolicy Bypass -File tools\net-check.ps1 bqtj.pages.dev
#      也可以指定对照域名：
#      powershell -ExecutionPolicy Bypass -File tools\net-check.ps1 bqtj.cc.cd bqtj.pages.dev
#
#  为什么需要它：
#      2026-09 线上出现过「手机打不开、开 VPN 才通」。排查后发现是
#      GFW 对 bqtj.cc.cd 这个「域名」做了 RST —— 同一台 Cloudflare IP 上，
#      换成 bqtj.pages.dev 做 Host / SNI 就完全正常。
#      也就是说：域名被封和「Cloudflare 被墙」「IP 被墙」是两回事，
#      用本脚本把两者区分开，才知道该换域名还是换 IP。
#
#  判读：
#      A 域名被 RST（code=000 + Connection was reset），而对照域名返回 2xx/3xx
#        → 封锁是按域名触发的，只能换域名（换 IP、换 CDN 都没用）
#      两个域名都被 RST → 有可能是 IP 段被针对，或本机网络问题
#      查询到的 IP 一个都连不上（超时而非重置）→ 多半不是域名问题
# ===========================================================================

param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Domain,
  [Parameter(Position = 1)][string]$Compare = 'bqtj.pages.dev'
)

function Invoke-Curl {
  param([string[]]$CurlArgs)
  # curl 把错误写在 stderr，PowerShell 会当成 ErrorRecord 喷一大段红字 ——
  # 这里只是「预期内的失败」，静音掉，真正有用的输出（-w 写的 code=…）照样能拿到。
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    return (& curl.exe @CurlArgs 2>&1 | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $old
  }
}

function Test-PlainHttp {
  param([string]$Ip, [string]$HostName)
  $r = Invoke-Curl @('--noproxy', '*', '-sS', '-o', 'NUL', '-m', '15',
                     '-H', "Host: $HostName", '-w', 'code=%{http_code}',
                     "http://$Ip/")
  return $r
}

function Test-Https {
  param([string]$HostName)
  $r = Invoke-Curl @('--noproxy', '*', '-sS', '-o', 'NUL', '-m', '15',
                     '-w', 'code=%{http_code} time=%{time_total}s',
                     "https://$HostName/")
  return $r
}

Write-Output "被测域名 : $Domain"
Write-Output "对照域名 : $Compare"
Write-Output ''

# ---------------------------------------------------------------- 1. DNS
$ips = @()
try {
  $ips = @(Resolve-DnsName -Name $Domain -Type A -ErrorAction Stop |
           Where-Object { $_.Type -eq 'A' } |
           Select-Object -ExpandProperty IPAddress)
} catch {
  Write-Output "DNS 解析失败：$($_.Exception.Message)"
}
Write-Output "DNS 解析 : $(if ($ips) { $ips -join ', ' } else { '(无 A 记录)' })"
Write-Output ''

# ------------------------------------------------- 2. HTTPS 直连（按 SNI）
Write-Output '--- HTTPS 直连（不给代理） ---'
Write-Output ("{0,-24} {1}" -f $Domain, (Test-Https $Domain))
Write-Output ("{0,-24} {1}" -f $Compare, (Test-Https $Compare))
Write-Output ''

# ------------------------------------- 3. 同一 IP 上换 Host，区分 IP / 域名
if ($ips.Count -gt 0) {
  Write-Output "--- 明文 HTTP，同一 IP 上换 Host（区分「IP 被封」和「域名被封」）---"
  foreach ($ip in $ips) {
    Write-Output ("{0,-16} Host={1,-22} {2}" -f $ip, $Domain,  (Test-PlainHttp $ip $Domain))
    Write-Output ("{0,-16} Host={1,-22} {2}" -f $ip, $Compare, (Test-PlainHttp $ip $Compare))
  }
  Write-Output ''
}

# ---------------------------------------------------------------- 4. 结论
$self    = Test-Https $Domain
$control = Test-Https $Compare

if ($self -match 'code=2\d\d|code=3\d\d') {
  Write-Output "结论：$Domain 可以直连，无需处理。"
} elseif ($control -match 'code=2\d\d|code=3\d\d') {
  Write-Output "结论：$Domain 连不上，但同 IP 上的 $Compare 正常"
  Write-Output "      → 属于「按域名」封锁（GFW RST），换 IP / 换 CDN 都无效，只能换域名。"
} else {
  Write-Output "结论：两个域名都连不上。先把代理/防火墙关掉再跑一次，"
  Write-Output "      若仍然如此，问题多半在本机网络或整个 IP 段，而不是这个域名。"
}
