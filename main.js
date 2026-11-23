// Webinel site: theme toggle (remembered per visitor) and a gentle reveal on scroll.
(() => {
  const root = document.documentElement;
  root.classList.add('js');

  const KEY = 'webinel-site-theme';
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (value) => { try { localStorage.setItem(KEY, value); } catch { /* private mode */ } };
  const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  const saved = read();
  if (saved === 'dark' || saved === 'light') root.dataset.theme = saved;

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current = root.dataset.theme ?? (systemDark() ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    write(next);
  });

  // Respect reduced motion: no autoplaying video, no reveal.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const video = document.querySelector('.hero__video video');
    video?.removeAttribute('autoplay');
    video?.pause();
    return;
  }

  const targets = document.querySelectorAll('.feature, .pipeline li, .facts > div, .install__card, .gallery figure, .plan, .faq details');
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of targets) {
    // Anything already on screen stays visible; only below-the-fold items rise in.
    if (el.getBoundingClientRect().top < window.innerHeight) continue;
    el.classList.add('rise');
    io.observe(el);
  }
})();
