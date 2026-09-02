/**
 * Client-side network measurement for the composer.
 *
 * The browser sees a completely different path than the server does: the user's
 * link to this app, not this app's link to the recipient's mail server. Sending
 * both means a message's trace shows the whole journey, and a slow send can be
 * attributed to the right half — a poor client connection looks nothing like a
 * slow remote MX, but in a single end-to-end number they are indistinguishable.
 */

/** Timings for the document navigation, via the Performance Timeline API. */
export function collectNavigationTiming() {
  if (typeof performance === 'undefined') return {};

  const [navigation] = performance.getEntriesByType('navigation');
  if (!navigation) return {};

  const positive = (value) => (Number.isFinite(value) && value > 0 ? round(value) : undefined);

  return {
    dnsMs: positive(navigation.domainLookupEnd - navigation.domainLookupStart),
    tcpMs: positive(navigation.connectEnd - navigation.connectStart),
    // `secureConnectionStart` is 0 on a plain HTTP origin, which would otherwise
    // report the whole connect phase as a TLS handshake.
    tlsMs: navigation.secureConnectionStart
      ? positive(navigation.connectEnd - navigation.secureConnectionStart)
      : undefined,
    ttfbMs: positive(navigation.responseStart - navigation.requestStart),
  };
}

/** Live link characteristics, where the Network Information API is available. */
export function collectConnectionInfo() {
  const connection =
    typeof navigator !== 'undefined'
      ? (navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection)
      : null;

  if (!connection) return {};

  return {
    // `effectiveType` ("4g", "3g") is more useful than `type`: it reflects
    // measured performance rather than the physical interface, and is the field
    // browsers actually populate.
    connectionType: connection.effectiveType ?? connection.type ?? undefined,
    downlinkMbps: Number.isFinite(connection.downlink) ? connection.downlink : undefined,
    rttMs: Number.isFinite(connection.rtt) ? connection.rtt : undefined,
  };
}

export function collectClientTrace() {
  const trace = { ...collectNavigationTiming(), ...collectConnectionInfo() };
  // Drop undefined keys so the payload stays clean and passes the API's schema.
  return Object.fromEntries(Object.entries(trace).filter(([, v]) => v !== undefined));
}

/** Read a File as a base64 string suitable for the attachment field. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      // The result is a data URL; the payload is everything after the comma.
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

function round(value) {
  return Math.round(value * 100) / 100;
}
