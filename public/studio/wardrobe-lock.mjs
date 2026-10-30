export function isCharacterFollowKind(kind) {
  return kind !== 'front' && (kind === 'side' || kind === 'back' || String(kind || '').startsWith('expr_'));
}

/** 正面是服装母版。侧、背、表情把正面图当作 IMAGE_0，不许改衣服。 */
export function wardrobeLockPrompt({kind, costume, hasFrontRef}) {
  const text = String(costume || '').trim();
  const bible = text
    ? `Costume bible (copy, do not redesign): ${text}.`
    : "Copy IMAGE_0's exact garments; do not invent a new outfit.";
  if (kind === 'front') {
    return `${bible} This is the MASTER wardrobe plate. Later side, back, and expression stills must copy these clothes exactly.`;
  }
  if (!hasFrontRef) return bible;
  const orbit = kind === 'side'
    ? 'Orbit the camera 90 degrees to a TRUE side profile of the SAME dressed person. Nose, chest, and toes point to the frame edge.'
    : kind === 'back'
      ? 'Orbit the camera 180 degrees to a TRUE back view of the SAME dressed person. Same jacket back, same hair, same pants.'
      : 'Keep the same collar, neckline, fabric, jewelry, glasses, and hair as IMAGE_0. Head-and-shoulders crop is allowed; wardrobe must not change.';
  return [
    "WARDROBE LOCK — IMAGE_0 is this character's FRONT plate.",
    bible,
    'Same garments, colors, fabric, wear, buttons, pockets, seams, prints, shoes, bag, glasses, watch, and jewelry.',
    'Do not add a new coat, vest, logo, rank, badge text, or swap the jacket/pants.',
    "Body-relative: a detail on the wearer's LEFT stays on the wearer's LEFT in every view (front: viewer's RIGHT; back: viewer's LEFT).",
    orbit,
    'Change ONLY camera orbit and/or the requested facial expression. Outfit is frozen.',
  ].join(' ');
}
