import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LiveStrokeInfo, StrokeInfo } from '../store';

/**
 * The shared drawing surface. Flat ink strokes are variable-width ribbons
 * swept along the pointer's path on a paper plane — round-capped and
 * round-jointed so they read like a real brush; the artist can toggle raised
 * 3D relief (rendered as a lit tube) per stroke.
 *
 * The camera looks straight down and the paper is sized to the canvas
 * element's aspect ratio, so the paper fills whatever space the layout gives
 * it. Because the paper fills the view exactly, pointer input is plain DOM
 * math on the wrapper element (no raycasting): normalized 0..1 coords across
 * the canvas ARE paper coords. That keeps the drawing resolution- and
 * aspect-independent (clients with different window shapes see a slightly
 * stretched, but complete, picture).
 *
 * Raw stylus samples are noisy, so input is run through a streamline (EMA)
 * smoother before it becomes geometry — that kills the jitter. Pen styles
 * then vary thickness per point (pressure / speed / taper), carried as a
 * parallel `widths` array; an empty array means a uniform stroke.
 *
 * The artist draws locally (live preview), streams progress through
 * `onStrokeProgress` (throttled) and commits the finished stroke through
 * `onStrokeEnd`; everyone renders the authoritative stroke list mirrored
 * from SpacetimeDB, plus the artist's in-flight `liveStroke`.
 */

/** Dynamic-thickness pens. `uniform` keeps a constant nib (empty widths). */
export type PenStyle = 'uniform' | 'pressure' | 'speed' | 'taper';

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

// --- input smoothing + pen dynamics -----------------------------------------
// streamline: each sample eases the "wet" brush toward the raw pointer by this
// factor (lower = smoother + a touch more lag). This is what de-jitters styluses.
const STREAMLINE = 0.4;
const VEL_ALPHA = 0.3; // EMA factor for the velocity estimate (speed pen)
const VEL_REF = 0.004; // normalized units/ms mapped to the thinnest speed stroke
const PRESSURE_MIN = 0.35; // width at zero pressure, × base nib
const SPEED_MIN = 0.4; // width at max speed, × base nib
const TAPER_FRAC = 0.3; // fraction of arc length spent tapering each end
const TAPER_MAX = 0.18; // cap the taper ramp (normalized) on long strokes
const TAPER_TIP = 0.05; // min tip width (× base) so ends read as fine points

// unit circle for the round caps/joins, computed once
const CAP_SEG = 8;
const UNIT_CIRCLE: [number, number][] = Array.from({ length: CAP_SEG + 1 }, (_, i) => {
  const a = (i / CAP_SEG) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

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

/** Per-sample thickness for the pressure/speed pens (uniform/taper handled elsewhere). */
function dynamicWidth(
  style: PenStyle,
  base: number,
  pressure: number,
  isPen: boolean,
  vel: number
): number {
  if (style === 'pressure') {
    // mouse/finger report no real pressure — sit them at mid weight
    const p = isPen && pressure > 0 ? pressure : 0.5;
    return base * (PRESSURE_MIN + (1 - PRESSURE_MIN) * p);
  }
  if (style === 'speed') {
    const sn = Math.min(vel / VEL_REF, 1); // faster → thinner, like wet ink
    return base * (1 - (1 - SPEED_MIN) * sn);
  }
  return base;
}

/** Thin the first and last stretch of a stroke by arc length (calligraphy taper). */
function taperWidths(points: number[], base: number): number[] {
  const n = points.length / 2;
  if (n === 0) return [];
  const cum = new Array<number>(n).fill(0);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const dx = points[i * 2] - points[(i - 1) * 2];
    const dy = points[i * 2 + 1] - points[(i - 1) * 2 + 1];
    total += Math.hypot(dx, dy);
    cum[i] = total;
  }
  if (total < 1e-6) return new Array<number>(n).fill(base);
  const taperLen = Math.max(Math.min(TAPER_FRAC * total, TAPER_MAX), 1e-6);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d = cum[i];
    const e = Math.sqrt(Math.max(0, Math.min(1, d / taperLen, (total - d) / taperLen)));
    out[i] = base * Math.max(e, TAPER_TIP);
  }
  return out;
}

/**
 * Final per-point widths to store/render for a stroke. Uniform pens send an
 * empty array (renderer falls back to the constant `base`); pressure/speed use
 * the widths captured per sample; taper is derived from the geometry.
 */
function widthsForSend(
  points: number[],
  captured: number[],
  style: PenStyle,
  base: number
): number[] {
  const n = points.length / 2;
  if (n === 0 || style === 'uniform') return [];
  if (style === 'taper') return taperWidths(points, base);
  // pressure/speed: pad/truncate the captured widths to the point count (the
  // dot-fill in handleUp can add one uncaptured point)
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = captured.length ? captured[Math.min(i, captured.length - 1)] : base;
  }
  return out;
}

/**
 * Flat ink as a filled variable-width ribbon in the paper plane: a trapezoid
 * per segment between the two point radii, plus a round disc at every point
 * that rounds the caps and the joins. Positions only (unlit, double-sided) —
 * cheap to rebuild while a live stroke grows and free of the whole-curve
 * resampling that used to make the line shimmer.
 */
function buildRibbonGeometry(
  points: number[],
  widths: number[] | null,
  base: number,
  paperW: number,
  paperH: number,
  lift: number
): THREE.BufferGeometry | null {
  const n = points.length / 2;
  if (n < 1) return null;

  const cx = new Array<number>(n);
  const cz = new Array<number>(n);
  const r = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    cx[i] = (points[i * 2] - 0.5) * paperW;
    cz[i] = (points[i * 2 + 1] - 0.5) * paperH;
    const wNorm = widths && widths.length === n ? widths[i] : base;
    r[i] = Math.max(wNorm * paperW, 1e-5);
  }

  const pos: number[] = [];
  const tri = (ax: number, az: number, bx: number, bz: number, cx_: number, cz_: number) => {
    pos.push(ax, lift, az, bx, lift, bz, cx_, lift, cz_);
  };

  // connecting trapezoids between consecutive discs
  for (let i = 0; i + 1 < n; i++) {
    let dx = cx[i + 1] - cx[i];
    let dz = cz[i + 1] - cz[i];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    dx /= len;
    dz /= len;
    const nx = -dz; // perpendicular in the XZ plane
    const nz = dx;
    const ax = cx[i] + nx * r[i];
    const az = cz[i] + nz * r[i];
    const bx = cx[i] - nx * r[i];
    const bz = cz[i] - nz * r[i];
    const c1x = cx[i + 1] + nx * r[i + 1];
    const c1z = cz[i + 1] + nz * r[i + 1];
    const d1x = cx[i + 1] - nx * r[i + 1];
    const d1z = cz[i + 1] - nz * r[i + 1];
    tri(ax, az, bx, bz, c1x, c1z);
    tri(bx, bz, d1x, d1z, c1x, c1z);
  }

  // round disc at every point — caps the ends and fills the joins
  for (let i = 0; i < n; i++) {
    const ri = r[i];
    for (let s = 0; s < CAP_SEG; s++) {
      const [u0, v0] = UNIT_CIRCLE[s];
      const [u1, v1] = UNIT_CIRCLE[s + 1];
      tri(
        cx[i],
        cz[i],
        cx[i] + u0 * ri,
        cz[i] + v0 * ri,
        cx[i] + u1 * ri,
        cz[i] + v1 * ri
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
  return geo;
}

interface InkStrokeProps {
  points: number[];
  color: string;
  width: number;
  /** Per-point half-widths; empty/undefined → constant `width`. */
  widths?: number[];
  threeD: boolean;
  paperW: number;
  paperH: number;
  /** Stacking order — later strokes sit imperceptibly higher. */
  order: number;
}

function InkStroke({ points, color, width, widths, threeD, paperW, paperH, order }: InkStrokeProps) {
  const lift = INK_LIFT + order * LIFT_STEP;

  const flatGeo = useMemo(
    () => (threeD ? null : buildRibbonGeometry(points, widths ?? null, width, paperW, paperH, lift)),
    [points, widths, width, threeD, paperW, paperH, lift]
  );

  const tubeGeo = useMemo(() => {
    if (!threeD) return null;
    const path = toWorld(points, paperW, paperH, lift);
    if (path.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(path);
    return new THREE.TubeGeometry(curve, Math.min(path.length * 4, 400), width * paperW, 8, false);
  }, [points, width, threeD, paperW, paperH, lift]);

  // geometry churns while a live stroke grows — free the replaced ones
  useEffect(() => () => {
    flatGeo?.dispose();
    tubeGeo?.dispose();
  }, [flatGeo, tubeGeo]);

  if (threeD) {
    if (!tubeGeo) return null;
    // real height + shading; hemispherical end caps round the 3D tube's ends
    const world = toWorld(points, paperW, paperH, lift);
    const capR = width * paperW;
    const ends = [world[0], world[world.length - 1]].filter(Boolean) as THREE.Vector3[];
    return (
      <>
        <mesh geometry={tubeGeo} renderOrder={1 + order}>
          <meshStandardMaterial color={color} roughness={0.35} />
        </mesh>
        {ends.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]} renderOrder={1 + order}>
            <sphereGeometry args={[capR, 12, 8]} />
            <meshStandardMaterial color={color} roughness={0.35} />
          </mesh>
        ))}
      </>
    );
  }

  if (!flatGeo) return null;
  // Flat ink is a plane-hugging ribbon a fraction of a millimeter above the
  // paper — too close for the depth buffer, so it skips depth entirely and
  // paints in stroke order over the paper (renderOrder). Double-sided so the
  // triangle winding never culls it when viewed straight down.
  return (
    <mesh geometry={flatGeo} renderOrder={1 + order}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} depthTest={false} depthWrite={false} />
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
  widths: number[];
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
  draftWidths: number[];
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

function Scene({
  strokes,
  liveStroke,
  pending,
  draft,
  draftWidths,
  canDraw,
  color,
  width,
  threeD,
}: SceneProps) {
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
          widths={s.widths}
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
          widths={p.widths}
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
          widths={draftWidths}
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
          widths={liveStroke.widths}
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
  /** Dynamic-thickness pen; `uniform` keeps a constant nib. */
  penStyle?: PenStyle;
  /** Raised 3D relief for new strokes (artist tool toggle). */
  threeD?: boolean;
  onStrokeEnd: (points: number[], widths: number[]) => void;
  /** Throttled snapshots of the growing stroke — drives the live share. */
  onStrokeProgress?: (points: number[], widths: number[]) => void;
}

export function DrawCanvas({
  strokes,
  liveStroke = null,
  canDraw,
  color,
  width,
  penStyle = 'uniform',
  threeD = false,
  onStrokeEnd,
  onStrokeProgress,
}: DrawCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // the in-progress stroke — ref for appending, state for rendering
  const drawing = useRef<number[] | null>(null);
  // per-point captured widths, parallel to `drawing` (pressure/speed pens)
  const strokeWidths = useRef<number[]>([]);
  // the eased "wet" brush position (streamline smoothing state)
  const smooth = useRef<{ x: number; y: number } | null>(null);
  // last raw sample — feeds the velocity estimate for the speed pen
  const lastRaw = useRef<{ x: number; y: number; t: number } | null>(null);
  const velEma = useRef(0);
  // the one pointer allowed to paint — extra fingers/palms are bystanders
  const activePointer = useRef<number | null>(null);
  const activePointerType = useRef('');
  const strokeStartedAt = useRef(0);
  // last time a stylus touched or hovered — gates touch input (palm rejection)
  const lastPenAt = useRef(-Infinity);
  const lastProgressAt = useRef(0);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [draftWidths, setDraftWidths] = useState<number[]>([]);
  // released strokes awaiting their server echo (see PendingStroke)
  const [pending, setPending] = useState<PendingStroke[]>([]);
  const pendingKey = useRef(0);

  // props the pointer handlers need at their latest value without being in the
  // handler identities (the handlers read refs so a mid-stroke prop change,
  // e.g. switching pens, doesn't restart anything)
  const penStyleRef = useRef(penStyle);
  const widthRef = useRef(width);
  penStyleRef.current = penStyle;
  widthRef.current = width;

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

  // rebuild the draft ribbon at most once per frame — pointermove can fire at
  // 120Hz+ and each rebuild is a fresh BufferGeometry
  const draftRaf = useRef(0);
  function scheduleDraft() {
    if (draftRaf.current) return;
    draftRaf.current = requestAnimationFrame(() => {
      draftRaf.current = 0;
      const pts = drawing.current;
      if (!pts) return;
      setDraft(pts.slice());
      setDraftWidths(widthsForSend(pts, strokeWidths.current, penStyleRef.current, widthRef.current));
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
      strokeWidths.current = [];
      smooth.current = null;
      lastRaw.current = null;
      activePointer.current = null;
      setDraft(null);
      setDraftWidths([]);
      setPending([]);
    }
  }, [canDraw]);

  // throw away the in-flight stroke without committing it (palm marks, pinch
  // gestures) — and retract the live preview other players already saw
  function cancelStroke() {
    drawing.current = null;
    strokeWidths.current = [];
    smooth.current = null;
    lastRaw.current = null;
    activePointer.current = null;
    if (draftRaf.current) {
      cancelAnimationFrame(draftRaf.current);
      draftRaf.current = 0;
    }
    setDraft(null);
    setDraftWidths([]);
    onStrokeProgress?.([], []);
  }

  function samplePoint(e: { clientX: number; clientY: number }): [number, number] {
    const rect = wrapRef.current!.getBoundingClientRect();
    return [
      THREE.MathUtils.clamp((e.clientX - rect.left) / rect.width, 0, 1),
      THREE.MathUtils.clamp((e.clientY - rect.top) / rect.height, 0, 1),
    ];
  }

  /**
   * Fold one raw pointer sample into the smoothed stroke: update the velocity
   * estimate, ease the wet brush toward the raw point, and commit a new point
   * (with its pen-derived width) once it's moved far enough to matter.
   */
  function ingestSample(
    rawX: number,
    rawY: number,
    pressure: number,
    isPen: boolean,
    t: number
  ): boolean {
    // velocity from raw motion, EMA-smoothed so the speed pen doesn't chatter
    if (lastRaw.current) {
      const dt = Math.max(t - lastRaw.current.t, 1);
      const v = Math.hypot(rawX - lastRaw.current.x, rawY - lastRaw.current.y) / dt;
      velEma.current = velEma.current * (1 - VEL_ALPHA) + v * VEL_ALPHA;
    }
    lastRaw.current = { x: rawX, y: rawY, t };

    const sm = smooth.current!;
    sm.x += (rawX - sm.x) * STREAMLINE;
    sm.y += (rawY - sm.y) * STREAMLINE;

    const pts = drawing.current!;
    const dx = sm.x - pts[pts.length - 2];
    const dy = sm.y - pts[pts.length - 1];
    if (Math.hypot(dx, dy) < MIN_SAMPLE_DIST) return false;
    if (pts.length >= MAX_POINTS_PER_STROKE * 2) return false;
    pts.push(sm.x, sm.y);
    strokeWidths.current.push(
      dynamicWidth(penStyleRef.current, widthRef.current, pressure, isPen, velEma.current)
    );
    return true;
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
    const [x, y] = samplePoint(e);
    drawing.current = [x, y];
    smooth.current = { x, y };
    lastRaw.current = { x, y, t: e.timeStamp };
    velEma.current = 0;
    strokeWidths.current = [
      dynamicWidth(penStyle, width, e.pressure, e.pointerType === 'pen', 0),
    ];
    setDraft([x, y]);
    setDraftWidths(widthsForSend([x, y], strokeWidths.current, penStyle, width));
  }

  function handleMove(e: React.PointerEvent) {
    // hover counts too — an approaching pencil locks out the settling palm
    if (e.pointerType === 'pen') lastPenAt.current = performance.now();
    if (e.pointerId !== activePointer.current) return;
    if (!drawing.current || !smooth.current) return;
    const isPen = e.pointerType === 'pen';
    // coalesced events recover the full-rate pointer path the browser batched
    // into this one event — fast flicks stay curved instead of going straight
    const native = e.nativeEvent;
    const samples =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    let grew = false;
    for (const s of samples) {
      const [x, y] = samplePoint(s);
      if (ingestSample(x, y, s.pressure, isPen, s.timeStamp)) grew = true;
    }
    if (!grew) return;
    scheduleDraft();
    const now = performance.now();
    if (now - lastProgressAt.current >= PROGRESS_INTERVAL_MS) {
      lastProgressAt.current = now;
      const pts = drawing.current;
      onStrokeProgress?.(pts.slice(), widthsForSend(pts, strokeWidths.current, penStyle, width));
    }
  }

  function handleUp(e: React.PointerEvent) {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    const pts = drawing.current;
    const captured = strokeWidths.current;
    drawing.current = null;
    strokeWidths.current = [];
    smooth.current = null;
    lastRaw.current = null;
    if (draftRaf.current) {
      cancelAnimationFrame(draftRaf.current);
      draftRaf.current = 0;
    }
    setDraft(null);
    setDraftWidths([]);
    if (!pts) return;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    // a tap becomes a dot — give it a second point so the ribbon has a path
    if (pts.length === 2) {
      pts.push(pts[0] + MIN_SAMPLE_DIST, pts[1]);
      captured.push(captured[0] ?? width);
    }
    const widths = widthsForSend(pts, captured, penStyle, width);
    // keep the ink on screen until the server echoes the committed stroke
    setPending(p => [...p, { key: pendingKey.current++, points: pts, widths, color, width, threeD }]);
    onStrokeEnd(pts, widths);
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
          draftWidths={draftWidths}
          canDraw={canDraw}
          color={color}
          width={width}
          threeD={threeD}
        />
      </Canvas>
    </div>
  );
}
