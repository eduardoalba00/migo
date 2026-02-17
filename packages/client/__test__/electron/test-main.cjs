const { app, BrowserWindow } = require("electron");
const path = require("path");

const mode = process.argv.find((a) =>
  ["load-test", "colorbars", "enumerate", "ipc-capture"].includes(a)
) || "load-test";

function sendJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

app.whenReady().then(async () => {
  if (mode === "load-test") {
    const results = {
      success: false,
      windowCount: 0,
      displayCount: 0,
      packetCount: 0,
      firstKeyframe: false,
      errors: [],
    };

    try {
      const buttercap = require("buttercap");

      results.windowCount = buttercap.listWindows().length;
      results.displayCount = buttercap.listDisplays().length;

      const displays = buttercap.listDisplays();
      const primary = displays.find((d) => d.primary) || displays[0];

      const session = buttercap.createSession({
        target: { type: "display", id: primary.id },
        video: { fps: 30, codec: "h264", bitrate: 4_000_000 },
        cursor: true,
      });

      const packets = [];
      session.on("video-packet", (p) => packets.push(p));
      session.on("error", (e) => results.errors.push(e.message));

      session.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      session.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));

      results.packetCount = packets.length;
      results.firstKeyframe = packets.some((p) => p.keyframe);
      results.success = true;
    } catch (err) {
      results.errors.push(err.message);
    }

    sendJson(results);
    app.quit();
  } else if (mode === "colorbars") {
    const win = new BrowserWindow({
      width: 3440,
      height: 1392,
      title: "migo-test-colorbars",
      show: true,
      frame: false,
      useContentSize: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.on("page-title-updated", (e) => e.preventDefault());
    await win.loadFile(path.join(__dirname, "colorbars.html"));
    sendJson({ ready: true, pid: process.pid });
  } else if (mode === "enumerate") {
    // Return windows and displays for the vitest process
    try {
      const buttercap = require("buttercap");
      sendJson({
        windows: buttercap.listWindows(),
        displays: buttercap.listDisplays(),
      });
    } catch (err) {
      sendJson({ error: err.message, windows: [], displays: [] });
    }
    app.quit();
  } else if (mode === "ipc-capture") {
    // Reads target config from env vars
    // Supports TEST_TARGET_TITLE to find a window by title (instead of a hardcoded ID)
    const buttercap = require("buttercap");

    let targetType = process.env.TEST_TARGET_TYPE || "display";
    let targetId = parseInt(process.env.TEST_TARGET_ID || "0", 10);
    const targetTitle = process.env.TEST_TARGET_TITLE;
    const audioPid = process.env.TEST_AUDIO_PID
      ? parseInt(process.env.TEST_AUDIO_PID, 10)
      : undefined;
    const duration = parseInt(process.env.TEST_DURATION_MS || "5000", 10);

    // If a title is provided, find the window by title
    if (targetTitle) {
      const windows = buttercap.listWindows();
      const match = windows.find((w) => w.title === targetTitle);
      if (match) {
        targetType = "window";
        targetId = match.hwnd;
      } else {
        sendJson({ error: `Window not found: ${targetTitle}`, videoPackets: [], audioPackets: [], errors: [`Window not found: ${targetTitle}`] });
        app.quit();
        return;
      }
    } else if (targetId === 0 && targetType === "display") {
      // Default to primary display
      const displays = buttercap.listDisplays();
      const primary = displays.find((d) => d.primary) || displays[0];
      if (primary) targetId = primary.id;
    }

    const results = {
      videoPackets: [],
      audioPackets: [],
      errors: [],
      stopped: false,
    };

    try {
      const audioMode = targetType === "window" ? "process" : "system";

      const session = buttercap.createSession({
        target: { type: targetType, id: targetId },
        video: { fps: 60, codec: "h264", bitrate: 8_000_000, preferHardware: true },
        cursor: true,
        audio: { mode: audioMode, processId: audioPid },
      });

      session.on("video-packet", (packet) => {
        results.videoPackets.push({
          size: packet.data.length,
          timestampUs: packet.timestampUs,
          keyframe: packet.keyframe,
          data:
            packet.keyframe && results.videoPackets.filter((p) => p.keyframe).length < 3
              ? Array.from(packet.data)
              : undefined,
        });
      });

      session.on("audio-packet", (packet) => {
        results.audioPackets.push({
          size: packet.data.length,
          timestampUs: packet.timestampUs,
          samples: packet.samples,
        });
      });

      session.on("error", (err) => {
        results.errors.push(err.message);
      });

      session.on("stopped", () => {
        results.stopped = true;
      });

      session.start();
      await new Promise((resolve) => setTimeout(resolve, duration));
      session.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      results.errors.push(err.message);
    }

    sendJson(results);
    app.quit();
  }
});
