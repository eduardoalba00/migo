// WASAPI Process-Specific Audio Loopback Capture
// Uses Windows 10 2004+ ActivateAudioInterfaceAsync with
// AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS for per-process audio capture.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

#include <napi.h>

// ─── Completion handler with free-threaded marshaling ──────────────────────────

class ActivateHandler : public IActivateAudioInterfaceCompletionHandler {
public:
  ActivateHandler() : m_ref(1), m_hr(E_FAIL), m_ftm(nullptr) {
    m_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    // ActivateAudioInterfaceAsync requires the handler to support
    // free-threaded marshaling (IMarshal), otherwise it returns
    // E_ILLEGAL_METHOD_CALL (0x8000000E).
    CoCreateFreeThreadedMarshaler(
        static_cast<IUnknown *>(
            static_cast<IActivateAudioInterfaceCompletionHandler *>(this)),
        &m_ftm);
  }
  ~ActivateHandler() {
    if (m_event) CloseHandle(m_event);
    if (m_ftm) m_ftm->Release();
  }

  // IUnknown
  ULONG STDMETHODCALLTYPE AddRef() override {
    return InterlockedIncrement(&m_ref);
  }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG ref = InterlockedDecrement(&m_ref);
    if (ref == 0) delete this;
    return ref;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) override {
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
      AddRef();
      return S_OK;
    }
    if (m_ftm) {
      return m_ftm->QueryInterface(riid, ppv);
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }

  // IActivateAudioInterfaceCompletionHandler
  HRESULT STDMETHODCALLTYPE
  ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
    HRESULT hrActivate = E_FAIL;
    IUnknown *pUnk = nullptr;
    op->GetActivateResult(&hrActivate, &pUnk);
    if (SUCCEEDED(hrActivate) && pUnk) {
      pUnk->QueryInterface(__uuidof(IAudioClient), (void **)&m_client);
      pUnk->Release();
    }
    m_hr = hrActivate;
    SetEvent(m_event);
    return S_OK;
  }

  HRESULT Wait(DWORD ms = 5000) {
    WaitForSingleObject(m_event, ms);
    return m_hr;
  }
  IAudioClient *GetClient() { return m_client; }

private:
  LONG m_ref;
  HANDLE m_event;
  HRESULT m_hr;
  IAudioClient *m_client = nullptr;
  IUnknown *m_ftm;
};

// ─── Capture state ─────────────────────────────────────────────────────────────

static IAudioClient *g_client = nullptr;
static IAudioCaptureClient *g_captureClient = nullptr;
static std::thread g_captureThread;
static std::atomic<bool> g_running{false};
static Napi::ThreadSafeFunction *g_tsfn = nullptr;
static std::mutex g_mutex;
static std::string g_lastError;
static std::atomic<int> g_dataCount{0};

// Event handles for event-driven capture
static HANDLE g_bufferEvent = nullptr; // signaled when WASAPI buffer is ready
static HANDLE g_stopEvent = nullptr;   // signaled to stop capture loop
static bool g_eventDriven = false;     // true if event-driven mode is active

static void setError(const char *fmt, HRESULT hr) {
  char buf[256];
  snprintf(buf, sizeof(buf), fmt, hr);
  g_lastError = buf;
}

// ─── Drain all available packets from WASAPI buffer ────────────────────────────

static bool DrainPackets() {
  UINT32 packetLength = 0;
  HRESULT hr = g_captureClient->GetNextPacketSize(&packetLength);
  if (FAILED(hr)) return false;

  while (packetLength > 0) {
    BYTE *pData = nullptr;
    UINT32 numFrames = 0;
    DWORD flags = 0;

    hr = g_captureClient->GetBuffer(&pData, &numFrames, &flags, nullptr, nullptr);
    if (FAILED(hr)) return false;

    g_dataCount.fetch_add(1);

    if (g_tsfn) {
      size_t sampleCount = numFrames * 2;
      float *copy = new float[sampleCount];
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        memset(copy, 0, sampleCount * sizeof(float));
      } else {
        memcpy(copy, pData, sampleCount * sizeof(float));
      }

      // Pack sample count + data pointer for the JS callback
      struct CaptureData {
        float *samples;
        size_t count;
      };
      auto *cd = new CaptureData{copy, sampleCount};

      g_tsfn->NonBlockingCall(cd,
          [](Napi::Env env, Napi::Function jsCallback, CaptureData *data) {
            // Copy into a new JS-owned ArrayBuffer (no custom finalizer)
            auto ab = Napi::ArrayBuffer::New(env, data->count * sizeof(float));
            memcpy(ab.Data(), data->samples, data->count * sizeof(float));
            auto f32 = Napi::Float32Array::New(env, data->count, ab, 0);
            delete[] data->samples;
            delete data;
            jsCallback.Call({f32});
          });
    }

    g_captureClient->ReleaseBuffer(numFrames);
    hr = g_captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) return false;
  }

  return true;
}

// ─── Capture loop: event-driven with polling fallback ──────────────────────────

static void CaptureLoop() {
  if (g_eventDriven) {
    // Event-driven mode: wait for WASAPI buffer event or stop event.
    // Processes packets immediately when they arrive — no polling delay.
    HANDLE handles[] = {g_bufferEvent, g_stopEvent};
    while (true) {
      DWORD result = WaitForMultipleObjects(2, handles, FALSE, 200);
      if (result == WAIT_OBJECT_0 + 1) break; // stop event signaled
      if (result == WAIT_FAILED) break;
      // WAIT_OBJECT_0 (buffer ready) or WAIT_TIMEOUT — drain packets either way
      if (!DrainPackets()) break;
    }
  } else {
    // Polling fallback: Sleep(1) between polls.
    // Used when event-driven mode is not supported by the audio driver.
    while (g_running.load()) {
      if (!DrainPackets()) break;
      Sleep(1);
    }
  }
}

// ─── N-API exports ─────────────────────────────────────────────────────────────

// startCapture runs activation + init synchronously on the JS thread,
// then spawns a capture loop thread.
static Napi::Value StartCapture(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_mutex);

  if (g_running.load()) {
    Napi::Error::New(env, "Capture already running").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  DWORD pid = info[0].As<Napi::Number>().Uint32Value();
  bool excludeMode = info[1].As<Napi::Boolean>().Value();

  g_lastError.clear();
  g_dataCount.store(0);
  g_eventDriven = false;

  // Ensure COM is initialized on this thread (Node/Electron may already have it)
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  // ── Activate audio interface ──
  AUDIOCLIENT_ACTIVATION_PARAMS acParams = {};
  acParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  acParams.ProcessLoopbackParams.TargetProcessId = pid;
  acParams.ProcessLoopbackParams.ProcessLoopbackMode =
      excludeMode ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                   : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activateParams = {};
  activateParams.vt = VT_BLOB;
  activateParams.blob.cbSize = sizeof(acParams);
  activateParams.blob.pBlobData = reinterpret_cast<BYTE *>(&acParams);

  auto handler = new ActivateHandler();
  IActivateAudioInterfaceAsyncOperation *asyncOp = nullptr;

  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
      &activateParams, handler, &asyncOp);

  if (FAILED(hr)) {
    char msg[128];
    snprintf(msg, sizeof(msg), "ActivateAudioInterfaceAsync: 0x%08lX", hr);
    g_lastError = msg;
    handler->Release();
    if (asyncOp) asyncOp->Release();
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  hr = handler->Wait(5000);
  if (FAILED(hr) || !handler->GetClient()) {
    char msg[128];
    snprintf(msg, sizeof(msg), "ActivateCompleted: 0x%08lX", hr);
    g_lastError = msg;
    handler->Release();
    if (asyncOp) asyncOp->Release();
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_client = handler->GetClient();
  handler->Release();
  if (asyncOp) asyncOp->Release();

  // ── Initialize audio client: 48kHz stereo float32 ──
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = 48000;
  fmt.wBitsPerSample = 32;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  REFERENCE_TIME bufferDuration = 200000; // 20ms

  // ── Create event handles ──
  g_bufferEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr); // auto-reset
  g_stopEvent = CreateEvent(nullptr, TRUE, FALSE, nullptr);    // manual-reset

  // ── Try event-driven mode first ──
  hr = g_client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                            AUDCLNT_STREAMFLAGS_LOOPBACK |
                                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                            bufferDuration, 0, &fmt, nullptr);

  if (SUCCEEDED(hr)) {
    hr = g_client->SetEventHandle(g_bufferEvent);
    if (SUCCEEDED(hr)) {
      g_eventDriven = true;
    } else {
      // SetEventHandle failed — re-initialize without event callback
      g_client->Release();
      g_client = nullptr;

      // Re-activate the audio interface (can't reuse a failed IAudioClient)
      auto handler2 = new ActivateHandler();
      IActivateAudioInterfaceAsyncOperation *asyncOp2 = nullptr;
      hr = ActivateAudioInterfaceAsync(
          VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
          &activateParams, handler2, &asyncOp2);
      if (SUCCEEDED(hr)) {
        hr = handler2->Wait(5000);
        if (SUCCEEDED(hr) && handler2->GetClient()) {
          g_client = handler2->GetClient();
        }
      }
      handler2->Release();
      if (asyncOp2) asyncOp2->Release();

      if (!g_client) {
        setError("Re-activation after event mode fallback failed: 0x%08lX", hr);
        CloseHandle(g_bufferEvent);
        CloseHandle(g_stopEvent);
        g_bufferEvent = nullptr;
        g_stopEvent = nullptr;
        Napi::Error::New(env, g_lastError).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      hr = g_client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDuration, 0,
                                &fmt, nullptr);
    }
  } else {
    // Event-driven init failed — fall back to polling mode
    g_client->Release();
    g_client = nullptr;

    // Re-activate (can't reuse a failed IAudioClient)
    auto handler2 = new ActivateHandler();
    IActivateAudioInterfaceAsyncOperation *asyncOp2 = nullptr;
    hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
        &activateParams, handler2, &asyncOp2);
    if (SUCCEEDED(hr)) {
      hr = handler2->Wait(5000);
      if (SUCCEEDED(hr) && handler2->GetClient()) {
        g_client = handler2->GetClient();
      }
    }
    handler2->Release();
    if (asyncOp2) asyncOp2->Release();

    if (!g_client) {
      setError("Re-activation failed: 0x%08lX", hr);
      CloseHandle(g_bufferEvent);
      CloseHandle(g_stopEvent);
      g_bufferEvent = nullptr;
      g_stopEvent = nullptr;
      Napi::Error::New(env, g_lastError).ThrowAsJavaScriptException();
      return env.Undefined();
    }

    hr = g_client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                              AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDuration, 0,
                              &fmt, nullptr);
  }

  if (FAILED(hr)) {
    char msg[128];
    snprintf(msg, sizeof(msg), "IAudioClient::Initialize: 0x%08lX", hr);
    g_lastError = msg;
    g_client->Release();
    g_client = nullptr;
    CloseHandle(g_bufferEvent);
    CloseHandle(g_stopEvent);
    g_bufferEvent = nullptr;
    g_stopEvent = nullptr;
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  hr = g_client->GetService(__uuidof(IAudioCaptureClient),
                            (void **)&g_captureClient);
  if (FAILED(hr)) {
    char msg[128];
    snprintf(msg, sizeof(msg), "GetService: 0x%08lX", hr);
    g_lastError = msg;
    g_client->Release();
    g_client = nullptr;
    CloseHandle(g_bufferEvent);
    CloseHandle(g_stopEvent);
    g_bufferEvent = nullptr;
    g_stopEvent = nullptr;
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  hr = g_client->Start();
  if (FAILED(hr)) {
    char msg[128];
    snprintf(msg, sizeof(msg), "IAudioClient::Start: 0x%08lX", hr);
    g_lastError = msg;
    g_captureClient->Release();
    g_captureClient = nullptr;
    g_client->Release();
    g_client = nullptr;
    CloseHandle(g_bufferEvent);
    CloseHandle(g_stopEvent);
    g_bufferEvent = nullptr;
    g_stopEvent = nullptr;
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // ── Start capture loop on background thread ──
  g_running.store(true);
  g_captureThread = std::thread(CaptureLoop);

  return env.Undefined();
}

static Napi::Value StopCapture(const Napi::CallbackInfo &info) {
  std::lock_guard<std::mutex> lock(g_mutex);

  g_running.store(false);

  // Signal the stop event so the capture loop exits WaitForMultipleObjects
  if (g_stopEvent) {
    SetEvent(g_stopEvent);
  }

  if (g_captureThread.joinable()) {
    g_captureThread.join();
  }

  if (g_tsfn) {
    g_tsfn->Release();
    delete g_tsfn;
    g_tsfn = nullptr;
  }

  if (g_captureClient) {
    g_captureClient->Release();
    g_captureClient = nullptr;
  }
  if (g_client) {
    g_client->Stop();
    g_client->Release();
    g_client = nullptr;
  }

  // Clean up event handles
  if (g_bufferEvent) {
    CloseHandle(g_bufferEvent);
    g_bufferEvent = nullptr;
  }
  if (g_stopEvent) {
    CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;
  }

  g_eventDriven = false;

  return info.Env().Undefined();
}

static Napi::Value OnData(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Function cb = info[0].As<Napi::Function>();

  if (g_tsfn) {
    g_tsfn->Release();
    delete g_tsfn;
  }

  g_tsfn = new Napi::ThreadSafeFunction(
      Napi::ThreadSafeFunction::New(env, cb, "AudioCaptureData", 0, 1));

  return env.Undefined();
}

static Napi::Value HwndToPid(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  HWND hwnd = reinterpret_cast<HWND>(
      static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value()));
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return Napi::Number::New(env, static_cast<double>(pid));
}

static Napi::Value GetError(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), g_lastError);
}

static Napi::Value GetDataCount(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(), static_cast<double>(g_dataCount.load()));
}

static Napi::Value IsRunning(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), g_running.load());
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("startCapture", Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
  exports.Set("onData", Napi::Function::New(env, OnData));
  exports.Set("hwndToPid", Napi::Function::New(env, HwndToPid));
  exports.Set("getLastError", Napi::Function::New(env, GetError));
  exports.Set("getDataCount", Napi::Function::New(env, GetDataCount));
  exports.Set("isRunning", Napi::Function::New(env, IsRunning));
  return exports;
}

NODE_API_MODULE(audio_capture, Init)
