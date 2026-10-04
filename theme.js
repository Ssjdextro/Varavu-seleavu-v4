/* Dark-mode switch — shared by index.html and analytics.html.
   The saved choice lives in localStorage under "ledger_theme"; with no saved
   choice the app follows the device's light/dark setting. */
(function(){
  "use strict";
  var KEY = 'ledger_theme', root = document.documentElement;
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  function current(){ return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

  function apply(theme, persist){
    root.setAttribute('data-theme', theme);
    if(persist){ try{ localStorage.setItem(KEY, theme); }catch(e){} }
    document.querySelectorAll('.theme-toggle').forEach(function(b){
      b.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', theme === 'dark' ? '#0b1119' : '#708baf');
    window.dispatchEvent(new CustomEvent('themechange', {detail: theme}));
  }

  document.querySelectorAll('.theme-toggle').forEach(function(b){
    b.addEventListener('click', function(){ apply(current() === 'dark' ? 'light' : 'dark', true); });
  });

  apply(current(), false);

  if(media && media.addEventListener){
    media.addEventListener('change', function(e){
      var saved = null; try{ saved = localStorage.getItem(KEY); }catch(err){}
      if(!saved) apply(e.matches ? 'dark' : 'light', false);
    });
  }
})();
