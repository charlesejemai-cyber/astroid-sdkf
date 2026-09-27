# astroid-sdk


[![CI](https://github.com/ASTROIDX556/astroid-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ASTROIDX556/astroid-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Built%20on-Stellar-7C3AED)](https://stellar.org)
[![Drips Wave](https://img.shields.io/badge/Drips-Stellar%20Wave-blue)](https://www.drips.network/wave/stellar)


> TypeScript SDK — the **developer surface** of Astroid, the Financial Operating System for autonomous AI agents on Stellar. Built for the [Drips Stellar Wave Program](https://www.drips.network/wave/stellar).

`astroid-sdk` is a TypeScript monorepo that provides typed clients, React hooks, and CLI tooling so developers can integrate Astroid into their own applications and agent runtimes. Closes #31

## Packages

| Package | Description |
|---|---|
| `@astroid/client` | Typed HTTP client for the Astroid REST API |
| `@astroid/types` | Shared entity and DTO type definitions |
| `@astroid/react` | React hooks (TanStack Query) + `<AstroidProvider>` |
| `@astroid/agent` | Agent resource methods: create, list, update |
| `@astroid/wallet` | Wallet resource methods |
| `@astroid/transaction` | Transaction building and submission helpers |
| `@astroid/policy` | Policy CRUD and simulation |
| `@astroid/budget` | Budget resource methods |
| `@astroid/analytics` | Analytics and metrics |
| `@astroid/auth` | Auth resource methods |
| `@astroid/notification` | Notification services |
