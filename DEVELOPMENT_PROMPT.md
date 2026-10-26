# HP Printer Adapter Development Prompt

You are implementing the ioBroker adapter `hpprinter` in this workspace. Read the root `AGENTS.md` and follow it as the governing project policy. Preserve the existing Creator scaffold and user changes. Do not publish, release, tag, push, create a GitHub repository, or change version numbers.

## Product goal

Build a maintainable ioBroker adapter that monitors HP network printers, with the HP LaserJet Pro MFP M479fdn as the first real validation target. The longer-term goal is broad HP printer coverage, but do not claim universal compatibility. Local network support is the initial implementation target. HP cloud support is optional future work and must not be implemented against undocumented/private endpoints or guessed authentication flows.

## Engineering constraints

- Keep adapter runtime code and tests in TypeScript. Compile the runtime to `build/` before packaging; do not add JavaScript source files.
- Inspect the actual scaffold, installed package versions, and relevant tests before editing.
- Verify protocol and device behavior from credible, current sources or direct reproducible evidence. Distinguish supported behavior from assumptions in code and documentation.
- Prefer standard, established printer protocols and maintained libraries over bespoke protocol implementations. Keep network timeouts, response sizes, polling concurrency, and retries bounded.
- Credentials and device responses must not leak into logs. Validate addresses, ports, credentials, payload types, and numeric values.
- A failed/unreachable printer is not the same as a printer reporting zero, idle, or no supplies. Expose availability and errors accurately.
- Use ioBroker state metadata correctly (`type`, valid `role`, `read`, `write`, units and translations). Keep IDs stable and names understandable. A command state must validate input and acknowledge only real outcomes.
- Poll only configured printers; do not scan the user's whole network without explicit configuration and consent. Avoid overlapping polling cycles and stop all timers/requests on unload.
- Keep configuration simple and usable in the existing JSON Admin UI. Do not add unsupported/unused options.
- Update the English README and its WORK IN PROGRESS changelog for user-visible behavior, using the required `- (Voodoo2man) ` prefix and past tense. Consider `common.news.NEXT` in `io-package.json` with required translations and the maximum-entry policy in `AGENTS.md`. Keep package and adapter versions aligned and unchanged for this ordinary development task.
- Do not add a test that merely asserts an implementation's own assumptions. Cover parsing, invalid/missing responses, offline behavior, 0/false/null boundaries, lifecycle cleanup, and state mappings where applicable.
- Run focused tests/checks after edits, then the available project gates (`npm test`, `npm run check`, `npm run lint`) as applicable. Report commands and outcomes precisely; do not claim dev-server/integration/real-device verification unless actually performed.

## MVP proposal

Use read-only IPP/2.0 as the primary local protocol, matching Home Assistant's Internet Printing Protocol integration. Query `Get-Printer-Attributes` at a user-configurable host, port, and resource path (defaults: port `631`, path `/ipp/print`), optionally over IPPS/TLS. Request printer state, marker levels, model information, and supported counters; publish only attributes actually returned. The HP LaserJet Pro MFP M479fdn remains unverified until tested against a real device. Do not implement print-job submission, configuration changes, discovery, or HP cloud integration unless specifically authorized.

## Agent task discipline

Each worker must own a disjoint set of files. Before editing, state its local hypothesis, files it will change, and focused validation. Do not edit files outside the assignment, version metadata, lockfiles, release configuration, generated dev-server files, or unrelated scaffold. If shared-file changes become necessary, report them instead of editing them. The coordinating agent integrates the work, resolves conflicts, runs repository-wide checks, updates any required docs/release notes, and reports remaining unknowns.

## Acceptance criteria

1. The adapter starts without demo states, validates configuration, and creates stable objects/states for configured printers.
2. Polling is bounded, non-overlapping, stoppable on unload, and reports online/offline/errors truthfully.
3. Device/protocol logic is isolated and testable without live hardware; tests use representative documented responses and cover malformed/unavailable data.
4. The Admin UI exposes only settings needed for the implemented verified behavior.
5. README, unreleased changelog, and `io-package.json` news agree with actual implemented scope and follow `AGENTS.md`.
6. No release, publication, remote operation, or unverified HP cloud feature is performed or claimed.