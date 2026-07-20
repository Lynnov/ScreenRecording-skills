export interface WindowBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WindowModeSnapshot {
  style: bigint;
  bounds: WindowBounds;
}

export interface WindowsCommand {
  command: 'powershell.exe';
  args: string[];
  decodedScript: string;
}

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
}
"@
`;

const GWL_STYLE = -16;
const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x0004;
const SWP_FRAMECHANGED = 0x0020;
const WS_CAPTION = 0x00c00000n;
const WS_THICKFRAME = 0x00040000n;

export function buildEnableBorderlessCommand(handle: bigint): WindowsCommand {
  const decodedScript = `${USER32_DEFINITION}
$ErrorActionPreference = 'Stop'
$handle = [IntPtr]::new(${handle.toString()})
$rect = New-Object NativeWindow+RECT
if (-not [NativeWindow]::GetWindowRect($handle, [ref]$rect)) { throw "GetWindowRect failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$stylePtr = [NativeWindow]::GetWindowLongPtr64($handle, ${GWL_STYLE})
$style = [Int64]$stylePtr
$newStyle = $style -band -bnot (${WS_CAPTION.toString()} -bor ${WS_THICKFRAME.toString()})
[void][NativeWindow]::SetWindowLongPtr64($handle, ${GWL_STYLE}, [IntPtr]::new($newStyle))
if (-not [NativeWindow]::ShowWindow($handle, ${SW_MAXIMIZE})) { throw "ShowWindow failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
[pscustomobject]@{ style = [string]$style; bounds = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom } } | ConvertTo-Json -Compress
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
if (-not [NativeWindow]::SetWindowPos($handle, [IntPtr]::Zero, ${bounds.left}, ${bounds.top}, ${width}, ${height}, ${SWP_NOZORDER} -bor ${SWP_FRAMECHANGED})) { throw "SetWindowPos SWP_FRAMECHANGED failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
if (-not [NativeWindow]::ShowWindow($handle, ${SW_RESTORE})) { throw "ShowWindow restore failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
`;
  return buildEncodedPowerShellCommand(decodedScript);
}

function buildEncodedPowerShellCommand(decodedScript: string): WindowsCommand {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(decodedScript, 'utf16le').toString('base64')],
    decodedScript,
  };
}
