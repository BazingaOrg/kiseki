/** 所有媒体都经 /media 透传(服务端做路径沙箱),前端不直接拼文件 URL。 */
export const mediaUrl = (absolutePath: string): string =>
  `/media?path=${encodeURIComponent(absolutePath)}`;

/**
 * 缩略图。小图一律走这里,别直接引用原图 —— 一张相机原图有好几 MB,
 * 拿来喂 44px 的方块会让页面白框半天出不来。
 */
export const thumbUrl = (absolutePath: string, width: number): string =>
  `/api/thumb?path=${encodeURIComponent(absolutePath)}&w=${width}`;

export const LIGHTBOX_PREVIEW_WIDTH = 1024;

export const lightboxSlide = (photoPath: string) => ({
  src: thumbUrl(photoPath, LIGHTBOX_PREVIEW_WIDTH),
  photoPath,
});

export const basename = (absolutePath: string): string =>
  absolutePath.split(/[\\/]/).pop() ?? absolutePath;
