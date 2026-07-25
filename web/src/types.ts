export interface DirEntry {
  name: string;
  path: string;
  isProject: boolean;
}

export interface DirsResponse {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
  root: string;
}

export interface LyricLine {
  time: number;
  text: string;
}

export interface ProjectResponse {
  path: string;
  photos: string[];
  audio: string | null;
  lyricsFile: string | null;
  lyrics: LyricLine[] | null;
  unsupportedVideos: string[];
  filterConfig: unknown;
  output: {
    stills: string[];
    videos: string[];
  };
}
