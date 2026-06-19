// eagler-ui.js
// Minimal UI glue for the Eagler-inspired client.
// Exposes window.EaglerUI.init(options)
// - options.onToggleUltraLow(): called when user toggles Ultra Low
// Emits a custom event 'eagler-cheats' on window when cheat toggles change: detail = { fly, speed, god }

(function(){
  function init(options = {}){
    // hook UI elements if present in DOM
    const remapBtn = document.getElementById('remap-btn');
    const webguiBtn = document.getElementById('webgui-btn');
    const webguiPanel = document.getElementById('webgui-panel');
    const closeWebgui = document.getElementById('close-webgui');
    const cheatFly = document.getElementById('cheat-fly');
    const cheatSpeed = document.getElementById('cheat-speed');
    const cheatGod = document.getElementById('cheat-god');
    const ultraLow = document.getElementById('ultra-low-toggle');

    if (remapBtn) remapBtn.addEventListener('click', () => {
      // Simple remap placeholder: prompt for forward key and save to localStorage
      const k = prompt('Press a key code to bind to FORWARD (example: KeyW, ArrowUp). Cancel to keep current.');
      if (k) {
        try { localStorage.setItem('mineecraft_forward', k); alert('Forward bound to ' + k); } catch(e){}
      }
    });

    if (webguiBtn && webguiPanel) webguiBtn.addEventListener('click', () => { webguiPanel.style.display = 'block'; });
    if (closeWebgui && webguiPanel) closeWebgui.addEventListener('click', () => { webguiPanel.style.display = 'none'; });

    function publishCheats(){
      const state = {
        fly: !!(cheatFly && cheatFly.checked),
        speed: cheatSpeed ? parseFloat(cheatSpeed.value) : 1.0,
        god: !!(cheatGod && cheatGod.checked)
      };
      window.dispatchEvent(new CustomEvent('eagler-cheats', { detail: state }));
    }

    if (cheatFly) cheatFly.addEventListener('change', publishCheats);
    if (cheatSpeed) cheatSpeed.addEventListener('input', publishCheats);
    if (cheatGod) cheatGod.addEventListener('change', publishCheats);

    if (ultraLow) ultraLow.addEventListener('change', () => {
      if (options.onToggleUltraLow && typeof options.onToggleUltraLow === 'function') options.onToggleUltraLow();
    });

    // expose a simple helper to open/close webGUI from code
    return {
      openWebGUI: () => { if (webguiPanel) webguiPanel.style.display = 'block'; },
      closeWebGUI: () => { if (webguiPanel) webguiPanel.style.display = 'none'; },
      getCheatState: () => ({ fly: !!(cheatFly && cheatFly.checked), speed: cheatSpeed ? parseFloat(cheatSpeed.value) : 1.0, god: !!(cheatGod && cheatGod.checked) })
    };
  }

  window.EaglerUI = { init };
})();
