// repoOfRemote reads `owner/repo` only from a remote whose host is exactly
// github.com; a spoofed remote that merely contains `github.com/<o>/<r>` must
// not read as that repo (it would make a foreign checkout the agent's workspace).
import { describe, expect, it } from "vitest";
import { repoOfRemote } from "../src/automate/checkout.js";

describe("repoOfRemote", () => {
  it.each([
    ["https://github.com/o/r", "o/r"],
    ["https://github.com/o/r.git", "o/r"],
    ["https://github.com/o/r/", "o/r"],
    ["http://github.com/o/r.git", "o/r"],
    ["https://user@github.com/o/r", "o/r"],
    ["https://user:tok@github.com/o/r.git", "o/r"],
    ["HTTPS://GitHub.COM/Owner/Repo.git", "Owner/Repo"],
    ["git@github.com:o/r", "o/r"],
    ["git@github.com:o/r.git", "o/r"],
    ["ssh://git@github.com/o/r", "o/r"],
    ["ssh://git@github.com/o/r.git", "o/r"],
    ["  git@github.com:my-org/my.repo_1.git  ", "my-org/my.repo_1"],
  ])("accepts %s", (url, want) => {
    expect(repoOfRemote(url)).toBe(want);
  });

  it.each([
    "https://evil.example/github.com/x/y",
    "https://evil.example/github.com/x/y.git",
    "git@evil.example:github.com/x/y",
    "ssh://git@evil.example/github.com/x/y",
    "https://github.com.evil.example/x/y",
    "git@github.com.evil.example:x/y",
    "ssh://git@github.com.evil.example/x/y",
    "https://evilgithub.com/x/y",
    "git@evilgithub.com:x/y",
    "https://github.com@evil.example/x/y",
    "https://evil.example?github.com/x/y",
    "file:///tmp/github.com/x/y",
    "/tmp/github.com/x/y",
    "github.com/x/y",
    "https://github.com/x",
    "https://github.com/x/y/z",
    "https://github.com/../y",
    "https://gitlab.com/x/y",
    "",
  ])("rejects %s", (url) => {
    expect(repoOfRemote(url)).toBeUndefined();
  });
});
