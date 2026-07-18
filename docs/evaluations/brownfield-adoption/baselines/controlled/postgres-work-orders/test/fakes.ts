import { randomUUID } from 'node:crypto';
import { DomainError } from '../src/domain/errors';
import { decideClose, type WorkOrder, type WorkOrderStatus } from '../src/domain/work-order';
import type { EventResult, HistoryEntry, WorkOrderStore } from '../src/store';

const now = '2025-02-01T12:00:00.000Z';

function fixture(
  id: string,
  status: WorkOrderStatus,
  inspectionPassed: boolean,
  closedAt: string | null = null,
): WorkOrder {
  return {
    id,
    title: `Fixture ${id}`,
    status,
    inspectionPassed,
    closedAt,
    version: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

export class MemoryStore implements WorkOrderStore {
  readonly records = new Map<string, WorkOrder>([
    ['WO-1001', fixture('WO-1001', 'in_progress', true)],
    ['WO-1002', fixture('WO-1002', 'open', true)],
    ['WO-1003', fixture('WO-1003', 'in_progress', false)],
    ['WO-1004', fixture('WO-1004', 'closed', true, '2025-01-02T00:00:00.000Z')],
    ['WO-1005', fixture('WO-1005', 'cancelled', true)],
  ]);

  private readonly histories = new Map<string, HistoryEntry[]>();

  async list(): Promise<WorkOrder[]> {
    return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<WorkOrder | null> {
    return this.records.get(id) ?? null;
  }

  async create(input: { id: string; title: string }): Promise<WorkOrder> {
    if (this.records.has(input.id)) {
      throw new DomainError(409, 'WORK_ORDER_EXISTS', `Work order ${input.id} already exists`);
    }
    const record = { ...fixture(input.id, 'open', false), title: input.title };
    this.records.set(input.id, record);
    return record;
  }

  async setInspection(id: string, passed: boolean): Promise<WorkOrder> {
    const record = this.requireRecord(id);
    const updated = { ...record, inspectionPassed: passed, version: record.version + 1, updatedAt: now };
    this.records.set(id, updated);
    return updated;
  }

  async history(id: string): Promise<HistoryEntry[] | null> {
    if (!this.records.has(id)) return null;
    return this.histories.get(id) ?? [];
  }

  async requestReminder(id: string): Promise<EventResult> {
    return { eventId: randomUUID(), workOrder: this.requireRecord(id) };
  }

  async close(id: string, _requestedBy: string): Promise<EventResult> {
    const record = this.requireRecord(id);
    const decision = decideClose(record.status, record.inspectionPassed);
    if (!decision.accepted) {
      throw new DomainError(409, decision.code, decision.message, {
        status: record.status,
        inspectionPassed: record.inspectionPassed,
      });
    }
    const updated: WorkOrder = {
      ...record,
      status: 'closed',
      closedAt: now,
      updatedAt: now,
      version: record.version + 1,
    };
    this.records.set(id, updated);
    return { eventId: '00000000-0000-4000-8000-000000000001', workOrder: updated };
  }

  private requireRecord(id: string): WorkOrder {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
    }
    return record;
  }
}
