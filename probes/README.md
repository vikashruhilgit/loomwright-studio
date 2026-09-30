# SDK probes

Each script answers one NEEDS VERIFICATION item in `docs/OPEN_QUESTIONS.md` against the real SDK; the result, SDK version and date are recorded there. They are evidence, not kernel code.

```bash
cd probes && npm install
node p1-bundled-binary.mjs
```

The SDK is pinned to the version the results were recorded against. Re-run after an upgrade and update the recorded result if it changes.
