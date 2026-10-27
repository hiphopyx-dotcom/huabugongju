const PREFIX = '[jbp-image-startup]';
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED',
  'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const KINDS = new Set(['http', 'network', 'timeout']);
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;

/** Metadata only. Keep the single startup attempt separate from generation. */
export function createImageStartupDiagnostic({fetcher = fetch, logger = console.info, onResult} = {}) {
  let attempt;
  return configuration => {
    if (attempt) return attempt;
    attempt = (async () => {
      if (!configuration?.key) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let result;
      try {
        const response = await fetcher(configuration.baseUrl + '/api-key', {
          method: 'GET', headers: {Authorization: 'Bearer ' + configuration.key},
          redirect: 'error', signal: controller.signal,
        });
        // Do not inspect the account response, including successful responses.
        try { void response.body?.cancel().catch(() => {}); } catch {}
        const status = response.status;
        if (!httpStatus(status)) throw new Error('invalid-status');
        result = {kind: 'http', httpStatus: status, code: null};
      } catch (error) {
        result = {kind: controller.signal.aborted ? 'timeout' : 'network', httpStatus: null, code: null};
        try {
          const code = NETWORK_CODES.has(error?.cause?.code) ? error.cause.code : error?.code;
          if (NETWORK_CODES.has(code)) result.code = code;
        } catch {}
      } finally {
        clearTimeout(timer);
      }
      // Only these freshly constructed, allowlisted fields reach the logger.
      Object.freeze(result);
      try { void Promise.resolve(logger(PREFIX, result)).catch(() => {}); } catch {}
      try { void Promise.resolve(onResult?.(result)).catch(() => {}); } catch {}
      return result;
    })();
    return attempt;
  };
}

/** Persist one internal, sanitized result; this does not add an HTTP surface. */
export async function persistImageStartupDiagnostic(query, result, {logger = console.info} = {}) {
  if (!result) return;
  try {
    const {kind, httpStatus: status, code} = result;
    if (!KINDS.has(kind) || kind === 'http' && !httpStatus(status)) throw new Error('invalid-result');
    const safe = {kind, httpStatus: kind === 'http' ? status : null,
      code: kind !== 'http' && NETWORK_CODES.has(code) ? code : null};
    await query('INSERT INTO studio_service_diagnostics (name,result,updated) VALUES ($1,$2::jsonb,$3) '
      + 'ON CONFLICT (name) DO UPDATE SET result=EXCLUDED.result,updated=EXCLUDED.updated',
    ['image-connection', JSON.stringify(safe), Date.now()]);
    return true;
  } catch {
    try { void Promise.resolve(logger(PREFIX, 'persist-unavailable')).catch(() => {}); } catch {}
    return false;
  }
}
