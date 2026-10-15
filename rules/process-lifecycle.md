# Process lifecycle & RAM protection

Agents start servers, watchers, test runners, browsers and MCP servers — and too often leave them running. On a laptop that ends in swap storms and crashes. **If you start a process for a task, you own its cleanup, including its children.**

## Before launching anything long-lived or heavy

1. **Know the project root** (git/workspace root of the app you are working on). Never treat the home directory or a parent folder as the root.
2. **Look first:** run `forge procs` (MCP: `process_snapshot`) to see what already runs for this project and how much memory it holds. Reuse a compatible service — same executable, cwd, config and port, and healthy — instead of starting a duplicate. A matching port alone is not proof.
3. **Check headroom:** `forge doctor` shows free memory. Under ~20% free, do not start heavy work.
4. **Start only what the task needs now.** Prefer one-shot commands (`vitest run`, `tsc --noEmit`) over watch modes and dev servers.

## Bounds

- **One heavy job at a time** (build, typecheck, test suite, e2e, package install). forge's gate commands enforce this per project with a command slot (`resources.maxConcurrentCommands`, default 1) shared by every agent.
- **Cap test workers** (e.g. vitest `maxWorkers: 2`, jest `--maxWorkers=2`, pytest-xdist `-n 2`) on machines with ≤ 16 GB.
- **One browser automation session per task.** No speculative Playwright, DevTools or extra profiles.
- **No unlimited auto-restart.** If a process keeps respawning, child counts keep rising or memory pressure worsens: stop launching, capture `forge procs --json`, stop the task-owned spawning parent and its descendants, and investigate. At most two startup attempts before changing approach.
- A bigger heap limit (`--max-old-space-size`) is not a fix for process multiplication.

## Record it

Keep a local, untracked `AGENT_PROCESSES.md` at the project root (`forge procs init` creates one) with three sections: rules, active processes, lifecycle history. Record long-running or heavy processes with host/user, owner task, purpose, state (`STARTING`, `RUNNING`, `REUSED`, `STOP_REQUESTED`, `STOPPED`, `EXITED`, `FAILED`, `CLEANUP_FAILED`, `HANDED_OVER`), UTC times, PID/PPID/PGID with start time, redacted command, cwd, port, and observed RSS (label it as RSS, not virtual size). Agents sharing a project share this file — never overwrite another agent's rows.

## Cleanup is part of the task

As soon as a process you started is no longer needed:

1. Re-verify its identity (PID + start time + command + cwd). PIDs get reused; a stored PID or port is not authority to kill.
2. Ask it to stop normally (SIGTERM / its own shutdown command), wait briefly, check again, then stop remaining **verified task-owned** descendants. Kill a whole process group only if every member is yours.
3. Verify the wrapper, server, workers and watchdogs are gone and the port is free. Record the verified exit.
4. Before your final response, run `forge procs` again: nothing you started should remain unless the user asked for it to stay up — then record it as `HANDED_OVER` with how to stop it.

forge itself follows this: gate commands run in their own process group, which is stopped on exit, timeout or Ctrl-C — including background jobs the command left behind — and the forge MCP server exits when its host disconnects.

## Never

- `killall node`, `pkill -f node`, or any broad kill.
- Stop the user's browser, another project's services, the agent host/CLI, its plugin hooks, or MCP servers the host started (they are host-managed — explain config changes instead).
- Delete projects, databases or caches as "cleanup".
- Claim an OS-enforced memory guarantee: these are process rules, not a sandbox.
