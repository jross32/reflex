'use strict';

// Generate a narrowly scoped Windows close request. This uses no keyboard or
// cursor injection, and never attempts to defeat a protected authentication UI.
const PROTECTED_PROCESS_GUARD = `
if ($proc.ProcessName -in @('CredentialUIBroker', 'LogonUI', 'consent')) {
  throw "PROTECTED_AUTH_WINDOW: Windows authentication UI must be dismissed by the signed-in user; Reflex will not bypass it."
}`;

function buildCloseWindowPs(selector, resolveMainWindowPs) {
  if (!selector || typeof selector !== 'object') throw new Error('window selector required');

  if (selector.hwnd) {
    const hwnd = String(selector.hwnd).trim();
    if (!/^\d+$/.test(hwnd) || hwnd.length > 19 || BigInt(hwnd) <= 0n || BigInt(hwnd) > 9223372036854775807n) {
      throw new Error('hwnd must be a positive decimal Win32 handle');
    }
    const expectedPid = selector.pid == null ? null : Number(selector.pid);
    if (expectedPid !== null && (!Number.isSafeInteger(expectedPid) || expectedPid <= 0)) {
      throw new Error('pid must be a positive integer');
    }
    const pidCheck = expectedPid === null ? '' : `
if ($ownerPid -ne [uint32]${expectedPid}) {
  throw "WINDOW_OWNER_MISMATCH: requested pid=${expectedPid}, actual pid=$ownerPid"
}`;

    return `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReflexWindowCloseNative {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@ -ErrorAction Stop
$targetHwnd = [IntPtr]([long]'${hwnd}')
if (-not [ReflexWindowCloseNative]::IsWindow($targetHwnd)) {
  throw "WINDOW_NOT_FOUND: hwnd=${hwnd} no longer exists"
}
$ownerPid = [uint32]0
[ReflexWindowCloseNative]::GetWindowThreadProcessId($targetHwnd, [ref]$ownerPid) | Out-Null
if ($ownerPid -eq 0) { throw "WINDOW_OWNER_UNKNOWN: hwnd=${hwnd}" }
${pidCheck}
$proc = Get-Process -Id $ownerPid -ErrorAction Stop
${PROTECTED_PROCESS_GUARD}
$sent = [ReflexWindowCloseNative]::PostMessage($targetHwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
if (-not $sent) {
  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($code -eq 5) {
    throw "WINDOW_CLOSE_ACCESS_DENIED: Windows refused WM_CLOSE for hwnd=${hwnd}; user interaction may be required"
  }
  throw "WINDOW_CLOSE_FAILED: WM_CLOSE hwnd=${hwnd} Win32Error=$code"
}
Start-Sleep -Milliseconds 150
$stillOpen = [ReflexWindowCloseNative]::IsWindow($targetHwnd)
$result = if ($stillOpen) { 'requested_window_still_open' } else { 'closed' }
"CloseWindow matchedBy=hwnd pid=$ownerPid result=$result"
`;
  }

  if (typeof resolveMainWindowPs !== 'function') {
    throw new Error('process window resolver required for pid/title selectors');
  }
  return `
${resolveMainWindowPs(selector)}
${PROTECTED_PROCESS_GUARD}
$ok = $proc.CloseMainWindow()
if (-not $ok) { throw "WINDOW_CLOSE_FAILED: CloseMainWindow returned false for pid=$($proc.Id)" }
"CloseWindow matchedBy=$matchedBy pid=$($proc.Id) result=requested"
`;
}

module.exports = { buildCloseWindowPs };
