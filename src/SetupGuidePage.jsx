// Device provisioning guide — written for factory workers with no technical background.

const Step = ({ number, icon, title, children }) => (
  <div style={g.step}>
    <div style={g.stepLeft}>
      <div style={g.stepBadge}>{number}</div>
      <div style={g.stepLine} />
    </div>
    <div style={g.stepBody}>
      <div style={g.stepIconWrap}>{icon}</div>
      <p style={g.stepTitle}>{title}</p>
      <div style={g.stepDesc}>{children}</div>
    </div>
  </div>
);

const PowerIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="12"/>
    <path d="M6.8 5.8A8 8 0 1 0 17.2 5.8"/>
  </svg>
);

const WifiIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M10.54 16.1a6 6 0 0 1 2.92 0"/>
    <line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);

const BrowserIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const FormIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const SendIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const SetupGuidePage = ({ onBack }) => (
  <div style={g.screen}>

    {/* App bar */}
    <div style={g.appBar}>
      <button style={g.backBtn} onClick={onBack} aria-label="Back">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <span style={g.appTitle}>Device Setup Guide</span>
      <div style={{ width: '44px' }} />
    </div>

    {/* Body */}
    <div style={g.body}>

      {/* Intro */}
      <div style={g.intro}>
        <p style={g.introTitle}>Setting up a new SmartShelf device</p>
        <p style={g.introSub}>Follow these steps in order. It takes about 2 minutes.</p>
      </div>

      {/* What you need */}
      <div style={g.needsCard}>
        <p style={g.needsTitle}>Before you start, have these ready:</p>
        <div style={g.needsItem}><span style={g.bullet}>•</span><span>The SmartShelf device (green circuit board)</span></div>
        <div style={g.needsItem}><span style={g.bullet}>•</span><span>A phone, tablet, or laptop</span></div>
        <div style={g.needsItem}><span style={g.bullet}>•</span><span>The <strong>WiFi name</strong> and <strong>password</strong> for this location</span></div>
        <div style={g.needsItem}><span style={g.bullet}>•</span><span>A <strong>unique name</strong> for this device (e.g. <code style={g.code}>shelf-01</code>, <code style={g.code}>shelf-02</code>) — ask your supervisor if unsure</span></div>
      </div>

      {/* Steps */}
      <div style={g.steps}>

        <Step number="1" icon={<PowerIcon />} title="Plug in the device">
          Connect the SmartShelf device to a USB power source or power bank.
          Wait about <strong>5 seconds</strong>.
          <br /><br />
          <span style={g.tip}>The LED on the device will blink <strong style={{ color: '#f97316' }}>orange</strong> — this means it's ready to be set up.</span>
        </Step>

        <Step number="2" icon={<WifiIcon />} title="Connect your phone to SmartShelf WiFi">
          Open <strong>WiFi Settings</strong> on your phone or tablet.
          <br /><br />
          Look for a network that starts with <strong>"SmartShelf-"</strong> followed by four letters or numbers, for example: <code style={g.code}>SmartShelf-A3F2</code>
          <br /><br />
          Tap it to connect. <strong>No password is needed.</strong>
        </Step>

        <Step number="3" icon={<BrowserIcon />} title="Open the setup page">
          After connecting, your phone may show a pop-up: <strong>"Sign in to network"</strong> or <strong>"Open login page"</strong> — tap it.
          <br /><br />
          If no pop-up appears, open your browser (Safari or Chrome) and in the address bar type exactly:
          <div style={g.urlBox}>192.168.4.1</div>
          then tap Go.
        </Step>

        <Step number="4" icon={<FormIcon />} title="Fill in the details">
          A setup form will appear. Fill in:
          <div style={g.fieldList}>
            <div style={g.fieldItem}>
              <span style={g.fieldLabel}>SSID</span>
              <span style={g.fieldDesc}>The WiFi name for this location</span>
            </div>
            <div style={g.fieldItem}>
              <span style={g.fieldLabel}>Password</span>
              <span style={g.fieldDesc}>The WiFi password for this location</span>
            </div>
            <div style={g.fieldItem}>
              <span style={g.fieldLabel}>Device ID</span>
              <span style={g.fieldDesc}>A unique name, e.g. <code style={g.code}>shelf-01</code></span>
            </div>
          </div>
          <span style={g.tip}>Leave all other fields as they are unless your supervisor has told you otherwise.</span>
        </Step>

        <Step number="5" icon={<SendIcon />} title='Tap "Save & Connect"'>
          Scroll to the bottom of the form and tap the blue <strong>"Save & Connect"</strong> button.
          <br /><br />
          The device will save the settings and <strong>restart automatically</strong>. This takes about 10 seconds.
        </Step>

        <Step number="6" icon={<CheckCircleIcon />} title="All done!">
          Once the device restarts, it joins the location WiFi. The orange blinking light will stop.
          <br /><br />
          You can now reconnect your phone to the normal WiFi and move on to the next device.
        </Step>

      </div>

      {/* LED indicator legend */}
      <div style={g.legendCard}>
        <p style={g.legendTitle}>LED indicator light</p>
        <div style={g.legendRow}>
          <span style={{ ...g.ledDot, background: '#f97316' }} />
          <span><strong>Blinking orange</strong> — Device is in setup mode, waiting to be configured</span>
        </div>
        <div style={g.legendRow}>
          <span style={{ ...g.ledDot, background: '#22c55e' }} />
          <span><strong>Solid green (brief flash)</strong> — LED test on startup; device is booting normally</span>
        </div>
        <div style={g.legendRow}>
          <span style={{ ...g.ledDot, background: '#374151' }} />
          <span><strong>No light</strong> — Device is working normally and connected to WiFi</span>
        </div>
      </div>

      {/* Reset section */}
      <div style={g.alertCard}>
        <div style={g.alertHeader}>
          <span style={g.alertIcon}><AlertIcon /></span>
          <span style={g.alertTitle}>Something went wrong?</span>
        </div>
        <p style={g.alertBody}>
          Hold the <strong>BOOT</strong> button on the device for <strong>5 seconds</strong>.
          The LED will flash red, then the device will restart in setup mode.
          Go back to <strong>Step 2</strong> and try again.
        </p>
        <div style={g.bootBtnDiagram}>
          <div style={g.boardRect}>
            <div style={g.bootBtnMarker}>BOOT</div>
          </div>
          <p style={g.diagramCaption}>The BOOT button is usually labelled "BOOT" or "IO0" on the board</p>
        </div>
      </div>

      <div style={{ height: 'calc(var(--bottom-safe) + 24px)' }} />
    </div>
  </div>
);

export default SetupGuidePage;

// ── Styles ─────────────────────────────────────────────────────────────────────
const g = {
  screen: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: 'var(--surface-2)',
  },
  appBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'calc(var(--top-safe) + 8px) 8px 8px',
    background: 'var(--primary)', color: '#fff',
    flexShrink: 0, minHeight: 'var(--app-bar-height)',
  },
  backBtn: {
    background: 'none', border: 'none', color: '#fff', padding: '8px',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '44px', minHeight: '44px', WebkitTapHighlightColor: 'rgba(255,255,255,0.2)',
    cursor: 'pointer',
  },
  appTitle: { fontSize: '18px', fontWeight: '600', letterSpacing: '0.3px' },

  body: {
    flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '16px',
  },

  intro: { marginBottom: '16px' },
  introTitle: {
    fontSize: '18px', fontWeight: '700', color: 'var(--text)',
    margin: '0 0 4px',
  },
  introSub: { fontSize: '14px', color: 'var(--text-secondary)', margin: 0 },

  needsCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '12px', padding: '16px', marginBottom: '24px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  },
  needsTitle: { fontSize: '14px', fontWeight: '700', color: 'var(--text)', margin: 0 },
  needsItem: {
    fontSize: '14px', color: 'var(--text-secondary)',
    display: 'flex', gap: '8px', alignItems: 'flex-start', lineHeight: '1.5',
  },
  bullet: { color: 'var(--primary)', fontWeight: '700', flexShrink: 0 },
  code: {
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: '4px', padding: '1px 5px', fontSize: '13px',
    fontFamily: 'monospace', color: 'var(--text)',
  },

  steps: { display: 'flex', flexDirection: 'column' },

  // Individual step
  step: { display: 'flex', gap: '12px', marginBottom: '8px' },
  stepLeft: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    flexShrink: 0, width: '32px',
  },
  stepBadge: {
    width: '32px', height: '32px', borderRadius: '50%',
    background: 'var(--primary)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '15px', fontWeight: '700', flexShrink: 0,
  },
  stepLine: {
    width: '2px', flex: 1, background: 'var(--border)',
    margin: '4px 0', minHeight: '24px',
  },
  stepBody: {
    flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '12px', padding: '14px 16px', marginBottom: '8px',
  },
  stepIconWrap: {
    color: 'var(--primary)', marginBottom: '8px',
    display: 'flex', alignItems: 'center',
  },
  stepTitle: {
    fontSize: '16px', fontWeight: '700', color: 'var(--text)',
    margin: '0 0 8px',
  },
  stepDesc: { fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6' },

  tip: {
    display: 'block', marginTop: '10px',
    background: 'var(--surface-2)', borderLeft: '3px solid var(--primary)',
    borderRadius: '0 6px 6px 0', padding: '8px 10px',
    fontSize: '13px', color: 'var(--text-secondary)',
  },

  urlBox: {
    background: 'var(--surface-2)', border: '1.5px solid var(--primary)',
    borderRadius: '8px', padding: '10px 14px', marginTop: '10px',
    fontFamily: 'monospace', fontSize: '18px', fontWeight: '700',
    color: 'var(--primary)', textAlign: 'center', letterSpacing: '1px',
  },

  fieldList: {
    display: 'flex', flexDirection: 'column', gap: '8px',
    margin: '10px 0', background: 'var(--surface-2)',
    borderRadius: '8px', padding: '10px',
  },
  fieldItem: { display: 'flex', flexDirection: 'column', gap: '2px' },
  fieldLabel: { fontSize: '13px', fontWeight: '700', color: 'var(--text)' },
  fieldDesc: { fontSize: '13px', color: 'var(--text-secondary)' },

  legendCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '12px', padding: '16px', marginTop: '8px', marginBottom: '12px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  },
  legendTitle: {
    fontSize: '14px', fontWeight: '700', color: 'var(--text)', margin: 0,
  },
  legendRow: {
    display: 'flex', gap: '10px', alignItems: 'flex-start',
    fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5',
  },
  ledDot: {
    width: '14px', height: '14px', borderRadius: '50%',
    flexShrink: 0, marginTop: '2px',
    boxShadow: '0 0 6px currentColor',
  },

  alertCard: {
    background: 'var(--surface)', border: '1.5px solid #f97316',
    borderRadius: '12px', padding: '16px', marginBottom: '8px',
  },
  alertHeader: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' },
  alertIcon: { color: '#f97316', display: 'flex', alignItems: 'center' },
  alertTitle: { fontSize: '15px', fontWeight: '700', color: 'var(--text)' },
  alertBody: {
    fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0,
  },

  bootBtnDiagram: { marginTop: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' },
  boardRect: {
    width: '140px', height: '60px', border: '2px solid var(--border)',
    borderRadius: '8px', background: 'var(--surface-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  bootBtnMarker: {
    background: '#f97316', color: '#fff',
    borderRadius: '4px', padding: '4px 8px',
    fontSize: '12px', fontWeight: '700', letterSpacing: '0.5px',
  },
  diagramCaption: {
    fontSize: '12px', color: 'var(--text-secondary)',
    textAlign: 'center', margin: 0,
  },
};
