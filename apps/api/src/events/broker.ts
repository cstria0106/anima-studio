import type { JobEventDto } from "@anima/shared";

type Listener = (event: JobEventDto) => void;

export class JobEventBroker {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(event: JobEventDto): void {
    for (const listener of this.listeners.get(event.jobId) ?? []) {
      listener(event);
    }
  }

  subscribe(jobId: string, listener: Listener): () => void {
    let group = this.listeners.get(jobId);
    if (!group) {
      group = new Set();
      this.listeners.set(jobId, group);
    }
    group.add(listener);
    return () => {
      group?.delete(listener);
      if (group?.size === 0) this.listeners.delete(jobId);
    };
  }
}
