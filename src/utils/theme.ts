export enum Theme {
  LIGHT = "light",
  DARK = "dark",
}

export const detectTheme = (): Theme => {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return Theme.DARK;
  }

  return Theme.LIGHT;
};

export const onThemeChange = (callback: (theme: Theme) => void): (() => void) => {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const handleChange = (e: MediaQueryListEvent) => {
    callback(e.matches ? Theme.DARK : Theme.LIGHT);
  };

  // Add the listener
  mediaQuery.addEventListener("change", handleChange);

  // Return the function to unsubscribe
  return () => {
    mediaQuery.removeEventListener("change", handleChange);
  };
};
