# Presenter Scripts — vLLM + llm-d Inference Visualizer

Technical narration scripts for each page in the visualizer. They follow the demo's actual flow, components, and numbers so you can narrate while stepping through the UI.

## How to use these scripts

- **Suggested order:** Inference Pipeline → Single vLLM → Naive LB → llm-d Routing → llm-d In Action (each page builds on the last).
- **Controls:** Use **Play**, **Step**, or **Reset** in the right sidebar; point at the diagram, stats bar, and event log as you speak.
- **Timing:** Each animated phase is roughly 2–6 seconds; pause on cache hits/misses and tail-latency charts.

---

## Suggested full-session arc (optional 45-min talk)

| Segment | Page | One-line bridge |
|---------|------|-----------------|
| 1 | Inference Pipeline | "Here's what one request costs." |
| 2 | Single vLLM | "Here's why cache reuse matters on one machine." |
| 3 | Naive LB | "Here's why naive scaling wastes that reuse." |
| 4 | llm-d Routing | "Here's the fix — and the latency proof." |
| 5 | llm-d In Action | "Here's the architecture that delivers it." |

---

# Page 1: Inference Pipeline

**Duration:** ~8–12 minutes (12 stages, auto-play or step-through)

### Opening (30 sec)

> "Before we talk about scaling or routing, we need one mental model: what actually happens when a single prompt hits vLLM. This page traces one request — prompt **'Hello'** → output **'World'** — through every stage on OpenShift AI. Watch the stage counter, the pipeline track at the top, and the live metrics: TTFT, KV cache size, and layer count."

### Major components to introduce

| Component | What to say |
|-----------|-------------|
| **Client** | Sends an OpenAI-compatible `POST /v1/completions` request |
| **Tokenizer** | Converts text into subword token IDs the model understands |
| **Embedding table** | Maps each token ID to a dense vector (4096 dimensions here) |
| **GPU scheduler** | vLLM's continuous batching assigns work to GPU tensor cores |
| **Self-attention (Q·K·V)** | Each transformer layer projects input into Query, Key, Value |
| **Prefill phase** | All input tokens processed **in parallel** — this sets **TTFT** |
| **KV cache** | Keys and values stored per layer so decode doesn't recompute attention |
| **PagedAttention** | KV blocks allocated on demand in GPU HBM — no wasted memory |
| **Decode phase** | Autoregressive: **one new token per forward pass** |
| **SSE stream** | Response streamed back to the client token by token |

### Stage-by-stage narration

**Stage 1 — Client Request**

> "A client sends `POST /v1/completions` with prompt 'Hello' to the vLLM API gateway. Nothing has been computed yet — this is just request intake."

**Stage 2 — Tokenization**

> "The tokenizer splits 'Hello' into subword token IDs. In our example, that's a single token — vocabulary entry **#9906**. Models never see raw strings; they see integers."

**Stage 3 — Embedding Lookup**

> "Token #9906 is looked up in the embedding table and becomes a **4096-dimensional vector**. That vector encodes semantic meaning in geometric space — the model's native input format."

**Stage 4 — GPU Scheduler**

> "vLLM's scheduler assigns this request to a GPU slot. Tensor cores are prepared for the matrix multiplications ahead. This is where continuous batching starts to matter at scale."

**Stage 5 — Self-Attention (Q · K · V)**

> "Inside each transformer layer, the input is projected into **Query, Key, and Value** matrices. Attention scores — softmax of QKᵀ over √d — determine how tokens relate to each other."

**Stage 6 — Prefill Phase**

> "Here's the first major phase split. **Prefill** runs all input tokens **in parallel** through **32 transformer layers**. It's compute-bound and largely determines **Time To First Token — TTFT**. In our demo, prefill takes about **84 ms**."

**Stage 7 — KV Cache Calculation**

> "During prefill, each layer computes K = Wₖ·x and V = Wᵥ·x. These tensors are the expensive part of attention. We save them instead of recomputing on every decode step."

**Stage 8 — KV Cache Storage**

> "vLLM stores K and V in **paged GPU memory blocks** — PagedAttention. About **12.4 KB** lands in HBM for this request. Blocks are allocated on demand; no fixed-size waste."

**Stage 9 — Decode Phase**

> "Generation switches to **autoregressive mode**: one new token per forward pass. Each step **reuses** the cached K and V from prefill. Decode is more memory-bound than prefill."

**Stage 10 — Output Token Generation**

> "The model samples from the vocabulary distribution. 'World' wins with probability **0.84** and becomes the selected output token."

**Stage 11 — Stream Response**

> "That token is streamed to the client over **Server-Sent Events**. TTFT — when the first token arrives — is prefill plus a small overhead, roughly **92 ms** in this demo."

**Stage 12 — Inference Complete**

> "Full path: 'Hello' tokenized → embedded → prefilled → decoded → 'World' returned. Critically, the **KV cache is retained** for follow-up turns. That retention is what the next pages build on."

### Closing takeaway

> "Remember three ideas from this page: **(1)** inference has two phases — parallel prefill and sequential decode; **(2)** the KV cache is the bridge between them; **(3)** TTFT is dominated by prefill. Everything after this page is about not wasting that prefill work."

---

# Page 2: Single vLLM

**Duration:** ~6–8 minutes (8 requests, step or auto-play)

### Opening (30 sec)

> "Page 1 showed one request end-to-end. Now we zoom into **one vLLM engine** and run **eight requests** through it. The diagram has three horizontal bands: **PREFILL** at the top, **KV CACHE** in the middle, **DECODE** at the bottom. Same instance, shared cache — no load balancer yet."

### Major components

| Component | Role |
|-----------|------|
| **Client queue** | Eight prompts arrive sequentially |
| **PREFILL band** | Parallel processing of all prompt tokens (compute-bound) |
| **KV CACHE band** | Local store of warmed prompt prefixes |
| **DECODE band** | Sequential output tokens (3 per request in this demo) |
| **Stats bar** | Prefill runs, cache hits, prefill time vs decode time |
| **Request grid (Q1–Q8)** | Q5–Q8 are **repeats** of Q1–Q4 |

### Workflow narration

**Setup — the two phases**

> "Every request follows the same pattern: arrive at the engine, optionally run prefill, always run decode. Prefill costs **84 ms**. Decode costs **42 ms** for three output tokens. If the prompt prefix is already in the KV cache, **prefill is skipped entirely**."

**Q1–Q4 — cold starts (cache misses)**

> "Q1 through Q4 are four distinct prompts — summarize, code review, translate, explain. Each is a **cache miss**. Watch prefill light up: all input tokens process in parallel, KV blocks fill, then decode generates three tokens sequentially. After each request, that prompt's prefix is stored in the local KV cache."

**Q5–Q8 — repeats (cache hits)**

> "Q5–Q8 repeat the same four prompts in shuffled order. But because we're still on the **same vLLM instance**, the KV cache is warm. Watch prefill **not** run — the request jumps straight to decode. Each hit saves **84 ms** of prefill."

**Point at the stats bar as requests complete**

> "Prefill runs should stay at **4**, not 8. Cache hits should climb to **4**. Total prefill time is **336 ms**; total decode time is **336 ms** across all eight. The event log spells it out: `KV HIT — skipped prefill`."

### Closing takeaway

> "On a **single instance**, KV cache reuse is automatic. Repeated or continued prompts are fast because prefill is skipped. The problem we'll see next: **scale out to multiple pods**, and that local cache is no longer shared."

---

# Page 3: Naive LB (Round-Robin Load Balancer)

**Duration:** ~6–8 minutes

### Opening (30 sec)

> "Production doesn't run one engine — it runs a **pool of vLLM pods** behind a load balancer. This page shows the simplest approach: **stateless round-robin**. Eight client requests, four pods, no stickiness, no cache awareness. The question: what happens to the KV cache when you scale?"

### Major components

| Component | Role |
|-----------|------|
| **Clients (8 reqs)** | Same eight prompts as the previous page |
| **Load Balancer** | Round-robin pointer rotates Pod 1 → 2 → 3 → 4 → 1… |
| **vLLM Pod 1–4** | Each has its **own local KV cache** — not shared |
| **Request grid** | Shows which pod each request is assigned to |
| **Stats** | Cache hits/misses, prefill recomputes, **wasted prefill ms** |

### Workflow narration

**How round-robin routes**

> "Request one goes to Pod 1, two to Pod 2, three to Pod 3, four to Pod 4, then five back to Pod 1, and so on. The balancer is **fair** — every pod gets equal traffic — but it has **zero memory** of where a prompt was cached."

**Q1–Q4 — first pass, all misses**

> "The first four requests each land on a different pod. All are cache misses — expected cold starts. Each pod's local KV cache fills with one prompt prefix. So far, so good."

**Q5–Q8 — repeats, all misses again**

> "Here's the failure mode. Q5 repeats 'code review' — but round-robin sends it to **Pod 1**, which cached 'summarize', not code review. **Cache miss. Full prefill recomputed.** Same for Q6, Q7, Q8: repeated prompts hit pods that never warmed them. Watch the red **PREFILL RECOMPUTE** bar pulse on the wrong pod."

**Point at per-pod KV cache panels**

> "Look at the fragmentation: Pod 1 holds summarize, Pod 2 holds code review — but neither pod holds both. The cache **exists**, just on the **wrong replica**."

**Final stats**

> "Four of eight requests are hits — only when round-robin happens to land on the pod that already has that prefix. Four are misses. That's **336 ms of wasted prefill** — work we already did on a different pod. The result banner says it plainly: **KV cache fragmented across pods**."

### Closing takeaway

> "Round-robin is simple and stateless, but it **throws away prefill investment** under repeat-heavy traffic — RAG, chat continuations, shared system prompts. The fix isn't bigger GPUs; it's **smarter routing**. That's the next page."

---

# Page 4: llm-d Routing (Cache + Load Aware)

**Duration:** ~8–10 minutes

### Opening (30 sec)

> "Same eight prompts, same four pods — but now the **llm-d Router** replaces naive round-robin. Two policies: **cache-aware** routes to a pod that already holds the matching KV prefix; **load-aware** picks the least-loaded pod for cold starts. Watch the routing label flash on each request and compare latency charts at the end."

### Major components

| Component | Role |
|-----------|------|
| **llm-d Router** | Intelligent gateway — cache-aware + load-aware |
| **Four vLLM pods** | Same local KV caches as before |
| **Routing label** | Shows `cache-aware` or `load-aware` per request |
| **Latency charts** | Per-request bars for naive RR vs llm-d |
| **Percentile tables** | P50, P95, P99, average — demo and production sim |

### Workflow narration

**Cold starts — load-aware**

> "For Q1–Q4, no pod has seen these prompts yet. The router uses **load-aware** routing: send each request to the replica with the lightest cache load. Cold prefill still runs — you can't avoid that on first contact — but work is spread evenly."

**Repeats — cache-aware**

> "Q5–Q8 repeat earlier prompts. Now the router scans: which pod already holds this prefix in KV cache? It routes **back to that pod**. Prefill is skipped; only decode runs — **42 ms** instead of **126 ms** (84 + 42). The event log shows `cache HIT — decode only`."

**Latency distribution**

> "Scroll to the charts. Naive round-robin treats every repeat as a miss — all repeat requests sit at **126 ms**. llm-d drops repeats to **42 ms**. The orange **P95 line** shifts down because tail latency spikes come from redundant prefills."

**Production extrapolation (100 requests)**

> "The eight-request demo is pedagogical. The **production simulation** runs 100 requests with heavy repeat traffic. P95 and P99 collapse under llm-d because cache-aware routing eliminates the prefill spikes that inflate tail latency. Median improves too, but the real win is **consistency** — fewer slow outliers."

**Final stats**

> "Check **Prefill saved** in the stats bar — that's milliseconds of compute llm-d avoided by not recomputing KV on the wrong pod. P95 and P99 on the demo should be materially lower than naive RR."

### Closing takeaway

> "Intelligent routing doesn't change the model or the pods — it changes **where** work lands. Cache-aware for repeats, load-aware for cold starts. That's how you protect TTFT and tail latency in real workloads. The *how* is the next page."

---

# Page 5: llm-d In Action (Internals)

**Duration:** ~10–15 minutes (7 micro-steps × 8 requests; auto-plays on load)

### Opening (30 sec)

> "The previous page showed **what** llm-d achieves. This page shows **how** — the official architecture: Client → **llm-d Router** (Proxy + EPP) → **InferencePool** model servers. Each request walks through seven micro-steps. Follow the component map at the bottom and the active-component highlight in the architecture diagram."

### Architecture overview (point at diagram)

> "Three layers. **Data plane:** Envoy Proxy accepts traffic. **Control plane inside the router:** the **Endpoint Picker (EPP)** makes routing decisions via **ext-proc** — Envoy's external processing hook. **InferencePool:** four vLLM model server replicas, each with local KV cache."

### Per-request micro-step script (repeat for each of 8 requests; vary hit/miss language)

**Step 1 — Proxy accepts client request**

> "The Proxy on the data plane receives the client's `POST /v1/chat/completions`. It holds the connection open — it does **not** blindly forward. Routing intelligence runs first."

**Step 2 — Proxy consults EPP via ext-proc**

> "Before forwarding, the Proxy pauses and calls the **Endpoint Picker** over **ext-proc**. This is the integration point: Envoy asks an external service, 'which replica should handle this request?'"

**Step 3 — EPP Scrapers collect telemetry**

> "Scraper plugins poll every model server in the InferencePool: **KV-cache block occupancy**, **prefix hash index**, **queue depth**, and **GPU memory headroom**. The EPP needs live state, not stale config."

**Step 4 — EPP Filters narrow candidates**

> "Filter plugins drop unhealthy or over-capacity endpoints. What remains is the **candidate set** — healthy replicas that can accept work right now."

**Step 5 — EPP Scorers rank replicas**

> "Scorers rank candidates. On a **cache hit**, the **KV-cache affinity scorer** heavily boosts the pod that already holds matching prefix blocks; a **load scorer** breaks ties. On a **cold start**, no KV match — **load-aware scorer** picks the least-loaded replica."

> *[Point at score table if shown]* "You'll see per-pod affinity and load scores. The winner is the highest total."

**Step 6 — EPP returns endpoint to Proxy**

> "The EPP applies the routing policy — `cache-aware` or `load-aware` — and returns the chosen pod to the Proxy over ext-proc."

**Step 7 — Proxy forwards to Model Server**

> "The Proxy forwards into the InferencePool. On a **hit**, the model server skips prefill and runs decode only. On a **miss**, full prefill then decode on the selected replica — and that pod's KV cache warms for the next repeat."

### Walk through Q5–Q8 explicitly

> "For repeats Q5–Q8, watch scrapers find an existing prefix hash on a specific pod, affinity scorer wins, policy is **cache-aware**, and prefill is skipped. That's the same outcome as Page 4 — but now you see the machinery: ext-proc, scrapers, filters, scorers."

### Closing takeaway

> "llm-d is not magic routing logic in the proxy alone. It's a **pluggable pipeline**: scrape live inference telemetry, filter bad endpoints, score replicas by cache affinity and load, return a decision over ext-proc. That's how OpenShift AI inference stays fast under repeat-heavy, multi-tenant traffic."
