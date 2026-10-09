const SECONDS_PER_PHOTO = 4;

const round3 = (value) => Math.round(value * 1000) / 1000;

const transitionFor = (config) => {
  if (config.transition === 'crossfade') return {type: 'crossfade', duration: config.crossfade};
  if (config.transition === 'cut') return {type: 'cut', duration: 0};
  return {type: 'album', duration: config.album_fade};
};

const brandingFor = (config, explicitKeys = new Set()) => {
  const branding = {};
  if (explicitKeys.has('outro_text')) branding.outro_text = config.outro_text;
  if (explicitKeys.has('signature')) branding.signature = config.signature;
  branding.intro = explicitKeys.has('intro') ? Boolean(config.intro) : false;
  return branding;
};

export const buildSilentTimeline = ({photos, config, explicitKeys}) => {
  const transition = transitionFor(config);
  const clips = photos.map((name, index) => ({
    kind: 'photo',
    src: `./${name}`,
    start: round3(index * SECONDS_PER_PHOTO),
    end: round3((index + 1) * SECONDS_PER_PHOTO),
    transition: index === 0 ? {type: 'none', duration: 0} : {...transition},
    motion: {type: 'none', from: 1, to: 1},
  }));
  return {
    meta: {
      version: 1,
      audio: '',
      duration: photos.length * SECONDS_PER_PHOTO,
      width: config.width,
      height: config.height,
      fps: config.fps,
      background: config.background,
      photo_scale: config.photo_scale,
      branding: brandingFor(config, explicitKeys),
      chapters: {enabled: false, day_count: 0, card_count: 0},
    },
    photos: clips,
    subtitles: [],
  };
};
