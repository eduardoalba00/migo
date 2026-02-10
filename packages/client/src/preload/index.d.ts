interface WindowAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id: string;
}

interface ScreenAPI {
  getSources: () => Promise<ScreenSource[]>;
}

declare global {
  interface Window {
    windowAPI: WindowAPI;
    screenAPI: ScreenAPI;
  }
}

export {};
