/* Inlined into every document's <head> at build time — see the themeBoot()
   plugin in vite.config.js, which substitutes it for the <!--THEME_BOOT-->
   marker.

   It has to be inline and render-blocking. Module scripts are deferred, so a
   theme applied from src/shared/theme.js lands one frame after the first
   paint, and anyone using the light theme sees a flash of black first. This
   sets only the html attribute, because <body> does not exist yet at this
   point in the parse; theme.js adds the body class once it does. The CSS rule
   `html[data-theme=light]{background:#eef1f7}` is what actually kills the
   flash, and it can only match once this has run. */
(function () {
  try {
    var mode = localStorage.getItem('mss3d_theme') === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', mode);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
