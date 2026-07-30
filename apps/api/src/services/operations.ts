import type {
  OperationDto,
  OperationEventDto,
  OperationKind,
  OperationStatus,
} from "@anima/shared";
import type {
  NewSystemOperationEvent,
  StudioRepository,
} from "../db/repository";
import { OperationEventBroker } from "../events/operation-broker";

export interface OperationProgress
  extends Omit<NewSystemOperationEvent, "operationId"> {
  status?: OperationStatus;
  metadata?: Record<string, unknown>;
  error?: string | null;
}

export class OperationService {
  constructor(
    private readonly repository: StudioRepository,
    readonly broker = new OperationEventBroker(),
  ) {}

  create(
    kind: OperationKind,
    phase: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): OperationDto {
    return this.createWithId(
      crypto.randomUUID(),
      kind,
      phase,
      message,
      metadata,
    );
  }

  createWithId(
    id: string,
    kind: OperationKind,
    phase: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): OperationDto {
    this.repository.createSystemOperation({
      id,
      kind,
      phase,
      message,
      metadata,
    });
    this.report(id, { phase, message });
    return this.get(id);
  }

  get(id: string): OperationDto {
    const operation = this.repository.findSystemOperation(id);
    if (!operation) throw new Error(`System operation not found: ${id}`);
    return operation;
  }

  list(limit = 50): OperationDto[] {
    return this.repository.listSystemOperations(limit);
  }

  events(
    operationId: string,
    afterId = 0,
    limit = 1_000,
  ): OperationEventDto[] {
    this.get(operationId);
    return this.repository.listSystemOperationEvents(
      operationId,
      afterId,
      limit,
    );
  }

  start(id: string, phase: string, message: string): OperationDto {
    this.repository.updateSystemOperation(id, {
      status: "running",
      phase,
      message,
      error: null,
      startedAt: new Date().toISOString(),
    });
    this.report(id, { phase, message, status: "running" });
    return this.get(id);
  }

  report(id: string, progress: OperationProgress): OperationEventDto {
    const current = this.get(id);
    const event = this.repository.addSystemOperationEvent({
      operationId: id,
      phase: progress.phase,
      message: progress.message,
      ...(progress.progress !== undefined
        ? { progress: progress.progress }
        : {}),
      ...(progress.current !== undefined
        ? { current: progress.current }
        : {}),
      ...(progress.total !== undefined ? { total: progress.total } : {}),
      ...(progress.bytesCompleted !== undefined
        ? { bytesCompleted: progress.bytesCompleted }
        : {}),
      ...(progress.bytesTotal !== undefined
        ? { bytesTotal: progress.bytesTotal }
        : {}),
      ...(progress.bytesPerSecond !== undefined
        ? { bytesPerSecond: progress.bytesPerSecond }
        : {}),
      ...(progress.payload !== undefined
        ? { payload: progress.payload }
        : {}),
    });
    this.repository.updateSystemOperation(id, {
      phase: progress.phase,
      message: progress.message,
      metadata: progress.metadata ?? current.metadata,
      ...(progress.status !== undefined ? { status: progress.status } : {}),
      ...(progress.progress !== undefined
        ? { progress: progress.progress }
        : {}),
      ...(progress.error !== undefined ? { error: progress.error } : {}),
    });
    this.broker.publish(event);
    return event;
  }

  complete(
    id: string,
    phase = "completed",
    message = "Operation completed.",
    metadata?: Record<string, unknown>,
  ): OperationDto {
    this.repository.updateSystemOperation(id, {
      status: "completed",
      phase,
      message,
      progress: 100,
      metadata: metadata ?? this.get(id).metadata,
      error: null,
      completedAt: new Date().toISOString(),
    });
    this.report(id, {
      phase,
      message,
      progress: 100,
      status: "completed",
      ...(metadata ? { metadata } : {}),
    });
    return this.get(id);
  }

  fail(id: string, error: unknown, phase = "failed"): OperationDto {
    const message =
      error instanceof Error ? error.message : String(error);
    this.repository.updateSystemOperation(id, {
      status: "failed",
      phase,
      message,
      error: message,
      completedAt: new Date().toISOString(),
    });
    this.report(id, {
      phase,
      message,
      status: "failed",
      error: message,
    });
    return this.get(id);
  }

  cancel(id: string, message = "Operation cancelled."): OperationDto {
    this.repository.updateSystemOperation(id, {
      status: "cancelled",
      phase: "cancelled",
      message,
      completedAt: new Date().toISOString(),
    });
    this.report(id, {
      phase: "cancelled",
      message,
      status: "cancelled",
    });
    return this.get(id);
  }
}
