const SECONDS_PER_PHOTO = 4;
const CHAPTER_DURATION = 1;
const CHAPTER_SYMBOLS = [':)', '♪', '✦', '˖°'];

const round3 = (value) => Math.round(value * 1000) / 1000;
const compareText = (a, b) => (a < b ? -1 : Number(a > b));

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

const photoDay = (shotTime) => {
  if (typeof shotTime !== 'string' || !/^\d{17}$/.test(shotTime)) return null;
  const year = Number(shotTime.slice(0, 4));
  const month = Number(shotTime.slice(4, 6));
  const day = Number(shotTime.slice(6, 8));
  const hour = Number(shotTime.slice(8, 10));
  const minute = Number(shotTime.slice(10, 12));
  const second = Number(shotTime.slice(12, 14));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  return shotTime.slice(0, 8);
};

export const buildSilentTimeline = ({photos, config, explicitKeys, shotTimes = []}) => {
  const transition = transitionFor(config);
  const dated = config.chapters === true && shotTimes.length === photos.length && shotTimes.every((shotTime) => photoDay(shotTime));
  const ordered = photos.map((name, index) => ({name, shotTime: shotTimes[index]}));
  if (dated) ordered.sort((a, b) => compareText(a.shotTime, b.shotTime) || compareText(a.name, b.name));
  const clips = ordered.map(({name}, index) => ({
    kind: 'photo',
    src: `./${name}`,
    start: round3(index * SECONDS_PER_PHOTO),
    end: round3((index + 1) * SECONDS_PER_PHOTO),
    transition: index === 0 ? {type: 'none', duration: 0} : {...transition},
    motion: {type: 'none', from: 1, to: 1},
  }));
  const days = ordered.map(({shotTime}) => photoDay(shotTime));
  const dayNumbers = dated ? new Map([...new Set(days)].map((day, index) => [day, index + 1])) : new Map();
  const cards = [];
  if (dayNumbers.size > 1) {
    for (let index = 1; index < clips.length; index += 1) {
      if (days[index] === days[index - 1]) continue;
      const boundary = clips[index].start;
      const start = boundary - CHAPTER_DURATION / 2;
      const end = boundary + CHAPTER_DURATION / 2;
      clips[index - 1].end = start;
      clips[index].start = end;
      clips[index].transition = {type: 'none', duration: 0};
      const month = Number(days[index].slice(4, 6));
      const day = Number(days[index].slice(6, 8));
      const ordinal = dayNumbers.get(days[index]);
      cards.push({kind: 'chapter', text: `${month}月${day}日 · 第${ordinal}天 ${CHAPTER_SYMBOLS[(ordinal - 1) % CHAPTER_SYMBOLS.length]}`, start, end});
    }
  }
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
      chapters: {enabled: cards.length > 0, day_count: dayNumbers.size, card_count: cards.length},
    },
    photos: [...clips, ...cards].sort((a, b) => a.start - b.start),
    subtitles: [],
  };
};
