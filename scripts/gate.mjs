#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const VERIFIER = "independent-verifier:verifier";

const dataDir = process.env.CLAUDE_PLUGIN_DATA;
if (!dataDir) throw new Error("independent-verifier: CLAUDE_PLUGIN_DATA is not set");

const input = JSON.parse(readFileSync(0, "utf8"));
const sessionDir = path.join(dataDir, "sessions", input.session_id);
const pendingDir = path.join(sessionDir, "pending");
const baselineDir = path.join(sessionDir, "baseline");

function workingTreeState() {
  const git = (...args) => spawnSync("git", ["-C", input.cwd, ...args], { encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  if (head.error) throw head.error;
  if (head.status !== 0) return "";
  return `${head.stdout}${git("status", "--porcelain").stdout}`;
}

function saveBaseline(state) {
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(path.join(baselineDir, input.agent_id), state);
}

switch (input.hook_event_name) {
  case "SubagentStart":
    saveBaseline(workingTreeState());
    break;
  case "SubagentStop": {
    const baseline = path.join(baselineDir, input.agent_id);
    const before = existsSync(baseline) ? readFileSync(baseline, "utf8") : null;
    const after = workingTreeState();
    saveBaseline(after);
    if (input.agent_type !== VERIFIER && before !== after) {
      mkdirSync(pendingDir, { recursive: true });
      writeFileSync(path.join(pendingDir, input.agent_id), input.agent_type ?? "");
    }
    break;
  }
  case "PostToolUse":
    if (!input.agent_id && input.tool_input?.subagent_type === VERIFIER) {
      rmSync(pendingDir, { recursive: true, force: true });
    }
    break;
  case "Stop": {
    const pending = existsSync(pendingDir) ? readdirSync(pendingDir) : [];
    if (pending.length > 0) {
      process.stdout.write(
        JSON.stringify({
          decision: "block",
          reason:
            `Agents ${pending.join(", ")} changed the working tree and no ${VERIFIER} ran after them. ` +
            `Before reporting, dispatch ${VERIFIER} with the user's request verbatim and every claim ` +
            "in their reports: changed files, test and CI results, pull requests, root cause. " +
            "Report only what it accepts and send rejected claims back to the agent that made them.",
        }),
      );
    }
    break;
  }
  case "SessionEnd":
    rmSync(sessionDir, { recursive: true, force: true });
    break;
}
