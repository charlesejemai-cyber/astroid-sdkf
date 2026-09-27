import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  TransactionStatus,
  WebhookEvent,
  ApiErrorCode,
  type ApiSuccessResponse,
  type WebhookEventEnvelope,
  type Transaction,
} from './index.js';

describe('@astroid/types', () => {
  it('mirrors the API enum values exactly', () => {
    expect(TransactionStatus.COMPLETED).toBe('COMPLETED');
    expect(ApiErrorCode.POLICY_VIOLATION).toBe('POLICY_VIOLATION');
  });

  it('exposes dot.case webhook event names matching the API contract', () => {
    expect(WebhookEvent.TRANSACTION_COMPLETED).toBe('transaction.completed');
    expect(WebhookEvent.WALLET_UPDATED).toBe('wallet.updated');
    expect(WebhookEvent.PROPOSAL_CREATED).toBe('proposal.created');
    expect(WebhookEvent.POLICY_VIOLATED).toBe('policy.violated');
    expect(WebhookEvent.BUDGET_EXCEEDED).toBe('budget.exceeded');
  });

  it('types the success envelope as { success, data, meta, requestId }', () => {
    const res: ApiSuccessResponse<{ id: string }> = {
      success: true,
      data: { id: 'wal_1' },
      requestId: 'req_123',
    };
    expect(res.success).toBe(true);
    expect(res.data.id).toBe('wal_1');
  });

  it('narrows webhook event data by event name at the type level', () => {
    expectTypeOf<
      WebhookEventEnvelope<'transaction.completed'>['data']
    >().toEqualTypeOf<Transaction>();
  });
});
