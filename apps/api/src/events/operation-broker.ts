import type { OperationEventDto } from "@anima/shared";

type OperationListener = (event: OperationEventDto) => void;

export class OperationEventBroker {
  private readonly listeners = new Map<
    string,
    Set<OperationListener>
  >();

  publish(event: OperationEventDto): void {
    for (const listener of this.listeners.get(event.operationId) ?? []) {
      listener(event);
    }
  }

  subscribe(
    operationId: string,
    listener: OperationListener,
  ): () => void {
    let group = this.listeners.get(operationId);
    if (!group) {
      group = new Set();
      this.listeners.set(operationId, group);
    }
    group.add(listener);
    return () => {
      group?.delete(listener);
      if (group?.size === 0) this.listeners.delete(operationId);
    };
  }
}
