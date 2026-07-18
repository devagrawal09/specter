import { randomUUID } from "node:crypto";
import { Db, MongoClient } from "mongodb";
import {
  ApprovalDocument,
  HistoryDocument,
  PublicApproval,
  PublicReturn,
  ReminderDocument,
  ReturnDocument,
  toPublicApproval,
  toPublicReturn,
} from "../domain/models.js";
import { assertRefundApprovable } from "../domain/refund-decision.js";
import { AppError, isDuplicateKeyError } from "../errors.js";
import { JobRepository } from "../repositories/job-repository.js";

export interface CreateReturnInput {
  orderId: string;
  customerId: string;
  itemSku: string;
  reason: string;
  refundAmountCents: number;
}

export interface ApprovalResult {
  return: PublicReturn;
  approval: PublicApproval;
}

export class ReturnService {
  private readonly jobs: JobRepository;

  constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.jobs = new JobRepository(db);
  }

  async list(): Promise<PublicReturn[]> {
    const documents = await this.db
      .collection<ReturnDocument>("returns")
      .find({})
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    return documents.map(toPublicReturn);
  }

  async get(id: string): Promise<PublicReturn> {
    const document = await this.db.collection<ReturnDocument>("returns").findOne({ _id: id });
    if (document === null) {
      throw new AppError(404, "RETURN_NOT_FOUND", "Return was not found.");
    }
    return toPublicReturn(document);
  }

  async create(input: CreateReturnInput): Promise<PublicReturn> {
    const now = this.clock();
    const id = `ret-${randomUUID()}`;
    const document: ReturnDocument = {
      _id: id,
      ...input,
      status: "requested",
      currency: "USD",
      receivedAt: null,
      inspectedAt: null,
      inspectionResult: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const reminderDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.db.collection<ReturnDocument>("returns").insertOne(document, { session });
        await this.db.collection<HistoryDocument>("returnHistory").insertOne(
          {
            _id: `history:${id}:requested`,
            returnId: id,
            eventKey: "requested",
            eventType: "return.requested",
            occurredAt: now,
            metadata: {},
          },
          { session },
        );
        await this.db.collection<ReminderDocument>("reminders").insertOne(
          {
            _id: `reminder:${id}`,
            returnId: id,
            dueAt: reminderDueAt,
            state: "scheduled",
            cancelledAt: null,
            sentAt: null,
          },
          { session },
        );
        await this.jobs.scheduleReminder(id, reminderDueAt, session);
      });
      return toPublicReturn(document);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(409, "RETURN_ALREADY_EXISTS", "A return already exists for this order.");
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async receive(id: string): Promise<PublicReturn> {
    const now = this.clock();
    const document = await this.db.collection<ReturnDocument>("returns").findOneAndUpdate(
      { _id: id, status: "requested", receivedAt: null },
      {
        $set: { status: "received", receivedAt: now, updatedAt: now },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (document === null) {
      const existing = await this.db.collection<ReturnDocument>("returns").findOne({ _id: id });
      if (existing === null) {
        throw new AppError(404, "RETURN_NOT_FOUND", "Return was not found.");
      }
      throw new AppError(409, "INVALID_RETURN_STATE", "Only a requested return can be received.");
    }
    await this.db.collection<HistoryDocument>("returnHistory").updateOne(
      { returnId: id, eventKey: "received" },
      {
        $setOnInsert: {
          _id: `history:${id}:received`,
          returnId: id,
          eventKey: "received",
          eventType: "return.received",
          occurredAt: now,
          metadata: {},
        },
      },
      { upsert: true },
    );
    return toPublicReturn(document);
  }

  async inspect(id: string, outcome: "accepted" | "rejected"): Promise<PublicReturn> {
    const now = this.clock();
    const status = outcome === "accepted" ? "inspected" : "rejected";
    const document = await this.db.collection<ReturnDocument>("returns").findOneAndUpdate(
      { _id: id, status: "received", receivedAt: { $ne: null }, inspectedAt: null },
      {
        $set: {
          status,
          inspectedAt: now,
          inspectionResult: outcome,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (document === null) {
      const existing = await this.db.collection<ReturnDocument>("returns").findOne({ _id: id });
      if (existing === null) {
        throw new AppError(404, "RETURN_NOT_FOUND", "Return was not found.");
      }
      throw new AppError(409, "INVALID_RETURN_STATE", "Only a received return can be inspected.");
    }
    await this.db.collection<HistoryDocument>("returnHistory").updateOne(
      { returnId: id, eventKey: "inspected" },
      {
        $setOnInsert: {
          _id: `history:${id}:inspected`,
          returnId: id,
          eventKey: "inspected",
          eventType: "return.inspected",
          occurredAt: now,
          metadata: { outcome },
        },
      },
      { upsert: true },
    );
    return toPublicReturn(document);
  }

  async approveRefund(id: string): Promise<ApprovalResult> {
    const session = this.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const returns = this.db.collection<ReturnDocument>("returns");
        const current = await returns.findOne({ _id: id }, { session });
        if (current === null) {
          throw new AppError(404, "RETURN_NOT_FOUND", "Return was not found.");
        }

        assertRefundApprovable(current);
        const approvedAt = this.clock();
        const updated = await returns.findOneAndUpdate(
          { _id: id, status: "inspected", version: current.version },
          {
            $set: { status: "refunded", updatedAt: approvedAt },
            $inc: { version: 1 },
          },
          { returnDocument: "after", session },
        );
        if (updated === null) {
          throw new AppError(409, "RETURN_CHANGED", "Return changed while refund was being approved.");
        }

        const approval: ApprovalDocument = {
          _id: `approval:${id}`,
          returnId: id,
          amountCents: current.refundAmountCents,
          currency: current.currency,
          approvedAt,
          processedAt: null,
          providerReference: null,
        };
        await this.db.collection<ApprovalDocument>("approvals").insertOne(approval, { session });
        await this.db.collection<HistoryDocument>("returnHistory").insertOne(
          {
            _id: `history:${id}:refund-approved`,
            returnId: id,
            eventKey: "refund-approved",
            eventType: "refund.approved",
            occurredAt: approvedAt,
            metadata: { amountCents: current.refundAmountCents, currency: current.currency },
          },
          { session },
        );
        await this.db.collection<ReminderDocument>("reminders").updateOne(
          { returnId: id, state: "scheduled" },
          { $set: { state: "cancelled", cancelledAt: approvedAt } },
          { session },
        );
        await this.jobs.cancelReminder(id, approvedAt, session);
        await this.jobs.queueRefund(id, approvedAt, session);

        return { return: toPublicReturn(updated), approval: toPublicApproval(approval) };
      });

      if (result === undefined) {
        throw new AppError(500, "TRANSACTION_ABORTED", "Refund approval transaction did not commit.");
      }
      return result;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(409, "REFUND_ALREADY_APPROVED", "Refund was already approved for this return.");
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
