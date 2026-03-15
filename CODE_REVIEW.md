# Code Review Report (RopotysViewer)

## Scope
- Electron main/preload process security and IPC surface.
- Database and parser integration code.
- Renderer-side data flow and UX correctness.

## Findings

### 1) Hardcoded SQL credentials in repository (High)
**Where:**
- `src/main/dataHandlers.ts`
- `python/read_trajectories.py`
- `python/read_inferno_fires.py`

**Why this matters:**
Hardcoded usernames/passwords in source code can leak through git history, logs, screenshots, and packaged binaries. This is a direct secret-management risk and increases blast radius if one environment is compromised.

**Recommendation:**
- Move DB host/user/password to environment variables.
- Add startup validation that fails fast when env vars are missing.
- Rotate the currently committed password.

### 2) Path traversal risk in custom `maps://` protocol handler (High)
**Where:** `src/main/index.ts`

**Why this matters:**
The handler uses `request.url.replace('maps://', '')` and joins it directly to `mapsDir`. Without normalization and boundary checks, crafted URLs like `maps://../...` may escape the maps directory and read arbitrary files readable by the app process.

**Recommendation:**
- Parse URL safely.
- Normalize the resolved path.
- Enforce that final path starts with the normalized maps root.
- Return 403 for out-of-root requests.

### 3) Electron renderer sandbox disabled (Medium)
**Where:** `src/main/index.ts`

**Why this matters:**
Even with `contextIsolation: true` and `nodeIntegration: false`, disabling sandbox increases impact if renderer compromise occurs (e.g., XSS in future features/plugins).

**Recommendation:**
- Set `sandbox: true` unless there is a documented blocker.
- If a blocker exists, document it and create a mitigation plan.

### 4) Non-portable Python executable resolution in IPC data loading (Medium)
**Where:** `src/main/dataHandlers.ts`

**Why this matters:**
Several handlers force `python/venv/Scripts/python.exe` (Windows path). On Linux/macOS this can silently fail and return empty arrays, causing hidden data-loss behavior instead of explicit failure.

**Recommendation:**
- Reuse the robust Python fallback strategy already used in `parser:parse` (`venv/Scripts`, `venv/bin`, `python3`, `python`).
- Surface explicit errors when Python cannot start.

### 5) Preload unsubscribe removes all listeners globally (Low)
**Where:** `src/preload/index.ts`

**Why this matters:**
`removeAllListeners(channel)` can remove listeners created by other components, causing hard-to-debug UI races when multiple subscriptions are active.

**Recommendation:**
- Capture the exact handler function and call `removeListener(channel, handler)`.

### 6) UI hover delete action likely not appearing (Low)
**Where:** `src/renderer/src/sidebar/DemoList.tsx`

**Why this matters:**
Delete button uses `group-hover:opacity-100`, but parent row is missing the `group` class, so hover reveal may never trigger.

**Recommendation:**
- Add `group` class to the parent row or remove `group-hover` usage.

## Validation performed
- `npm run build` completed successfully.

## Suggested remediation order
1. High severity: credentials + `maps://` traversal.
2. Medium severity: sandbox + Python portability.
3. Low severity: listener cleanup + hover UX polish.
