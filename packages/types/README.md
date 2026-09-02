# @astroid/types

Every interface, DTO, enum, and response envelope for the Astroid platform —
the Financial Operating System for autonomous AI agents on Stellar. Developers
never hand-write Astroid types; import them from here.

```bash
pnpm add @astroid/types
```

```ts
import type { Transaction, Wallet, PolicySimulationResult } from '@astroid/types';
import { TransactionStatus, WebhookEvent } from '@astroid/types';

TransactionStatus.COMPLETED; // "COMPLETED"
WebhookEvent.TRANSACTION_COMPLETED; // "transaction.completed"
```

Includes:

- **Entities** — `Organization`, `User`, `Agent`, `Wallet`, `Policy`, `Budget`, `Transaction`, `Proposal`, `Approval`, `Notification`, `ApiKey`, `Webhook`, `Session`, `MemoryRecord`, and more.
- **Enums** — mirrored 1:1 with the `astroid-api` Prisma schema.
- **Response envelope** — `ApiResponse<T>` = `{ success, data, meta, requestId }`.
- **Pagination** — `PaginationParams`, `PaginatedResponse`, `Paginated<T>`, `PaginationMeta`, `CursorPaginationParams`, `CursorPaginated`.
- **Webhooks & events** — dot.case event names and a fully-typed `WebhookEventDataMap`.
- **AI-native** — `PaymentIntent`, `PaymentIntentResult`.

Zero runtime dependencies (enums compile to tree-shakeable `const` objects).
