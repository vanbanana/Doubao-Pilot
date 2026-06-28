# Test Plan — PR #2: Agentify 豆包 transcript (hide raw JSON/XML machinery)

## What changed (user-visible)
Before (PR #1): the 豆包 conversation showed our injected machinery as raw text — the
full tool-protocol preamble inside the user's bubble, and `<tool name="…">{json}</tool>`
+ `<task_complete/>` inside the assistant's bubble (see prior screenshot).
After (PR #2): `dom-cleanup.ts` masks all that machinery in place, so the conversation
reads as clean prose; the structured tool execution still appears in the card panel.

Evidence the plan is grounded in code:
- Masking patterns: `src/core/ui/dom-cleanup.ts:172` (`computeMaskRanges`) — preamble
  `SENTINEL…## 用户任务`, `<tool …>…</tool>`, `<task_complete/>`, continuation/nudge turns.
- Per-turn masking + empty-turn hiding: `dom-cleanup.ts:81` (`transformTranscript`).
- Card panel still renders events: `src/core/ui/overlay.ts:247` (`renderAgentEvent`).

## Primary flow (recorded)
Trigger a fresh agent run that emits a tool call, and verify the transcript is clean.

1. Open a NEW chat on doubao.com (so we see fresh rendering, not stale DOM).
2. In the composer type a task that forces a `shell_exec` tool call, e.g.
   `用 shell 执行 echo doubao-pilot-verify-123 并把真实输出告诉我`. Press send.
3. Observe the conversation as the agent runs to completion.

### Pass/fail assertions (each would look different if the change were broken)
- **A1 (user bubble clean):** The user's message bubble must NOT contain the strings
  `你现在具备调用本机工具的能力`, `## 可用工具`, or `## 规则`. It should show only the
  real task text (`用 shell 执行 echo doubao-pilot-verify-123 …`) plus the small
  "豆包 Pilot" chip. — If broken, the full protocol preamble would be visible (as in PR #1).
- **A2 (assistant bubble clean):** No assistant bubble in the conversation may contain the
  literal substrings `<tool name=` or `<task_complete`. — If broken, the raw XML
  `<tool name="shell_exec">{"command": …}</tool>` would be visible (as in PR #1 screenshot).
- **A3 (no continuation noise):** The transcript must NOT show a user turn containing
  `[工具执行结果]` or `（原始任务回顾：`. — If broken, the auto-sent continuation prompt
  would appear as a raw user message.
- **A4 (card panel works):** The "豆包 Pilot · 执行过程" card panel must appear inline with
  at least one step card and a `shell_exec` tool card whose result shows the real output
  `doubao-pilot-verify-123`. — Confirms masking didn't break the agent/exec path.
- **A5 (final answer present):** A final answer (native 豆包 bubble and/or card "最终回答")
  must contain `doubao-pilot-verify-123`, proving the answer came from real execution.

## Verification method
- Use the page DOM (read_dom / saved HTML) to grep for the forbidden substrings for
  A1–A3 (objective string presence/absence), plus screenshots for visual confirmation.
- Screenshot the final state for A4/A5.

## Out of scope
- Browser-control tools, popup self-check, anti-detection pacing (unchanged this PR).
- Regression of multi-step browser_* flows (covered by PR #1 E2E).
