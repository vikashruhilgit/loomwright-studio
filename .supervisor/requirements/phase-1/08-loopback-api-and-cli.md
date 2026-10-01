# 08: Loopback API, kill switch, and the `studio` CLI

## Status: ready

**Priority:** MVP

## Story

As the owner, I want to see what the kernel is doing and stop everything from a terminal, so that I stay in control before any GUI exists (invariant 3: the kill switch).

## Acceptance criteria

1. **Given** the daemon, **when** it starts, **then** it serves HTTP on `127.0.0.1` only (never `0.0.0.0`), on a port written to `~/.loomwright-studio/api.json`. Every request needs a bearer token from the Keychain item `loomwright-studio-api`, which the kernel generates on first start. A request without the right token gets 401, and the response body never echoes the token.
2. **Given** `GET /status`, **when** it's called, **then** it returns JSON with:
   - kernel version and uptime;
   - auth provider health (item 04; never the secret);
   - running sessions (id, agent, model, pgid, started);
   - pending events and wake-ups;
   - today's tokens per agent (D26 counting);
   - `cap_state` per account.
3. **Given** `POST /stop-all`, **when** it's called, **then** every session is stopped through the session manager (item 05), the loop stops taking new events until `POST /resume` is called, and both are recorded in `events`.
4. **Given** the CLI, **when** `studio status` runs, **then** it prints a short human summary of `/status` (`--json` prints the raw JSON). `studio stop --all` calls `/stop-all`. If the daemon isn't running, both exit non-zero with a one-line message.
5. **Given** a test, **when** it starts the API on a random port, **then** it asserts the 401 without the token, the loopback-only bind, and that `/stop-all` leaves no session process group alive (using the fake spawner).

## Out of scope

WebSocket streaming (phase 5 GUI). `studio ask` (phase 2).

## Dependencies

05, 06, 07.

## Risks

Low.
