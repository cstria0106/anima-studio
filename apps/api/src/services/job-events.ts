import type { JobEventDto } from "@anima/shared";
import {
  eventToDto,
  type NewEvent,
  StudioRepository,
} from "../db/repository";
import { JobEventBroker } from "../events/broker";

export class JobEventService {
  constructor(
    private readonly repository: StudioRepository,
    readonly broker: JobEventBroker,
  ) {}

  append(input: NewEvent): JobEventDto {
    const event = eventToDto(this.repository.addEvent(input));
    this.broker.publish(event);
    return event;
  }

  list(jobId: string, afterId = 0): JobEventDto[] {
    return this.repository
      .listEvents(jobId, afterId)
      .map((row) => eventToDto(row));
  }
}
