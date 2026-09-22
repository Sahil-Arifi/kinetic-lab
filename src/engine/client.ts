import {
  PROTOCOL_VERSION,
  ResponseGate,
  commandPayloadSchema,
  type CommandPayload,
  type WorkerCommand,
  type WorkerResponse,
} from './protocol';
import { parseScene, type SceneDocument } from './scene-schema';

export interface WorkerPort {
  postMessage(message: WorkerCommand): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export class PhysicsClient {
  private worker: WorkerPort;
  private readonly gate = new ResponseGate(crypto.randomUUID());
  private sequence = 0;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly receive: (response: WorkerResponse) => void,
    private readonly createWorker: () => WorkerPort = () =>
      new Worker(new URL('../workers/physics.worker.ts', import.meta.url), {
        type: 'module',
        name: 'kinetic-physics',
      }),
  ) {
    this.worker = this.attach();
  }

  private attach(): WorkerPort {
    const worker = this.createWorker();
    const generation = ++this.generation;
    worker.onmessage = (event) => {
      if (this.disposed || generation !== this.generation) return;
      const response = this.gate.accept(event.data);
      if (response) this.receive(response);
    };
    worker.onerror = (event) => {
      if (this.disposed || generation !== this.generation) return;
      // Native worker failures are local diagnostics, not accepted protocol responses.
      this.receive({
        type: 'error',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: this.gate.sessionId,
        sequence: 1,
        message: event.message || 'The physics worker stopped. Restart it to continue.',
      });
    };
    return worker;
  }

  send(payload: CommandPayload): void {
    if (this.disposed) return;
    const valid = commandPayloadSchema.parse(payload);
    this.worker.postMessage({
      ...valid,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.gate.sessionId,
      sequence: ++this.sequence,
    });
  }

  private replace(scene: SceneDocument, type: 'loadScene' | 'reset'): void {
    const validated = parseScene(scene);
    this.gate.replace(crypto.randomUUID());
    this.sequence = 0;
    this.send({ type, scene: validated });
  }

  load(scene: SceneDocument): void {
    this.replace(scene, 'loadScene');
  }
  reset(scene: SceneDocument): void {
    this.replace(scene, 'reset');
  }
  restart(scene: SceneDocument): void {
    const validated = parseScene(scene);
    this.worker.terminate();
    this.disposed = false;
    this.gate.replace(crypto.randomUUID());
    this.worker = this.attach();
    this.load(validated);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Termination releases the entire worker/WASM heap, including temporary constraints.
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }
}
