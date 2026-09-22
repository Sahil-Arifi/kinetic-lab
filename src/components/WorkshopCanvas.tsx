import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Euler, Group, OrthographicCamera, Plane, Vector3 } from 'three';
import type { BodyDocument, SceneDocument, Vec3 } from '../engine/scene-schema';
import type { Transform } from '../engine/protocol';
import { clampDepth, clampVec3 } from '../input/pointer';
import { isPrimaryInteraction, resolvePointerIntent } from '../input/touch';
import { createMetricBuffer, recordMetric, summarizeMetric } from '../metrics/runtime';
import { CUP_WALL_THICKNESS } from '../scenes/primitives';

interface Props {
  scene: SceneDocument;
  selectedId: string | null;
  transforms: RefObject<Map<string, Transform>>;
  playing: boolean;
  mode: 'object' | 'orbit';
  goal: boolean;
  depth: number;
  interactionEpoch: number;
  zoom: number;
  focus: Vec3;
  onSelect: (id: string) => void;
  onBeginGrab: (id: string, target: Vec3) => void;
  onMoveGrab: (target: Vec3) => void;
  onEndGrab: (cancelled?: boolean) => void;
  onEditPosition: (id: string, position: Vec3) => void;
  onDepth: (depth: number) => void;
  onSample: (interval: number, drawCalls: number) => void;
}
interface DragState {
  id: string;
  plane: Plane;
  offset: Vector3;
  normal: Vector3;
  base: Vector3;
  target: Vector3;
  startDepth: number;
  moved: boolean;
  paused: boolean;
}
interface CaptureTarget {
  setPointerCapture: (id: number) => void;
  hasPointerCapture: (id: number) => boolean;
  releasePointerCapture: (id: number) => void;
}
const asVec = (point: Vector3): Vec3 => ({
  x: point.x,
  y: point.y,
  z: point.z,
});

function Cup({
  body,
  selected,
  complete,
}: {
  body: BodyDocument;
  selected: boolean;
  complete: boolean;
}) {
  const { x: w, y: h, z: d } = body.dimensions;
  const t = Math.min(CUP_WALL_THICKNESS, w / 5, h / 5, d / 5);
  const parts: {
    size: [number, number, number];
    position: [number, number, number];
  }[] = [
    { size: [w, t, d], position: [0, -h / 2 + t / 2, 0] },
    { size: [w, h, t], position: [0, 0, -d / 2 + t / 2] },
    { size: [w, h, t], position: [0, 0, d / 2 - t / 2] },
    { size: [t, h, d - 2 * t], position: [w / 2 - t / 2, 0, 0] },
    { size: [t, h * 0.2, d - 2 * t], position: [-w / 2 + t / 2, -h * 0.4, 0] },
  ];
  return (
    <>
      {parts.map((part, index) => (
        <mesh key={index} castShadow receiveShadow position={part.position}>
          <boxGeometry args={part.size} />
          <meshStandardMaterial
            color={complete ? '#bed0a1' : '#bbbea8'}
            roughness={0.65}
            emissive={selected ? '#6a4126' : '#000000'}
            emissiveIntensity={0.13}
          />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -h / 2 + t + 0.005, 0]}>
        <ringGeometry args={[Math.min(w, d) * 0.24, Math.min(w, d) * 0.28, 48]} />
        <meshBasicMaterial color={complete ? '#e0f4bc' : '#eeead7'} />
      </mesh>
    </>
  );
}

function BenchGrid({ body }: { body: BodyDocument }) {
  const vertices = useMemo(() => {
    const points: number[] = [];
    const halfX = body.dimensions.x / 2;
    const halfZ = body.dimensions.z / 2;
    for (let x = -halfX; x <= halfX; x += 0.5) points.push(x, 0, -halfZ, x, 0, halfZ);
    for (let z = -halfZ; z <= halfZ; z += 0.5) points.push(-halfX, 0, z, halfX, 0, z);
    return new Float32Array(points);
  }, [body.dimensions.x, body.dimensions.z]);
  return (
    <lineSegments
      position={[body.position.x, body.position.y + body.dimensions.y / 2 + 0.01, body.position.z]}
      rotation={[body.rotation.x, body.rotation.y, body.rotation.z]}
    >
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[vertices, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#687267" transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}

function Body({
  body,
  selected,
  complete,
  transforms,
  drag,
  onDown,
  onMove,
  onUp,
}: {
  body: BodyDocument;
  selected: boolean;
  complete: boolean;
  transforms: Props['transforms'];
  drag: RefObject<DragState | null>;
  onDown: (e: ThreeEvent<PointerEvent>, body: BodyDocument) => void;
  onMove: (e: ThreeEvent<PointerEvent>) => void;
  onUp: (e: ThreeEvent<PointerEvent>, cancelled?: boolean) => void;
}) {
  const group = useRef<Group>(null);
  const rotation = useRef(new Euler());
  useFrame(() => {
    if (!group.current) return;
    const active = drag.current;
    const snapshot = transforms.current.get(body.id);
    if (active?.id === body.id && active.moved && active.paused)
      group.current.position.copy(active.target);
    else if (snapshot) {
      group.current.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
      group.current.quaternion.set(
        snapshot.rotation.x,
        snapshot.rotation.y,
        snapshot.rotation.z,
        snapshot.rotation.w,
      );
    } else {
      group.current.position.set(body.position.x, body.position.y, body.position.z);
      group.current.quaternion.setFromEuler(
        rotation.current.set(body.rotation.x, body.rotation.y, body.rotation.z),
      );
    }
  });
  const isBench = body.id === 'workbench';
  const color =
    body.type === 'sphere'
      ? '#ee754f'
      : isBench
        ? '#424747'
        : body.type === 'fixedBarrier'
          ? '#919992'
          : body.type === 'domino'
            ? '#e4d6bb'
            : '#bdbaa9';
  return (
    <group
      ref={group}
      position={[body.position.x, body.position.y, body.position.z]}
      rotation={[body.rotation.x, body.rotation.y, body.rotation.z]}
      onPointerDown={(event) => onDown(event, body)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={(event) => onUp(event, true)}
    >
      {body.type === 'targetCup' ? (
        <Cup body={body} selected={selected} complete={complete} />
      ) : (
        <mesh castShadow={!isBench} receiveShadow>
          {body.type === 'sphere' ? (
            <sphereGeometry args={[body.dimensions.x / 2, 36, 24]} />
          ) : (
            <boxGeometry args={[body.dimensions.x, body.dimensions.y, body.dimensions.z]} />
          )}
          <meshStandardMaterial
            color={color}
            roughness={body.type === 'sphere' ? 0.25 : 0.72}
            metalness={body.type === 'sphere' ? 0.24 : body.type === 'fixedBarrier' ? 0.32 : 0.03}
            emissive={selected ? '#bd522a' : '#000000'}
            emissiveIntensity={selected ? 0.13 : 0}
          />
        </mesh>
      )}
      {body.type === 'domino' && (
        <mesh position={[0, body.dimensions.y * 0.13, body.dimensions.z / 2 + 0.002]}>
          <boxGeometry args={[body.dimensions.x * 0.75, 0.022, 0.004]} />
          <meshStandardMaterial color="#a38e71" />
        </mesh>
      )}
      {selected && !isBench && (
        <Html
          center
          position={[0, body.dimensions.y / 2 + 0.48, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="body-label">{body.name}</div>
        </Html>
      )}
      {body.id === 'marble' && (
        <Html center style={{ pointerEvents: 'none' }}>
          <span className="body-anchor" data-testid="body-anchor-marble" aria-hidden="true" />
        </Html>
      )}
    </group>
  );
}

function Scene(
  props: Props & {
    setDragging: (value: boolean) => void;
    drag: RefObject<DragState | null>;
  },
) {
  const { camera, size } = useThree();
  const previousFocus = useRef(new Vector3(0.4, 1, 0));
  const lastSample = useRef(0);
  const intervals = useRef(createMetricBuffer(120));
  const { drag } = props;
  const { interactionEpoch, setDragging, depth, playing, onMoveGrab, zoom, focus } = props;
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.min(size.width / 23.5, size.height / 12) * zoom;
      const nextFocus = new Vector3(focus.x, focus.y, focus.z);
      camera.position.add(nextFocus.clone().sub(previousFocus.current));
      previousFocus.current.copy(nextFocus);
      camera.lookAt(nextFocus);
      camera.updateProjectionMatrix();
    }
  }, [camera, size, zoom, focus]);
  useEffect(() => {
    drag.current = null;
    setDragging(false);
  }, [interactionEpoch, drag, setDragging]);
  useEffect(() => {
    const active = drag.current;
    if (!active) return;
    active.target.copy(active.base).addScaledVector(active.normal, depth - active.startDepth);
    active.moved = true;
    if (playing) onMoveGrab(clampVec3(asVec(active.target), -40, 40));
  }, [depth, playing, onMoveGrab, drag]);
  useFrame((state, delta) => {
    intervals.current = recordMetric(intervals.current, delta * 1000);
    if (state.clock.elapsedTime - lastSample.current >= 0.5) {
      props.onSample(summarizeMetric(intervals.current).average, state.gl.info.render.calls);
      lastSample.current = state.clock.elapsedTime;
    }
  });
  const down = (event: ThreeEvent<PointerEvent>, body: BodyDocument) => {
    if (props.mode === 'orbit' || !isPrimaryInteraction(event.nativeEvent)) return;
    event.stopPropagation();
    props.onSelect(body.id);
    if (resolvePointerIntent(event.pointerType, props.mode, body.bodyMode === 'dynamic') !== 'grab')
      return;
    const current = props.transforms.current.get(body.id)?.position ?? body.position;
    const center = new Vector3(current.x, current.y, current.z);
    const normal = camera.getWorldDirection(new Vector3());
    drag.current = {
      id: body.id,
      plane: new Plane().setFromNormalAndCoplanarPoint(normal, event.point),
      offset: event.point.clone().sub(center),
      normal,
      base: center.clone(),
      target: center.clone(),
      startDepth: props.depth,
      moved: false,
      paused: !props.playing,
    };
    (event.target as unknown as CaptureTarget).setPointerCapture(event.pointerId);
    props.setDragging(true);
    if (props.playing) props.onBeginGrab(body.id, current);
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    const active = drag.current;
    if (!active) return;
    event.stopPropagation();
    const hit = event.ray.intersectPlane(active.plane, new Vector3());
    if (!hit) return;
    active.base.copy(hit).sub(active.offset);
    active.target.copy(active.base).addScaledVector(active.normal, props.depth - active.startDepth);
    active.moved = true;
    if (props.playing) props.onMoveGrab(clampVec3(asVec(active.target), -40, 40));
  };
  const up = (event: ThreeEvent<PointerEvent>, cancelled = false) => {
    const active = drag.current;
    if (!active) return;
    event.stopPropagation();
    const captureTarget = event.target as unknown as CaptureTarget;
    if (captureTarget.hasPointerCapture(event.pointerId))
      captureTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    props.setDragging(false);
    if (props.playing) props.onEndGrab(cancelled);
    else if (active.moved && !cancelled)
      props.onEditPosition(active.id, clampVec3(asVec(active.target), -40, 40));
  };
  return (
    <>
      <color attach="background" args={['#272d2e']} />
      <ambientLight intensity={0.7} />
      <hemisphereLight color="#fff2d9" groundColor="#343f43" intensity={1.65} />
      <directionalLight
        position={[-4, 12, 6]}
        intensity={3.2}
        color="#fff1d8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
        shadow-radius={3}
        shadow-normalBias={0.03}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[6, 5, -8]} intensity={0.8} color="#bfdae1" />
      <mesh receiveShadow position={[0, -0.43, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#272d2e" roughness={1} />
      </mesh>
      {props.scene.bodies
        .filter((body) => body.id === 'workbench')
        .map((body) => (
          <BenchGrid key={body.id} body={body} />
        ))}
      {props.scene.bodies.map((body) => (
        <Body
          key={body.id}
          body={body}
          selected={body.id === props.selectedId}
          complete={props.goal}
          transforms={props.transforms}
          drag={drag}
          onDown={down}
          onMove={move}
          onUp={up}
        />
      ))}
      <OrbitControls
        makeDefault
        enabled={props.mode === 'orbit' && !drag.current}
        target={[focus.x, focus.y, focus.z]}
        minZoom={10}
        maxZoom={150}
        minPolarAngle={0.18}
        maxPolarAngle={Math.PI / 2.08}
        enableDamping={false}
      />
    </>
  );
}

export function WorkshopCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const { depth, onDepth } = props;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (drag.current) {
        event.preventDefault();
        onDepth(clampDepth(depth + event.deltaY * 0.005));
      }
    };
    const key = (event: KeyboardEvent) => {
      if (drag.current && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        onDepth(clampDepth(depth + (event.key === 'ArrowUp' ? -0.15 : 0.15)));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [depth, onDepth]);
  return (
    <div
      ref={host}
      className={`canvas-host ${dragging ? 'is-dragging' : ''} mode-${props.mode}`}
      data-testid="workshop-canvas"
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        props.onEndGrab(true);
      }}
    >
      <Canvas
        shadows="soft"
        orthographic
        camera={{ position: [8.8, 12, 18], zoom: 42, near: 0.1, far: 200 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
        fallback={
          <div className="canvas-fallback">
            This browser does not support WebGL. Use the object list and inspector to edit your
            scene.
          </div>
        }
        aria-label="Interactive 3D Marble Run workbench"
      >
        <Suspense fallback={null}>
          <Scene {...props} drag={drag} setDragging={setDragging} />
        </Suspense>
      </Canvas>
    </div>
  );
}
