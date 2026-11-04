'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCloseWindowPs } = require('./window-close');

test('an explicit HWND uses its real Win32 owner, not MainWindowHandle', () => {
  const script = buildCloseWindowPs({ hwnd: '19926542' });
  assert.match(script, /GetWindowThreadProcessId\(\$targetHwnd/);
  assert.match(script, /PostMessage\(\$targetHwnd, 0x0010/);
  assert.doesNotMatch(script, /MainWindowHandle/);
  assert.match(script, /WINDOW_NOT_FOUND/);
  assert.match(script, /requested_window_still_open/);
});

test('an HWND plus PID never silently targets a different window', () => {
  const script = buildCloseWindowPs({ hwnd: '12345', pid: 17 });
  assert.match(script, /WINDOW_OWNER_MISMATCH: requested pid=17/);
});

test('protected authentication process is refused on both selector paths', () => {
  for (const script of [
    buildCloseWindowPs({ hwnd: '8' }),
    buildCloseWindowPs({ pid: 2 }, () => '$proc = Get-Process -Id 2'),
  ]) {
    assert.match(script, /CredentialUIBroker/);
    assert.match(script, /PROTECTED_AUTH_WINDOW/);
  }
});

test('Windows access-denied is explicit rather than reported as success', () => {
  const script = buildCloseWindowPs({ hwnd: '4' });
  assert.match(script, /GetLastWin32Error/);
  assert.match(script, /WINDOW_CLOSE_ACCESS_DENIED/);
  assert.match(script, /if \(-not \$sent\)/);
});

test('malformed and oversized handles are refused before reaching PowerShell', () => {
  for (const hwnd of ['0', '-5', '2; Remove-Item', "1'", '9223372036854775808', '9'.repeat(1000)]) {
    assert.throws(() => buildCloseWindowPs({ hwnd }), /positive decimal Win32 handle/);
  }
});

test('PID/title path retains existing resolver and reports refused close', () => {
  const script = buildCloseWindowPs({ title: 'Notepad' }, () => '$proc = Get-Process notepad; $matchedBy = "title"');
  assert.match(script, /Get-Process notepad/);
  assert.match(script, /CloseMainWindow\(\)/);
  assert.match(script, /WINDOW_CLOSE_FAILED/);
});
