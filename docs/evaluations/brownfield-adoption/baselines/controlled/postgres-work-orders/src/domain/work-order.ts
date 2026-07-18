export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'closed', 'cancelled'] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export interface WorkOrder {
  id: string;
  title: string;
  status: WorkOrderStatus;
  inspectionPassed: boolean;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CloseRejectionCode =
  | 'ALREADY_CLOSED'
  | 'INVALID_STATUS'
  | 'INSPECTION_REQUIRED';

export type CloseDecision =
  | { accepted: true }
  | { accepted: false; code: CloseRejectionCode; message: string };

/** Pure policy used after the database row has been locked. */
export function decideClose(
  status: WorkOrderStatus,
  inspectionPassed: boolean,
): CloseDecision {
  if (status === 'closed') {
    return {
      accepted: false,
      code: 'ALREADY_CLOSED',
      message: 'Work order is already closed',
    };
  }

  if (status !== 'in_progress') {
    return {
      accepted: false,
      code: 'INVALID_STATUS',
      message: `Work order cannot be closed from status ${status}`,
    };
  }

  if (!inspectionPassed) {
    return {
      accepted: false,
      code: 'INSPECTION_REQUIRED',
      message: 'A passed inspection is required before closing the work order',
    };
  }

  return { accepted: true };
}
