export const FRAME_ASPECTS = Object.freeze(['1:1','3:4','16:9','9:16']);
export const DEFAULT_FRAME_ASPECT = '16:9';

export function parseFrameAspect(value) {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, '').replace('/', ':') : '';
  if (!FRAME_ASPECTS.includes(raw)) throw Error('画幅必须是 1:1、3:4、16:9 或 9:16');
  return raw;
}

export function episodeAspectOf(desk) {
  const chosen = desk?.episodeAspects?.[desk.episode];
  if (FRAME_ASPECTS.includes(chosen)) return chosen;
  return FRAME_ASPECTS.includes(desk?.aspect) ? desk.aspect : DEFAULT_FRAME_ASPECT;
}

export function setEpisodeAspect(desk, episode, value) {
  const aspect = parseFrameAspect(value);
  desk.episodeAspects ||= {};
  desk.episodeAspects[episode] = aspect;
  return aspect;
}
