/** Keep navigation intent on this site. It never establishes subscription access. */
export function safeAuthReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/dashboard';
  let decoded = value;
  for (let pass = 0; pass < 5; pass++) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return '/dashboard';
    let next;
    try { next = decodeURIComponent(decoded); } catch { return '/dashboard'; }
    if (next === decoded) {
      try {
        const url = new URL(value, 'https://portabase.invalid');
        if (url.origin !== 'https://portabase.invalid') return '/dashboard';
        return `${url.pathname}${url.search}${url.hash}`;
      } catch { return '/dashboard'; }
    }
    decoded = next;
  }
  return '/dashboard';
}

export function checkoutPlanFromSearch(search) {
  const plan = new URLSearchParams(search).get('plan');
  return ['cloud-7', 'cloud-17'].includes(plan) ? plan : null;
}
