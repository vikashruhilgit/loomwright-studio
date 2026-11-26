# 24b — Launch Pad's auto-gate answer runs in a ticket run

## Status: superseded by 25c (gate-auto.sh admitted; its exclusion reason was false)

**Observed live (2026-11-20, session 249, Loomwright 18.1.2).**
- At Launch Pad Phase 6 (SAVE) the session asked Loomwright's deterministic answer seat for the `LP-SAVE` gate: `bash …/18.1.2/scripts/gate-auto.sh decide LP-SAVE --offered "Save and exit" --offered "Refine further" --offered "Edit sections" --offered "Discard" --runfile .supervisor/a…` was denied `bash_prefix_not_allowed` (event 37984). The session then saved the brief anyway (`## Phase 6: SAVE — saved …`), so the gate was answered by the model, not by `gate-auto.sh`, and no decision line reached the run file.
- At the end, `gate-auto.sh list .supervisor/automate/automate-2026-11-20-001.md` was denied the same way (38095).

**Why it matters.** `gate-auto.sh` is the deterministic seat for `auto`-tier gates: it reads the catalog and the run file and prints one `answer`/`ask` line. Denying it moves the answer from a script to the model, which is the opposite of the kernel's "an LLM never owns its own lifecycle" direction. Item 23m listed `gate-auto.sh` only under `--parallel` lanes; this run shows the inline phases call it too.

**Ask.** Read `gate-auto.sh` (`decide`, `list`; which files it writes) and admit the read-and-answer subcommands for the ticket run if they only touch the run's own run file and `.supervisor/`; otherwise give it a kernel-owned path. Verify on the next live run that `LP-SAVE` is answered by the script.
