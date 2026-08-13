export {};

declare global {
  interface Window {
    kisekiDesktop?: {
      openProject(): Promise<{path: string} | null>;
      openRecentProject(path: string): Promise<{path: string}>;
      openDroppedProject(file: File): Promise<{path: string}>;
      onProjectChanged(callback: (path: string) => void): () => void;
      showOutput(): Promise<string>;
      cancelJob(): Promise<boolean>;
    };
  }
}
