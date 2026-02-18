{
  "targets": [
    {
      "target_name": "audio_capture",
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/native/audio-capture.cpp"],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "dependencies": [
            "<!(node -p \"require('node-addon-api').gyp\")"
          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS",
            "WINVER=0x0A00",
            "_WIN32_WINNT=0x0A00"
          ],
          "libraries": [
            "-lmmdevapi",
            "-lole32",
            "-luser32"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
