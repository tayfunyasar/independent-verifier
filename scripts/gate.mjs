#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const VERIFIER = "independent-verifier:verifier";

const dataDir = process.env.CLAUDE_PLUGIN_DATA;
if (!dataDir) throw new Error("independent-verifier: CLAUDE_PLUGIN_DATA is not set");

const input = JSON.parse(readFileSync(0, "utf8"));
function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const sessionDir = path.join(dataDir, "sessions", input.session_id);
const pendingDir = path.join(sessionDir, "pending");
const baselineDir = path.join(sessionDir, "baseline");

function workingTreeState() {
  const refs = git(input.cwd, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads");
  const worktrees = git(input.cwd, "worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => {
      const cwd = line.slice("worktree ".length);
      return {
        cwd,
        head: git(cwd, "rev-parse", "HEAD").trim(),
        status: git(cwd, "status", "--porcelain"),
      };
    });
  return JSON.stringify({ refs, worktrees });
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
    if (input.agent_type === VERIFIER) {
      if (
        input.last_assistant_message?.includes("accepted") &&
        !input.last_assistant_message.includes("rejected")
      ) {
        rmSync(pendingDir, { recursive: true, force: true });
      }
    } else if (before !== after) {
      mkdirSync(pendingDir, { recursive: true });
      writeFileSync(path.join(pendingDir, input.agent_id), input.agent_type ?? "");
    }
    break;
  }
  case "Stop": {
    const pending = existsSync(pendingDir) ? readdirSync(pendingDir) : [];
    if (pending.length > 0) {
      process.stdout.write(
        JSON.stringify({
          decision: "block",
          reason:
            `Agents ${pending.join(", ")} changed the working tree and no accepted ${VERIFIER} verdict exists. ` +
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
