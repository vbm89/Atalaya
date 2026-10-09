import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

function runRefusing(script) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", "./scripts/register-ts-ext.mjs", script],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${script} did not exit`));
    }, 20000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe("local tick guards", () => {
  for (const script of ["scripts/watch-tick.mjs", "scripts/paper-tick.mjs"]) {
    it(`${script} exits before a cycle when DATABASE_URL is missing`, async () => {
      const { code, out } = await runRefusing(script);
      assert.equal(code, 1);
      assert.match(out, /DATABASE_URL is required/);
      assert.doesNotMatch(out, /"status"|"decisions"|"processed"/);
    });
  }
});
