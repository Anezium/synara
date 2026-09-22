import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBatchExecutableResolver, resolveExecutable } from "./executable";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "synara-executable-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createBatchExecutableResolver", () => {
  it("matches resolveExecutable across PATH order, PATHEXT, and missing entries", () => {
    const first = makeTempDir();
    const second = makeTempDir();
    writeFileSync(join(first, "tool.cmd"), "");
    writeFileSync(join(second, "tool.exe"), "");
    writeFileSync(join(second, "other.CMD"), "");
    writeFileSync(join(second, "bare"), "");
    mkdirSync(join(second, "folder.exe"));
    const env = {
      PATH: [join(first, "missing"), first, second].join(";"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const options = { platform: "win32" as const, env };
    const resolve = createBatchExecutableResolver(options);

    for (const command of ["tool", "other", "bare", "folder", "absent", "tool.exe"]) {
      expect(resolve(command), command).toBe(resolveExecutable(command, options));
    }
    // Exact casing of the hit depends on the host filesystem's case sensitivity.
    expect(resolve("tool")?.toLowerCase()).toBe(join(first, "tool.cmd").toLowerCase());
    expect(resolve("other")?.toLowerCase()).toBe(join(second, "other.cmd").toLowerCase());
    expect(resolve("bare")).toBeNull();
    expect(resolve("folder")).toBeNull();
  });

  it("delegates qualified commands to resolveExecutable", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "tool.exe"), "");
    const options = { platform: "win32" as const, env: { PATH: "", PATHEXT: ".EXE" } };

    expect(createBatchExecutableResolver(options)(join(dir, "tool"))).toBe(
      resolveExecutable(join(dir, "tool"), options),
    );
  });
});
