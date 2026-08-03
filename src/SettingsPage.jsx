import { useState, useEffect, useRef } from 'react';
import { initDB, getSettings, saveSettings } from './db';

const uid = () =>
  crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

const newRow = () => ({ id: uid(), localCode: '', thirdPartyCode: '' });

// ── Mapping row ────────────────────────────────────────────────────────────────
const MappingRow = ({ row, index, onChange, onDelete, rowErrors = {} }) => (
  <div style={s.mappingRowWrap}>
    <div style={s.mappingRow}>
      <span style={s.rowIndex}>{index + 1}</span>
      <div style={s.mappingInputs}>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="3rd party code"
          value={row.thirdPartyCode}
          onChange={(e) => onChange(row.id, 'thirdPartyCode', e.target.value)}
          style={{ ...s.mappingInput, ...(rowErrors.thirdPartyCode ? s.inputError : {}) }}
          aria-label="3rd party shelf code"
        />
        <div style={s.arrowWrap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
            <polyline points="12 5 19 12 12 19"/>
          </svg>
        </div>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="Local code"
          value={row.localCode}
          onChange={(e) => onChange(row.id, 'localCode', e.target.value)}
          style={{ ...s.mappingInput, ...(rowErrors.localCode ? s.inputError : {}) }}
          aria-label="Local shelf code"
        />
      </div>
      <button style={s.deleteBtn} onClick={() => onDelete(row.id)} aria-label="Remove mapping">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
    {(rowErrors.thirdPartyCode || rowErrors.localCode) && (
      <div style={s.mappingRowErrors}>
        <span style={s.fieldError}>{rowErrors.thirdPartyCode || ' '}</span>
        <span style={s.fieldError}>{rowErrors.localCode || ' '}</span>
      </div>
    )}
  </div>
);

// ── Confirm dialog ─────────────────────────────────────────────────────────────
const ConfirmDialog = ({ onConfirm, onCancel }) => (
  <div style={s.overlay} role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <div style={s.dialog}>
      <div style={s.dialogIcon}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <p id="dlg-title" style={s.dialogTitle}>Save Settings?</p>
      <p style={s.dialogBody}>
        This will overwrite the existing settings in the local database. This action cannot be undone.
      </p>
      <div style={s.dialogActions}>
        <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
        <button style={s.confirmBtn} onClick={onConfirm}>Yes, Save</button>
      </div>
    </div>
  </div>
);

// ── Main page ──────────────────────────────────────────────────────────────────
// ledGlowTime and useMappings are kept for db compatibility but not shown in UI
const DEFAULT = { shelfUrl: '', ledGlowTime: 30, mappings: [] };

const SettingsPage = ({ onBack, onOpenSetupGuide }) => {
  const [settings, setSettings] = useState(DEFAULT);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);    // null | 'saving' | 'saved' | 'error'
  const [uploadState, setUploadState] = useState(null); // null | 'parsing' | {added,updated} | {error}
  const fileInputRef = useRef(null);

  const isDirty = ready && JSON.stringify(settings) !== savedSnapshot;

  useEffect(() => {
    initDB()
      .then(() => {
        const loaded = getSettings();
        const s = {
          shelfUrl:     loaded.shelfUrl,
          ledGlowTime:  loaded.ledGlowTime ?? 30,
          mappings:     loaded.mappings,
        };
        setSettings(s);
        setSavedSnapshot(JSON.stringify(s));
        setReady(true);
      })
      .catch((err) => {
        console.error('DB init failed:', err);
        setStatus('error');
        setReady(true);
      });
  }, []);

  // Auto-clear 'saved' status after 3 s
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (s) => {
    const e = {};
    if (!s.shelfUrl.trim()) e.shelfUrl = 'Device URL is required.';
    const mappingErrs = {};
    s.mappings.forEach((r) => {
      const re = {};
      if (!r.thirdPartyCode.trim()) re.thirdPartyCode = '3rd party code is required.';
      if (!r.localCode.trim())      re.localCode      = 'Local code is required.';
      if (Object.keys(re).length)   mappingErrs[r.id] = re;
    });
    if (Object.keys(mappingErrs).length) e.mappings = mappingErrs;
    return e;
  };

  // ── Field handlers ─────────────────────────────────────────────────────────
  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => { const e = { ...prev }; delete e[field]; return e; });
    setUploadState(null);
    setStatus(null);
  };

  const addMapping = () => {
    setSettings((prev) => ({ ...prev, mappings: [...prev.mappings, newRow()] }));
    setStatus(null);
  };

  const updateMapping = (id, field, value) => {
    setSettings((prev) => ({
      ...prev,
      mappings: prev.mappings.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    }));
    setErrors((prev) => {
      if (!prev.mappings?.[id]) return prev;
      const mappings = { ...prev.mappings };
      const rowErrs  = { ...mappings[id] };
      delete rowErrs[field];
      if (Object.keys(rowErrs).length) mappings[id] = rowErrs;
      else delete mappings[id];
      return { ...prev, mappings: Object.keys(mappings).length ? mappings : undefined };
    });
    setStatus(null);
  };

  const deleteMapping = (id) => {
    setSettings((prev) => ({ ...prev, mappings: prev.mappings.filter((r) => r.id !== id) }));
    setErrors((prev) => {
      if (!prev.mappings?.[id]) return prev;
      const mappings = { ...prev.mappings };
      delete mappings[id];
      return { ...prev, mappings: Object.keys(mappings).length ? mappings : undefined };
    });
    setStatus(null);
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploadState('parsing');
    try {
      const buffer = await file.arrayBuffer();
      // Lazy-load SheetJS so it stays out of the initial bundle
      const { read, utils } = await import('xlsx');
      const wb      = read(buffer);
      const ws      = wb.Sheets[wb.SheetNames[0]];
      const allRows = utils.sheet_to_json(ws, { header: 1 });

      // Row 1 is always treated as the header — data starts from row 2
      const dataRows = allRows
        .slice(1)
        .filter((r) => r.length >= 2)
        .map((r) => [String(r[0] ?? '').trim(), String(r[1] ?? '').trim()])
        .filter(([a, b]) => a && b);

      if (!dataRows.length) {
        setUploadState({ error: 'No data found. Check that the file has data from row 2 onward.' });
        return;
      }

      // Upsert into current mappings (read settings synchronously from closure)
      const byKey = new Map(settings.mappings.map((m) => [m.thirdPartyCode, { ...m }]));
      let added = 0, updated = 0;
      dataRows.forEach(([third, local]) => {
        if (byKey.has(third)) {
          byKey.get(third).localCode = local;
          updated++;
        } else {
          byKey.set(third, { id: uid(), thirdPartyCode: third, localCode: local });
          added++;
        }
      });

      setSettings((prev) => ({ ...prev, mappings: [...byKey.values()] }));
      setUploadState({ added, updated });
      setStatus(null);
    } catch (err) {
      console.error('File parse error:', err);
      setUploadState({ error: 'Could not read the file. Make sure it is a valid CSV or Excel file.' });
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const e = validate(settings);
    if (Object.keys(e).length) { setErrors(e); return; }
    setConfirming(true);
  };

  const confirmSave = async () => {
    setConfirming(false);
    setStatus('saving');
    try {
      await saveSettings({ ...settings, useMappings: true });
      setSavedSnapshot(JSON.stringify(settings));
      setStatus('saved');
    } catch (err) {
      console.error('Save failed:', err);
      setStatus('error');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.screen}>
      {confirming && (
        <ConfirmDialog onConfirm={confirmSave} onCancel={() => setConfirming(false)} />
      )}

      {/* App bar */}
      <div style={s.appBar}>
        <button style={s.backBtn} onClick={onBack} aria-label="Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span style={s.appTitle}>Settings</span>
        <div style={{ width: '44px' }} />
      </div>

      {/* Scrollable body */}
      <div style={s.body}>

        {/* ── Connection ── */}
        <div style={s.section}>
          <p style={s.sectionLabel}>Connection</p>
          <div style={s.fieldGroup}>
            <label style={s.label} htmlFor="shelfUrl">Device Base URL</label>
            <input
              id="shelfUrl"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              style={{ ...s.input, ...(errors.shelfUrl ? s.inputError : {}) }}
              placeholder="http://192.168.1.50"
              value={settings.shelfUrl}
              onChange={(e) => handleChange('shelfUrl', e.target.value)}
              disabled={!ready}
            />
            {errors.shelfUrl && <p style={s.fieldError}>{errors.shelfUrl}</p>}
            <p style={s.hint}>
              Base URL of the rack controller (e.g. http://192.168.1.50). The app posts to /light to activate a shelf LED.
            </p>
          </div>
        </div>

        {/* ── Shelf Code Mappings ── */}
        <div style={s.section}>
          <p style={s.sectionLabel}>Shelf Code Mappings</p>
          <div style={s.fieldGroup}>
            <p style={s.hint}>
              Scanned 3rd party codes are translated to local shelf codes before being sent to the device.
            </p>

            {settings.mappings.length > 0 && (
              <>
                <div style={s.mappingHeader}>
                  <span style={s.headerSpacer} />
                  <div style={s.headerLabels}>
                    <span style={s.headerLabel}>3rd party code</span>
                    <span style={s.headerLabel}>Local code</span>
                  </div>
                  <span style={s.headerSpacer} />
                </div>
                {settings.mappings.map((row, i) => (
                  <MappingRow
                    key={row.id}
                    row={row}
                    index={i}
                    onChange={updateMapping}
                    onDelete={deleteMapping}
                    rowErrors={errors.mappings?.[row.id]}
                  />
                ))}
              </>
            )}

            {settings.mappings.length === 0 && (
              <p style={{ ...s.hint, textAlign: 'center', padding: '8px 0' }}>
                No mappings yet. Add one manually or upload a file below.
              </p>
            )}

            {/* Action buttons */}
            <div style={s.mappingActions}>
              <button style={s.addBtn} onClick={addMapping} disabled={!ready}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Row
              </button>
              <button
                style={s.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={!ready}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>

            {/* Upload status */}
            {uploadState === 'parsing' && (
              <p style={s.uploadMsg}>Parsing file…</p>
            )}
            {uploadState && typeof uploadState === 'object' && !uploadState.error && (
              <p style={s.uploadSuccess}>
                ✓ {uploadState.added + uploadState.updated} rows processed —{' '}
                {uploadState.added} added, {uploadState.updated} updated. Save to keep changes.
              </p>
            )}
            {uploadState?.error && (
              <p style={s.uploadError}>{uploadState.error}</p>
            )}

            <p style={s.uploadHint}>
              Accepts .csv or .xlsx/.xls — first row is treated as a header. Column A: 3rd party code, Column B: local code.
            </p>
          </div>
        </div>

      </div>

      {/* Pinned footer */}
      <div style={s.footer}>
        {status === 'saved' && (
          <p style={s.savedMsg}>✓ Saved to local database.</p>
        )}
        {status === 'error' && (
          <p style={s.errorMsg}>Something went wrong. Please try again.</p>
        )}
        <button
          style={{
            ...s.saveBtn,
            opacity: (!ready || !isDirty || status === 'saving') ? 0.45 : 1,
            cursor: (!ready || !isDirty || status === 'saving') ? 'default' : 'pointer',
          }}
          onClick={isDirty ? handleSave : undefined}
          disabled={!ready || !isDirty || status === 'saving'}
          aria-disabled={!isDirty}
        >
          {status === 'saving' ? 'Saving…' : isDirty ? 'Save Changes' : 'No Changes'}
        </button>

        {/* Device setup guide */}
        {onOpenSetupGuide && (
          <div style={s.section}>
            <p style={s.sectionLabel}>Device</p>
            <button style={s.guideBtn} onClick={onOpenSetupGuide}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>How to set up a new device</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.5 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        )}

        <div style={{ height: 'calc(var(--bottom-safe) + 8px)' }} />
      </div>
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'flex-end',
    zIndex: 100,
    padding: '0 0 calc(var(--bottom-safe) + 16px)',
  },
  dialog: {
    background: 'var(--surface)',
    borderRadius: '20px 20px 0 0',
    padding: '28px 24px 16px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  dialogIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: '#fff8e1',
    color: '#f9a825',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  dialogTitle: { margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text)' },
  dialogBody: {
    margin: 0, fontSize: '14px', color: 'var(--text-secondary)',
    textAlign: 'center', lineHeight: '1.5',
  },
  dialogActions: { display: 'flex', gap: '12px', width: '100%', marginTop: '8px' },
  cancelBtn: {
    flex: 1, padding: '14px', background: 'var(--surface-2)', color: 'var(--text)',
    border: '1.5px solid var(--border)', borderRadius: '12px',
    fontSize: '16px', fontWeight: '600', minHeight: '52px',
  },
  confirmBtn: {
    flex: 1, padding: '14px', background: 'var(--primary)', color: '#fff',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', minHeight: '52px',
  },
  screen: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-2)' },
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
  },
  appTitle: { fontSize: '18px', fontWeight: '600', letterSpacing: '0.3px' },
  body: {
    flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px',
  },
  section: { marginBottom: '8px' },
  sectionLabel: {
    margin: '0 0 8px 4px', fontSize: '12px', fontWeight: '600',
    color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.8px',
  },
  fieldGroup: {
    background: 'var(--surface)', borderRadius: '12px', padding: '16px 12px',
    border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px',
  },
  label: { fontSize: '15px', fontWeight: '600', color: 'var(--text)' },
  input: {
    width: '100%', padding: '12px 14px', fontSize: '16px',
    border: '1.5px solid var(--border)', borderRadius: '10px',
    background: 'var(--surface-2)', color: 'var(--text)',
    outline: 'none', minHeight: '48px', appearance: 'none', WebkitAppearance: 'none',
  },
  hint: { margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' },
  inputError: { borderColor: 'var(--error-text)', background: 'var(--error-bg)' },
  fieldError: { margin: 0, fontSize: '12px', color: 'var(--error-text)', fontWeight: '500' },
  mappingHeader: { display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '2px' },
  headerSpacer: { flexShrink: 0, width: '28px' },
  headerLabels: { flex: 1, display: 'flex', gap: '28px' },
  headerLabel: {
    flex: 1, fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center',
  },
  mappingRowWrap: { display: 'flex', flexDirection: 'column', gap: '4px' },
  mappingRowErrors: {
    display: 'flex', paddingLeft: '28px', paddingRight: '42px', gap: '28px',
  },
  mappingRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  rowIndex: {
    flexShrink: 0, width: '22px', fontSize: '12px',
    color: 'var(--text-secondary)', textAlign: 'center', fontWeight: '500',
  },
  mappingInputs: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden',
  },
  mappingInput: {
    flex: 1, minWidth: 0, padding: '10px', fontSize: '14px',
    border: '1.5px solid var(--border)', borderRadius: '8px',
    background: 'var(--surface-2)', color: 'var(--text)',
    outline: 'none', minHeight: '44px', textAlign: 'center',
    appearance: 'none', WebkitAppearance: 'none',
  },
  arrowWrap: { flexShrink: 0, flexGrow: 0, display: 'flex', alignItems: 'center', padding: '0 2px' },
  deleteBtn: {
    flexShrink: 0, background: 'none', border: 'none', color: 'var(--error-text)',
    padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', minWidth: '36px', minHeight: '44px',
    WebkitTapHighlightColor: 'transparent',
  },
  mappingActions: { display: 'flex', gap: '8px', marginTop: '4px' },
  addBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '12px 8px', background: 'var(--surface-2)', color: 'var(--primary)',
    border: '1.5px dashed var(--primary)', borderRadius: '10px',
    fontSize: '14px', fontWeight: '600', minHeight: '48px',
  },
  uploadBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '12px 8px', background: 'var(--surface-2)', color: 'var(--text-secondary)',
    border: '1.5px dashed var(--border)', borderRadius: '10px',
    fontSize: '14px', fontWeight: '600', minHeight: '48px',
  },
  uploadMsg: { margin: 0, fontSize: '13px', color: 'var(--text-secondary)' },
  uploadSuccess: {
    margin: 0, fontSize: '13px', color: 'var(--success-text)', fontWeight: '500', lineHeight: '1.5',
  },
  uploadError: { margin: 0, fontSize: '13px', color: 'var(--error-text)', fontWeight: '500' },
  uploadHint: {
    margin: 0, fontSize: '12px', color: 'var(--text-secondary)',
    lineHeight: '1.5', borderTop: '1px solid var(--border)', paddingTop: '10px',
  },
  footer: {
    padding: '12px 16px calc(var(--bottom-safe) + 16px)',
    background: 'var(--surface)', borderTop: '1px solid var(--border)',
    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px',
  },
  saveBtn: {
    width: '100%', padding: '16px', background: 'var(--primary)', color: '#fff',
    border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600',
    minHeight: '52px', transition: 'opacity 0.2s',
  },
  savedMsg: { margin: 0, textAlign: 'center', fontSize: '14px', color: 'var(--success-text)', fontWeight: '500' },
  errorMsg: { margin: 0, textAlign: 'center', fontSize: '14px', color: 'var(--error-text)', fontWeight: '500' },
  guideBtn: {
    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '12px', padding: '14px 16px', color: 'var(--primary)',
    fontSize: '15px', fontWeight: '600', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent', textAlign: 'left',
  },
};

export default SettingsPage;
