import { PhysicsRuntime } from '../engine/commands';
import { config } from '../engine/configuration';
import { initPhysics } from '../engine/world';
import { commandSchema, PROTOCOL_VERSION } from '../engine/protocol';

const port = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};
const runtime = new PhysicsRuntime((response) => port.postMessage(response));
// Serialize initialization and all discrete commands: a reset/release can never be lost.
let queue = initPhysics();
port.onmessage = (event) => {
  queue = queue
    .then(() => {
      runtime.handle(event.data);
    })
    .catch((failure: unknown) => {
      const parsed = commandSchema.safeParse(event.data);
      if (parsed.success)
        port.postMessage({
          protocolVersion: PROTOCOL_VERSION,
          sessionId: parsed.data.sessionId,
          sequence: 1,
          type: 'error',
          message:
            failure instanceof Error
              ? failure.message.slice(0, 500)
              : 'Physics initialization failed.',
        });
    });
};
setInterval(() => runtime.advance(performance.now()), config.schedulerIntervalMs);
