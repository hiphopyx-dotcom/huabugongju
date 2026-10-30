const EMPTY = 'EMPTY VACANT SET. Zero people: no humans, no extras, no silhouettes, no mannequins, no faces, no hands. Architecture only.';

export function setKindOf(heading = '', name = '', description = '') {
  const blob = `${heading} ${name} ${description}`;
  if (/(外景|EXT\b)/i.test(blob) && !/内景/.test(blob)) return 'exterior';
  return 'interior';
}

function placeHint(location) {
  return [location.heading, location.name, location.time_of_day, location.weather, location.atmosphere, location.lighting, location.description].filter(Boolean).join(' · ');
}

export function locationViewPrompt(location, kind) {
  const set = setKindOf(location.heading, location.name, location.description);
  const place = placeHint(location) || 'unnamed set';
  const where = set === 'exterior' ? '外景 EXTERIOR.' : '内景 INTERIOR.';
  if (kind === 'plan' || kind === 'a_plan') {
    return [
      set === 'exterior' ? "Photoreal bird's-eye OVERHEAD of this EXTERIOR location. High aerial of the same place as IMAGE_0." : "Photoreal bird's-eye OVERHEAD of this INTERIOR room. Straight-down view of the same room as IMAGE_0.",
      'IMAGE_0 is the ground-level master still. Lock the spatial structure.',
      'Photoreal materials, same time of day and lighting as IMAGE_0. NOT a white clay model. NOT a schematic diagram. NOT a CAD floor plan.',
      EMPTY, `Place: ${place}. ${where}`, 'No people, no text, no watermark.',
    ].join(' ');
  }
  if (kind === 'establishing' || kind === 'a_establishing') {
    return [
      set === 'exterior' ? 'Photoreal EXTERIOR still. Live-action photography. Not a 3D model.' : 'Photoreal INTERIOR still. Live-action photography. Not a 3D model.',
      'Front establishing still from a fixed tripod. Square-on. Eye-level. This photo is the spatial source of truth.',
      EMPTY, `Place: ${place}. ${where}`, 'No people, no text, no watermark, no collage.',
    ].join(' ');
  }
  const yaw = kind.endsWith('view_w') ? 'SAME TRIPOD. Only yaw the camera head 90° LEFT.'
    : kind.endsWith('view_e') ? 'SAME TRIPOD. Only yaw the camera head 90° RIGHT.'
    : 'SAME TRIPOD. Yaw 180° so you look opposite the master.';
  return [
    'Photoreal still. Live-action photography. Not a white clay model.',
    'IMAGE_0 is the ground-level MASTER still. IMAGE_1 is the overhead plan (layout lock only).',
    yaw, 'SAME SPACE. Do not invent a new building.', EMPTY, `Place: ${place}. ${where}`, 'No people, no text, no watermark.',
  ].join(' ');
}

export const STRUCTURE_A = Object.freeze([
  {id:'a_establishing', label:'主图', ratio:'16:9'},
  {id:'a_plan', label:'写实俯视', ratio:'16:9'},
  {id:'a_view_w', label:'左', ratio:'16:9'},
  {id:'a_view_e', label:'右', ratio:'16:9'},
  {id:'a_view_s', label:'对面', ratio:'16:9'},
]);
export const STRUCTURE_B = Object.freeze([
  {id:'plan', label:'俯视白模', ratio:'1:1'},
  {id:'view_n', label:'北机位', ratio:'16:9'},
  {id:'view_w', label:'西机位', ratio:'16:9'},
  {id:'view_e', label:'东机位', ratio:'16:9'},
  {id:'view_s', label:'南机位', ratio:'16:9'},
]);
