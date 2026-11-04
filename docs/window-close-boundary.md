# Reflex close-window boundary — November 4, 2026

## Scope

`close_window({ hwnd })` now uses the exact Win32 window owner and an ordinary
`WM_CLOSE` request, rather than searching only a process's main window. It
refuses ambiguous HWND/PID mismatches, reports Windows error 5 explicitly, and
checks whether the window remains after a request. PID/title selectors retain
`CloseMainWindow` and report a false return as a failure.

This is a request to close an ordinary application window, **not** a forced
process termination. A window can remain open if its application displays a
save/confirmation prompt; `requested_window_still_open` is not proof of closure.

## Authentication safety boundary

The code deliberately refuses `CredentialUIBroker`, `LogonUI`, and `consent`
windows with `PROTECTED_AUTH_WINDOW`. It never elevates, kills an authentication
broker, reads credentials, injects a PIN, or bypasses Windows interactive
security. A user must dismiss an OS-owned protected prompt on their authorized
desktop. The prior live case had HWND `19926542`, PID `31204`; posting WM_CLOSE
from the existing process returned Win32 error 5 (access denied).

## Verification in the isolated worktree

```powershell
node --check mcp-server.js
node --test lib/window-close.test.js
node --test lib/window-close.integration.test.js
git diff --check
```

The integration fixture creates a hidden, normal WinForms window owned by a
disposable PowerShell process, closes it by **its actual HWND**, verifies that
the owner process exits, and kills only that disposable test process if needed.
It does not manipulate the current desktop's authentication prompt.

This branch is not installed into the running Reflex server. Activation should
wait for a normal supervised maintenance window and review of the existing
uncommitted modifications in the live Reflex working tree.
