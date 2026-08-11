# skills — Domain knowledge

This directory contains reusable Workshop knowledge and Agent Skills. It must not encode conventions that belong to one downstream Workshop repository.

## Selection principles

- Prioritize repeatedly observed Workshop-specific constraints: execution semantics, event frequency, high-frequency performance, state and lifecycle, damage/healing semantics, bot AI, OverPy/OSTW usage, and Workshop code review.
- Do not attempt to document the entire platform.
- Agent-facing content must be concise, explicit, and supported by concrete Workshop reasoning. Replace vague advice such as "optimize performance" with an actionable constraint.

## Canonical language

Skill instructions and descriptions are authored in English. This is a repository and distribution convention, not a response-language restriction: a skill may answer a user in the user's language when the requested artifact and canonical technical terms allow it.

Published skills follow a canonical English instruction surface; a future skill generator must emit the same surface and must not bypass that check. Multilingual examples belong in evaluation data, not in maintained instructions.

## Standalone installation

Every published skill must remain useful when installed by itself. Refer to optional companion skills by their exact skill names, not by sibling file paths. If portable supporting material is needed, keep it inside that skill directory and reference it with a relative path. Downstream repository documents are optional context and must not be required for the skill to load.

## Adding a skill

1. Create a directory named after the skill with a `SKILL.md` file.
2. Explain when to use it, its core rules, and the Workshop reasoning behind them.
3. Cite traceable sources from `references/` instead of copying large references into the skill.
4. Cover reusable behavior changes with a deterministic consistency check or regression case in the private source repository.
