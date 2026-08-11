# adapters — Integrations

This directory contains provider- or harness-specific integrations, such as Codex, Deep Code, OpenCode, and DeepSeek adapters.

## Conventions

- Keep provider and harness behavior at the boundary; do not leak it into shared Workshop knowledge or evaluation layers unless unavoidable.
- Keep this directory empty until a concrete integration has a near-term use.
- Describe every maintained adapter in English and keep credentials outside the repository.
