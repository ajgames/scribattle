import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LiveStrokeInfo, StrokeInfo } from '../store';

/**
 * The shared drawing surface. Strokes are tubes swept along the pointer's
 * path on a paper plane; by default they're squashed flat + unlit so they
 * read as 2D ink, and the artist can toggle raised 3D relief per stroke.
 *
 * The camera looks straight down and the paper is sized to the canvas
 * element's aspect ratio, so the paper fills whatever space the layout gives
 * it. Because the paper fills the view exactly, pointer input is plain DOM
 * math on the wrapper element (no raycasting): normalized 0..1 coords across
 * the canvas ARE paper coords. That keeps the drawing resolution- and
 * aspect-independent (clients with different window shapes see a slightly
 * stretched, but complete, picture).
 *
 * The artist draws locally (live preview), streams progress through
 * `onStrokeProgress` (throttled) and commits the finished stroke through
 * `onStrokeEnd`; everyone renders the authoritative stroke list mirrored
 * from SpacetimeDB, plus the artist's in-flight `liveStroke`.
 */

const CAM_HEIGHT = 5;
const CAM_FOV = 45;
const INK_LIFT = 0.02; // ink floats a hair above the paper
// stack strokes a hair apart so overlapping flat ink doesn't z-fight
const LIFT_STEP = 0.0012;
// skip pointer samples closer than this (normalized) — keeps curves smooth
// and stroke payloads small
const MIN_SAMPLE_DIST = 0.005;
const MAX_POINTS_PER_STROKE = 2048; // pairs with the server's float cap
const PROGRESS_INTERVAL_MS = 100; // live-stroke stream rate (~10 fps)
// palm rejection: after any stylus contact/hover, finger touches don't paint
// for this long (a resting palm between pen strokes would otherwise scribble)
const PEN_PRIORITY_MS = 10_000;
// a second finger landing this soon after the first means a pinch/system
// gesture, not a stroke — throw the accidental mark away
const PINCH_GRACE_MS = 150;

/** World-space paper extents that exactly fill the camera's view. */
function usePaperSize(): [number, number] {
  const aspect = useThree(s => s.size.width / Math.max(1, s.size.height));
  const h = 2 * CAM_HEIGHT * Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2));
  return [h * aspect, h];
}

function toWorld(points: number[], paperW: number, paperH: number, lift: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push(
      new THREE.Vector3((points[i] - 0.5) * paperW, lift, (points[i + 1] - 0.5) * paperH)
    );
  }
  return out;
}

interface InkStrokeProps {
  points: number[];
  color: string;
  width: number;
  threeD: boolean;
  paperW: number;
  paperH: number;
  /** Stacking order — later strokes sit imperceptibly higher. */
  order: number;
}

function InkStroke({ points, color, width, threeD, paperW, paperH, order }: InkStrokeProps) {
  const geometry = useMemo(() => {
    const path = toWorld(points, paperW, paperH, INK_LIFT + order * LIFT_STEP);
    if (path.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(path);
    return new THREE.TubeGeometry(
      curve,
      Math.min(path.length * 4, 400),
      width * paperW,
      8,
      false
    );
  }, [points, width, paperW, paperH, order]);

  // geometry churns while a live stroke grows — free the replaced ones
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  // Flat ink is a squashed tube a fraction of a millimeter above the paper —
  // too close for the depth buffer, so it skips depth entirely and paints in
  // stroke order over the paper (renderOrder 0). 3D strokes have real height
  // and keep depth testing for their own shading/overlaps.
  return (
    <mesh geometry={geometry} scale={threeD ? 1 : [1, 0.02, 1]} renderOrder={1 + order}>
      {threeD ? (
        <meshStandardMaterial color={color} roughness={0.35} />
      ) : (
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      )}
    </mesh>
  );
}

/**
 * A stroke the artist released that hasn't echoed back from the server yet.
 * Kept rendered locally so the ink doesn't blink out during the round-trip.
 */
interface PendingStroke {
  key: number;
  points: number[];
  color: string;
  width: number;
  threeD: boolean;
}

interface SceneProps {
  strokes: StrokeInfo[];
  liveStroke: LiveStrokeInfo | null;
  /** Released-but-unconfirmed strokes (artist only). */
  pending: PendingStroke[];
  /** The local artist's in-progress stroke (preview before commit). */
  draft: number[] | null;
  canDraw: boolean;
  color: string;
  width: number;
  threeD: boolean;
}

/**
 * Keep R3F's notion of the canvas size honest. R3F's built-in measurement
 * watches an inner 100%-height div whose box can resolve wrong (and then
 * never change) when flex layout settles after mount — the classic symptom
 * was a squashed drawing on narrow layouts until a breakpoint crossing
 * forced a relayout. Observing the wrapper (a definite, absolutely-positioned
 * box) and pushing its size into the store sidesteps all of that.
 */
function SizeSync({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const setSize = useThree(s => s.setSize);
  const get = useThree(s => s.get);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      const { size } = get();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        (Math.abs(rect.width - size.width) > 0.5 || Math.abs(rect.height - size.height) > 0.5)
      ) {
        setSize(rect.width, rect.height);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target, setSize, get]);
  return null;
}

function Scene({ strokes, liveStroke, pending, draft, canDraw, color, width, threeD }: SceneProps) {
  const [paperW, paperH] = usePaperSize();
  return (
    <>
      {/* only 3D strokes are lit (paper + flat ink use unlit materials);
          intensities account for three's physical light units (÷π) */}
      <ambientLight intensity={2} />
      <directionalLight position={[3, 6, 2]} intensity={2.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[paperW, paperH]} />
        {/* unlit — the paper reads as crisp white no matter the lighting */}
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {strokes.map((s, i) => (
        <InkStroke
          key={s.id}
          points={s.points}
          color={s.color}
          width={s.width}
          threeD={s.threeD}
          paperW={paperW}
          paperH={paperH}
          order={i}
        />
      ))}
      {/* released strokes still in flight to the server (artist only) —
          rendering them until the authoritative row echoes back is what keeps
          the ink from blinking out on pointer-up */}
      {pending.map((p, i) => (
        <InkStroke
          key={p.key}
          points={p.points}
          color={p.color}
          width={p.width}
          threeD={p.threeD}
          paperW={paperW}
          paperH={paperH}
          order={strokes.length + i}
        />
      ))}
      {/* my in-progress stroke (artist preview) */}
      {draft && draft.length >= 4 && (
        <InkStroke
          points={draft}
          color={color}
          width={width}
          threeD={threeD}
          paperW={paperW}
          paperH={paperH}
          order={strokes.length + pending.length + 1}
        />
      )}
      {/* the artist's in-flight stroke, streamed to everyone else */}
      {!canDraw && liveStroke && liveStroke.points.length >= 4 && (
        <InkStroke
          points={liveStroke.points}
          color={liveStroke.color}
          width={liveStroke.width}
          threeD={liveStroke.threeD}
          paperW={paperW}
          paperH={paperH}
          order={strokes.length}
        />
      )}
    </>
  );
}

export interface DrawCanvasProps {
  strokes: StrokeInfo[];
  /** Someone else's in-progress stroke (ignored while you're the artist). */
  liveStroke?: LiveStrokeInfo | null;
  canDraw: boolean;
  color: string;
  /** Brush radius, normalized to paper width (server clamps 0.005–0.1). */
  width: number;
  /** Raised 3D relief for new strokes (artist tool toggle). */
  threeD?: boolean;
  onStrokeEnd: (points: number[]) => void;
  /** Throttled snapshots of the growing stroke — drives the live share. */
  onStrokeProgress?: (points: number[]) => void;
}

export function DrawCanvas({
  strokes,
  liveStroke = null,
  canDraw,
  color,
  width,
  threeD = false,
  onStrokeEnd,
  onStrokeProgress,
}: DrawCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // the in-progress stroke — ref for appending, state for rendering
  const drawing = useRef<number[] | null>(null);
  // the one pointer allowed to paint — extra fingers/palms are bystanders
  const activePointer = useRef<number | null>(null);
  const activePointerType = useRef('');
  const strokeStartedAt = useRef(0);
  // last time a stylus touched or hovered — gates touch input (palm rejection)
  const lastPenAt = useRef(-Infinity);
  const lastProgressAt = useRef(0);
  const [draft, setDraft] = useState<number[] | null>(null);
  // released strokes awaiting their server echo (see PendingStroke)
  const [pending, setPending] = useState<PendingStroke[]>([]);
  const pendingKey = useRef(0);

  // retire pending strokes as their authoritative rows arrive: the artist is
  // the only writer, so strokes come back in commit order — each new row
  // confirms the oldest pending one. A shrink means clear-canvas / turn
  // rotation; drop them all.
  const strokeCount = useRef(strokes.length);
  useEffect(() => {
    const prev = strokeCount.current;
    strokeCount.current = strokes.length;
    if (strokes.length > prev) {
      setPending(p => (p.length ? p.slice(strokes.length - prev) : p));
    } else if (strokes.length < prev) {
      setPending(p => (p.length ? [] : p));
    }
  }, [strokes.length]);

  // rebuild the draft tube at most once per frame — pointermove can fire at
  // 120Hz+ and each rebuild is a fresh TubeGeometry
  const draftRaf = useRef(0);
  function scheduleDraft() {
    if (draftRaf.current) return;
    draftRaf.current = requestAnimationFrame(() => {
      draftRaf.current = 0;
      if (drawing.current) setDraft(drawing.current.slice());
    });
  }
  useEffect(
    () => () => {
      if (draftRaf.current) cancelAnimationFrame(draftRaf.current);
    },
    []
  );

  // iPadOS: a stylus double-tap on the paper is a "select/copy image"
  // gesture that touch-action/user-select don't cover — swallow the raw
  // touch defaults entirely (drawing runs on pointer events, which still
  // fire; React can't attach non-passive touch listeners, hence native)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const swallow = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchstart', swallow, { passive: false });
    el.addEventListener('touchend', swallow, { passive: false });
    return () => {
      el.removeEventListener('touchstart', swallow);
      el.removeEventListener('touchend', swallow);
    };
  }, []);

  // dropping the brush mid-stroke (artist rotated away) shouldn't strand ink
  useEffect(() => {
    if (!canDraw) {
      drawing.current = null;
      activePointer.current = null;
      setDraft(null);
      setPending([]);
    }
  }, [canDraw]);

  // throw away the in-flight stroke without committing it (palm marks, pinch
  // gestures) — and retract the live preview other players already saw
  function cancelStroke() {
    drawing.current = null;
    activePointer.current = null;
    if (draftRaf.current) {
      cancelAnimationFrame(draftRaf.current);
      draftRaf.current = 0;
    }
    setDraft(null);
    onStrokeProgress?.([]);
  }

  function samplePoint(e: { clientX: number; clientY: number }): [number, number] {
    const rect = wrapRef.current!.getBoundingClientRect();
    return [
      THREE.MathUtils.clamp((e.clientX - rect.left) / rect.width, 0, 1),
      THREE.MathUtils.clamp((e.clientY - rect.top) / rect.height, 0, 1),
    ];
  }

  function handleDown(e: React.PointerEvent) {
    if (!canDraw || e.button !== 0) return;
    if (e.pointerType === 'pen') lastPenAt.current = performance.now();
    // palm rejection: while the stylus is in active use, fingers don't paint
    if (e.pointerType === 'touch' && performance.now() - lastPenAt.current < PEN_PRIORITY_MS) {
      return;
    }
    if (activePointer.current != null) {
      if (e.pointerType === 'pen') {
        // the palm usually lands a beat before the pencil tip — scrap the
        // palm's stroke and let the pen take over
        cancelStroke();
      } else if (
        activePointerType.current === 'touch' &&
        performance.now() - strokeStartedAt.current < PINCH_GRACE_MS
      ) {
        // two fingers down almost together = a pinch, not a drawing
        cancelStroke();
        return;
      } else {
        return; // extra fingers don't get a second brush
      }
    }
    try {
      wrapRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (tests, some pens) can't be captured — draw anyway
    }
    activePointer.current = e.pointerId;
    activePointerType.current = e.pointerType;
    strokeStartedAt.current = performance.now();
    drawing.current = [...samplePoint(e)];
    setDraft(drawing.current.slice());
  }

  function handleMove(e: React.PointerEvent) {
    // hover counts too — an approaching pencil locks out the settling palm
    if (e.pointerType === 'pen') lastPenAt.current = performance.now();
    if (e.pointerId !== activePointer.current) return;
    const pts = drawing.current;
    if (!pts) return;
    // coalesced events recover the full-rate pointer path the browser batched
    // into this one event — fast flicks stay curved instead of going straight
    const native = e.nativeEvent;
    const samples =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    let grew = false;
    for (const s of samples) {
      if (pts.length >= MAX_POINTS_PER_STROKE * 2) break;
      const [x, y] = samplePoint(s);
      const dx = x - pts[pts.length - 2];
      const dy = y - pts[pts.length - 1];
      if (Math.hypot(dx, dy) < MIN_SAMPLE_DIST) continue;
      pts.push(x, y);
      grew = true;
    }
    if (!grew) return;
    scheduleDraft();
    const now = performance.now();
    if (now - lastProgressAt.current >= PROGRESS_INTERVAL_MS) {
      lastProgressAt.current = now;
      onStrokeProgress?.(pts.slice());
    }
  }

  function handleUp(e: React.PointerEvent) {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    const pts = drawing.current;
    drawing.current = null;
    if (draftRaf.current) {
      cancelAnimationFrame(draftRaf.current);
      draftRaf.current = 0;
    }
    setDraft(null);
    if (!pts) return;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    // a tap becomes a dot — give it a second point so the tube has a path
    if (pts.length === 2) pts.push(pts[0] + MIN_SAMPLE_DIST, pts[1]);
    // keep the ink on screen until the server echoes the committed stroke
    setPending(p => [...p, { key: pendingKey.current++, points: pts, color, width, threeD }]);
    onStrokeEnd(pts);
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      style={{
        // absolute against the (relative) host box: the wrapper's size is
        // always definite, so R3F's resize observer tracks the real layout —
        // percentage heights inside flex sections can measure wrong at mount
        // and leave the canvas (and stroke coords) built for a stale box
        position: 'absolute',
        inset: 0,
        touchAction: 'none',
        // long-pressing paper shouldn't summon iOS text selection / callouts
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        cursor: canDraw ? 'crosshair' : 'default',
      }}
    >
      <Canvas
        flat
        camera={{ position: [0, CAM_HEIGHT, 0], fov: CAM_FOV, up: [0, 0, -1] }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        // the canvas is a replaced element — Safari's select/copy gestures
        // target it directly, so it needs its own blockers too
        style={{
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      >
        <color attach="background" args={['#f7f5f1']} />
        <SizeSync target={wrapRef} />
        <Scene
          strokes={strokes}
          liveStroke={liveStroke}
          pending={pending}
          draft={draft}
          canDraw={canDraw}
          color={color}
          width={width}
          threeD={threeD}
        />
      </Canvas>
    </div>
  );
}
