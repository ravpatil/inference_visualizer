# 🧠 vLLM Inferencing Visualizer

An interactive, animated web application that visualizes how Large Language Models process text step-by-step using **vLLM** inference engine on **OpenShift AI**. This tool helps everyone—from laypersons to technical experts—understand the complexity of LLM inference.

## ✨ Features

### 🎨 Modern Interactive UI
- **Large, colorful animated blocks** for each inference stage
- **Real-time phase visualization** showing Prefill vs Decode stages
- **Smooth transitions & animations** for educational impact
- **Mobile-responsive design** with dark theme

### 📊 Comprehensive LLM Inferencing Visualization
- **10-step inference pipeline** covering the entire LLM execution lifecycle
- **Phase-based breakdown**:
  - 🔧 **Setup**: System initialization
  - ⚡ **Prefill Phase**: Parallel token processing
  - 🎯 **Decode Phase**: Sequential token generation
  - ✅ **Complete**: Response streaming
- **Real-time metrics**: TTFT latency, throughput, memory usage
- **Educational tooltips**: Each step includes layperson-friendly explanations

### 🎮 Interactive Controls
- **Navigation**: Arrow keys, spacebar, or click buttons
- **Auto-play mode**: Watch the entire pipeline automatically (Press `P`)
- **Step-by-step walkthrough**: Click any step to jump to it
- **Reset**: Start over anytime

### 🏗️ Technical Stack
- **Tokenization**: Breaking text into model-readable tokens
- **Embeddings**: Converting tokens to high-dimensional vectors
- **Attention Computation**: Multi-layer (32 layers) parallel attention
- **KV Cache**: Memory optimization for fast token generation
- **Autoregressive Generation**: One token at a time prediction

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Installation

```bash
cd vllm-visualizer
npm install
```

### Development

```bash
npm run dev
```

Server will start at `http://localhost:5173` (or `5174` if 5173 is busy)

### Production Build

```bash
npm run build
```

Output will be in the `dist/` folder.

## 🎯 How to Use

### Navigation
- **Next Step**: Click "Next ▶" button or press `Right Arrow` / `Space`
- **Previous Step**: Click "◀ Prev" button or press `Left Arrow`
- **Auto-Play**: Click "Auto-Play" button or press `P` to watch the full pipeline
- **Reset**: Click "Reset" or click any step in the trace list
- **Jump to Step**: Click on any step in the right panel to jump directly

### Understanding the Visualization

#### 🔹 Step 1: System Ready
Your request is received and the system is prepared.

#### 🔹 Steps 2-6: Prefill Phase (Parallel)
- **Tokenization** (Step 3): "Hello!" → [Token_ID, Token_ID]
- **Embeddings** (Step 4): Tokens → High-dimensional vectors
- **Attention** (Step 5): Which tokens matter? (32 parallel operations)
- **KV Cache** (Step 6): Save important info for fast generation

#### 🔹 Steps 7-9: Decode Phase (Sequential)
- **Prepare for Generation** (Step 7): Switch to serial mode
- **Generate Token 1** (Step 8): Predict "world"
- **Generate Token 2** (Step 9): Predict "!"

#### 🔹 Step 10: Stream Complete
Response sent back to client. Performance metrics collected.

## 📊 Key Metrics Explained

### TTFT (Time To First Token) Latency
- **What**: Time from request to first output token
- **Why**: Matters for user experience
- **Value**: ~85ms for this configuration

### Throughput (Tokens/sec)
- **What**: How many tokens generated per second
- **Why**: Determines response speed
- **Value**: ~72 tokens/second

### KV Memory Profile
- **What**: Cache memory used for storing Key-Value pairs
- **Why**: Enables fast token generation
- **Value**: ~12.4 MB for this example

## 🎓 For Different Audiences

### 👨‍💼 Business Users
Focus on "Auto-Play" to see the full journey. Notice how fast the system responds (85ms first token, then continuous generation).

### 👨‍💻 Developers
Check the "Execution Trace" panel on the right. Follow the tokenization → attention → cache → generation pipeline.

### 🔬 Researchers
Review the metrics and understand the trade-offs between prefill (parallel) and decode (sequential) phases.

### 📚 Educators
Use this tool to explain transformer architecture, attention mechanisms, and token generation to students.

## 🏗️ Architecture

```
User Input ("Hello!")
        ↓
   [Tokenizer] ← Break into pieces
        ↓
  [Embeddings] ← Numbers with meaning
        ↓
 [Attention] ← 32 layers learning importance
        ↓
   [KV Cache] ← Save for later
        ↓
  [Generate 1] ← Predict "world"
        ↓
  [Generate 2] ← Predict "!"
        ↓
 [Stream Back] ← Response ready
```

## 🎨 Customization

### Change the Input Text
Edit `STEPS` constant in `src/App.jsx`:
```javascript
// Change "Hello!" to your text
{ id: 2, name: "User Request", ... desc: 'Client string "Your text here"...'
```

### Modify Colors & Animations
Edit animation variants in `StepVisualization` component (line ~36 in App.jsx):
```javascript
const variantMap = {
  1: { color: 'from-blue-500 to-purple-500', ... }
  // Adjust colors here
}
```

### Add More Steps
Extend the `STEPS` array with additional pipeline stages.

## 🛠️ Technologies Used

- **React 19** - UI framework
- **Framer Motion** - Smooth animations
- **Tailwind CSS 4** - Styling
- **Lucide React** - Icons
- **Vite** - Build tool

## 📈 Performance Notes

- **Smooth animations**: 60 FPS target
- **Low resource usage**: Works on laptops and tablets
- **Dark theme**: Reduces eye strain during presentations
- **Responsive**: From mobile to 4K displays

## 🐛 Troubleshooting

### Port Already in Use
If port 5173 is busy, Vite will automatically use 5174 (or next available).

### Animations Stuttering
- Ensure you're using a modern browser (Chrome 90+, Firefox 89+, Safari 15+)
- Close other applications consuming GPU
- Try refreshing the page

### Build Errors
```bash
# Clear dependencies and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 📚 Learning Resources

- [vLLM Documentation](https://docs.vllm.ai/)
- [Transformer Architecture](https://arxiv.org/abs/1706.03762)
- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [OpenShift AI](https://ai.redhat.com/)

## 💡 Use Cases

1. **Demos & Presentations**: Show stakeholders how AI works
2. **Education**: Teach transformer internals to students
3. **Onboarding**: Help new team members understand LLM inference
4. **Documentation**: Replace static diagrams with interactive visuals
5. **Research**: Prototype inference pipeline optimizations

## 📝 License

MIT

## 🤝 Contributing

Feel free to fork, modify, and improve this visualizer for your use case!

---

**Built with ❤️ for understanding AI inference**
