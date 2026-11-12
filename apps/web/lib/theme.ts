export type Theme = 'light' | 'dark' | 'system';

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('mya-theme', theme);
  } catch {
    /* storage unavailable */
  }
}

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem('mya-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Inline script that applies the stored theme before paint (prevents a flash). */
export const themeBootScript = `try{var t=localStorage.getItem('mya-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
