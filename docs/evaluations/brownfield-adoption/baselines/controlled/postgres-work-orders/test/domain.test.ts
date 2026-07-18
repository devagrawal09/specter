import { describe, expect, it } from 'vitest';
import { decideClose, type WorkOrderStatus } from '../src/domain/work-order';

describe('decideClose', () => {
  it.each<{
    status: WorkOrderStatus;
    passed: boolean;
    accepted: boolean;
    code?: string;
  }>([
    { status: 'in_progress', passed: true, accepted: true },
    { status: 'in_progress', passed: false, accepted: false, code: 'INSPECTION_REQUIRED' },
    { status: 'open', passed: true, accepted: false, code: 'INVALID_STATUS' },
    { status: 'cancelled', passed: true, accepted: false, code: 'INVALID_STATUS' },
    { status: 'closed', passed: true, accepted: false, code: 'ALREADY_CLOSED' },
  ])('evaluates $status with inspection=$passed', ({ status, passed, accepted, code }) => {
    const decision = decideClose(status, passed);
    expect(decision.accepted).toBe(accepted);
    if (!decision.accepted) expect(decision.code).toBe(code);
  });
});
