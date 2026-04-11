import type { IngestEvent, IngestSource } from './source.js';

/**
 * `QueueSubscriber` — placeholder for the Phase 5+ orchestrator contract.
 *
 * The orchestration engineer (per the project memory) is separately
 * building a message-queue contract that will feed events into Pinakes.
 * When that lands, this class becomes a real subscriber. Until then it
 * exists so:
 *   1. The `IngestSource` interface has both implementations the codebase
 *      expects, exercising the contract in type-check
 *   2. `serve.ts` can document the swap-in seam (commented `// const source = new QueueSubscriber(...)`)
 *   3. Phase 5 doesn't have to add a new file — only fill this one in
 *
 * Both methods throw `not implemented` — calling them is a programming
 * error in Phase 2.
 */
export class QueueSubscriber implements IngestSource {
  async start(_onEvent: (ev: IngestEvent) => Promise<void>): Promise<void> {
    throw new Error(
      'QueueSubscriber.start() not implemented — pending orchestrator message-queue contract'
    );
  }

  async stop(): Promise<void> {
    throw new Error(
      'QueueSubscriber.stop() not implemented — pending orchestrator message-queue contract'
    );
  }
}
