# Independent Verifier

When a subagent changes the git working tree, the session can't finish until `independent-verifier:verifier` has tried to falsify the subagent's claims.

## Why

In one private repository using this workflow, roughly one in five sampled verifier reports rejected the work or found a false claim. This was a small, hand-classified sample.

## Install

Run `/plugin marketplace add tayfunyasar/independent-verifier`, then `/plugin install independent-verifier@independent-verifier`.

## Requirements

Node.js and a git repository.

## Cost

A verifier runs in its own context, and its report returns to the main session.

## Limits

Changes in the main session aren't gated. Changes outside the git working tree (MCP writes, for example) aren't detected. Parallel subagents sharing one working tree are attributed together. The verifier's read-only rule covers Bash only through its prompt.
