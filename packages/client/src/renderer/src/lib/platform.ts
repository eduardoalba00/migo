export const isElectron =
  typeof window !== "undefined" && !!window.windowAPI;
export const isWeb = !isElectron;
