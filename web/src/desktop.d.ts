export {};

declare global {
  interface Window {
    kisekiDesktop?: {
      openProject(): Promise<{path: string} | null>;
      openRecentProject(path: string): Promise<{path: string}>;
      openDroppedProject(file: File): Promise<{path: string}>;
      showOutput(): Promise<string>;
      cancelJob(): Promise<boolean>;
    };
  }
}
