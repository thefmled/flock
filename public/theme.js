/*
 * flock theme switch: shared across every app page.
 *
 * Usage on any page:
 *   1. Make sure the pre-paint script is in <head> (sets data-theme before paint)
 *   2. Drop a placeholder where you want the switch:
 *        <div data-theme-switch="fixed"></div>   (top-right floating)
 *      or
 *        <div data-theme-switch="inline"></div>  (inline, for topbars)
 *   3. Load this file: <script src="/theme.js"></script>
 *
 * The switch renders 3 segments: light / dark / system.
 * Selected mode persists in localStorage as flock_theme.
 */
(function() {
  var SWITCH_HTML =
    '<button data-mode="light" onclick="setFlockTheme(\'light\')" aria-label="Light" title="Light">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>' +
        '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' +
      '</svg>' +
    '</button>' +
    '<button data-mode="dark" onclick="setFlockTheme(\'dark\')" aria-label="Dark" title="Dark">' +
      '<svg viewBox="0 0 24 24">' +
        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/>' +
      '</svg>' +
    '</button>' +
    '<button data-mode="system" onclick="setFlockTheme(\'system\')" aria-label="System" title="Follow system preference">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
        '<rect x="3" y="4" width="18" height="13" rx="2"/>' +
        '<line x1="9" y1="20" x2="15" y2="20" stroke-linecap="round"/>' +
      '</svg>' +
    '</button>';

  // Global setter: works whether or not a switch is rendered
  window.setFlockTheme = function(mode) {
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return;
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('flock_theme', mode); } catch (e) {}
    syncSwitchUI(mode);
  };

  function syncSwitchUI(mode) {
    var buttons = document.querySelectorAll('.theme-switch button[data-mode]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-checked', buttons[i].getAttribute('data-mode') === mode ? 'true' : 'false');
    }
  }

  function render() {
    // Find every placeholder and inject the switch markup + class
    var placeholders = document.querySelectorAll('[data-theme-switch]');
    for (var i = 0; i < placeholders.length; i++) {
      var el = placeholders[i];
      // Skip if already rendered (in case script runs twice)
      if (el.classList.contains('theme-switch')) continue;
      var variant = el.getAttribute('data-theme-switch') || 'inline';
      el.classList.add('theme-switch');
      if (variant === 'fixed') el.classList.add('theme-switch-fixed');
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Theme');
      el.innerHTML = SWITCH_HTML;
    }
    // Mark the active mode
    var current = document.documentElement.getAttribute('data-theme') || 'system';
    syncSwitchUI(current);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
