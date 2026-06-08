import { useState, useRef, useCallback, useMemo } from "react";
import {
  C,
  REQUESTS,
  POD_META,
  POD_COUNT,
  PREFILL_MS,
  ROUTE_MS,
  PREFILL_ANIM_MS,
  DECODE_ANIM_MS,
  STEP_GAP_MS,
  HIT_PAUSE_MS,
  requestLatency,
  computePercentiles,
  simulateProductionTail,
  buildIntelligentPlan,
  GlowButton,
  Stat,
  delay,
  animateValue,
  lerp,
  easeOutCubic,
  PlaybackControls,
  EventLog,
  RequestGrid,
  PageShell,
  PageLayout,
  PagePanel,
  PageHeader,
  SectionLabel,
  SidebarControls,
} from "./demoShared.jsx";

const INTELLIGENT_PLAN = buildIntelligentPlan();

function LatencyChart({ latencies, color, label, percentiles }) {
  const max = Math.max(...latencies, PREFILL_MS + 42);
  const barW = 28;
  const gap = 8;
  const chartW = latencies.length * (barW + gap) + 40;
  const chartH = 120;

  return (
    <div style={{ flex: "1 1 280px" }}>
      <div style={{ color, fontSize: 10, fontFamily: "monospace", fontWeight: "bold", marginBottom: 8 }}>{label}</div>
      <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + 40}`} style={{ display: "block" }}>
        {[42, 84, 126].map((ms) => {
          const y = chartH - (ms / max) * chartH;
          return (
            <g key={ms}>
              <line x1={30} y1={y} x2={chartW - 10} y2={y} stroke={C.dim} strokeWidth={0.5} strokeDasharray="2,4" />
              <text x={26} y={y + 3} textAnchor="end" fill={C.muted} fontSize={7} fontFamily="monospace">{ms}</text>
            </g>
          );
        })}
        {latencies.map((ms, i) => {
          const h = (ms / max) * chartH;
          const x = 36 + i * (barW + gap);
          const isTail = ms >= percentiles.p95;
          return (
            <g key={i}>
              <rect x={x} y={chartH - h} width={barW} height={h} rx={3}
                fill={isTail ? C.red : color} opacity={0.85} />
              <text x={x + barW / 2} y={chartH + 12} textAnchor="middle" fill={C.muted} fontSize={7} fontFamily="monospace">
                Q{i + 1}
              </text>
              <text x={x + barW / 2} y={chartH - h - 4} textAnchor="middle" fill={C.text} fontSize={7} fontFamily="monospace">
                {ms}
              </text>
            </g>
          );
        })}
        <line x1={30} y1={chartH - (percentiles.p95 / max) * chartH} x2={chartW - 10}
          y2={chartH - (percentiles.p95 / max) * chartH} stroke={C.orange} strokeWidth={1.5} strokeDasharray="4,3" />
        <text x={chartW - 8} y={chartH - (percentiles.p95 / max) * chartH - 4} textAnchor="end"
          fill={C.orange} fontSize={8} fontFamily="monospace">P95</text>
      </svg>
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <Stat label="P50" value={`${percentiles.p50} ms`} color={color} />
        <Stat label="P95" value={`${percentiles.p95} ms`} color={C.orange} />
        <Stat label="P99" value={`${percentiles.p99} ms`} color={C.red} />
        <Stat label="Avg" value={`${percentiles.avg} ms`} color={C.muted} />
      </div>
    </div>
  );
}

function PercentileCompare({ title, naive, intelligent }) {
  const rows = [
    ["P50 (median)", naive.p50, intelligent.p50],
    ["P95 (tail)", naive.p95, intelligent.p95],
    ["P99 (worst)", naive.p99, intelligent.p99],
    ["Average", naive.avg, intelligent.avg],
  ];

  return (
    <div style={{ padding: "12px 16px", background: `${C.bg}88`, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
      <div style={{ color: C.text, fontSize: 11, fontFamily: "monospace", fontWeight: "bold", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 60px", gap: 8, fontSize: 10, fontFamily: "monospace" }}>
        <div style={{ color: C.muted }}>Metric</div>
        <div style={{ color: C.red, textAlign: "right" }}>Naive RR</div>
        <div style={{ color: C.green, textAlign: "right" }}>llm-d</div>
        <div style={{ color: C.cyan, textAlign: "right" }}>Δ</div>
        {rows.map(([label, n, intel]) => {
          const delta = n - intel;
          const pct = n > 0 ? Math.round((delta / n) * 100) : 0;
          return (
            <div key={label} style={{ display: "contents" }}>
              <div style={{ color: C.muted }}>{label}</div>
              <div style={{ color: C.red, textAlign: "right" }}>{n} ms</div>
              <div style={{ color: C.green, textAlign: "right" }}>{intel} ms</div>
              <div style={{ color: delta > 0 ? C.green : C.muted, textAlign: "right" }}>
                {delta > 0 ? `−${pct}%` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IntelligentRoutingPage() {
  const [reqIdx, setReqIdx] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const [packetT, setPacketT] = useState(0);
  const [prefillT, setPrefillT] = useState(0);
  const [podCaches, setPodCaches] = useState(() => Array.from({ length: POD_COUNT }, () => new Set()));
  const [events, setEvents] = useState([]);
  const [latencies, setLatencies] = useState([]);
  const [stats, setStats] = useState({ hits: 0, misses: 0, prefills: 0, savedMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [activePod, setActivePod] = useState(null);
  const [currentMiss, setCurrentMiss] = useState(false);
  const [routeFlash, setRouteFlash] = useState(null);

  const podCachesRef = useRef(podCaches);
  const runningRef = useRef(false);
  const playingRef = useRef(false);

  const productionSim = useMemo(() => simulateProductionTail(100), []);

  const demoNaivePercentiles = useMemo(
    () => computePercentiles(REQUESTS.map(() => requestLatency(false))),
    []
  );
  const demoIntelPercentiles = useMemo(() => {
    const lats = INTELLIGENT_PLAN.map((req) => requestLatency(req.isHitPredicted));
    return computePercentiles(lats);
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    const empty = Array.from({ length: POD_COUNT }, () => new Set());
    podCachesRef.current = empty;
    setReqIdx(-1);
    setPhase("idle");
    setPacketT(0);
    setPrefillT(0);
    setPodCaches(empty);
    setEvents([]);
    setLatencies([]);
    setStats({ hits: 0, misses: 0, prefills: 0, savedMs: 0 });
    setPlaying(false);
    setActivePod(null);
    setCurrentMiss(false);
    setRouteFlash(null);
  }, []);

  const dispatchRequest = useCallback(async (index) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const req = INTELLIGENT_PLAN[index];
    const pod = req.pod;
    const isHit = podCachesRef.current[pod].has(req.key);

    setReqIdx(index);
    setActivePod(pod);
    setCurrentMiss(!isHit);
    setRouteFlash(req.routeReason);
    setPhase("route");
    setPacketT(0);
    setPrefillT(0);

    await animateValue(setPacketT, ROUTE_MS);

    setPhase("process");
    if (!isHit) {
      await animateValue(setPrefillT, PREFILL_ANIM_MS);
    } else {
      await delay(HIT_PAUSE_MS);
    }
    await animateValue(() => {}, DECODE_ANIM_MS);

    setPodCaches((prev) => {
      const next = prev.map((s) => new Set(s));
      next[pod].add(req.key);
      podCachesRef.current = next;
      return next;
    });

    const lat = requestLatency(isHit);
    setLatencies((prev) => [...prev, lat]);
    setStats((prev) => ({
      hits: prev.hits + (isHit ? 1 : 0),
      misses: prev.misses + (isHit ? 0 : 1),
      prefills: prev.prefills + (isHit ? 0 : 1),
      savedMs: prev.savedMs + (isHit ? PREFILL_MS : 0),
    }));

    setEvents((prev) => [
      {
        id: index,
        isHit,
        text: isHit
          ? `${req.prompt.label} → Pod ${pod + 1} [${req.routeReason}]: cache HIT — ${lat}ms (decode only)`
          : `${req.prompt.label} → Pod ${pod + 1} [${req.routeReason}]: cold start — ${lat}ms (prefill + decode)`,
      },
      ...prev,
    ].slice(0, 12));

    setPhase("done");
    setActivePod(null);
    setRouteFlash(null);
    runningRef.current = false;
  }, []);

  const runFrom = useCallback(
    async (startIndex) => {
      for (let i = startIndex; i < INTELLIGENT_PLAN.length; i++) {
        if (!playingRef.current && i > startIndex) break;
        await dispatchRequest(i);
        if (i < INTELLIGENT_PLAN.length - 1) {
          await delay(STEP_GAP_MS);
          if (!playingRef.current) break;
        }
      }
      setPlaying(false);
    },
    [dispatchRequest]
  );

  const step = useCallback(async () => {
    if (runningRef.current) return;
    const next = reqIdx + 1;
    if (next >= INTELLIGENT_PLAN.length) return;
    setPlaying(false);
    await dispatchRequest(next);
  }, [dispatchRequest, reqIdx]);

  const startPlay = useCallback(async () => {
    if (runningRef.current) return;
    if (reqIdx >= INTELLIGENT_PLAN.length - 1 && phase === "done") {
      reset();
      await delay(50);
    }
    setPlaying(true);
    playingRef.current = true;
    const start = reqIdx < 0 ? 0 : phase === "done" ? reqIdx + 1 : reqIdx;
    if (start >= INTELLIGENT_PLAN.length) return;
    await runFrom(start);
  }, [phase, reqIdx, reset, runFrom]);

  const W = 720;
  const routerX = W / 2;
  const routerY = 68;
  const podY = 210;
  const podXs = [110, 250, 390, 530];
  const clientX = 36;
  const clientY = 68;

  const currentReq = reqIdx >= 0 ? INTELLIGENT_PLAN[reqIdx] : null;
  const targetPodX = currentReq ? podXs[currentReq.pod] : routerX;
  const isAnimating = phase === "route" || phase === "process";
  const completed = reqIdx >= INTELLIGENT_PLAN.length - 1 && phase === "done";
  const doneCount = reqIdx < 0 ? 0 : phase === "done" ? reqIdx + 1 : reqIdx;

  const packetPos =
    packetT > 0 && currentReq
      ? (() => {
          const t = easeOutCubic(packetT);
          if (t < 0.4) {
            const seg = t / 0.4;
            return { x: lerp(clientX, routerX, seg), y: lerp(clientY, routerY, seg) };
          }
          const seg = (t - 0.4) / 0.6;
          return { x: lerp(routerX, targetPodX, seg), y: lerp(routerY, podY, seg) };
        })()
      : null;

  const currentPercentiles = latencies.length > 0
    ? computePercentiles(latencies)
    : { p50: 0, p95: 0, p99: 0, avg: 0, sorted: [] };

  const naiveDemoLats = REQUESTS.map(() => requestLatency(false));

  return (
    <PageShell>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes routerGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(139,92,246,0.4)); }
          50% { filter: drop-shadow(0 0 12px rgba(34,197,94,0.6)); }
        }
      `}</style>

      <PagePanel borderColor={C.green}>
        <PageHeader
          color={C.green}
          title="llm-d Intelligent Routing — Cache + Load Aware"
          description="Same 8 prompts as the naive round-robin demo, but llm-d routes each request to the pod with a matching KV cache (cache-aware) or the least-loaded pod for cold starts (load-aware). This eliminates redundant prefills and tightens P95/P99 tail latency in production inference."
        />

        <PageLayout
          main={
            <>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20, padding: "16px 20px", background: `${C.bg}88`, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <Stat label="Requests" value={`${doneCount} / 8`} color={C.cyan} />
          <Stat label="Cache hits" value={stats.hits} color={C.green} />
          <Stat label="Cache misses" value={stats.misses} color={C.red} />
          <Stat label="Prefill saved" value={`${stats.savedMs} ms`} color={C.gold} />
          <Stat label="Routing" value={routeFlash || "idle"} color={C.purple} />
          {completed && (
            <>
              <Stat label="P95 (demo)" value={`${currentPercentiles.p95} ms`} color={C.orange} />
              <Stat label="P99 (demo)" value={`${currentPercentiles.p99} ms`} color={C.red} />
            </>
          )}
        </div>

        <svg width="100%" viewBox={`0 0 ${W} 280`} style={{ display: "block", marginBottom: 20, minHeight: 320 }}>
          <rect x={8} y={48} width={56} height={48} rx={8} fill={C.panel} stroke={C.border} />
          <text x={clientX} y={68} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">CLIENTS</text>
          <text x={clientX} y={84} textAnchor="middle" fill={C.text} fontSize={10} fontFamily="monospace">8 reqs</text>

          {/* llm-d router */}
          <g style={isAnimating ? { animation: "routerGlow 1.2s ease-in-out infinite" } : undefined}>
            <rect x={routerX - 85} y={routerY - 30} width={170} height={60} rx={12}
              fill={`${C.purple}18`} stroke={C.purple} strokeWidth={1.5} />
            <text x={routerX} y={routerY - 8} textAnchor="middle" fill={C.purple} fontSize={11} fontFamily="monospace" fontWeight="bold">
              llm-d ROUTER
            </text>
            <text x={routerX} y={routerY + 8} textAnchor="middle" fill={C.green} fontSize={8} fontFamily="monospace">
              cache-aware + load-aware
            </text>
            <text x={routerX} y={routerY + 22} textAnchor="middle" fill={C.muted} fontSize={7} fontFamily="monospace">
              {routeFlash === "cache-aware" ? "→ routing to cached pod" : routeFlash === "load-aware" ? "→ picking least loaded" : "OpenShift AI inference gateway"}
            </text>
          </g>

          {podXs.map((px, i) => (
            <path key={i}
              d={`M ${routerX} ${routerY + 30} Q ${routerX} ${podY - 40} ${px} ${podY - 52}`}
              fill="none"
              stroke={activePod === i && isAnimating ? C.green : C.dim}
              strokeWidth={activePod === i && isAnimating ? 2 : 0.8}
              strokeDasharray={activePod === i && isAnimating ? "none" : "4,6"}
              opacity={0.7}
            />
          ))}

          {POD_META.map((pod, i) => {
            const px = podXs[i];
            const isActive = activePod === i;
            const isPrefilling = isActive && phase === "process" && currentMiss;
            const cacheKeys = [...podCaches[i]];

            return (
              <g key={pod.id}>
                <rect x={px - 58} y={podY - 52} width={116} height={118} rx={10}
                  fill={C.panel} stroke={isActive ? pod.color : C.border} strokeWidth={isActive ? 2 : 1} />
                <text x={px} y={podY - 34} textAnchor="middle" fill={pod.color} fontSize={10} fontFamily="monospace" fontWeight="bold">
                  {pod.name}
                </text>
                <text x={px} y={podY - 20} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
                  KV cache
                </text>
                {cacheKeys.length === 0 ? (
                  <text x={px} y={podY + 4} textAnchor="middle" fill={C.dim} fontSize={8} fontFamily="monospace">(empty)</text>
                ) : (
                  cacheKeys.map((key, ci) => (
                    <g key={key}>
                      <rect x={px - 48} y={podY - 8 + ci * 16} width={96} height={13} rx={3}
                        fill={`${C.kv}22`} stroke={C.kv} strokeWidth={0.5} />
                      <text x={px} y={podY + 2 + ci * 16} textAnchor="middle" fill={C.kv} fontSize={7} fontFamily="monospace">
                        {INTELLIGENT_PLAN.find((r) => r.key === key)?.prompt.short || key}
                      </text>
                    </g>
                  ))
                )}
                {isPrefilling && (
                  <>
                    <rect x={px - 50} y={podY + 48} width={100} height={6} rx={3} fill={C.dim} />
                    <rect x={px - 50} y={podY + 48} width={100 * prefillT} height={6} rx={3} fill={C.orange} />
                    <text x={px} y={podY + 64} textAnchor="middle" fill={C.orange} fontSize={8} fontFamily="monospace">COLD PREFILL</text>
                  </>
                )}
              </g>
            );
          })}

          {packetPos && currentReq && (
            <g>
              <circle cx={packetPos.x} cy={packetPos.y} r={10}
                fill={`${POD_META[currentReq.pod].color}55`} stroke={POD_META[currentReq.pod].color} strokeWidth={2} />
              <text x={packetPos.x} y={packetPos.y + 4} textAnchor="middle" fill="#fff" fontSize={8} fontFamily="monospace" fontWeight="bold">
                {currentReq.prompt.label}
              </text>
            </g>
          )}
        </svg>

        <div style={{ marginBottom: 16 }}>
          <SectionLabel>REQUEST QUEUE — llm-d routes repeats back to cached pods</SectionLabel>
          <RequestGrid
            requests={INTELLIGENT_PLAN}
            reqIdx={reqIdx}
            phase={phase}
            isAnimating={isAnimating}
          />
        </div>

        {(completed || latencies.length > 0) && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: C.text, fontSize: 14, fontFamily: "monospace", fontWeight: "bold", marginBottom: 12 }}>
              LATENCY DISTRIBUTION — 8-request demo
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <LatencyChart
                latencies={naiveDemoLats}
                color={C.red}
                label="Naive Round-Robin (all cache misses on repeats)"
                percentiles={demoNaivePercentiles}
              />
              <LatencyChart
                latencies={latencies.length === 8 ? latencies : INTELLIGENT_PLAN.map((r) => requestLatency(r.isHitPredicted))}
                color={C.green}
                label="llm-d Intelligent Routing"
                percentiles={completed ? currentPercentiles : demoIntelPercentiles}
              />
            </div>
          </div>
        )}

        <PercentileCompare
          title="8-REQUEST DEMO — tail latency comparison"
          naive={demoNaivePercentiles}
          intelligent={completed ? currentPercentiles : demoIntelPercentiles}
        />

        <PercentileCompare
          title="PRODUCTION EXTRAPOLATION — 100 requests, heavy repeat traffic"
          naive={productionSim.naive}
          intelligent={productionSim.intelligent}
        />

        {completed && (
          <div style={{ padding: "18px 22px", background: `${C.green}11`, border: `1px solid ${C.green}44`, borderRadius: 12 }}>
            <div style={{ color: C.green, fontFamily: "monospace", fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
              RESULT: P95/P99 TAIL LATENCY IMPROVED
            </div>
            <div style={{ color: C.muted, fontSize: 15, fontFamily: "monospace", lineHeight: 1.7 }}>
              Demo: P50 dropped {demoNaivePercentiles.p50 - currentPercentiles.p50} ms ({Math.round((1 - currentPercentiles.p50 / demoNaivePercentiles.p50) * 100)}%).
              Production sim: P95 {productionSim.naive.p95} → {productionSim.intelligent.p95} ms
              (−{Math.round((1 - productionSim.intelligent.p95 / productionSim.naive.p95) * 100)}%),
              P99 {productionSim.naive.p99} → {productionSim.intelligent.p99} ms.
              Cache-aware routing eliminates prefill spikes that inflate tail latency under repeat-heavy workloads.
            </div>
          </div>
        )}
            </>
          }
          sidebar={
            <SidebarControls
              events={events}
              playing={playing}
              completed={completed}
              isAnimating={isAnimating}
              onPlay={() => { playingRef.current = true; startPlay(); }}
              onPause={() => { setPlaying(false); playingRef.current = false; }}
              onStep={step}
              onReset={reset}
            />
          }
        />
      </PagePanel>
    </PageShell>
  );
}
