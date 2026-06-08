import { useState, useRef, useCallback } from "react";
import {
  C,
  REQUESTS,
  PREFILL_MS,
  DECODE_MS,
  OUTPUT_TOKENS,
  ROUTE_MS,
  PREFILL_ANIM_MS,
  DECODE_ANIM_MS,
  STEP_GAP_MS,
  HIT_PAUSE_MS,
  Stat,
  delay,
  animateValue,
  lerp,
  easeOutCubic,
  PlaybackControls,
  EventLog,
  PageShell,
  PageLayout,
  PagePanel,
  PageHeader,
  SectionLabel,
  SidebarControls,
} from "./demoShared.jsx";

export default function SingleVLLMPage() {
  const [reqIdx, setReqIdx] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const [arriveT, setArriveT] = useState(0);
  const [prefillT, setPrefillT] = useState(0);
  const [decodeT, setDecodeT] = useState(0);
  const [decodeTokens, setDecodeTokens] = useState(0);
  const [cache, setCache] = useState(() => new Set());
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({ hits: 0, misses: 0, prefills: 0, totalPrefillMs: 0, totalDecodeMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [currentMiss, setCurrentMiss] = useState(false);
  const [activeSection, setActiveSection] = useState(null);

  const cacheRef = useRef(cache);
  const runningRef = useRef(false);
  const playingRef = useRef(false);

  const reset = useCallback(() => {
    runningRef.current = false;
    const empty = new Set();
    cacheRef.current = empty;
    setReqIdx(-1);
    setPhase("idle");
    setArriveT(0);
    setPrefillT(0);
    setDecodeT(0);
    setDecodeTokens(0);
    setCache(empty);
    setEvents([]);
    setStats({ hits: 0, misses: 0, prefills: 0, totalPrefillMs: 0, totalDecodeMs: 0 });
    setPlaying(false);
    setCurrentMiss(false);
    setActiveSection(null);
  }, []);

  const dispatchRequest = useCallback(async (index) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const req = REQUESTS[index];
    const isHit = cacheRef.current.has(req.key);

    setReqIdx(index);
    setCurrentMiss(!isHit);
    setPhase("arrive");
    setArriveT(0);
    setPrefillT(0);
    setDecodeT(0);
    setDecodeTokens(0);
    setActiveSection(null);

    await animateValue(setArriveT, ROUTE_MS);

    if (!isHit) {
      setActiveSection("prefill");
      setPhase("prefill");
      await animateValue(setPrefillT, PREFILL_ANIM_MS);
    } else {
      await delay(HIT_PAUSE_MS);
    }

    setActiveSection("decode");
    setPhase("decode");
    for (let t = 1; t <= OUTPUT_TOKENS; t++) {
      setDecodeTokens(t);
      await animateValue(setDecodeT, DECODE_ANIM_MS / OUTPUT_TOKENS);
    }

    const nextCache = new Set(cacheRef.current);
    nextCache.add(req.key);
    cacheRef.current = nextCache;
    setCache(nextCache);

    setStats((prev) => ({
      hits: prev.hits + (isHit ? 1 : 0),
      misses: prev.misses + (isHit ? 0 : 1),
      prefills: prev.prefills + (isHit ? 0 : 1),
      totalPrefillMs: prev.totalPrefillMs + (isHit ? 0 : PREFILL_MS),
      totalDecodeMs: prev.totalDecodeMs + DECODE_MS,
    }));

    setEvents((prev) => [
      {
        id: index,
        isHit,
        text: isHit
          ? `${req.prompt.label}: KV HIT — skipped prefill → DECODE ${DECODE_MS}ms (saved ${PREFILL_MS}ms)`
          : `${req.prompt.label}: PREFILL ${PREFILL_MS}ms (parallel) → DECODE ${DECODE_MS}ms (${OUTPUT_TOKENS} tokens)`,
      },
      ...prev,
    ].slice(0, 12));

    setPhase("done");
    setActiveSection(null);
    runningRef.current = false;
  }, []);

  const runFrom = useCallback(
    async (startIndex) => {
      for (let i = startIndex; i < REQUESTS.length; i++) {
        if (!playingRef.current && i > startIndex) break;
        await dispatchRequest(i);
        if (i < REQUESTS.length - 1) {
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
    if (next >= REQUESTS.length) return;
    setPlaying(false);
    await dispatchRequest(next);
  }, [dispatchRequest, reqIdx]);

  const startPlay = useCallback(async () => {
    if (runningRef.current) return;
    if (reqIdx >= REQUESTS.length - 1 && phase === "done") {
      reset();
      await delay(50);
    }
    setPlaying(true);
    playingRef.current = true;
    await runFrom(reqIdx < 0 ? 0 : reqIdx + 1 > REQUESTS.length - 1 ? 0 : reqIdx + (phase === "done" ? 1 : 0));
  }, [phase, reqIdx, reset, runFrom]);

  const W = 720;
  const vllmX = W / 2;
  const clientX = 40;
  const clientY = 120;
  const vllmTop = 40;
  const prefillY = 90;
  const kvY = 155;
  const decodeY = 210;

  const currentReq = reqIdx >= 0 ? REQUESTS[reqIdx] : null;
  const isAnimating = phase !== "idle" && phase !== "done";
  const completed = reqIdx >= REQUESTS.length - 1 && phase === "done";
  const doneCount = reqIdx < 0 ? 0 : phase === "done" ? reqIdx + 1 : reqIdx;

  const packetY = lerp(clientY, prefillY + 20, easeOutCubic(arriveT));

  const inputTokens = 6;
  const prefillActive = activeSection === "prefill";
  const decodeActive = activeSection === "decode";

  return (
    <PageShell>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseSection { 0%,100% { opacity: 0.85; } 50% { opacity: 1; } }
      `}</style>

      <PagePanel borderColor={C.blue}>
        <PageHeader
          color={C.blue}
          title="Single vLLM Instance — Prefill / Decode Pipeline"
          description="One vLLM engine processes each prompt in two distinct phases: PREFILL runs all input tokens in parallel and fills the KV cache; DECODE generates output tokens one at a time. Repeated prompts on the same instance skip prefill entirely."
        />

        <PageLayout
          main={
            <>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20, padding: "16px 20px", background: `${C.bg}88`, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <Stat label="Requests" value={`${doneCount} / 8`} color={C.cyan} />
          <Stat label="Prefill runs" value={stats.prefills} color={C.gold} />
          <Stat label="Cache hits" value={stats.hits} color={C.green} />
          <Stat label="Prefill time" value={`${stats.totalPrefillMs} ms`} color={C.orange} />
          <Stat label="Decode time" value={`${stats.totalDecodeMs} ms`} color={C.green} />
          <Stat label="KV entries" value={cache.size} color={C.kv} />
        </div>

        <svg width="100%" viewBox={`0 0 ${W} 320`} style={{ display: "block", marginBottom: 20, minHeight: 340 }}>
          {/* Client */}
          <rect x={12} y={clientY - 28} width={56} height={48} rx={8} fill={C.panel} stroke={C.border} />
          <text x={clientX} y={clientY - 8} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">CLIENT</text>
          <text x={clientX} y={clientY + 8} textAnchor="middle" fill={C.text} fontSize={9} fontFamily="monospace">queue</text>

          {/* vLLM container */}
          <rect x={vllmX - 200} y={vllmTop} width={400} height={240} rx={14} fill={`${C.blue}08`} stroke={C.blue} strokeWidth={1.5} />
          <text x={vllmX} y={vllmTop + 18} textAnchor="middle" fill={C.blue} fontSize={12} fontFamily="monospace" fontWeight="bold">
            vLLM ENGINE (single instance)
          </text>

          {/* PREFILL section */}
          <rect
            x={vllmX - 185}
            y={prefillY - 22}
            width={370}
            height={52}
            rx={8}
            fill={prefillActive ? `${C.gold}25` : `${C.gold}10`}
            stroke={prefillActive ? C.gold : `${C.gold}66`}
            strokeWidth={prefillActive ? 2 : 1}
            style={prefillActive ? { animation: "pulseSection 1s ease-in-out infinite" } : undefined}
          />
          <text x={vllmX - 170} y={prefillY + 2} fill={C.gold} fontSize={10} fontFamily="monospace" fontWeight="bold">
            ⚡ PREFILL
          </text>
          <text x={vllmX - 170} y={prefillY + 16} fill={C.muted} fontSize={8} fontFamily="monospace">
            parallel · all prompt tokens at once
          </text>
          {Array.from({ length: inputTokens }).map((_, i) => {
            const tx = vllmX - 60 + i * 22;
            const lit = prefillActive && prefillT > i / inputTokens;
            return (
              <g key={i}>
                <rect x={tx - 8} y={prefillY - 6} width={16} height={16} rx={4}
                  fill={lit ? C.gold : C.dim} opacity={lit ? 1 : 0.4} />
                <text x={tx} y={prefillY + 6} textAnchor="middle" fill="#000" fontSize={7} fontFamily="monospace">{i + 1}</text>
              </g>
            );
          })}
          {prefillActive && (
            <rect x={vllmX + 60} y={prefillY - 4} width={100 * prefillT} height={8} rx={4} fill={C.gold} />
          )}

          {/* KV Cache divider */}
          <rect x={vllmX - 185} y={kvY - 14} width={370} height={28} rx={6} fill={`${C.kv}15`} stroke={C.kv} strokeWidth={1} />
          <text x={vllmX - 170} y={kvY + 4} fill={C.kv} fontSize={9} fontFamily="monospace" fontWeight="bold">KV CACHE</text>
          {[...cache].slice(0, 6).map((key, i) => (
            <rect key={key} x={vllmX - 50 + i * 34} y={kvY - 8} width={30} height={14} rx={3}
              fill={`${C.kv}33`} stroke={C.kv} strokeWidth={0.5} />
          ))}
          {[...cache].slice(0, 6).map((key, i) => (
            <text key={`t-${key}`} x={vllmX - 35 + i * 34} y={kvY + 2} textAnchor="middle"
              fill={C.kv} fontSize={6} fontFamily="monospace">{REQUESTS.find(r => r.key === key)?.prompt.short.slice(0, 6)}</text>
          ))}

          {/* DECODE section */}
          <rect
            x={vllmX - 185}
            y={decodeY - 22}
            width={370}
            height={52}
            rx={8}
            fill={decodeActive ? `${C.green}25` : `${C.green}10`}
            stroke={decodeActive ? C.green : `${C.green}66`}
            strokeWidth={decodeActive ? 2 : 1}
            style={decodeActive ? { animation: "pulseSection 1s ease-in-out infinite" } : undefined}
          />
          <text x={vllmX - 170} y={decodeY + 2} fill={C.green} fontSize={10} fontFamily="monospace" fontWeight="bold">
            🎯 DECODE
          </text>
          <text x={vllmX - 170} y={decodeY + 16} fill={C.muted} fontSize={8} fontFamily="monospace">
            sequential · one output token per step
          </text>
          {Array.from({ length: OUTPUT_TOKENS }).map((_, i) => {
            const tx = vllmX - 20 + i * 36;
            const lit = decodeActive && decodeTokens > i;
            return (
              <g key={i}>
                <circle cx={tx} cy={decodeY + 4} r={10}
                  fill={lit ? C.green : C.dim} opacity={lit ? 1 : 0.35} />
                <text x={tx} y={decodeY + 8} textAnchor="middle" fill="#000" fontSize={7} fontFamily="monospace">
                  {lit ? `t${i + 1}` : "·"}
                </text>
                {lit && i < OUTPUT_TOKENS - 1 && (
                  <line x1={tx + 12} y1={decodeY + 4} x2={tx + 24} y2={decodeY + 4}
                    stroke={C.green} strokeWidth={1} markerEnd="url(#arrow)" />
                )}
              </g>
            );
          })}

          {/* Flow arrow prefill → decode */}
          <line x1={vllmX} y1={prefillY + 32} x2={vllmX} y2={kvY - 16} stroke={C.muted} strokeWidth={1} strokeDasharray="3,3" />
          <line x1={vllmX} y1={kvY + 16} x2={vllmX} y2={decodeY - 24} stroke={C.muted} strokeWidth={1} strokeDasharray="3,3" />

          {/* Request packet */}
          {arriveT > 0 && currentReq && phase !== "done" && (
            <g>
              <line x1={clientX + 28} y1={clientY} x2={vllmX - 200} y2={packetY} stroke={C.cyan} strokeWidth={1} opacity={0.5} />
              <circle cx={lerp(clientX + 28, vllmX - 180, easeOutCubic(arriveT))} cy={packetY} r={10}
                fill={`${C.cyan}55`} stroke={C.cyan} strokeWidth={2} />
              <text x={lerp(clientX + 28, vllmX - 180, easeOutCubic(arriveT))} y={packetY + 4}
                textAnchor="middle" fill="#fff" fontSize={8} fontFamily="monospace" fontWeight="bold">
                {currentReq.prompt.label}
              </text>
            </g>
          )}

          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill={C.green} />
            </marker>
          </defs>
        </svg>

        {/* Phase legend */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            [C.gold, "PREFILL", "Process all input tokens in parallel (compute-bound)"],
            [C.kv, "KV CACHE", "Store keys/values for fast decode reuse"],
            [C.green, "DECODE", "Generate one token per forward pass (memory-bound)"],
          ].map(([color, title, desc]) => (
            <div key={title} style={{ flex: "1 1 200px", padding: "12px 16px", background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 10 }}>
              <div style={{ color, fontSize: 14, fontFamily: "monospace", fontWeight: "bold", marginBottom: 6 }}>{title}</div>
              <div style={{ color: C.muted, fontSize: 13, fontFamily: "monospace", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* Request queue */}
        <div style={{ marginBottom: 16 }}>
        <SectionLabel>REQUEST QUEUE — same instance, shared KV cache</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {REQUESTS.map((req, i) => {
              const isCurrent = i === reqIdx && isAnimating;
              const isPast = i < reqIdx || (i === reqIdx && phase === "done");
              const isRepeat = i >= 4;
              return (
                <div key={i} style={{
                  background: isCurrent ? `${C.blue}22` : isPast ? C.dim : C.panel,
                  border: `1px solid ${isCurrent ? C.blue : C.border}`,
                  borderRadius: 8, padding: "8px 10px",
                  opacity: !isPast && !isCurrent && reqIdx >= 0 ? 0.55 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: C.blue, fontSize: 10, fontFamily: "monospace", fontWeight: "bold" }}>
                      {req.prompt.label}
                      {isRepeat && <span style={{ color: C.green, marginLeft: 4, fontSize: 8 }}>↻ repeat</span>}
                    </span>
                  </div>
                  <div style={{ color: C.text, fontSize: 13, fontFamily: "monospace" }}>{req.prompt.text}</div>
                </div>
              );
            })}
          </div>
        </div>

        {completed && (
          <div style={{ padding: "18px 22px", background: `${C.green}11`, border: `1px solid ${C.green}44`, borderRadius: 12 }}>
            <div style={{ color: C.green, fontFamily: "monospace", fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
              RESULT: PREFILL + DECODE CLEARLY SEPARATED
            </div>
            <div style={{ color: C.muted, fontSize: 15, fontFamily: "monospace", lineHeight: 1.7 }}>
              {stats.prefills} prefill passes ({stats.totalPrefillMs} ms) and {doneCount} decode passes ({stats.totalDecodeMs} ms).
              Repeats Q5–Q8 skipped prefill ({stats.hits} cache hits) — only decode ran, saving {stats.hits * PREFILL_MS} ms.
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
