// Isolated OCR runtime. Do not install vLLM into env/.
// uv downloads its own CPython 3.12 (--managed-python), so this does not use
// the Python, conda install, or CUDA toolkit already on the machine.
// Windows NVIDIA: SystemPanic community wheel (official vLLM does not ship Windows).
// Linux NVIDIA: official vLLM wheel; uv selects the CUDA build from the driver.
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const ROOT = __dirname
const VENV = path.join(ROOT, "env-vllm")
const MARKER = path.join(VENV, ".scribe-runtime.json")
const WINDOWS_WHEEL =
  "https://github.com/SystemPanic/vllm-windows/releases/download/v0.24.0/vllm-0.24.0%2Bcu132-cp312-cp312-win_amd64.whl"

const VARIANT = {
  win32: "windows-nvidia-v0.24.0+cu132",
  linux: "linux-nvidia-official",
}

function cleanEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key === "VIRTUAL_ENV" ||
      key === "PYTHONPATH" ||
      key === "PYTHONHOME" ||
      key === "PYTHONUSERBASE" ||
      key.startsWith("CONDA_") ||
      key.startsWith("_CE_")
    ) {
      delete env[key]
    }
  }
  return env
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: cleanEnv() })
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: cleanEnv() }).trim()
}

function venvPython(platform) {
  return platform === "win32"
    ? path.join(VENV, "Scripts", "python.exe")
    : path.join(VENV, "bin", "python")
}

function vllmExe(platform) {
  return platform === "win32"
    ? path.join(VENV, "Scripts", "vllm.exe")
    : path.join(VENV, "bin", "vllm")
}

function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(MARKER, "utf8"))
  } catch {
    return null
  }
}

function venvIsUvManaged() {
  const cfgPath = path.join(VENV, "pyvenv.cfg")
  if (!fs.existsSync(cfgPath)) return false
  const text = fs.readFileSync(cfgPath, "utf8")
  if (!/^uv\s*=/m.test(text)) return false
  const home = ((text.match(/^home\s*=\s*(.*)$/m) || [])[1] || "").toLowerCase()
  if (
    home.includes("anaconda") ||
    home.includes("miniconda") ||
    home.includes("miniforge")
  ) {
    return false
  }
  return home.length > 0
}

function isLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

function removeVenv() {
  // A Pinokio drive link must stay. Deleting it would leave the next install
  // as a private folder instead of the shared drive.
  if (isLink(VENV)) return
  const link = path.join(VENV, "cuda-runtime", "bin")
  try {
    fs.rmdirSync(link)
  } catch {
    // Not present, or it is a normal directory.
  }
  fs.rmSync(VENV, { recursive: true, force: true })
}

function ensure(platform) {
  const variant = VARIANT[platform]
  if (!variant) {
    throw new Error(`install-vllm.js does not install a runtime for ${platform}`)
  }
  const marker = readMarker()
  if (
    marker &&
    marker.variant === variant &&
    marker.uv === true &&
    venvIsUvManaged() &&
    fs.existsSync(vllmExe(platform))
  ) {
    console.log(`[install-vllm] Isolated ${variant} runtime already present.`)
    return
  }
  if (fs.existsSync(VENV) && !venvIsUvManaged() && !isLink(VENV)) {
    console.log(
      "[install-vllm] Replacing env-vllm. It was not created from uv's own Python."
    )
    removeVenv()
  }

  run("uv", ["python", "install", "3.12"])
  const managed = capture("uv", ["python", "find", "3.12", "--managed-python"])
  console.log(`[install-vllm] Using uv-managed Python: ${managed}`)

  if (!fs.existsSync(venvPython(platform))) {
    const args = ["venv", "env-vllm", "--python", "3.12", "--managed-python"]
    if (!isLink(VENV)) args.push("--clear")
    run("uv", args)
  }

  const py = venvPython(platform)
  if (platform === "win32") {
    run("uv", [
      "pip",
      "install",
      "--python",
      py,
      "--index-strategy",
      "unsafe-best-match",
      WINDOWS_WHEEL,
      "--extra-index-url",
      "https://download.pytorch.org/whl/cu130",
    ])
    // The wheel allows transformers>=5.5.3. 5.22 renamed PixtralRotaryEmbedding.
    run("uv", ["pip", "install", "--python", py, "transformers==5.5.3"])
  } else {
    run("uv", ["pip", "install", "--python", py, "vllm", "--torch-backend=auto"])
    run(vllmExe(platform), ["download-kernels"])
  }

  fs.writeFileSync(
    MARKER,
    JSON.stringify({ variant, uv: true, python: managed }, null, 2) + "\n"
  )
  console.log(`[install-vllm] Installed ${variant}.`)
}

if (require.main === module) {
  const platform = process.argv[2]
  if (platform !== "win32" && platform !== "linux") {
    console.error("usage: node install-vllm.js win32|linux")
    process.exit(2)
  }
  ensure(platform)
}

module.exports = {
  ensure,
  run: [
    {
      when: "{{gpu === 'nvidia' && platform === 'win32'}}",
      method: "shell.run",
      params: {
        message: "node install-vllm.js win32",
      },
    },
    {
      when: "{{gpu === 'nvidia' && platform === 'linux'}}",
      method: "shell.run",
      params: {
        message: "node install-vllm.js linux",
      },
    },
  ],
}
