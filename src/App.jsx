import { useState, useEffect, useRef, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import SettingsPage from './SettingsPage';
import SetupGuidePage from './SetupGuidePage';
import { initDB, getSettings, saveSettings, lookupLocalCode } from './db';

const DUMMY_BASE = 'http://192.168.1.50';
const SUCCESS_DURATION = 2000;

const uid = () =>
  crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

// ── Camera helpers ─────────────────────────────────────────────────────────────

// After permission is granted, labels are populated — use them to find rear camera.
async function enumerateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  } catch {
    return [];
  }
}

async function getRearCameraConstraints() {
  const cameras = await enumerateCameras();
  if (!cameras.length) return { facingMode: { ideal: 'environment' } };

  // Match by label (reliable on Android after permission)
  const rear = cameras.find((d) => /back|rear|environment/i.test(d.label));
  if (rear?.deviceId) return { deviceId: { exact: rear.deviceId } };

  // Fallback: on Android the back camera is typically the last device in the list
  if (cameras.length > 1) return { deviceId: { exact: cameras[cameras.length - 1].deviceId } };

  return { facingMode: { ideal: 'environment' } };
}

function detectDevice() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const isAndroid = /Android/.test(ua);
  const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
  const isChrome = /CriOS/.test(ua) || (/Chrome/.test(ua) && !isIOS);
  return { isIOS, isAndroid, isSafari, isChrome };
}

function getDeniedInstructions() {
  const { isIOS, isAndroid, isSafari, isChrome } = detectDevice();
  if (isIOS && isSafari) return [
    'Open the iPhone/iPad Settings app',
    'Scroll down and tap Safari',
    'Tap Camera under "Settings for Websites"',
    'Select Allow',
    'Return here and reload the page',
  ];
  if (isIOS && isChrome) return [
    'Open the iPhone/iPad Settings app',
    'Scroll down and tap Chrome',
    'Tap Camera and set it to Allow',
    'Return here and reload the page',
  ];
  if (isIOS) return [
    'Open the iPhone/iPad Settings app',
    'Find your browser in the app list',
    'Tap Camera and set it to Allow',
    'Return here and reload the page',
  ];
  if (isAndroid && isChrome) return [
    'Tap the 🔒 lock icon in the address bar',
    'Tap Permissions → Camera',
    'Switch Camera to Allow',
    'Reload this page',
  ];
  if (isAndroid) return [
    'Open your device Settings → Apps',
    'Find your browser and tap Permissions',
    'Enable Camera',
    'Reload this page',
  ];
  return [
    'Click the camera or lock icon in the browser address bar',
    'Set Camera permission to Allow',
    'Reload this page',
  ];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function sendToESP32(localCode, shelfUrl) {
  const base = (shelfUrl?.trim() || DUMMY_BASE).replace(/\/+$/, '');
  const res = await fetch(`${base}/light`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shelf: Number(localCode), color: 'green' }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Device returned ${res.status}`);
}

// ── Audio feedback ─────────────────────────────────────────────────────────────
function playSuccessSound() {
  try {
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;
    [[880, t, t + 0.09], [1320, t + 0.11, t + 0.22]].forEach(([freq, start, end]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.28, start);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.start(start);
      osc.stop(end);
    });
    setTimeout(() => ctx.close(), 400);
  } catch {
    // audio not available — ignore silently
  }
}

// ── Spinner ────────────────────────────────────────────────────────────────────
const Spinner = ({ color = '#fff' }) => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="16" stroke={color + '33'} strokeWidth="4"/>
    <path d="M20 4a16 16 0 0 1 16 16" stroke={color} strokeWidth="4" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate"
        from="0 20 20" to="360 20 20" dur="0.8s" repeatCount="indefinite"/>
    </path>
  </svg>
);

// ── Camera Gate ────────────────────────────────────────────────────────────────
const CameraGate = ({ onGranted }) => {
  const [perm, setPerm] = useState('checking');

  useEffect(() => {
    if (perm !== 'checking') return;
    if (!navigator.permissions) {
      Promise.resolve().then(() => setPerm('prompt'));
      return;
    }
    navigator.permissions.query({ name: 'camera' })
      .then(async (result) => {
        if (result.state === 'granted') {
          const constraints = await getRearCameraConstraints();
          onGranted(constraints);
        } else {
          setPerm(result.state);
        }
        result.onchange = async () => {
          if (result.state === 'granted') {
            const constraints = await getRearCameraConstraints();
            onGranted(constraints);
          } else {
            setPerm(result.state);
          }
        };
      })
      .catch(() => setPerm('prompt'));
  }, [perm, onGranted]);

  const requestAccess = async () => {
    setPerm('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPerm('denied');
        return;
      }
      // Acquire stream to trigger permission dialog
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      stream.getTracks().forEach((t) => t.stop());

      // Now labels are available — enumerate to find the real rear camera
      const constraints = await getRearCameraConstraints();
      onGranted(constraints);
    } catch (err) {
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setPerm('no-camera');
      } else {
        setPerm('denied');
      }
    }
  };

  if (perm === 'checking' || perm === 'requesting') {
    return (
      <div style={p.screen}>
        <Spinner color="var(--primary)" />
        {perm === 'requesting' && <span style={p.checkingText}>Accessing camera…</span>}
      </div>
    );
  }

  if (perm === 'prompt') {
    return (
      <div style={p.screen}>
        <div style={p.card}>
          <div style={{ ...p.iconCircle, background: '#e8f0fe', color: 'var(--primary)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <h2 style={p.title}>Camera Access Required</h2>
          <p style={p.body}>
            Smart Shelf uses your camera to scan QR codes and barcodes.
            <strong> Camera access is mandatory</strong> — the app cannot function without it.
          </p>
          <p style={p.body}>
            Tap the button below and select <strong>Allow</strong> when your browser asks for permission.
          </p>
          <button style={p.primaryBtn} onClick={requestAccess}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Allow Camera Access
          </button>
        </div>
      </div>
    );
  }

  if (perm === 'no-camera') {
    return (
      <div style={p.screen}>
        <div style={p.card}>
          <div style={{ ...p.iconCircle, background: 'var(--error-bg)', color: 'var(--error-text)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </div>
          <h2 style={p.title}>No Camera Found</h2>
          <p style={p.body}>No camera was detected on this device. Smart Shelf requires a working camera to scan codes.</p>
        </div>
      </div>
    );
  }

  // denied
  const steps = getDeniedInstructions();
  return (
    <div style={p.screen}>
      <div style={p.card}>
        <div style={{ ...p.iconCircle, background: 'var(--error-bg)', color: 'var(--error-text)' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </div>
        <h2 style={p.title}>Camera Access Blocked</h2>
        <p style={p.body}>
          You've blocked camera access for this site.
          <strong> Camera access is mandatory</strong> — follow the steps below then reload.
        </p>
        <div style={p.stepsList}>
          {steps.map((step, i) => (
            <div key={i} style={p.stepRow}>
              <span style={p.stepNum}>{i + 1}</span>
              <span style={p.stepText}>{step}</span>
            </div>
          ))}
        </div>
        <button style={p.primaryBtn} onClick={() => window.location.reload()}>Reload Page</button>
        <button style={p.secondaryBtn} onClick={() => setPerm('prompt')}>Try Again</button>
      </div>
    </div>
  );
};

// ── Scanner screen ─────────────────────────────────────────────────────────────
const ScannerScreen = ({ onOpenSettings, dbReady, initialConstraints }) => {
  const [scanState, setScanState] = useState('idle');
  const [sentCode, setSentCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(100);
  const [pendingCode, setPendingCode] = useState('');
  const [localCodeInput, setLocalCodeInput] = useState('');
  const [addError, setAddError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [camIndex, setCamIndex] = useState(0);
  const [constraints, setConstraints] = useState(initialConstraints);
  const timerRef = useRef(null);
  const settingsRef = useRef({ shelfUrl: '', useMappings: false });

  // Enumerate all cameras for the flip button
  useEffect(() => {
    enumerateCameras().then((list) => {
      if (!list.length) return;
      setCameras(list);
      // Sync camIndex with whichever camera initialConstraints selected
      if (initialConstraints?.deviceId?.exact) {
        const idx = list.findIndex((c) => c.deviceId === initialConstraints.deviceId.exact);
        setCamIndex(idx >= 0 ? idx : 0);
      } else {
        // If no deviceId, find the rear camera index as default
        const rearIdx = list.findIndex((d) => /back|rear|environment/i.test(d.label));
        setCamIndex(rearIdx >= 0 ? rearIdx : list.length - 1);
      }
    });
  }, [initialConstraints]);

  const flipCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const next = (camIndex + 1) % cameras.length;
    setCamIndex(next);
    setConstraints({ deviceId: { exact: cameras[next].deviceId } });
  }, [cameras, camIndex]);

  const reset = useCallback(() => {
    cancelAnimationFrame(timerRef.current);
    setScanState('idle');
    setSentCode('');
    setErrorMsg('');
    setProgress(100);
    setPendingCode('');
    setLocalCodeInput('');
    setAddError('');
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    const loaded = getSettings();
    settingsRef.current = { shelfUrl: loaded.shelfUrl, useMappings: loaded.useMappings };
  }, [dbReady]);

  useEffect(() => {
    if (scanState === 'success') playSuccessSound();
  }, [scanState]);

  useEffect(() => {
    if (scanState !== 'success') return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / SUCCESS_DURATION) * 100);
      setProgress(pct);
      if (elapsed >= SUCCESS_DURATION) reset();
      else timerRef.current = requestAnimationFrame(tick);
    };
    timerRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(timerRef.current);
  }, [scanState, reset]);

  const handleScan = async (result) => {
    if (scanState !== 'idle') return;
    const rawValue = result?.[0]?.rawValue;
    if (!rawValue) return;

    setScanState('processing');
    try {
      let localCode = rawValue;
      const { shelfUrl, useMappings } = settingsRef.current;

      if (useMappings) {
        const mapped = lookupLocalCode(rawValue);
        if (!mapped) {
          setPendingCode(rawValue);
          setScanState('add-mapping');
          return;
        }
        localCode = mapped;
      }

      await sendToESP32(localCode, shelfUrl);
      setSentCode(localCode);
      setScanState('success');
    } catch (err) {
      const msg = err?.name === 'TimeoutError'
        ? 'Request timed out. Check the shelf URL and network.'
        : `Failed to send to ESP32: ${err.message}`;
      setErrorMsg(msg);
      setScanState('error');
    }
  };

  const handleAddAndSend = async () => {
    const localCode = localCodeInput.trim();
    if (!localCode) {
      setAddError('Local code is required.');
      return;
    }
    setAddError('');
    setScanState('processing');
    try {
      const current = getSettings();
      const newMapping = { id: uid(), localCode, thirdPartyCode: pendingCode };
      await saveSettings({ ...current, mappings: [...current.mappings, newMapping] });
      await sendToESP32(localCode, settingsRef.current.shelfUrl);
      setSentCode(localCode);
      setScanState('success');
    } catch (err) {
      const msg = err?.name === 'TimeoutError'
        ? 'Request timed out. Check the shelf URL and network.'
        : `Failed to send to ESP32: ${err.message}`;
      setErrorMsg(msg);
      setScanState('error');
    }
  };

  const handleCameraError = (err) => {
    console.error('Camera error:', err);
    setErrorMsg('Camera error: ' + (err?.message || 'Unknown error'));
    setScanState('error');
  };

  return (
    <div style={s.screen}>
      <div style={s.appBar}>
        <span style={s.appTitle}>Smart Shelf</span>
        <div style={s.appBarRight}>
          {cameras.length > 1 && scanState === 'idle' && (
            <button style={s.iconBtn} onClick={flipCamera} aria-label="Switch camera">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <polyline points="16 3 21 3 21 8"/><line x1="15" y1="9" x2="21" y2="3"/>
              </svg>
            </button>
          )}
          <button style={s.iconBtn} onClick={onOpenSettings} aria-label="Settings">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      <div style={s.scannerArea}>
        {scanState === 'idle' && (
          <Scanner
            onScan={handleScan}
            onError={handleCameraError}
            constraints={constraints}
            allowMultiple={false}
            scanDelay={500}
            styles={{ container: { width: '100%', height: '100%' } }}
          />
        )}

        {scanState === 'processing' && (
          <div style={s.overlay}>
            <div style={s.processingCard}>
              <Spinner />
              <p style={s.processingText}>Sending to ESP32…</p>
            </div>
          </div>
        )}

        {scanState === 'success' && (
          <div style={s.successOverlay}>
            <div style={s.successCheckWrap}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p style={s.successLabel}>Local Shelf Code</p>
            <p style={s.successCode}>{sentCode}</p>
            <p style={s.successSub}>Sent to ESP32</p>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressBar, width: `${progress}%` }} />
            </div>
          </div>
        )}

        {scanState === 'add-mapping' && (
          <div style={s.overlay}>
            <div style={s.resultCard}>
              <div style={{ ...s.iconCircle, background: '#fff8e1', color: '#f59e0b' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <p style={s.cardTitle}>Unknown Code</p>
              <p style={s.cardLabel}>Scanned</p>
              <p style={s.cardValue}>{pendingCode}</p>
              <p style={s.cardHint}>Not in mapping list. Enter the local shelf code to save and send.</p>
              <div style={{ width: '100%' }}>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  placeholder="Local shelf code"
                  value={localCodeInput}
                  onChange={(e) => { setLocalCodeInput(e.target.value); setAddError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddAndSend(); }}
                  style={{ ...s.addInput, ...(addError ? s.addInputError : {}) }}
                  autoFocus
                />
                {addError && <p style={s.addFieldError}>{addError}</p>}
              </div>
              <div style={s.addBtnRow}>
                <button style={s.addSecondaryBtn} onClick={reset}>Cancel</button>
                <button style={s.addPrimaryBtn} onClick={handleAddAndSend}>Add &amp; Send</button>
              </div>
            </div>
          </div>
        )}

        {scanState === 'error' && (
          <div style={s.overlay}>
            <div style={s.resultCard}>
              <div style={{ ...s.iconCircle, background: 'var(--error-bg)', color: 'var(--error-text)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </div>
              <p style={s.cardTitle}>Send Failed</p>
              <p style={s.errorDetail}>{errorMsg}</p>
              <button style={s.retryBtn} onClick={reset}>Try Again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Root ───────────────────────────────────────────────────────────────────────
const App = () => {
  const [view, setView] = useState('scanner');
  const [cameraConstraints, setCameraConstraints] = useState(null);
  const [dbReady, setDbReady] = useState(false);

  const handleCameraGranted = useCallback((constraints) => {
    setCameraConstraints(constraints);
  }, []);

  useEffect(() => {
    initDB().then(() => setDbReady(true)).catch(console.error);
  }, []);

  if (view === 'settings') {
    return (
      <SettingsPage
        onBack={() => setView('scanner')}
        onOpenSetupGuide={() => setView('setup')}
      />
    );
  }

  if (view === 'setup') {
    return <SetupGuidePage onBack={() => setView('settings')} />;
  }

  if (!cameraConstraints) {
    return <CameraGate onGranted={handleCameraGranted} />;
  }

  return (
    <ScannerScreen
      onOpenSettings={() => setView('settings')}
      dbReady={dbReady}
      initialConstraints={cameraConstraints}
    />
  );
};

// ── Scanner styles ─────────────────────────────────────────────────────────────
const s = {
  screen: { display: 'flex', flexDirection: 'column', height: '100%', background: '#000' },
  appBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'calc(var(--top-safe) + 8px) 8px 8px',
    background: 'var(--primary)',
    color: '#fff',
    flexShrink: 0,
    minHeight: 'var(--app-bar-height)',
    zIndex: 10,
  },
  appTitle: { fontSize: '18px', fontWeight: '600', letterSpacing: '0.3px', paddingLeft: '8px' },
  appBarRight: { display: 'flex', alignItems: 'center', gap: '2px' },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#fff',
    padding: '8px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '44px',
    minHeight: '44px',
    WebkitTapHighlightColor: 'rgba(255,255,255,0.2)',
  },
  scannerArea: { flex: 1, position: 'relative', overflow: 'hidden', background: '#000' },
  overlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px', zIndex: 5,
  },
  processingCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' },
  processingText: { margin: 0, color: '#fff', fontSize: '16px', fontWeight: '500' },
  successOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.92)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    gap: '12px',
    zIndex: 5,
  },
  successCheckWrap: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: 'var(--success-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
  },
  successLabel: {
    margin: 0,
    fontSize: '12px',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '1.2px',
  },
  successCode: {
    margin: 0,
    fontSize: '52px',
    fontWeight: '800',
    color: '#fff',
    letterSpacing: '-1px',
    wordBreak: 'break-all',
    textAlign: 'center',
    lineHeight: 1.1,
  },
  successSub: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--success-text)',
    fontWeight: '600',
  },
  resultCard: {
    background: 'var(--surface)',
    borderRadius: '20px',
    padding: '28px 24px 24px',
    width: '100%', maxWidth: '340px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
  },
  iconCircle: {
    width: '60px', height: '60px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px',
  },
  cardTitle: { margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text)' },
  cardLabel: { margin: 0, fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px' },
  cardValue: { margin: 0, fontSize: '22px', fontWeight: '700', color: 'var(--text)', wordBreak: 'break-all', textAlign: 'center' },
  progressTrack: { width: '100%', height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', overflow: 'hidden', marginTop: '4px', maxWidth: '200px' },
  progressBar: { height: '100%', background: 'var(--success-text)', borderRadius: '3px', transition: 'width 0.05s linear' },
  cardHint: { margin: 0, fontSize: '13px', color: 'var(--text-secondary)' },
  errorDetail: { margin: 0, fontSize: '14px', color: 'var(--error-text)', textAlign: 'center', lineHeight: '1.5', wordBreak: 'break-word' },
  retryBtn: {
    marginTop: '8px', width: '100%', padding: '14px',
    background: 'var(--primary)', color: '#fff', border: 'none',
    borderRadius: '12px', fontSize: '16px', fontWeight: '600', minHeight: '48px',
  },
  addInput: {
    width: '100%', padding: '12px 14px', fontSize: '16px', fontWeight: '600',
    border: '1.5px solid var(--border)', borderRadius: '10px',
    background: 'var(--surface-2)', color: 'var(--text)', outline: 'none',
    marginTop: '4px', boxSizing: 'border-box',
  },
  addInputError: { borderColor: 'var(--error-text)' },
  addFieldError: { margin: '4px 0 0', fontSize: '12px', color: 'var(--error-text)' },
  addBtnRow: { display: 'flex', gap: '10px', width: '100%', marginTop: '4px' },
  addSecondaryBtn: {
    flex: 1, padding: '13px', background: 'transparent',
    color: 'var(--text-secondary)', border: '1.5px solid var(--border)',
    borderRadius: '12px', fontSize: '15px', fontWeight: '600', minHeight: '48px',
  },
  addPrimaryBtn: {
    flex: 2, padding: '13px', background: 'var(--primary)', color: '#fff',
    border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '600', minHeight: '48px',
  },
};

// ── Camera gate styles ─────────────────────────────────────────────────────────
const p = {
  screen: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', padding: '24px', gap: '16px' },
  checkingText: { fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' },
  card: { background: 'var(--surface)', borderRadius: '20px', padding: '32px 24px 28px', width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  iconCircle: { width: '72px', height: '72px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px' },
  title: { margin: 0, fontSize: '20px', fontWeight: '700', color: 'var(--text)', textAlign: 'center' },
  body: { margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: '1.6' },
  stepsList: { width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--surface-2)', borderRadius: '12px', padding: '16px', marginTop: '4px' },
  stepRow: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  stepNum: { flexShrink: 0, width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', color: '#fff', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: '13px', color: 'var(--text)', lineHeight: '1.5', paddingTop: '2px' },
  primaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '16px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', minHeight: '52px', marginTop: '4px' },
  secondaryBtn: { width: '100%', padding: '14px', background: 'transparent', color: 'var(--primary)', border: '1.5px solid var(--primary)', borderRadius: '12px', fontSize: '15px', fontWeight: '600', minHeight: '48px' },
};

export default App;
