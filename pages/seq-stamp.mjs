/** Sequence numbers stay in metadata and the UI. Image bytes are never rewritten. */

/** The string a still rehearsal hashes or a request sends. Nothing here redraws pixels. */
export function sourceImage(dataUrl) {
  return typeof dataUrl === 'string' ? dataUrl : '';
}

export function seqText(label) {
  const text = String(label ?? '').trim();
  if (!/^(\d{1,3}|[A-Za-z]\d{0,3})$/.test(text)) return '';
  return /[A-Za-z]/.test(text) ? text.toUpperCase() : text;
}

/** Drop-in for the preview import. Returns the same string it was given. */
export async function stampSeq(dataUrl, label) {
  void label;
  return typeof dataUrl === 'string' ? dataUrl : '';
}

export function presentSeq(dataUrl, label) {
  return {
    dataUrl: typeof dataUrl === 'string' ? dataUrl : '',
    seqLabel: seqText(label),
  };
}
