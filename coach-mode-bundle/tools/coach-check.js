/**
 * `coach_check` —— 采集只读证据（决策 D7：只做只读动作，且必须走宿主服务）。
 *
 * 四条只读 kind：path_exists / list_dir / read_file 经 `ctx.fs`，command 经 `ctx.subprocess`，
 * 都不碰 `node:fs`，因此不绕过沙箱与审批策略；`kind = "command"` 只在命令命中
 * `Config.allowCommands` 白名单时才执行，默认白名单为空 = 默认不支持命令核查（用户已确认）。
 *
 * v0.4.3 新增 `kind = "screenshot"`（SPEC §15）：截「用户屏幕上某个窗口」当证据。
 * 它和 command 一样走 `ctx.subprocess`，但**多两道闸**：
 *   1. `Config.screenshotEnabled` 显式打开（默认关）——截屏会把用户屏幕内容发给模型；
 *   2. 同一步最多 `screenshotMaxPerStep` 张，失败也计数。
 * 抓到的 PNG 先落工作区 `.coach/shots/`，读回字节后经 `ctx.attachments.saveImage` 存成
 * 持久附件，再把 `{ type: 'image', attachment }` 作为工具结果的一部分回给模型。
 */

import { defineTool } from './define-tool.js'
import {
  CHECK_KINDS,
  CoachError,
  checksFor,
  currentStepKey,
  effectiveSinceBack,
} from '../core/machine.js'
import { applyCheck } from '../core/verify.js'

const DETAIL_BUDGET = 600

const DESCRIPTION = [
  '采集一步的只读核查证据。这是核查的唯一取证通道：evidence 为 file / command / screen 的步骤，',
  '必须先调用本工具拿到证据，coach_verify 才会受理。',
  'kind=path_exists 查路径是否存在；kind=list_dir 列目录；kind=read_file 读文本；',
  'kind=command 执行一条只读命令（默认有 7 条只读白名单，可直接跑；白名单外的命令会失败）；',
  'kind=screenshot 截用户屏幕上指定的窗口（需要 Config 打开 screenshotEnabled；',
  'target 写进程名 / 窗口标题片段 / foreground / pid:1234，只截匹配到的那个窗口，不截整屏）。',
  '结果原样记录，不做解释、不做判断。截图失败也是一条记录（ok=false），不会凭空通过。',
].join('')

/** 截断，保持 meta 与回传文本可读。 */
function clip(text, budget = DETAIL_BUDGET) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim()
  return value.length <= budget ? value : `${value.slice(0, budget - 1)}…`
}

/** 会话工作目录。 */
function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** 文件系统类核查。 */
async function observeFile(fs, kind, target, config, exec) {
  const resolved = await fs.resolve(target, { cwd: cwdOf(exec) })

  if (kind === 'path_exists') {
    const info = await fs.stat(resolved)
    if (info === undefined) return { ok: false, detail: '路径不存在' }
    const size = info.size === undefined ? '' : `，${info.size} 字节`
    return { ok: true, detail: `存在（类型 ${info.type}${size}）` }
  }

  const info = await fs.stat(resolved)
  if (info === undefined) return { ok: false, detail: kind === 'list_dir' ? '目录不存在' : '文件不存在' }

  if (kind === 'list_dir') {
    if (info.type !== 'directory') return { ok: false, detail: `该路径不是目录（类型 ${info.type}）` }
    const entries = await fs.listDir(resolved)
    const shown = entries.slice(0, config.listDirMaxEntries)
    const names = shown.map((entry) => `${entry.name}${entry.type === 'directory' ? '/' : ''}`)
    const more = entries.length > shown.length ? ` …（共 ${entries.length} 个条目）` : ''
    return { ok: true, detail: `共 ${entries.length} 个条目：${names.join(', ')}${more}` }
  }

  if (info.type !== 'file') return { ok: false, detail: `该路径不是普通文件（类型 ${info.type}）` }
  const text = await fs.readText(resolved)
  return {
    ok: true,
    detail: `共 ${text.length} 字符，前 ${Math.min(text.length, config.readFileMaxChars)} 字符：\n`
      + text.slice(0, config.readFileMaxChars),
  }
}

/** 命令类核查（默认关闭）。 */
async function observeCommand(subprocess, command, config, exec) {
  const allowed = config.allowCommands ?? []
  if (!allowed.includes(command)) {
    // v2.2：把"下一步该怎么办"直接写进错误里——实测模型会在这里空转。
    throw new CoachError(
      '命令核查未启用：这条命令不在 Config.allowCommands 白名单里（默认白名单为空）。'
        + '**不要重复试命令核查**。三条可行的替代：'
        + '(1) 改用文件核查：path_exists / list_dir / read_file；'
        + '(2) 如果这一小步确实只能靠命令输出判断，把该步的 evidence 设成 user_artifact，'
        + '让用户把终端回显贴过来；'
        + '(3) 想真正开启命令核查，请用户把这条命令加进插件的 allowCommands 配置后重启。',
      'COACH_CHECK_COMMAND_DISABLED',
    )
  }
  const argv = process.platform === 'win32'
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', command]
    : ['/bin/sh', '-c', command]
  const timeout = AbortSignal.timeout(config.commandTimeoutMs)
  const signal = exec?.signal === undefined ? timeout : AbortSignal.any([exec.signal, timeout])
  const handle = subprocess.spawn({
    argv,
    cwd: cwdOf(exec),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 65536 },
    },
    graceMs: 2000,
    signal,
  })
  const outcome = await handle.done
  const stdout = clip(handle.collected?.stdout?.readFrom(0)?.text ?? '')
  const stderr = clip(handle.collected?.stderr?.readFrom(0)?.text ?? '')
  return {
    ok: outcome.exitCode === 0,
    detail: `exit=${String(outcome.exitCode)}；stdout：${stdout === '' ? '（空）' : stdout}；`
      + `stderr：${stderr === '' ? '（空）' : stderr}`,
  }
}

/** PowerShell 单引号字面量。 */
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * 抓屏脚本（Windows PowerShell 5.1 与 pwsh 都可跑）。只往 stdout 写一行 JSON。
 *
 * 选择规则：`foreground` / `pid:1234` / 进程名或窗口标题的**子串**；
 * 被 `screenshotBlockProcesses` 命中的进程（默认含 DSH 自己与 Electron）永远不选。
 * 只截这一个窗口的矩形，不做整屏截图。
 *
 * v0.4.4 抓取顺序（见 SPEC §15）：
 * 1. `PrintWindow(PW_RENDERFULLCONTENT)` —— 让目标窗口自己渲染，**不受遮挡影响**；
 * 2. 失败或纯色 → 检测 9 个采样点是否被别的进程盖住；
 * 3. 被盖住 → 直接报 `occluded` 失败，**绝不回退到屏幕像素**（那会截到遮挡物当证据）；
 * 4. 没被盖住 → 回退 `CopyFromScreen`（GPU 直绘窗口只有这条能拿到画面）。
 * 窗口尺寸改用 DWM 扩展边框，去掉 GetWindowRect 里那圈不可见的阴影边距。
 * @param {object} options 参数。
 * @returns {string} PowerShell 脚本文本。
 */
export function captureScript(options) {
  const { target, outPath, maxWidth, maxHeight, selfPid } = options
  const blocked = Array.isArray(options.blocked) ? options.blocked : []
  const blockedTitles = Array.isArray(options.blockedTitles) ? options.blockedTitles : []
  const blockedList = blocked.length === 0 ? '@()' : `@(${blocked.map(psLiteral).join(', ')})`
  const blockedTitleList = blockedTitles.length === 0
    ? '@()'
    : `@(${blockedTitles.map(psLiteral).join(', ')})`
  return `
$ErrorActionPreference = 'Stop'
# The script is ASCII-only on purpose: it is delivered through -EncodedCommand (UTF-16LE),
# and PowerShell 5.1 reads a BOM-less .ps1 as ANSI, which would corrupt non-ASCII comments.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function Write-Result($value) { $value | ConvertTo-Json -Compress -Depth 4 }
try {
  Add-Type -AssemblyName System.Drawing
  if (-not ('CoachShot' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CoachShot {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);
  [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static void EnableDpiAwareness() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) { return; } } catch { }
    try { SetProcessDPIAware(); } catch { }
  }
  // Visible frame bounds: excludes the invisible DWM resize/shadow margin that
  // GetWindowRect includes (measured: 7px left/right/bottom on Windows 10).
  public static bool TryGetFrame(IntPtr hWnd, out RECT rect) {
    rect = new RECT();
    int hr = DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT)));
    if (hr == 0 && rect.Right > rect.Left && rect.Bottom > rect.Top) return true;
    return GetWindowRect(hWnd, out rect);
  }
  // Which process owns the window visible at this screen point? Returns -1 if none.
  // GA_ROOT = 2, so a child control resolves to its top-level window.
  public static int OwnerPidAt(int x, int y) {
    POINT p = new POINT();
    p.X = x; p.Y = y;
    IntPtr hit = WindowFromPoint(p);
    if (hit == IntPtr.Zero) return -1;
    IntPtr root = GetAncestor(hit, 2);
    if (root == IntPtr.Zero) root = hit;
    uint pid;
    GetWindowThreadProcessId(root, out pid);
    return (int)pid;
  }
}
'@
  }
  [CoachShot]::EnableDpiAwareness()

  $target = ${psLiteral(target)}
  $outPath = ${psLiteral(outPath)}
  $maxWidth = ${maxWidth}
  $maxHeight = ${maxHeight}
  $blocked = ${blockedList}
  $blockedTitles = ${blockedTitleList}
  $selfPid = ${selfPid}

  $wins = New-Object System.Collections.ArrayList
  $callback = [CoachShot+EnumProc]{
    param($hWnd, $lParam)
    if (-not [CoachShot]::IsWindowVisible($hWnd)) { return $true }
    $buffer = New-Object System.Text.StringBuilder 1024
    if ([CoachShot]::GetWindowTextW($hWnd, $buffer, 1024) -le 0) { return $true }
    $owner = [uint32]0
    [void][CoachShot]::GetWindowThreadProcessId($hWnd, [ref]$owner)
    $processName = ''
    try { $processName = (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { $processName = '' }
    [void]$script:wins.Add([pscustomobject]@{
      hwnd = $hWnd
      pid = [int]$owner
      process = $processName
      title = $buffer.ToString()
    })
    return $true
  }
  [void][CoachShot]::EnumWindows($callback, [IntPtr]::Zero)

  $candidates = New-Object System.Collections.ArrayList
  $ignored = New-Object System.Collections.ArrayList
  foreach ($window in $wins) {
    $name = $window.process.ToLower()
    $title = $window.title.ToLower()
    $blockedByTitle = $false
    foreach ($marker in $blockedTitles) {
      if ($title.Contains($marker)) { $blockedByTitle = $true; break }
    }
    if (($blocked -contains $name) -or $blockedByTitle -or ($window.pid -eq $selfPid)) {
      [void]$ignored.Add($window)
    } else {
      [void]$candidates.Add($window)
    }
  }

  $pick = $null
  if ($target -eq 'foreground') {
    $foreground = [CoachShot]::GetForegroundWindow()
    foreach ($window in $ignored) {
      if ($window.hwnd -eq $foreground) {
        Write-Result @{ ok = $false; error = 'blocked_window'; title = $window.title; process = $window.process; pid = $window.pid }
        exit 0
      }
    }
    foreach ($window in $candidates) {
      if ($window.hwnd -eq $foreground) { $pick = $window; break }
    }
  } elseif ($target -match '^pid:([0-9]+)$') {
    $wantedPid = [int]$Matches[1]
    foreach ($window in $candidates) {
      if ($window.pid -eq $wantedPid) { $pick = $window; break }
    }
  } else {
    $needle = $target.ToLower()
    $best = 99
    foreach ($window in $candidates) {
      $name = $window.process.ToLower()
      $title = $window.title.ToLower()
      $score = 99
      if ($name -eq $needle) { $score = 0 }
      elseif ($name.Contains($needle)) { $score = 1 }
      elseif ($title.Contains($needle)) { $score = 2 }
      if ($score -lt $best) { $best = $score; $pick = $window }
      if ($best -eq 0) { break }
    }
  }

  if ($null -eq $pick) {
    Write-Result @{
      ok = $false
      error = 'no_window'
      target = $target
      candidates = @($candidates | Select-Object -First 8 | ForEach-Object {
        [pscustomobject]@{ pid = $_.pid; process = $_.process; title = $_.title }
      })
    }
    exit 0
  }

  if ([CoachShot]::IsIconic($pick.hwnd)) {
    Write-Result @{ ok = $false; error = 'window_minimized'; title = $pick.title; process = $pick.process; pid = $pick.pid }
    exit 0
  }

  $rect = New-Object CoachShot+RECT
  if (-not [CoachShot]::TryGetFrame($pick.hwnd, [ref]$rect)) {
    Write-Result @{ ok = $false; error = 'no_rect'; title = $pick.title; process = $pick.process; pid = $pick.pid }
    exit 0
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 1 -or $height -le 1) {
    Write-Result @{ ok = $false; error = 'zero_size'; title = $pick.title; process = $pick.process; pid = $pick.pid }
    exit 0
  }

  # ---- v0.4.4: capture the WINDOW, not the screen pixels under its rectangle ----
  # CopyFromScreen (v0.4.3) returns whatever is painted at those coordinates, so any
  # window stacked on top silently becomes the "evidence". PrintWindow asks the target
  # window to render itself into our bitmap, so occlusion no longer matters.
  function Test-FlatBitmap($bmp) {
    $seen = @{}
    $stepX = [Math]::Max(1, [int]($bmp.Width / 16))
    $stepY = [Math]::Max(1, [int]($bmp.Height / 16))
    for ($x = 0; $x -lt $bmp.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bmp.Height; $y += $stepY) {
        $seen[$bmp.GetPixel($x, $y).ToArgb()] = $true
        if ($seen.Count -gt 1) { return $false }
      }
    }
    return $true
  }

  # How many of 9 sample points inside the target rect are covered by ANOTHER process?
  # Used only to decide whether falling back to screen pixels would be honest.
  function Get-OccludedCount($r, $ownPid) {
    $covered = 0
    foreach ($fx in 0.15, 0.5, 0.85) {
      foreach ($fy in 0.15, 0.5, 0.85) {
        $px = [int]($r.Left + ($r.Right - $r.Left) * $fx)
        $py = [int]($r.Top + ($r.Bottom - $r.Top) * $fy)
        $owner = [CoachShot]::OwnerPidAt($px, $py)
        if ($owner -ne -1 -and $owner -ne $ownPid) { $covered++ }
      }
    }
    return $covered
  }

  $bitmap = $null
  $method = ''
  $occluded = 0

  # 1) Preferred: the window renders itself. Unaffected by stacking order.
  $attempt = New-Object System.Drawing.Bitmap $width, $height
  $attemptGraphics = [System.Drawing.Graphics]::FromImage($attempt)
  $hdc = $attemptGraphics.GetHdc()
  # 2 = PW_RENDERFULLCONTENT (Windows 8.1+): required for DirectComposition /
  # hardware-accelerated windows, where plain PrintWindow returns an empty frame.
  $printed = $false
  try { $printed = [CoachShot]::PrintWindow($pick.hwnd, [IntPtr]$hdc, 2) } catch { $printed = $false }
  $attemptGraphics.ReleaseHdc([IntPtr]$hdc)
  $attemptGraphics.Dispose()
  if ($printed -and -not (Test-FlatBitmap $attempt)) {
    $bitmap = $attempt
    $method = 'printwindow'
  } else {
    # PrintWindow failed or produced a flat frame (common for GPU-drawn windows).
    $attempt.Dispose()
    $occluded = Get-OccludedCount $rect $pick.pid
    if ($occluded -gt 0) {
      # Falling back to screen pixels here would capture the covering window.
      # Refuse instead of returning someone else's pixels as evidence.
      Write-Result @{
        ok = $false
        error = 'occluded'
        title = $pick.title
        process = $pick.process
        pid = $pick.pid
        covered = $occluded
      }
      exit 0
    }
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
    $graphics.Dispose()
    $method = 'screen'
  }

  # A single flat color almost always means the capture failed
  # (minimized / exclusive fullscreen / DRM / GPU black frame), so it must not count as evidence.
  if (Test-FlatBitmap $bitmap) {
    $bitmap.Dispose()
    Write-Result @{ ok = $false; error = 'blank_image'; title = $pick.title; process = $pick.process; pid = $pick.pid; method = $method }
    exit 0
  }

  $scale = 1.0
  if ($width -gt $maxWidth) { $scale = [Math]::Min($scale, $maxWidth / $width) }
  if ($height -gt $maxHeight) { $scale = [Math]::Min($scale, $maxHeight / $height) }
  $final = $bitmap
  if ($scale -lt 1.0) {
    $scaledWidth = [int][Math]::Max(1, [Math]::Round($width * $scale))
    $scaledHeight = [int][Math]::Max(1, [Math]::Round($height * $scale))
    $final = New-Object System.Drawing.Bitmap $scaledWidth, $scaledHeight
    $scaled = [System.Drawing.Graphics]::FromImage($final)
    $scaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaled.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
    $scaled.Dispose()
    $bitmap.Dispose()
  }

  $directory = [System.IO.Path]::GetDirectoryName($outPath)
  if (-not [System.IO.Directory]::Exists($directory)) { [void][System.IO.Directory]::CreateDirectory($directory) }
  $final.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $savedWidth = $final.Width
  $savedHeight = $final.Height
  $final.Dispose()

  Write-Result @{
    ok = $true
    path = $outPath
    width = $savedWidth
    height = $savedHeight
    sourceWidth = $width
    sourceHeight = $height
    pid = $pick.pid
    process = $pick.process
    title = $pick.title
    method = $method
  }
} catch {
  Write-Result @{
    ok = $false
    error = 'exception'
    message = $_.Exception.Message
    line = $_.InvocationInfo.ScriptLineNumber
    source = $_.InvocationInfo.Line
  }
}
`
}

/** 从脚本输出里取出最后一行 JSON。 */
export function parseCaptureOutput(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed !== null && typeof parsed === 'object') return parsed
    } catch {
      // 继续往前找
    }
  }
  return null
}

/** 把候选窗口列表写成一句可读的话。 */
function formatCandidates(list) {
  const entries = Array.isArray(list) ? list.slice(0, 6) : []
  if (entries.length === 0) return ''
  const shown = entries
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => `${entry.process ?? '?'}「${clip(entry.title ?? '', 60)}」(pid ${entry.pid ?? '?'})`)
  return shown.length === 0 ? '' : `当前可见窗口：${shown.join('；')}。`
}

/** 抓屏失败 → 面向模型的失败事实。 */
function captureFailure(result) {
  const title = clip(result?.title ?? '', 120)
  const processName = clip(result?.process ?? '', 60)
  switch (result?.error) {
    case 'no_window': {
      const candidates = formatCandidates(result?.candidates)
      return {
        detail: `没找到匹配「${clip(result?.target ?? '', 60)}」的窗口。${candidates}`
          + '可以让用户确认窗口标题，或改用 target="foreground"，或 pid:<数字>。',
      }
    }
    case 'blocked_window':
      return {
        detail: `「${title}」是 DSH 自己 / 被屏蔽的窗口，不能截图。`
          + '请换一个目标窗口（用户要核查的那个工具）。',
      }
    case 'window_minimized':
      return {
        detail: `窗口「${title}」（${processName}）当前是最小化的，抓不到画面。`
          + '请用户把窗口恢复出来再截一次；不要拿最小化时的截图当证据。',
      }
    case 'blank_image':
      return {
        detail: `窗口「${title}」抓到的是纯色画面（常见于最小化、独占全屏、DRM 或 GPU 黑屏），`
          + '不能当证据。请用户把窗口用普通模式显示出来再试。',
      }
    case 'occluded':
      return {
        detail: `窗口「${title}」（${processName}）被别的窗口挡住了 ${result?.covered ?? '多'} 处，`
          + '插件无法在不截到遮挡物的前提下拿到它的画面（这类窗口只能从屏幕像素取图）。'
          + '**不要拿这张图判通过，也不要重试同一个 target**。请让用户把该窗口切到最前面'
          + '（或最小化挡住它的窗口）后再截一次。',
      }
    case 'zero_size':
    case 'no_rect':
      return { detail: `窗口「${title}」没有可截取的区域（可能已关闭或尺寸为 0）。请用户重新打开后再试。` }
    case 'exception':
      return { detail: `截图脚本出错：${clip(result?.message ?? '未知错误', 200)}` }
    default:
      return { detail: `截图失败：${clip(JSON.stringify(result), 300)}` }
  }
}

/**
 * 截一张图并存成附件（v0.4.3；v0.4.4 增加抓取方式与 `occluded` 失败）。
 *
 * 只做三件事：跑抓屏脚本 → 读回 PNG → `attachments.saveImage`。
 * 抓屏失败**不抛错**，而是返回一条 `ok:false` 的事实——它会落进 `checks`，
 * 于是 `coach_verify` 看到「最近一次截图失败」就不会放行。
 * @param {object} deps 插件依赖 `{ config, ctx, projection }`。
 * @param {string} target 窗口选择器。
 * @param {object} exec 工具执行上下文。
 * @returns {Promise<{ok: boolean, detail: string, shot: object|null, image?: object}>}
 */
async function observeScreenshot(deps, target, exec) {
  const { config, ctx } = deps

  if (config.sameMachine === false) {
    throw new CoachError(
      '截图核查需要教练和用户在同一台机器上（Config.sameMachine 现在是 false）。'
        + '远端部署时截到的是服务器桌面，不是用户屏幕。请把该步的 evidence 改成 user_artifact，'
        + '让用户自己发截图。',
      'COACH_CHECK_SHOT_REMOTE',
    )
  }
  if (process.platform !== 'win32') {
    throw new CoachError(
      '截图核查目前只支持 Windows（GDI + Win32 窗口枚举）。'
        + '这个平台上请把该步的 evidence 改成 user_artifact，让用户自己发截图。',
      'COACH_CHECK_SHOT_PLATFORM',
    )
  }
  if (config.screenshotEnabled !== true) {
    throw new CoachError(
      '截图核查没有启用：Config.screenshotEnabled 默认是 false（截屏会把用户屏幕内容发给模型）。'
        + '**不要反复重试截图**。三条可行的替代：'
        + '(1) 把该步的 evidence 设成 user_artifact，让用户把截图发过来；'
        + '(2) 能用文件 / 命令核对的，改用 path_exists / list_dir / read_file；'
        + '(3) 想真正开启，请用户把 screenshotEnabled: true 写进插件的 config 后重启。',
      'COACH_CHECK_SHOT_DISABLED',
    )
  }

  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  const attachments = ctx.get('attachments')
  if (subprocess === undefined) {
    throw new CoachError('宿主的 subprocess 服务不可用，无法截图。', 'COACH_CHECK_NO_SUBPROCESS')
  }
  if (fs === undefined) {
    throw new CoachError('宿主的 fs 服务不可用，无法读回截图。', 'COACH_CHECK_NO_FS')
  }
  if (attachments === undefined) {
    throw new CoachError(
      '宿主没有挂载附件服务（ctx.attachments），截图无法存成持久附件，也就没法回给模型。'
        + '请把该步的 evidence 改成 user_artifact。',
      'COACH_CHECK_NO_ATTACHMENTS',
    )
  }

  const cwd = cwdOf(exec)
  const directory = `${cwd.replace(/[\\/]+$/, '')}\\.coach\\shots`
  const stamp = Date.now().toString(36)
  const name = `shot-${stamp}.png`
  const outPath = `${directory}\\${name}`

  const script = captureScript({
    target,
    outPath,
    maxWidth: config.screenshotMaxWidth,
    maxHeight: config.screenshotMaxHeight,
    blocked: config.screenshotBlockProcesses ?? [],
    blockedTitles: config.screenshotBlockTitles ?? [],
    selfPid: process.pid,
  })
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const timeout = AbortSignal.timeout(config.screenshotTimeoutMs)
  const signal = exec?.signal === undefined ? timeout : AbortSignal.any([exec.signal, timeout])
  const handle = subprocess.spawn({
    argv: ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 16384 },
    },
    graceMs: 2000,
    signal,
  })

  let outcome
  try {
    outcome = await handle.done
  } catch (error) {
    return { ok: false, detail: `截图脚本没有跑起来：${clip(error instanceof Error ? error.message : String(error), 200)}`, shot: null }
  }

  const stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
  const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
  const result = parseCaptureOutput(stdout)
  if (result === null) {
    return {
      ok: false,
      detail: `截图脚本没有返回可解析的结果（exit=${String(outcome?.exitCode)}）。`
        + `${stderr === '' ? '' : `stderr：${clip(stderr, 200)}`}`,
      shot: null,
    }
  }
  if (result.ok !== true) {
    return { ok: false, detail: captureFailure(result).detail, shot: null }
  }

  let reference
  try {
    const fileTarget = await fs.resolve(outPath, { cwd })
    const data = await fs.readBytes(fileTarget, undefined, config.screenshotMaxBytes)
    reference = await attachments.saveImage({ data, mediaType: 'image/png', name })
    if (config.screenshotKeepFiles !== true) {
      try {
        await fs.deleteFile(fileTarget)
      } catch {
        // 删不掉就留着，不影响证据；README 里写明了路径。
      }
    }
  } catch (error) {
    return {
      ok: false,
      detail: `截图抓到了，但存成附件失败：${clip(error instanceof Error ? error.message : String(error), 200)}`,
      shot: null,
    }
  }

  const width = Number.isInteger(result.width) ? result.width : reference.width
  const height = Number.isInteger(result.height) ? result.height : reference.height
  const resized = Number.isInteger(result.sourceWidth) && Number.isInteger(result.sourceHeight)
    && (result.sourceWidth !== width || result.sourceHeight !== height)
    ? `（原 ${result.sourceWidth}×${result.sourceHeight}，已缩放）`
    : ''
  const windowTitle = clip(result.title ?? '', 120)
  const kept = config.screenshotKeepFiles === true ? `；文件留在 ${outPath}` : ''
  // v0.4.4：记下这张图是「窗口自渲染」还是「屏幕像素」，排查遮挡问题时这是关键信息。
  const method = result.method === 'printwindow' || result.method === 'screen' ? result.method : ''
  const how = method === 'printwindow' ? '（窗口自渲染，不受遮挡影响）'
    : method === 'screen' ? '（屏幕像素）'
      : ''
  return {
    ok: true,
    detail: `窗口「${windowTitle}」（${result.process ?? '?'}，pid ${result.pid ?? '?'}）`
      + `已截图 ${width}×${height}${resized}${how}；画面已存进附件 ${String(reference.attachmentId).slice(0, 12)}…${kept}`,
    shot: {
      id: String(reference.attachmentId),
      path: outPath,
      width,
      height,
      window: windowTitle,
      process: clip(result.process ?? '', 120),
      pid: Number.isInteger(result.pid) ? result.pid : null,
      method,
    },
    image: { type: 'image', attachment: reference },
  }
}

export function createCheckTool(deps) {
  const { config, projection, ctx } = deps
  // v0.4.3：图片块不是 JSON，进不了工具返回值/schema；render 时按 shotId 从这里取。
  // 会话回放用的是日志里已存的块，不需要这张表，所以进程内丢了也没关系。
  const imageBlocks = new Map()

  return defineTool({
    name: 'coach_check',
    description: DESCRIPTION,
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: CHECK_KINDS,
        description: '核查种类：path_exists / list_dir / read_file / command / screenshot。',
      },
      target: {
        type: 'string',
        required: true,
        description: '要核查的路径；kind=command 时要执行的只读命令；'
          + 'kind=screenshot 时的窗口选择器（进程名 / 窗口标题片段 / foreground / pid:1234）。'
          + '用户只描述现象时，自己推断出对应路径或窗口来核对。',
      },
      stepKey: {
        type: 'string',
        description: '可选：当前步骤的键（形如 "0:1"）。给出时必须是当前步骤，否则失败。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          kind: { type: 'string', required: true },
          target: { type: 'string', required: true },
          stepKey: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          detail: { type: 'string', required: true },
          shotId: { type: 'string' },
          shotPath: { type: 'string' },
          shotProcess: { type: 'string' },
          shotPid: { type: 'number' },
          shotMethod: { type: 'string' },
          windowTitle: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const isEnvProbe = value.stepKey === 'env'
        const head = isEnvProbe
          ? `已记录**环境核查**（${value.kind} ${value.target}）——计划还没建立，所以它不绑定任何步骤、也不推进状态。\n`
          : `已记录核查证据（步骤 ${value.stepKey}，${value.kind} ${value.target}）。\n`
        if (value.kind === 'screenshot') {
          const blocks = [{
            type: 'text',
            text: `${head}${value.ok ? '截图成功' : '截图失败'}：${value.detail}\n`
              + (value.ok
                ? '这是**插件自己抓的画面**，不是用户发来的。对照【合格标准】看，判定仍必须用 coach_verify 落盘；'
                  + '用户反馈之后抓的截图才算数。'
                : '失败的截图不能当证据。按上面的原因处理后重抓，不要用旧截图或失败结果判「通过」。'),
          }]
          const stored = value.shotId === undefined ? undefined : imageBlocks.get(value.shotId)
          // 不在这里删：注册表可能为同一结果多次调用 render（内容 / 展示），
          // 删早了第二次就只剩文字。表里存的是引用对象，不是像素，留着代价可以忽略。
          if (stored !== undefined) blocks.push(stored)
          return blocks
        }
        const tail = isEnvProbe
          ? '这是环境事实，不是对某一步的判定。接下来按状态块的【下一步】做：确认完可用性就调用 coach_plan。'
          : '这是插件读到的原始事实，不是判定。判定请用 coach_verify，按状态块里的【合格标准】给出结论。'
        return [{
          type: 'text',
          text: `${head}核查结果：${value.ok ? '成功' : '未通过'}\n原始事实：${value.detail}\n${tail}`,
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_check',
        stepKey: value.stepKey,
        kind: value.kind,
        target: value.target,
        ok: value.ok,
        detail: value.detail,
        shot: value.shotId === undefined
          ? null
          : {
            id: value.shotId,
            path: value.shotPath ?? '',
            width: value.width ?? 0,
            height: value.height ?? 0,
            window: value.windowTitle ?? '',
            process: value.shotProcess ?? '',
            pid: value.shotPid ?? null,
            method: value.shotMethod ?? '',
          },
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const kind = args.kind
      const target = typeof args.target === 'string' ? args.target.trim() : ''

      // v0.2.5：先拦非法 kind，避免 kind:"none" 落进文件分支真的去读路径。
      // 核心 `applyCheck` 里还有一层同样的校验（双保险，且单测可直接覆盖）。
      if (!CHECK_KINDS.includes(kind)) {
        throw new CoachError(
          `kind 必须是 ${CHECK_KINDS.join(' / ')} 之一，收到 ${JSON.stringify(kind)}。`,
          'COACH_CHECK_KIND',
        )
      }

      let observation
      let image
      if (kind === 'screenshot') {
        // v0.4.3：按步预算——同一小步第 N+1 张在抓屏之前就拒绝（失败也计数）。
        const stepKey = state.phase === 'INIT' || state.phase === 'CHECK_TOOL_AVAILABILITY'
          ? 'env'
          : currentStepKey(state)
        const used = effectiveSinceBack(state, checksFor(state, stepKey))
          .filter((check) => check.kind === 'screenshot').length
        const limit = config.screenshotMaxPerStep
        if (used >= limit) {
          throw new CoachError(
            `本步截图已经用满 ${limit} 张（Config.screenshotMaxPerStep）。`
              + '没抓清就先用文字 / 报错让用户补充，或把该步的 evidence 改成 user_artifact；'
              + '换到下一步额度会重置。',
            'COACH_CHECK_SHOT_BUDGET',
          )
        }
        observation = await observeScreenshot(deps, target, exec)
        image = observation.image
      } else if (kind === 'command') {
        const subprocess = ctx.get('subprocess')
        if (subprocess === undefined) {
          throw new CoachError('宿主的 subprocess 服务不可用，无法做命令核查。', 'COACH_CHECK_NO_SUBPROCESS')
        }
        observation = await observeCommand(subprocess, target, config, exec)
      } else {
        const fs = ctx.get('fs')
        if (fs === undefined) {
          throw new CoachError('宿主的 fs 服务不可用，无法做文件核查。', 'COACH_CHECK_NO_FS')
        }
        try {
          observation = await observeFile(fs, kind, target, config, exec)
        } catch (error) {
          observation = {
            ok: false,
            detail: `读取失败：${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      const detail = clip(observation.detail)
      const shot = observation.shot ?? null
      const next = applyCheck(state, {
        stepKey: args.stepKey,
        kind,
        target,
        ok: observation.ok,
        detail,
        shot,
      }, 0)

      const shotId = shot === null ? undefined : shot.id
      if (image !== undefined && shotId !== undefined) imageBlocks.set(shotId, image)

      return {
        ok: observation.ok,
        kind,
        target,
        stepKey: next.checks[next.checks.length - 1].stepKey,
        phase: next.phase,
        detail,
        ...(shotId === undefined ? {} : { shotId }),
        ...(shot === null ? {} : {
          shotPath: shot.path,
          shotProcess: shot.process,
          shotPid: shot.pid ?? undefined,
          shotMethod: shot.method === '' ? undefined : shot.method,
          windowTitle: shot.window,
          width: shot.width,
          height: shot.height,
        }),
      }
    },
  })
}
