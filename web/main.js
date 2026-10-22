var Report = function () {

  return {
    prevent_sleep: function () {
      setTimeout(Main.prevent_sleep, 0);
    },

    setAspectRatio: function (idealRatio) {
      Main.setAspectRatio(idealRatio);
    },

    setActive: function (active) {
      Main.setActive(active);
    },

    setHTML: function (id, msg) {
      Main.setHTML(id, msg);
    },

    setTitle: function (msg) {
      Main.setTitle(msg);
    },

    startWasm: function (result) {
      Main.on_ww_init(!result);
    },

    handleWorkerMessage: function (event) {
      if (event.error) {
        console.error('[report] error ' + event.message);
        return;
      }
      const { fun, args } = event.data;
      //console.log(event.data);
      if (typeof Report[fun] !== 'function') {
        console.warn('[report] Unknown worker message type: ' + fun);
        return;
      }
      Report[fun](...args);
    }
  };
}();


var Main = function () {

  // configurable
  var _ready = false;
  var _colorBalance = false;

  // internal
  var _ww = undefined;

  var _showStats = false;
  var _wakeLock = undefined;

  // cached
  var _idealRatio = 1;

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      return document.exitFullscreen();
    }
    else {
      return document.documentElement.requestFullscreen();
    }
  }

  // public interface
  return {
    init: function (canvas) {
      if (!_ww) { // no webworker, use main thread
        console.log("main thread impl");
        Send.init_window(canvas);
        Main.setMode();
        Main.setFPS(15);
        _ready = true;
        const chooseFile = document.getElementById("choose-file");
        if (chooseFile) chooseFile.disabled = false;
        Main.resize();
        Send.nextFrame();
        return;
      }
    },

    init_ww: function (canvas) {
      const urlParams = new URLSearchParams(window.location.search);
      const use_ww = urlParams.get('ww') || window.location.hash == "#ww=1";
      if (!use_ww || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
        return false;
      }
      console.log("ww impl");
      var offscreen = canvas.transferControlToOffscreen();
      _ww = new Worker('send-worker.js');
      _ww.onmessage = Report.handleWorkerMessage;
      _ww.onerror = function (err) {
        console.error('[send] Worker error: ', err);
      };
      _ww.postMessage({ fun: 'init_window', args: [offscreen] }, [offscreen]);
      return true;
    },

    on_ww_init: function (force_local) {
      console.log('on ww init ' + force_local);

      if (force_local) {
        _ww = undefined;
        // force refresh in main thread mode
        const cleanURL = window.location.origin + window.location.pathname;
        window.location.replace(cleanURL);
        return;
      }

      Main.setMode();
      Main.setFPS(15);
      _ready = true;
      const chooseFile = document.getElementById("choose-file");
      if (chooseFile) chooseFile.disabled = false;
      Main.resize();
      _ww.postMessage({ fun: 'nextFrame', args: [] });
    },

    check_GL_enabled: function () {
      var testCanvas = document.createElement('canvas');
      if (!testCanvas.getContext("webgl2") && !testCanvas.getContext("webgl")) {
        var elem = document.getElementById('dragdrop');
        elem.classList.add("error");
      }
    },

    resize: function () {
      if (!_ready) return;
      // reset zoom
      var canvas = document.getElementById('canvas');
      var width = Math.max(1, window.innerWidth - 12);
      var height = Math.max(1, window.innerHeight - 12);
      Main.scaleCanvas(canvas, width, height);

    },

    toggleFullscreen: function () {
      toggleFullscreen().then(Main.resize);
      Main.togglePause(true);
    },

    togglePause: function (pause) {
      if (_ww) {
        _ww.postMessage({ fun: 'togglePause', args: [pause] });
      }
      else {
        Send.togglePause(pause);
      }
    },

    scaleCanvas: function (canvas, width, height) {
      // using ratio from current config,
      // determine optimal dimensions and rotation
      var needRotate = _idealRatio > 1 && height > width;
      if (_ww) {
        _ww.postMessage({ fun: 'rotate_window', args: [needRotate] });
      }
      else {
        Send.rotate_window(needRotate);
      }

      var ourRatio = needRotate ? height / width : width / height;

      var xdim = needRotate ? height : width;
      var ydim = needRotate ? width : height;
      if (ourRatio > _idealRatio) {
        xdim = Math.floor(xdim * _idealRatio / ourRatio);
      }
      else if (ourRatio < _idealRatio) {
        ydim = Math.floor(ydim * ourRatio / _idealRatio);
      }

      console.log(xdim + "x" + ydim);
      if (needRotate) {
        canvas.style.width = ydim + "px";
        canvas.style.height = xdim + "px";
      }
      else {
        canvas.style.width = xdim + "px";
        canvas.style.height = ydim + "px";
      }
    },

    prevent_sleep: async function () {
      if (_wakeLock) {
        return;
      }
      const requestWakeLock = async () => {
        try {
          _wakeLock = await navigator.wakeLock.request('screen');
          console.log('got wake lock!');
          _wakeLock.addEventListener('release', () => {
            _wakeLock = undefined;
          });
        } catch (err) { }
      };
      requestWakeLock();
    },

    importFile: function (fblob) {
      if (!_ready || document.getElementById("app")?.hidden) return;
      if (!_ww) {
        Send.importFile(fblob);
        return;
      }

      _ww.postMessage({ fun: 'importFile', args: [fblob] });
    },

    dragDrop: function (event) {
      console.log("drag drop?");
      console.log(event);
      const files = event.dataTransfer.files;
      if (files && files.length === 1) {
        Main.importFile(files[0]);
      }
    },

    clickFileInput: function () {
      if (!_ready || document.getElementById("app").hidden) return;
      document.getElementById("file_input").click();
    },

    fileInput: function (ev) {
      console.log("file input: " + ev);
      var file = document.getElementById('file_input').files[0];
      if (file) {
        Main.importFile(file);
      }
      Main.togglePause(false);
      document.getElementById("file_input").value = "";
    },

    setAspectRatio: function (idealRatio) {
      _idealRatio = idealRatio;
      Main.resize();
    },

    setActive: function (active) {
      // hide cursor when there's a barcode active
      document.getElementById("dragdrop").classList.add("active");
    },

    // Mode B is the only encoder configuration.
    setMode: function () {
      if (_ww) _ww.postMessage({ fun: 'setMode', args: [] });
      else Send.setMode();
    },

    startup: function () {
      const started = performance.now();
      const progress = document.getElementById('startup-progress');
      function update() {
        const elapsed = performance.now() - started;
        progress.value = Math.min(100, elapsed / 40);
        if (elapsed < 4000) {
          requestAnimationFrame(update);
        } else {
          document.getElementById('startup').hidden = true;
          document.getElementById('app').hidden = false;
          Main.resize();
        }
      }
      requestAnimationFrame(update);
    },

    setFPS: function (val) {
      if (!val) {
        return;
      }
      if (_ww) {
        _ww.postMessage({ fun: 'setFPS', args: [val] });
      }
      else {
        Send.setFPS(val);
      }
    },

    setHTML: function (id, msg) {
      const element = document.getElementById(id);
      if (element) element.textContent = msg;
    },

    setTitle: function (msg) {
      document.title = "Cimbar: " + msg;
    }
  };
}();

window.addEventListener("touchstart", function (e) {
  e = e || event;
  Main.togglePause(true);
}, false);

window.addEventListener("touchend", function (e) {
  e = e || event;
  Main.togglePause(false);
}, false);

window.addEventListener("touchcancel", function (e) {
  e = e || event;
  Main.togglePause(false);
}, false);

window.addEventListener("dragover", function (e) {
  e = e || event;
  e.preventDefault();

  document.body.style["opacity"] = 0.5;
}, false);

window.addEventListener("dragleave", function (e) {
  e = e || event;
  e.preventDefault();

  document.body.style["opacity"] = 1.0;
}, false);

window.addEventListener("drop", function (e) {
  e = e || event;
  e.preventDefault();
  e.stopPropagation();
  Main.dragDrop(e);
  document.body.style["opacity"] = 1.0;
}, false);

window.addEventListener('resize', () => {
  Main.resize();
});
