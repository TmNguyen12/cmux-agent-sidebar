import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALL = fileURLToPath(new URL("../install.sh", import.meta.url));
const SOURCE = readFileSync(fileURLToPath(new URL("../sidebars/agents.js", import.meta.url)), "utf8");

// A throwaway HOME with a stub `cmux` that only records its arguments.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "agents-install-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const log = join(root, "cmux.log");
  writeFileSync(join(bin, "cmux"), `#!/bin/bash\necho "$*" >> "${log}"\n`);
  chmodSync(join(bin, "cmux"), 0o755);
  const run = () => execFileSync("bash", [INSTALL], {
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  const sidebars = join(home, ".config/cmux/sidebars");
  const cmuxLog = () => readFileSync(log, "utf8");
  return { root, home, sidebars, run, cmuxLog };
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort();
}

test("install writes only the sidebar file and validates it", () => {
  const s = sandbox();
  try {
    s.run();
    assert.deepEqual(filesUnder(s.home), [".config/cmux/sidebars/agents.js"]);
    assert.equal(readFileSync(join(s.sidebars, "agents.js"), "utf8"), SOURCE);
    assert.match(s.cmuxLog(), /^sidebar validate agents$/m);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("re-running an unchanged install makes no backup", () => {
  const s = sandbox();
  try {
    s.run();
    s.run();
    assert.deepEqual(readdirSync(s.sidebars), ["agents.js"]);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a different existing agents.js is backed up before it is replaced", () => {
  const s = sandbox();
  try {
    mkdirSync(s.sidebars, { recursive: true });
    writeFileSync(join(s.sidebars, "agents.js"), "// mine\n");
    s.run();
    const files = readdirSync(s.sidebars).sort();
    assert.equal(files.length, 2);
    assert.match(files[1], /^agents\.js\.bak\.\d+$/);
    assert.equal(readFileSync(join(s.sidebars, files[1]), "utf8"), "// mine\n");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("install refuses to run without cmux on PATH", () => {
  const s = sandbox();
  try {
    assert.throws(() => execFileSync("bash", [INSTALL], {
      env: { HOME: s.home, PATH: "/usr/bin:/bin" },
      stdio: "pipe",
    }));
    assert.deepEqual(filesUnder(s.home), []);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
