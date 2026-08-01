import { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';

const QrScannerComponent = () => {
  const [scanResult, setScanResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Triggered automatically when a QR code is successfully decoded
  const handleScan = (result) => {
    if (result && result[0]?.rawValue) {
      setScanResult(result[0].rawValue);
      setErrorMessage(''); // Clear errors on success
    }
  };

  // Triggered if camera access is blocked or unsupported
  const handleError = (error) => {
    console.error('QR Scanner Error:', error);
    setErrorMessage('Camera access denied or unsupported on this browser.');
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Mobile QR Code Scanner</h2>
      
      {/* Scanner Wrapper with constraints */}
      <div style={styles.scannerWrapper}>
        <Scanner
          onScan={handleScan}
          onError={handleError}
          constraints={{
            facingMode: 'environment' // Forces the mobile rear camera
          }}
          allowMultiple={false} // Stops continuous scanning after one match
          scanDelay={500} // Throttle scans to 500ms for better performance
        />
      </div>

      {/* Result Display */}
      {scanResult && (
        <div style={styles.successBox}>
          <strong>Scanned Result:</strong>
          <p style={styles.resultText}>{scanResult}</p>
          <button style={styles.button} onClick={() => setScanResult('')}>
            Scan Again
          </button>
        </div>
      )}

      {/* Error Display */}
      {errorMessage && (
        <div style={styles.errorBox}>
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  );
};

// Basic inline styling for scannability and layout
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px',
    fontFamily: 'sans-serif',
  },
  title: {
    marginBottom: '20px',
    color: '#333',
  },
  scannerWrapper: {
    width: '100%',
    maxWidth: '400px',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  successBox: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#e6f4ea',
    color: '#137333',
    borderRadius: '8px',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
  },
  resultText: {
    wordBreak: 'break-all',
    margin: '10px 0',
  },
  errorBox: {
    marginTop: '20px',
    padding: '15px',
    backgroundColor: '#fce8e6',
    color: '#c5221f',
    borderRadius: '8px',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
  },
  button: {
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
  }
};

export default QrScannerComponent;
