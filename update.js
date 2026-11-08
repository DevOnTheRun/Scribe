module.exports = {
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
  ]
}
