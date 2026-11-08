module.exports = {
  run: [
    {
      method: "fs.link",
      params: {
        drive: {
          "lighton/lightonocr-2-1b": "app/models/lightonocr-2-1b",
          "lighton/lightonocr-2-1b-bbox": "app/models/lightonocr-2-1b-bbox",
          "lighton/lightonocr-2-1b-base": "app/models/lightonocr-2-1b-base",
          "lighton/lightonocr-2-1b-bbox-base": "app/models/lightonocr-2-1b-bbox-base",
          "lighton/lightonocr-2-1b-ocr-soup": "app/models/lightonocr-2-1b-ocr-soup",
          "lighton/lightonocr-2-1b-bbox-soup": "app/models/lightonocr-2-1b-bbox-soup",
          // Shared with any other Pinokio app that links the same key.
          "vllm/env-vllm": "env-vllm",
        }
      }
    }
  ]
}
