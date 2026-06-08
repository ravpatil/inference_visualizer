import { useState, useRef, useCallback, useEffect } from "react";
import {
  C,
  PREFILL_MS,
  DECODE_MS,
  Stat,
  delay,
  animateValue,
  PHASE_ANIM_MS,
  STEP_GAP_MS,
  PageShell,
  PageLayout,
  PagePanel,
  PageHeader,
  SectionLabel,
  SidebarControls,
} from "./demoShared.jsx";

const INPUT = "Hello";
const OUTPUT = "World";
const TOKEN_ID = 9906;
const EMBED_DIM = 4096;
const LAYER_COUNT = 32;
const KV_SIZE_KB = 12.4;
const TTFT_MS = PREFILL_MS + 8;

const STEPS = [
  {
    id: 1,
    label: "Client",
    color: C.cyan,
    title: "Client Request",
    explain:
      'The client sends a completion request with prompt "Hello" to the vLLM OpenAI-compatible API endpoint.',
    log: 'POST /v1/completions → prompt: "Hello"',
  },
  {
    id: 2,
    label: "Tokenize",
    color: C.cyan,
    title: "Tokenization",
    explain:
      'The tokenizer splits "Hello" into subword token IDs the model understands. One token maps to vocabulary entry #9906.',
    log: `"Hello" → [${TOKEN_ID}] (1 input token)`,
  },
  {
    id: 3,
    label: "Embed",
    color: C.blue,
    title: "Embedding Lookup",
    explain:
      "Each token ID is converted to a dense vector (4096 dimensions) that encodes semantic meaning in geometric space.",
    log: `Token ${TOKEN_ID} → vector[${EMBED_DIM}]`,
  },
  {
    id: 4,
    label: "GPU",
    color: C.purple,
    title: "GPU Scheduler",
    explain:
      "vLLM's continuous batching scheduler assigns the request to a GPU slot. Tensor cores prepare for matrix operations.",
    log: "Request queued → GPU slot assigned (CUDA stream ready)",
  },
  {
    id: 5,
    label: "Attention",
    color: C.purple,
    title: "Self-Attention (Q · K · V)",
    explain:
      "For each layer, input is projected into Query, Key, and Value matrices. Attention scores determine token relationships.",
    log: "Q, K, V computed → softmax(QKᵀ/√d) · V",
  },
  {
    id: 6,
    label: "Prefill",
    color: C.gold,
    title: "Prefill Phase",
    explain:
      "All input tokens are processed in parallel through 32 transformer layers. This is compute-bound and sets TTFT latency.",
    log: `Prefill: 1 token × ${LAYER_COUNT} layers in parallel (${PREFILL_MS}ms)`,
  },
  {
    id: 7,
    label: "KV Calc",
    color: C.kv,
    title: "KV Cache Calculation",
    explain:
      "Key and Value tensors are computed per layer: K = Wₖ·x, V = Wᵥ·x. These avoid recomputing attention for prior tokens during decode.",
    log: `K,V tensors computed for ${LAYER_COUNT} layers`,
  },
  {
    id: 8,
    label: "KV Store",
    color: C.kv,
    title: "KV Cache Storage",
    explain:
      "vLLM stores K,V in paged GPU memory blocks (PagedAttention). Blocks are allocated on demand in HBM — no wasted memory.",
    log: `Stored ${KV_SIZE_KB} KB in paged KV blocks (GPU HBM)`,
  },
  {
    id: 9,
    label: "Decode",
    color: C.green,
    title: "Decode Phase",
    explain:
      "Generation switches to autoregressive mode: one new token per forward pass, reusing cached K,V from prefill.",
    log: "Decode: sequential mode — 1 token per forward pass",
  },
  {
    id: 10,
    label: "Output",
    color: C.green,
    title: "Output Token Generation",
    explain:
      'The model samples from the vocabulary distribution. "World" has the highest probability (p=0.84) and is selected.',
    log: `Generated token: "${OUTPUT}" (p=0.84)`,
  },
  {
    id: 11,
    label: "Stream",
    color: C.orange,
    title: "Stream Response",
    explain:
      "The output token is streamed back to the client via Server-Sent Events. TTFT marks when the first token arrives.",
    log: `SSE stream → client receives "${OUTPUT}" (TTFT: ${TTFT_MS}ms)`,
  },
  {
    id: 12,
    label: "Done",
    color: C.green,
    title: "Inference Complete",
    explain:
      'Full path: "Hello" tokenized → embedded → prefilled → decoded → "World" returned. KV cache retained for follow-up turns.',
    log: `Complete: "${INPUT}" → "${OUTPUT}" in ${TTFT_MS + DECODE_MS}ms total`,
  },
];

function StepVisual({ step, t }) {
  const W = 920;
  const H = 300;
  const svgStyle = { display: "block", width: "100%", minHeight: 360 };

  switch (step.id) {
    case 1:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={40} y={60} width={100} height={70} rx={10} fill={C.panel} stroke={C.cyan} strokeWidth={1.5} />
          <text x={90} y={88} textAnchor="middle" fill={C.cyan} fontSize={11} fontFamily="monospace" fontWeight="bold">CLIENT</text>
          <text x={90} y={108} textAnchor="middle" fill={C.text} fontSize={10} fontFamily="monospace">"Hello"</text>
          <line x1={140} y1={95} x2={200} y2={95} stroke={C.cyan} strokeWidth={2} opacity={t} markerEnd="url(#arr-cyan)" />
          <rect x={200} y={50} width={280} height={90} rx={10} fill={`${C.cyan}12`} stroke={C.cyan} strokeWidth={1.5} opacity={0.5 + t * 0.5} />
          <text x={340} y={78} textAnchor="middle" fill={C.cyan} fontSize={10} fontFamily="monospace" fontWeight="bold">vLLM API Gateway</text>
          <text x={340} y={98} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">POST /v1/completions</text>
          <text x={340} y={118} textAnchor="middle" fill={C.text} fontSize={9} fontFamily="monospace">{`{ "prompt": "${INPUT}" }`}</text>
          <defs><marker id="arr-cyan" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill={C.cyan} /></marker></defs>
        </svg>
      );

    case 2: {
      const chars = INPUT.split("");
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          {chars.map((ch, i) => (
            <g key={i} opacity={t > i / chars.length ? 1 : 0.3}>
              <rect x={120 + i * 44} y={70} width={36} height={36} rx={6} fill={C.panel} stroke={C.cyan} strokeWidth={1} />
              <text x={138 + i * 44} y={94} textAnchor="middle" fill={C.cyan} fontSize={16} fontFamily="monospace">{ch}</text>
            </g>
          ))}
          <text x={340} y={130} textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="monospace" opacity={t}>tokenizer →</text>
          <g opacity={Math.max(0, (t - 0.4) * 1.5)}>
            <rect x={260} y={145} width={160} height={50} rx={10} fill={`${C.cyan}22`} stroke={C.cyan} strokeWidth={2} />
            <text x={340} y={168} textAnchor="middle" fill={C.cyan} fontSize={14} fontFamily="monospace" fontWeight="bold">{INPUT}</text>
            <text x={340} y={186} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">token #{TOKEN_ID}</text>
          </g>
        </svg>
      );
    }

    case 3:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={80} y={80} width={80} height={40} rx={8} fill={`${C.cyan}22`} stroke={C.cyan} strokeWidth={1.5} />
          <text x={120} y={106} textAnchor="middle" fill={C.cyan} fontSize={12} fontFamily="monospace">#{TOKEN_ID}</text>
          <text x={200} y={106} fill={C.muted} fontSize={14} fontFamily="monospace" opacity={t}>→</text>
          <rect x={230} y={60} width={320} height={80} rx={10} fill={`${C.blue}15`} stroke={C.blue} strokeWidth={1.5} />
          {Array.from({ length: 24 }).map((_, i) => (
            <rect key={i} x={240 + i * 12} y={75} width={8} height={50 * (0.3 + 0.7 * Math.sin(i * 0.8))}
              fill={C.blue} opacity={t * (0.3 + (i % 5) * 0.12)} rx={2} />
          ))}
          <text x={390} y={118} textAnchor="middle" fill={C.blue} fontSize={10} fontFamily="monospace">vector[{EMBED_DIM}]</text>
        </svg>
      );

    case 4:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={220} y={40} width={240} height={140} rx={12} fill={C.panel} stroke={C.purple} strokeWidth={2} />
          <text x={340} y={68} textAnchor="middle" fill={C.purple} fontSize={12} fontFamily="monospace" fontWeight="bold">GPU (A100/H100)</text>
          {Array.from({ length: 8 }).map((_, i) => (
            <rect key={i} x={240 + (i % 4) * 52} y={82 + Math.floor(i / 4) * 28} width={44} height={20} rx={4}
              fill={i === 0 && t > 0.3 ? `${C.purple}55` : C.dim} stroke={i === 0 ? C.purple : C.border} strokeWidth={0.5} />
          ))}
          <text x={340} y={165} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">Continuous batching slot</text>
          <rect x={240} y={175} width={200 * t} height={8} rx={4} fill={C.purple} />
          <text x={340} y={200} textAnchor="middle" fill={C.purple} fontSize={9} fontFamily="monospace">SM util: {Math.round(t * 92)}%</text>
        </svg>
      );

    case 5:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          {[["Q", C.cyan, 120], ["K", C.gold, 280], ["V", C.green, 440]].map(([label, color, x]) => (
            <g key={label} opacity={0.4 + t * 0.6}>
              <rect x={x} y={60} width={80} height={80} rx={10} fill={`${color}18`} stroke={color} strokeWidth={1.5} />
              <text x={x + 40} y={108} textAnchor="middle" fill={color} fontSize={20} fontFamily="monospace" fontWeight="bold">{label}</text>
            </g>
          ))}
          <text x={340} y={170} textAnchor="middle" fill={C.purple} fontSize={10} fontFamily="monospace" opacity={t}>
            Attention = softmax(QKᵀ / √d) · V
          </text>
          <rect x={200} y={185} width={280 * t} height={10} rx={5} fill={C.purple} opacity={0.6} />
          <text x={340} y={210} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">Layer 1 → {Math.min(LAYER_COUNT, Math.ceil(t * LAYER_COUNT))} / {LAYER_COUNT}</text>
        </svg>
      );

    case 6:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={80} y={50} width={520} height={60} rx={10} fill={`${C.gold}15`} stroke={C.gold} strokeWidth={2} />
          <text x={340} y={78} textAnchor="middle" fill={C.gold} fontSize={12} fontFamily="monospace" fontWeight="bold">⚡ PREFILL — parallel</text>
          <text x={340} y={98} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">1 input token × {LAYER_COUNT} layers simultaneously</text>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x={100 + i * 42} y={130} width={32} height={40} rx={4}
              fill={C.gold} opacity={t > i / 12 ? 0.8 : 0.15} />
          ))}
          <rect x={100} y={185} width={480 * t} height={10} rx={5} fill={C.gold} />
          <text x={340} y={210} textAnchor="middle" fill={C.gold} fontSize={10} fontFamily="monospace">{Math.round(t * PREFILL_MS)} / {PREFILL_MS} ms</text>
        </svg>
      );

    case 7:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          {Array.from({ length: 4 }).map((_, i) => (
            <g key={i} opacity={t > i * 0.2 ? 1 : 0.2}>
              <text x={100} y={70 + i * 38} fill={C.kv} fontSize={10} fontFamily="monospace">Layer {i + 1}:</text>
              <text x={180} y={70 + i * 38} fill={C.text} fontSize={9} fontFamily="monospace">K = Wₖ · x</text>
              <text x={320} y={70 + i * 38} fill={C.text} fontSize={9} fontFamily="monospace">V = Wᵥ · x</text>
              <rect x={460} y={56 + i * 38} width={80 * Math.min(1, (t - i * 0.2) * 2)} height={14} rx={3} fill={C.kv} />
            </g>
          ))}
          <text x={340} y={195} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">… × {LAYER_COUNT} layers total</text>
        </svg>
      );

    case 8:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <text x={340} y={45} textAnchor="middle" fill={C.kv} fontSize={11} fontFamily="monospace" fontWeight="bold">PagedAttention — GPU HBM</text>
          {Array.from({ length: 12 }).map((_, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const filled = t * 12 > i;
            return (
              <rect key={i} x={180 + col * 82} y={60 + row * 48} width={72} height={38} rx={6}
                fill={filled ? `${C.kv}33` : C.panel} stroke={filled ? C.kv : C.border} strokeWidth={1} />
            );
          })}
          {Array.from({ length: 12 }).map((_, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            return (
              <text key={`l-${i}`} x={216 + col * 82} y={84 + row * 48} textAnchor="middle"
                fill={C.kv} fontSize={8} fontFamily="monospace" opacity={t * 12 > i ? 1 : 0.3}>
                Block {i + 1}
              </text>
            );
          })}
          <text x={340} y={210} textAnchor="middle" fill={C.kv} fontSize={10} fontFamily="monospace">{KV_SIZE_KB} KB allocated</text>
        </svg>
      );

    case 9:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={80} y={50} width={220} height={55} rx={8} fill={`${C.gold}12`} stroke={C.gold} strokeWidth={1} opacity={1 - t * 0.5} />
          <text x={190} y={82} textAnchor="middle" fill={C.gold} fontSize={10} fontFamily="monospace">PREFILL (done)</text>
          <text x={340} y={82} textAnchor="middle" fill={C.muted} fontSize={18} fontFamily="monospace" opacity={t}>→</text>
          <rect x={400} y={50} width={220} height={55} rx={8} fill={`${C.green}${Math.round(t * 40).toString(16).padStart(2, "0")}`} stroke={C.green} strokeWidth={2} />
          <text x={510} y={82} textAnchor="middle" fill={C.green} fontSize={10} fontFamily="monospace" fontWeight="bold">DECODE (active)</text>
          <circle cx={510} cy={150} r={18 + 4 * Math.sin(t * 12)} fill={`${C.green}44`} stroke={C.green} strokeWidth={2} />
          <text x={510} y={155} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="monospace">1 tok</text>
          <text x={340} y={195} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">Reuses cached K,V — no recompute</text>
        </svg>
      );

    case 10: {
      const candidates = [
        { word: "World", p: 0.84 },
        { word: "there", p: 0.09 },
        { word: "!", p: 0.04 },
        { word: "…", p: 0.03 },
      ];
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          {candidates.map((c, i) => {
            const y = 60 + i * 38;
            const w = c.p * 400 * (c.word === OUTPUT ? t : Math.min(t, 0.5));
            const isWinner = c.word === OUTPUT;
            return (
              <g key={c.word}>
                <text x={100} y={y + 14} fill={isWinner ? C.green : C.muted} fontSize={11} fontFamily="monospace">{c.word}</text>
                <rect x={160} y={y} width={w} height={20} rx={4} fill={isWinner ? C.green : C.dim} opacity={0.8} />
                <text x={570} y={y + 14} textAnchor="end" fill={isWinner ? C.green : C.muted} fontSize={10} fontFamily="monospace">p={c.p}</text>
              </g>
            );
          })}
          <rect x={250} y={175} width={140} height={36} rx={8} fill={`${C.green}22`} stroke={C.green} strokeWidth={2} opacity={t} />
          <text x={320} y={198} textAnchor="middle" fill={C.green} fontSize={14} fontFamily="monospace" fontWeight="bold" opacity={t}>{OUTPUT}</text>
        </svg>
      );
    }

    case 11:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <rect x={380} y={60} width={100} height={70} rx={10} fill={C.panel} stroke={C.orange} strokeWidth={1.5} />
          <text x={430} y={88} textAnchor="middle" fill={C.orange} fontSize={11} fontFamily="monospace" fontWeight="bold">vLLM</text>
          <text x={430} y={108} textAnchor="middle" fill={C.green} fontSize={12} fontFamily="monospace">"{OUTPUT}"</text>
          <line x1={380} y1={95} x2={180} y2={95} stroke={C.orange} strokeWidth={2} opacity={t} strokeDasharray="6,4" />
          <rect x={40} y={60} width={100} height={70} rx={10} fill={`${C.cyan}${Math.round(t * 30).toString(16).padStart(2, "0")}`} stroke={C.cyan} strokeWidth={1.5} />
          <text x={90} y={88} textAnchor="middle" fill={C.cyan} fontSize={11} fontFamily="monospace" fontWeight="bold">CLIENT</text>
          <text x={90} y={115} textAnchor="middle" fill={C.green} fontSize={11} fontFamily="monospace" opacity={t}>"{OUTPUT}"</text>
          <text x={340} y={170} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">Server-Sent Events stream</text>
          <text x={340} y={190} textAnchor="middle" fill={C.gold} fontSize={10} fontFamily="monospace">TTFT: {TTFT_MS}ms</text>
        </svg>
      );

    case 12:
      return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={svgStyle}>
          <line x1={80} y1={110} x2={600} y2={110} stroke={C.border} strokeWidth={2} />
          {[
            [INPUT, C.cyan, 100],
            ["Token", C.cyan, 200],
            ["Prefill", C.gold, 320],
            ["KV", C.kv, 420],
            ["Decode", C.green, 520],
            [OUTPUT, C.green, 600],
          ].map(([label, color, x], i) => (
            <g key={label} opacity={t > i / 6 ? 1 : 0.3}>
              <circle cx={x} cy={110} r={8} fill={color} />
              <text x={x} y={135} textAnchor="middle" fill={color} fontSize={9} fontFamily="monospace">{label}</text>
            </g>
          ))}
          <text x={340} y={175} textAnchor="middle" fill={C.green} fontSize={14} fontFamily="monospace" fontWeight="bold">
            "{INPUT}" → "{OUTPUT}"
          </text>
          <text x={340} y={200} textAnchor="middle" fill={C.muted} fontSize={10} fontFamily="monospace">
            {TTFT_MS}ms TTFT · {DECODE_MS}ms decode · {KV_SIZE_KB} KB KV cache
          </text>
        </svg>
      );

    default:
      return null;
  }
}

function PipelineTrack({ stepIdx, phase, onSelect }) {
  return (
    <div style={{ display: "flex", gap: 3, padding: "12px 0", overflowX: "auto", marginBottom: 16 }}>
      {STEPS.map((s, i) => {
        const isCurrent = i === stepIdx && phase === "animating";
        const isPast = i < stepIdx || (i === stepIdx && phase === "done");
        return (
          <button
            key={s.id}
            onClick={() => onSelect(i)}
            title={s.title}
            style={{
              background: isCurrent ? s.color : isPast ? `${s.color}33` : C.panel,
              border: `1px solid ${isCurrent ? s.color : isPast ? `${s.color}66` : C.border}`,
              borderRadius: 16,
              padding: "4px 8px",
              cursor: "pointer",
              color: isCurrent ? "#000" : isPast ? s.color : C.muted,
              fontSize: 13,
              fontFamily: "monospace",
              fontWeight: "bold",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "all 0.2s",
              padding: "6px 12px",
            }}
          >
            {s.id}. {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default function InferencePipelinePage() {
  const [stepIdx, setStepIdx] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const [animT, setAnimT] = useState(0);
  const [events, setEvents] = useState([]);
  const [playing, setPlaying] = useState(false);

  const runningRef = useRef(false);
  const playingRef = useRef(false);
  const sessionRef = useRef(0);

  const reset = useCallback(() => {
    sessionRef.current += 1;
    runningRef.current = false;
    playingRef.current = false;
    setStepIdx(-1);
    setPhase("idle");
    setAnimT(0);
    setEvents([]);
    setPlaying(false);
  }, []);

  const runStep = useCallback(async (index, session) => {
    if (session !== sessionRef.current) return false;
    if (runningRef.current) return false;
    runningRef.current = true;

    const step = STEPS[index];
    setStepIdx(index);
    setPhase("animating");
    setAnimT(0);

    try {
      await animateValue(setAnimT, PHASE_ANIM_MS);
      if (session !== sessionRef.current) return false;
      setEvents((prev) => {
        if (prev.some((e) => e.id === index)) return prev;
        return [
          { id: index, color: step.color, prefix: `${step.id}.`, text: step.log },
          ...prev,
        ].slice(0, 14);
      });
      setPhase("done");
      return true;
    } finally {
      runningRef.current = false;
    }
  }, []);

  const runFrom = useCallback(
    async (start, session) => {
      for (let i = start; i < STEPS.length; i++) {
        if (session !== sessionRef.current || !playingRef.current) break;
        await runStep(i, session);
        if (i < STEPS.length - 1) {
          await delay(STEP_GAP_MS);
          if (session !== sessionRef.current || !playingRef.current) break;
        }
      }
      if (session === sessionRef.current) {
        setPlaying(false);
        playingRef.current = false;
      }
    },
    [runStep]
  );

  const step = useCallback(async () => {
    if (runningRef.current) return;
    const next = stepIdx + 1;
    if (next >= STEPS.length) return;
    setPlaying(false);
    playingRef.current = false;
    await runStep(next, sessionRef.current);
  }, [runStep, stepIdx]);

  const startPlay = useCallback(async () => {
    if (runningRef.current) return;
    if (stepIdx >= STEPS.length - 1 && phase === "done") {
      reset();
      await delay(50);
    }
    const session = sessionRef.current;
    playingRef.current = true;
    setPlaying(true);
    const start = stepIdx < 0 ? 0 : phase === "done" ? stepIdx + 1 : stepIdx;
    if (start >= STEPS.length) return;
    await runFrom(start, session);
  }, [phase, stepIdx, reset, runFrom]);

  useEffect(() => {
    const session = sessionRef.current;
    playingRef.current = true;
    setPlaying(true);
    runFrom(0, session);
    return () => {
      sessionRef.current += 1;
      playingRef.current = false;
      runningRef.current = false;
    };
  }, [runFrom]);

  const jumpTo = useCallback(
    async (index) => {
      if (runningRef.current) return;
      sessionRef.current += 1;
      const session = sessionRef.current;
      setPlaying(false);
      playingRef.current = false;
      setStepIdx(-1);
      setPhase("idle");
      setAnimT(0);
      setEvents([]);
      await delay(30);
      for (let i = 0; i <= index; i++) {
        if (session !== sessionRef.current) break;
        await runStep(i, session);
        if (i < index) await delay(100);
      }
    },
    [runStep]
  );

  const isAnimating = phase === "animating";
  const completed = stepIdx >= STEPS.length - 1 && phase === "done";
  const currentStep = stepIdx >= 0 ? STEPS[stepIdx] : null;
  const doneCount = stepIdx < 0 ? 0 : phase === "done" ? stepIdx + 1 : stepIdx;

  return (
    <PageShell>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseStage { 0%,100% { opacity: 0.9; } 50% { opacity: 1; } }
      `}</style>

      <PagePanel borderColor={C.cyan}>
        <PageHeader
          color={C.cyan}
          title="vLLM Inference Pipeline"
          description={
            <>
              Follow a single request — prompt <span style={{ color: C.cyan }}>"{INPUT}"</span> → output{" "}
              <span style={{ color: C.green }}>"{OUTPUT}"</span> — through every stage of vLLM inference on
              OpenShift AI: tokenization, GPU attention, prefill, KV cache, decode, and streaming response.
            </>
          }
        />

        <PageLayout
          main={
            <>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20, padding: "16px 20px", background: `${C.bg}88`, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <Stat label="Stage" value={`${doneCount} / ${STEPS.length}`} color={C.cyan} />
                <Stat label="Input" value={`"${INPUT}"`} color={C.cyan} />
                <Stat label="Output" value={completed ? `"${OUTPUT}"` : "…"} color={C.green} />
                <Stat label="TTFT" value={doneCount >= 6 ? `${TTFT_MS} ms` : "—"} color={C.gold} />
                <Stat label="KV cache" value={doneCount >= 8 ? `${KV_SIZE_KB} KB` : "—"} color={C.kv} />
                <Stat label="Layers" value={doneCount >= 5 ? String(LAYER_COUNT) : "—"} color={C.purple} />
              </div>

              <PipelineTrack stepIdx={stepIdx} phase={phase} onSelect={jumpTo} />

              {currentStep ? (
                <div
                  style={{
                    marginBottom: 20,
                    padding: "28px 32px",
                    background: `${currentStep.color}08`,
                    border: `1px solid ${currentStep.color}44`,
                    borderRadius: 14,
                    animation: isAnimating ? "pulseStage 1s ease-in-out infinite" : undefined,
                  }}
                >
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ color: currentStep.color, fontFamily: "monospace", fontSize: 26, fontWeight: "bold", lineHeight: 1.3 }}>
                      Stage {currentStep.id} — {currentStep.title}
                    </span>
                  </div>
                  <StepVisual step={currentStep} t={animT} />
                  <p style={{ color: C.text, fontSize: 17, fontFamily: "monospace", lineHeight: 1.75, margin: "20px 0 0", borderLeft: `4px solid ${currentStep.color}66`, paddingLeft: 16 }}>
                    {currentStep.explain}
                  </p>
                </div>
              ) : (
                <div style={{ padding: "56px 32px", textAlign: "center", color: C.dim, fontFamily: "monospace", fontSize: 16, marginBottom: 20, border: `1px dashed ${C.border}`, borderRadius: 14 }}>
                  Auto-playing all {STEPS.length} stages — use controls on the right to step manually
                </div>
              )}

              <SectionLabel>END-TO-END FLOW</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 20 }}>
                {["Client", "Tokenize", "Embed", "GPU", "Attention", "Prefill", "KV Cache", "Decode", OUTPUT].map((label, i, arr) => (
                  <span key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontFamily: "monospace",
                        fontWeight: "bold",
                        background: i <= stepIdx ? `${C.cyan}22` : C.panel,
                        border: `1px solid ${i <= stepIdx && stepIdx >= 0 ? C.cyan : C.border}`,
                        color: i <= stepIdx && stepIdx >= 0 ? C.cyan : C.muted,
                      }}
                    >
                      {label}
                    </span>
                    {i < arr.length - 1 && <span style={{ color: C.dim, fontSize: 14 }}>→</span>}
                  </span>
                ))}
              </div>

              {completed && (
                <div style={{ padding: "18px 22px", background: `${C.green}11`, border: `1px solid ${C.green}44`, borderRadius: 12 }}>
                  <div style={{ color: C.green, fontFamily: "monospace", fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
                    INFERENCE COMPLETE
                  </div>
                  <div style={{ color: C.muted, fontSize: 15, fontFamily: "monospace", lineHeight: 1.7 }}>
                    "{INPUT}" was tokenized, embedded, processed through {LAYER_COUNT} attention layers during prefill,
                    K/V values stored in {KV_SIZE_KB} KB paged cache, then decoded to produce "{OUTPUT}" in {TTFT_MS + DECODE_MS}ms total.
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
