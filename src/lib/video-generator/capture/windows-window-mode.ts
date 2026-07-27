export interface WindowBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WindowModeSnapshot {
  style: bigint;
  exStyle: bigint;
  bounds: WindowBounds;
}

export interface AppliedBorderlessWindowMode {
  handle: bigint;
  snapshot: WindowModeSnapshot;
  appliedBounds: WindowBounds;
  applied: true;
}

export interface WindowsCommand {
  command: 'powershell.exe';
  args: string[];
  decodedScript: string;
}

export type RunWindowsCommand = (
  command: WindowsCommand,
) => Promise<{ stdout: string; stderr: string }>;

const USER32_DEFINITION = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativeWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public int dwFlags;
  }

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll", SetLastError=true, EntryPoint="GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", SetLastError=true, EntryPoint="SetWindowLongPtr")]
  public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
}
"@
`;

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x0004;
const SWP_FRAMECHANGED = 0x0020;
const MONITOR_DEFAULTTONEAREST = 0x00000002;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const WS_CAPTION = 0x00c00000n;
const WS_THICKFRAME = 0x00040000n;
const WS_MINIMIZEBOX = 0x00020000n;
const WS_MAXIMIZEBOX = 0x00010000n;

export function buildEnableBorderlessCommand(handle: bigint): WindowsCommand {
  const decodedScript = `${USER32_DEFINITION}
$ErrorActionPreference = 'Stop'
$handle = [IntPtr]::new(${handle.toString()})
$rect = New-Object NativeWindow+RECT
if (-not [NativeWindow]::GetWindowRect($handle, [ref]$rect)) { throw "GetWindowRect failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$stylePtr = [NativeWindow]::GetWindowLongPtr64($handle, ${GWL_STYLE})
$exStylePtr = [NativeWindow]::GetWindowLongPtr64($handle, ${GWL_EXSTYLE})
$style = [Int64]$stylePtr
$exStyle = [Int64]$exStylePtr
$newStyle = $style -band -bnot (${WS_CAPTION.toString()} -bor ${WS_THICKFRAME.toString()} -bor ${WS_MINIMIZEBOX.toString()} -bor ${WS_MAXIMIZEBOX.toString()})
[void][NativeWindow]::SetWindowLongPtr64($handle, ${GWL_STYLE}, [IntPtr]::new($newStyle))
$monitor = [NativeWindow]::MonitorFromWindow($handle, ${MONITOR_DEFAULTTONEAREST})
if ($monitor -eq [IntPtr]::Zero) { throw "MonitorFromWindow failed" }
$monitorInfo = New-Object NativeWindow+MONITORINFO
$monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][NativeWindow+MONITORINFO])
if (-not [NativeWindow]::GetMonitorInfo($monitor, [ref]$monitorInfo)) { throw "GetMonitorInfo failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$work = $monitorInfo.rcWork
if (-not [NativeWindow]::SetWindowPos($handle, [IntPtr]::Zero, $work.Left, $work.Top, $work.Right - $work.Left, $work.Bottom - $work.Top, ${SWP_NOZORDER} -bor ${SWP_FRAMECHANGED})) { throw "SetWindowPos borderless failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$appliedRect = New-Object NativeWindow+RECT
if (-not [NativeWindow]::GetWindowRect($handle, [ref]$appliedRect)) { throw "GetWindowRect verify failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$visibleRect = New-Object NativeWindow+RECT
$dwmResult = [NativeWindow]::DwmGetWindowAttribute($handle, ${DWMWA_EXTENDED_FRAME_BOUNDS}, [ref]$visibleRect, [Runtime.InteropServices.Marshal]::SizeOf([type][NativeWindow+RECT]))
if ($dwmResult -ne 0) { throw "DwmGetWindowAttribute DWMWA_EXTENDED_FRAME_BOUNDS failed: $dwmResult" }
$appliedStyle = [Int64][NativeWindow]::GetWindowLongPtr64($handle, ${GWL_STYLE})
$forbiddenStyle = ${WS_CAPTION.toString()} -bor ${WS_THICKFRAME.toString()}
$applied = (($appliedStyle -band $forbiddenStyle) -eq 0) -and $visibleRect.Left -eq $work.Left -and $visibleRect.Top -eq $work.Top -and $visibleRect.Right -eq $work.Right -and $visibleRect.Bottom -eq $work.Bottom
[pscustomobject]@{
  handle = [string]${handle.toString()}
  snapshot = @{
    style = [string]$style
    exStyle = [string]$exStyle
    bounds = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
  }
  appliedBounds = @{ left = $visibleRect.Left; top = $visibleRect.Top; right = $visibleRect.Right; bottom = $visibleRect.Bottom }
  rawBounds = @{ left = $appliedRect.Left; top = $appliedRect.Top; right = $appliedRect.Right; bottom = $appliedRect.Bottom }
  applied = $applied
} | ConvertTo-Json -Depth 4 -Compress
`;
  return buildEncodedPowerShellCommand(decodedScript);
}

export function buildRestoreWindowCommand(handle: bigint, snapshot: WindowModeSnapshot): WindowsCommand {
  const { bounds } = snapshot;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const decodedScript = `${USER32_DEFINITION}
$ErrorActionPreference = 'Stop'
$handle = [IntPtr]::new(${handle.toString()})
[void][NativeWindow]::SetWindowLongPtr64($handle, ${GWL_STYLE}, [IntPtr]::new(${snapshot.style.toString()}))
[void][NativeWindow]::SetWindowLongPtr64($handle, ${GWL_EXSTYLE}, [IntPtr]::new(${snapshot.exStyle.toString()}))
if (-not [NativeWindow]::SetWindowPos($handle, [IntPtr]::Zero, ${bounds.left}, ${bounds.top}, ${width}, ${height}, ${SWP_NOZORDER} -bor ${SWP_FRAMECHANGED})) { throw "SetWindowPos SWP_FRAMECHANGED failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
[void][NativeWindow]::ShowWindow($handle, ${SW_RESTORE})
$restoredRect = New-Object NativeWindow+RECT
if (-not [NativeWindow]::GetWindowRect($handle, [ref]$restoredRect)) { throw "GetWindowRect restore verify failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$restoredStyle = [Int64][NativeWindow]::GetWindowLongPtr64($handle, ${GWL_STYLE})
$restoredExStyle = [Int64][NativeWindow]::GetWindowLongPtr64($handle, ${GWL_EXSTYLE})
$restored = $restoredStyle -eq ${snapshot.style.toString()} -and $restoredExStyle -eq ${snapshot.exStyle.toString()} -and $restoredRect.Left -eq ${bounds.left} -and $restoredRect.Top -eq ${bounds.top} -and $restoredRect.Right -eq ${bounds.right} -and $restoredRect.Bottom -eq ${bounds.bottom}
[pscustomobject]@{ restored = $restored } | ConvertTo-Json -Compress
`;
  return buildEncodedPowerShellCommand(decodedScript);
}

export async function enableBorderlessWindowMode(
  sourceId: string,
  runCommand: RunWindowsCommand,
): Promise<AppliedBorderlessWindowMode> {
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (match === null) {
    throw new Error(`Invalid Windows window source id: ${sourceId}`);
  }
  const handle = BigInt(match[1]!);
  const result = await runCommand(buildEnableBorderlessCommand(handle));
  const parsed = parseJsonObject(result.stdout, 'borderless apply');
  if (parsed.applied !== true) {
    throw new Error(`Borderless window mode was not verified as applied: ${JSON.stringify(parsed)}`);
  }
  if (parsed.handle !== handle.toString()) {
    throw new Error('Borderless window mode returned a different window handle.');
  }
  const snapshot = parseSnapshot(parsed.snapshot);
  const appliedBounds = parseBounds(parsed.appliedBounds);
  return { handle, snapshot, appliedBounds, applied: true };
}

export async function restoreBorderlessWindowMode(
  mode: AppliedBorderlessWindowMode,
  runCommand: RunWindowsCommand,
): Promise<void> {
  const result = await runCommand(buildRestoreWindowCommand(mode.handle, mode.snapshot));
  const parsed = parseJsonObject(result.stdout, 'borderless restore');
  if (parsed.restored !== true) {
    throw new Error('Borderless window mode restore was not verified.');
  }
}

function buildEncodedPowerShellCommand(decodedScript: string): WindowsCommand {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(decodedScript, 'utf16le').toString('base64')],
    decodedScript,
  };
}

function parseSnapshot(value: unknown): WindowModeSnapshot {
  const object = asObject(value, 'window snapshot');
  return {
    style: parseBigIntString(object.style, 'window style'),
    exStyle: parseBigIntString(object.exStyle, 'window extended style'),
    bounds: parseBounds(object.bounds),
  };
}

function parseBounds(value: unknown): WindowBounds {
  const object = asObject(value, 'window bounds');
  const result = {
    left: object.left,
    top: object.top,
    right: object.right,
    bottom: object.bottom,
  };
  if (Object.values(result).some((item) => typeof item !== 'number' || !Number.isInteger(item))) {
    throw new Error('Invalid window bounds returned by PowerShell.');
  }
  return result as WindowBounds;
}

function parseBigIntString(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new Error(`Invalid ${label} returned by PowerShell.`);
  }
  return BigInt(value);
}

function parseJsonObject(stdout: string, label: string): Record<string, unknown> {
  try {
    return asObject(JSON.parse(stdout), label);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} object.`);
  }
  return value as Record<string, unknown>;
}
