export const C = {
  bg: "#050a0f",
  panel: "#0a1520",
  border: "#1a3050",
  dim: "#1c3a5c",
  text: "#c8dff0",
  muted: "#4a7a9b",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  green: "#22c55e",
  gold: "#f59e0b",
  orange: "#f97316",
  pink: "#ec4899",
  blue: "#3b82f6",
  red: "#ef4444",
  kv: "#a78bfa",
};

export const POD_COUNT = 4;
export const PREFILL_MS = 84;
export const DECODE_MS = 42;
export const OUTPUT_TOKENS = 3;
/** Wait between steps/stages (all pages). */
export const STEP_GAP_MS = 2000;
/** Main phase animation duration — middle of 5–7s presentation window. */
export const PHASE_ANIM_MS = 6000;
export const ROUTE_MS = 2000;
export const PREFILL_ANIM_MS = 2500;
export const DECODE_ANIM_MS = 1500;
export const HIT_PAUSE_MS = 1500;

export const POD_META = [
  { id: 0, name: "vLLM Pod 1", color: C.cyan },
  { id: 1, name: "vLLM Pod 2", color: C.purple },
  { id: 2, name: "vLLM Pod 3", color: C.green },
  { id: 3, name: "vLLM Pod 4", color: C.orange },
];

export const PROMPTS = {
  summarize: { label: "Q1", text: "Summarize quarterly report", short: "Summarize" },
  code: { label: "Q2", text: "Review my Python code", short: "Code review" },
  translate: { label: "Q3", text: "Translate email to French", short: "Translate" },
  explain: { label: "Q4", text: "Explain quantum computing", short: "Explain" },
  rag: { label: "Q5", text: "Answer from knowledge base", short: "RAG query" },
  sql: { label: "Q6", text: "Generate SQL for analytics", short: "SQL gen" },
  chat: { label: "Q7", text: "Continue chat conversation", short: "Chat cont." },
  classify: { label: "Q8", text: "Classify support ticket", short: "Classify" },
};

const REQUEST_SLOTS = [
  { key: "summarize", slot: "Q1" },
  { key: "code", slot: "Q2" },
  { key: "translate", slot: "Q3" },
  { key: "explain", slot: "Q4" },
  { key: "code", slot: "Q5" },
  { key: "summarize", slot: "Q6" },
  { key: "explain", slot: "Q7" },
  { key: "translate", slot: "Q8" },
];

export const REQUESTS = REQUEST_SLOTS.map((r, i) => ({
  ...r,
  id: i + 1,
  pod: i % POD_COUNT,
  naivePod: i % POD_COUNT,
  prompt: { ...PROMPTS[r.key], label: r.slot },
}));

export function requestLatency(isHit) {
  return isHit ? DECODE_MS : PREFILL_MS + DECODE_MS;
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

export function computePercentiles(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    sorted,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
  };
}

/** Deterministic production simulation: 100 requests, heavy repeat traffic. */
export function simulateProductionTail(count = 100) {
  const naiveLatencies = [];
  const intLatencies = [];
  const naiveCaches = Array.from({ length: POD_COUNT }, () => new Set());
  const intCaches = Array.from({ length: POD_COUNT }, () => new Set());

  for (let i = 0; i < count; i++) {
    const keyIdx = i < 4 ? i : (i * 7 + 3) % 4;
    const key = REQUEST_SLOTS[keyIdx].key;

    const naivePod = i % POD_COUNT;
    const naiveHit = naiveCaches[naivePod].has(key);
    naiveLatencies.push(requestLatency(naiveHit) + (naiveHit ? 0 : Math.floor(i / 20)));
    naiveCaches[naivePod].add(key);

    let intPod = -1;
    for (let p = 0; p < POD_COUNT; p++) {
      if (intCaches[p].has(key)) {
        intPod = p;
        break;
      }
    }
    if (intPod === -1) {
      const loads = intCaches.map((s) => s.size);
      intPod = loads.indexOf(Math.min(...loads));
    }
    const intHit = intCaches[intPod].has(key);
    intLatencies.push(requestLatency(intHit));
    intCaches[intPod].add(key);
  }

  return { naive: computePercentiles(naiveLatencies), intelligent: computePercentiles(intLatencies) };
}

export function routeIntelligent(index, key, podCaches, podLoad) {
  for (let p = 0; p < POD_COUNT; p++) {
    if (podCaches[p].has(key)) {
      return { pod: p, reason: "cache-aware", isHit: true };
    }
  }
  let best = 0;
  for (let p = 1; p < POD_COUNT; p++) {
    if (podLoad[p] < podLoad[best]) best = p;
  }
  return { pod: best, reason: "load-aware", isHit: false };
}

export function buildIntelligentPlan() {
  const podCaches = Array.from({ length: POD_COUNT }, () => new Set());
  const podLoad = Array(POD_COUNT).fill(0);

  return REQUESTS.map((req, i) => {
    const { pod, reason, isHit } = routeIntelligent(i, req.key, podCaches, podLoad);
    podCaches[pod].add(req.key);
    podLoad[pod] += 1;
    return { ...req, pod, routeReason: reason, isHitPredicted: isHit };
  });
}

export function GlowButton({ onClick, color, children, disabled, fullWidth }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? C.dim : `${color}22`,
        border: `1px solid ${disabled ? C.border : `${color}88`}`,
        color: disabled ? C.muted : color,
        fontFamily: "monospace",
        fontSize: 15,
        fontWeight: "bold",
        padding: "12px 20px",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.05em",
        transition: "all 0.2s",
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          color: C.muted,
          fontSize: 12,
          fontFamily: "monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      <span style={{ color, fontFamily: "monospace", fontSize: 18, fontWeight: "bold" }}>{value}</span>
    </div>
  );
}

export const PAGE = {
  maxWidth: 1480,
  padding: "28px 48px",
  sidebarWidth: 360,
  gap: 36,
};

export function PageShell({ children }) {
  return (
    <div style={{ maxWidth: PAGE.maxWidth, margin: "0 auto", padding: PAGE.padding, width: "100%" }}>
      {children}
    </div>
  );
}

export function PageLayout({ main, sidebar }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(0, 1fr) ${PAGE.sidebarWidth}px`,
        gap: PAGE.gap,
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>{main}</div>
      <aside
        style={{
          position: "sticky",
          top: 96,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {sidebar}
      </aside>
    </div>
  );
}

export function PagePanel({ borderColor, children }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${borderColor}44`,
        borderRadius: 16,
        padding: "28px 32px",
      }}
    >
      {children}
    </div>
  );
}

export function PageHeader({ color, title, description }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 10px ${color}` }} />
        <span style={{ color, fontFamily: "monospace", fontSize: 20, fontWeight: "bold", letterSpacing: "0.04em" }}>
          {title}
        </span>
      </div>
      {description && (
        <p
          style={{
            color: C.muted,
            fontSize: 15,
            fontFamily: "monospace",
            lineHeight: 1.7,
            margin: "0 0 24px",
            borderLeft: `3px solid ${C.border}`,
            paddingLeft: 14,
          }}
        >
          {description}
        </p>
      )}
    </>
  );
}

export function SectionLabel({ children }) {
  return (
    <div
      style={{
        color: C.muted,
        fontSize: 13,
        fontFamily: "monospace",
        marginBottom: 10,
        letterSpacing: "0.08em",
        fontWeight: "bold",
      }}
    >
      {children}
    </div>
  );
}

export function SidebarControls({
  events,
  playing,
  completed,
  isAnimating,
  onPlay,
  onPause,
  onStep,
  onReset,
}) {
  return (
    <>
      <div
        style={{
          background: `${C.bg}aa`,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "20px",
        }}
      >
        <SectionLabel>CONTROLS</SectionLabel>
        <PlaybackControls
          playing={playing}
          completed={completed}
          isAnimating={isAnimating}
          onPlay={onPlay}
          onPause={onPause}
          onStep={onStep}
          onReset={onReset}
          vertical
        />
      </div>
      <div
        style={{
          background: `${C.bg}aa`,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "20px",
          flex: 1,
        }}
      >
        <SectionLabel>EVENT LOG</SectionLabel>
        <EventLog events={events} inSidebar />
      </div>
    </>
  );
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function animateValue(setter, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      setter(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export function PlaybackControls({ playing, completed, isAnimating, onPlay, onPause, onStep, onReset, vertical }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexDirection: vertical ? "column" : "row" }}>
      <GlowButton onClick={onPlay} color={C.green} disabled={isAnimating || (playing && !completed)} fullWidth={vertical}>
        {completed ? "↺ Replay" : playing ? "▶ Playing…" : "▶ Play All"}
      </GlowButton>
      <GlowButton onClick={onPause} color={C.gold} disabled={!playing} fullWidth={vertical}>
        ⏸ Pause
      </GlowButton>
      <GlowButton onClick={onStep} color={C.cyan} disabled={isAnimating || completed} fullWidth={vertical}>
        Step →
      </GlowButton>
      <GlowButton onClick={onReset} color={C.muted} disabled={isAnimating} fullWidth={vertical}>
        Reset
      </GlowButton>
    </div>
  );
}

export function EventLog({ events, inSidebar }) {
  return (
    <div
      style={{
        ...(inSidebar
          ? { maxHeight: 520, overflowY: "auto" }
          : {
              background: `${C.bg}aa`,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "16px 18px",
              marginBottom: 16,
              maxHeight: 200,
              overflowY: "auto",
            }),
      }}
    >
      {!inSidebar && (
        <div style={{ color: C.muted, fontSize: 13, fontFamily: "monospace", marginBottom: 10, fontWeight: "bold" }}>
          EVENT LOG
        </div>
      )}
      {events.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 14, fontFamily: "monospace", lineHeight: 1.5 }}>
          Press Play or Step to begin…
        </div>
      ) : (
        events.map((ev, i) => (
          <div
            key={ev.id}
            style={{
              fontSize: 14,
              fontFamily: "monospace",
              lineHeight: 1.5,
              color: ev.color || (ev.isHit ? C.green : C.red),
              marginBottom: 8,
              animation: i === 0 ? "fadeInUp 0.3s both" : undefined,
            }}
          >
            {ev.prefix || (ev.isHit ? "✓" : "✗")} {ev.text}
          </div>
        ))
      )}
    </div>
  );
}

export function RequestGrid({ requests, reqIdx, phase, isAnimating, podKey = "pod", podMeta = POD_META }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {requests.map((req, i) => {
        const isCurrent = i === reqIdx && isAnimating;
        const isPast = i < reqIdx || (i === reqIdx && phase === "done");
        const pod = req[podKey];
        const podColor = podMeta[pod]?.color || C.cyan;
        const isRepeat = i >= 4;
        return (
          <div
            key={i}
            style={{
              background: isCurrent ? `${podColor}22` : isPast ? C.dim : C.panel,
              border: `1px solid ${isCurrent ? podColor : C.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              opacity: !isPast && !isCurrent && reqIdx >= 0 ? 0.55 : 1,
              transition: "all 0.3s",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: podColor, fontSize: 13, fontFamily: "monospace", fontWeight: "bold" }}>
                {req.prompt.label}
                {isRepeat && <span style={{ color: C.orange, marginLeft: 4, fontSize: 11 }}>↻ repeat</span>}
              </span>
              <span style={{ color: C.muted, fontSize: 12, fontFamily: "monospace" }}>
                → P{pod + 1}
              </span>
            </div>
            <div style={{ color: C.text, fontSize: 12, fontFamily: "monospace", lineHeight: 1.4 }}>
              {req.prompt.text}
            </div>
            {req.routeReason && (
              <div style={{ color: C.purple, fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>
                {req.routeReason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
