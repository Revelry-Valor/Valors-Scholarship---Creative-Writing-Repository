export type Theme = 'system' | 'light' | 'dark';

export function currentTheme(): Theme {
  try {
    const t = localStorage.getItem('lr.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyTheme(t: Theme = currentTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    localStorage.setItem('lr.theme', t);
  } catch {
    // ignore
  }
}
