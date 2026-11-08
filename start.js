module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        env: {
          SCRIBE_PROJECTS: "projects",
          HF_HOME: "./cache/HF_HOME",
        },
        message: "python app/backend/main.py --host 127.0.0.1 --port {{port}}",
        on: [
          {
            // Reference: G:\AI\Pinokio\prototype\system\examples\mochi\start.js (URL capture)
            // Capture group required so local.set uses input.event[1]
            event: "/(http:\\/\\/[0-9.:]+)/",
            done: true,
          },
        ],
      },
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}",
      },
    },
  ],
};
