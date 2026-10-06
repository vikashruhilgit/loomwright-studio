// The protected-folder list and check (D31): pure path logic against a temp
// home dir, with real symlinks in the temp dir only.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTECTED_LOCATIONS, isProtectedPath, protectedLocationsText } from "../src/protected-paths.js";

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-protected-"));
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("PROTECTED_LOCATIONS", () => {
  it("is ~/Documents, ~/Desktop, ~/Downloads and iCloud Drive", () => {
    expect(PROTECTED_LOCATIONS).toEqual(["Documents", "Desktop", "Downloads", join("Library", "Mobile Documents")]);
    expect(protectedLocationsText()).toBe("~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents");
  });
});

describe("isProtectedPath", () => {
  it("each location and anything inside it, whether it exists or not", () => {
    for (const location of PROTECTED_LOCATIONS) {
      expect(isProtectedPath(join(home, location), home)).toBe(true);
      expect(isProtectedPath(join(home, location, "a", "b"), home)).toBe(true);
    }
    mkdirSync(join(home, "Documents", "repo"), { recursive: true });
    expect(isProtectedPath(join(home, "Documents", "repo"), home)).toBe(true);
    expect(isProtectedPath(join(home, "Documents", "repo", "not-yet"), home)).toBe(true);
  });

  it("is case-insensitive (APFS) and works on a path-segment boundary", () => {
    expect(isProtectedPath(join(home, "documents", "repo"), home)).toBe(true);
    expect(isProtectedPath(join(home, "DESKTOP"), home)).toBe(true);
    expect(isProtectedPath(join(home, "Documents2", "repo"), home)).toBe(false);
    expect(isProtectedPath(join(home, "DocumentsX"), home)).toBe(false);
  });

  it("other paths are not protected: the home dir itself, its other dirs, outside the home dir", () => {
    for (const path of [home, join(home, "code", "repo"), join(home, ".loomwright-studio", "app", "1.0.0"), join(home, "Library", "Caches"), "/tmp", join(tmp, "Documents")]) {
      expect(isProtectedPath(path, home)).toBe(false);
    }
  });

  it("resolves symlinks: a link into a protected folder is protected, one out of it is still under it as written", () => {
    mkdirSync(join(home, "Desktop", "repo"), { recursive: true });
    symlinkSync(join(home, "Desktop", "repo"), join(tmp, "link"));
    expect(isProtectedPath(join(tmp, "link"), home)).toBe(true);
    expect(isProtectedPath(join(tmp, "link", "sub", "not-yet"), home)).toBe(true);

    // A symlinked home: the location is compared as written and resolved.
    symlinkSync(home, join(tmp, "home-link"));
    expect(isProtectedPath(join(home, "Downloads", "x"), join(tmp, "home-link"))).toBe(true);
    expect(isProtectedPath(join(tmp, "home-link", "Downloads", "x"), home)).toBe(true);

    // Out of a protected folder by a link inside it: reaching it still goes through the folder.
    mkdirSync(join(tmp, "elsewhere"));
    mkdirSync(join(home, "Documents"));
    symlinkSync(join(tmp, "elsewhere"), join(home, "Documents", "out"));
    expect(isProtectedPath(join(home, "Documents", "out"), home)).toBe(true);
    expect(isProtectedPath(join(tmp, "elsewhere"), home)).toBe(false);
  });

  it("a relative path resolves against the cwd", () => {
    expect(isProtectedPath("relative/dir", home)).toBe(isProtectedPath(join(process.cwd(), "relative", "dir"), home));
  });
});
