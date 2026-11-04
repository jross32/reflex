'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { buildCloseWindowPs } = require('./window-close');

const encodePs = (source) => Buffer.from(source, 'utf16le').toString('base64');

function runPowerShell(source, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(source)], {
      windowsHide: true,
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('a genuine owned secondary HWND accepts WM_CLOSE without desktop input injection', {
  skip: process.platform !== 'win32',
  timeout: 18000,
}, async () => {
  const source = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.add_FormClosed({ [System.Windows.Forms.Application]::ExitThread() })
$handle = $form.Handle
[Console]::WriteLine('HWND=' + $handle.ToInt64())
[Console]::Out.Flush()
[System.Windows.Forms.Application]::Run()
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encodePs(source)], {
    windowsHide: true,
  });
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (data) => { output += data.toString('utf8'); });
  child.stderr.on('data', (data) => { errorOutput += data.toString('utf8'); });

  try {
    const hwnd = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test window startup timed out: ' + errorOutput)), 7000);
      child.stdout.on('data', () => {
        const match = output.match(/HWND=(\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error('test window exited early: ' + code + ' ' + errorOutput)); });
    });
    const closed = await runPowerShell(buildCloseWindowPs({ hwnd }), 8000);
    assert.equal(closed.code, 0, closed.stderr + closed.stdout);
    assert.match(closed.stdout, /CloseWindow matchedBy=hwnd/);
    const exited = child.exitCode !== null ? child.exitCode : await Promise.race([
      new Promise((resolve) => child.once('exit', (code) => resolve(code))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test window did not close')), 3000)),
    ]);
    assert.equal(exited, 0, errorOutput);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
