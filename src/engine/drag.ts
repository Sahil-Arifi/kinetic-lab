import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from './scene-schema';
import { config } from './configuration';

export const MAX_HANDLE_SPEED = config.maxGrabSpeed;

function localPoint(body: RAPIER.RigidBody, point: Vec3): Vec3 {
  const p = body.translation();
  const q = body.rotation();
  const v = { x: point.x - p.x, y: point.y - p.y, z: point.z - p.z };
  // Inverse quaternion rotation keeps the grabbed surface point under the cursor.
  const tx = 2 * (-q.y * v.z + q.z * v.y);
  const ty = 2 * (-q.z * v.x + q.x * v.z);
  const tz = 2 * (-q.x * v.y + q.y * v.x);
  return {
    x: v.x + q.w * tx - q.y * tz + q.z * ty,
    y: v.y + q.w * ty - q.z * tx + q.x * tz,
    z: v.z + q.w * tz - q.x * ty + q.y * tx,
  };
}

export class GrabConstraint {
  private handle?: RAPIER.RigidBody;
  private joint?: RAPIER.ImpulseJoint;
  private target?: Vec3;

  constructor(private readonly world: RAPIER.World) {}

  get active(): boolean {
    return this.handle !== undefined;
  }

  begin(body: RAPIER.RigidBody, target: Vec3): boolean {
    this.end();
    if (!body.isDynamic()) return false;
    this.target = { ...target };
    this.handle = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(target.x, target.y, target.z),
    );
    const mass = body.mass();
    const spring = RAPIER.JointData.spring(
      0,
      config.grabStiffness * mass,
      config.grabDamping * mass,
      { x: 0, y: 0, z: 0 },
      localPoint(body, target),
    );
    this.joint = this.world.createImpulseJoint(spring, this.handle, body, true);
    body.wakeUp();
    return true;
  }

  move(target: Vec3): void {
    if (this.handle) this.target = { ...target };
  }

  step(dt: number): void {
    if (!this.handle || !this.target) return;
    const current = this.handle.translation();
    const dx = this.target.x - current.x;
    const dy = this.target.y - current.y;
    const dz = this.target.z - current.z;
    const distance = Math.hypot(dx, dy, dz);
    const fraction = distance > 0 ? Math.min(1, (MAX_HANDLE_SPEED * dt) / distance) : 0;
    this.handle.setNextKinematicTranslation({
      x: current.x + dx * fraction,
      y: current.y + dy * fraction,
      z: current.z + dz * fraction,
    });
  }

  end(): void {
    if (this.joint) this.world.removeImpulseJoint(this.joint, true);
    if (this.handle) this.world.removeRigidBody(this.handle);
    this.joint = undefined;
    this.handle = undefined;
    this.target = undefined;
  }
}
