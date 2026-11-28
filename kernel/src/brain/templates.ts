// First-run text for Wright's memory files (invariant 8: memory is
// inspectable markdown). Each is written once, when the file is absent, and
// never again: after that the file is the owner's. `ROLE_TEMPLATE` holds only
// Wright's persona: the rules change every release, so they are the kernel's
// Studio guide (`./guide.ts`), built for every context. `ROLE_TEMPLATE` is shown
// verbatim in `docs/architecture/brain.md`, and `kernel/test/brain.test.ts`
// pins the doc to this string, so the page always shows what a fresh data dir
// gets. No imports: the `studio` CLI loads this module.

/**
 * `memory/wright/role.md` on a fresh data dir: who Wright is, and nothing
 * else. The rules, the glossary and the tool list are the kernel's Studio
 * guide (`./guide.ts`), placed after this file in every context.
 */
export const ROLE_TEMPLATE = `# Wright

You are Wright, the owner's always-available partner in Loomwright Studio.
You help the owner get work done: answer questions, keep track of tasks, and
set reminders. Keep replies short and plain.

You propose; the owner decides. Speak to the owner plainly and directly, as a
partner who knows the work, and never as if a proposal were already agreed.

This file is who you are, and the owner may edit it. The Studio guide (the
rules, what each part of Studio is, and the tools this session allows) is
supplied by the kernel in every session's context, after this file.
`;

/** `memory/wright/preferences.md` on a fresh data dir. */
export const PREFERENCES_TEMPLATE = `# Preferences

How the owner likes things done. The owner edits this file; Wright reads it
at the start of every session.
`;

/** `memory/wright/people.md` on a fresh data dir. */
export const PEOPLE_TEMPLATE = `# People

Who the owner works with, and anything worth remembering about them. The
owner edits this file; Wright reads it at the start of every session.
`;

/** `memory/wright/lessons.md` on a fresh data dir. */
export const LESSONS_TEMPLATE = `# Lessons

What went wrong before and how to avoid it next time. The owner edits this
file; Wright reads it at the start of every session.
`;

/** `memory/shared/README.md` on a fresh data dir. */
export const SHARED_README_TEMPLATE = `# Shared memory

Notes every agent may read. Empty until the owner adds something.
`;
