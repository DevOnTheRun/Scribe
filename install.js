// Link shared Pinokio drives and install Python deps.
// LightOnOCR weights are downloaded from Settings → Models.
const fs = require("fs")
const path = require("path")

const AGENT_SCAFFOLD_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "QWEN.md",
  ".clinerules",
  ".cursorrules",
  ".geminiignore",
  ".windsurfrules",
]

function removeAgentScaffolds() {
  const root = path.resolve(__dirname)
  for (const name of AGENT_SCAFFOLD_FILES) {
    const target = path.join(root, name)
    try {
      if (!fs.existsSync(target)) continue
      fs.rmSync(target, { force: true })
      console.log(`[install] Removed leftover scaffold: ${name}`)
    } catch (err) {
      console.warn(`[install] Could not remove ${name}: ${err.message || err}`)
    }
  }
}

module.exports = {
  removeAgentScaffolds,
  requires: {
    bundle: "ai"
  },
  run: [
    {
      method: "shell.run",
      params: {
        message: "node -e \"require('./install.js').removeAgentScaffolds()\"",
      }
    },
    {
      method: "script.start",
      params: {
        uri: "link.js",
      }
    },
    {
      method: "script.start",
      params: {
        uri: "torch.js",
        params: {
          venv: "env",
        }
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        message: "uv pip install -r app/backend/requirements.txt",
      }
    },
    {
      method: "notify",
      params: {
        html: "Install complete. Click <b>Start</b>, then open <b>Settings → Models</b> to download LightOnOCR-2-1B. Faster OCR (vLLM, about 6 GB) is optional on that same tab."
      }
    },
  ]
}
