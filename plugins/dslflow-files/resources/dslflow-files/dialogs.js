// dialogs.js — Reusable modal dialog system for the Project Files plugin.
// Loaded before plugin.js; dsffModal / dsffPrompt / dsffConfirm are plain globals.
// Feature-level decisions (e.g. "unsaved changes before navigating") stay in plugin.js.

var dsffModalSeq = 0;

// Low-level modal builder.
//   opts.title   – bold heading (optional)
//   opts.body    – HTML string (optional)
//   opts.input   – { placeholder?, value? }  adds a text input
//   opts.buttons – [{ label, cls?, key?: "Enter"|"Escape", action?(val) }]
function dsffModal(opts) {
  var ns       = "dsff-modal-" + (++dsffModalSeq);
  var $overlay = $('<div class="dsff-modal-overlay">').appendTo(document.body);
  var $dlg     = $('<div class="dsff-modal">').appendTo($overlay);

  if (opts.title) $('<div class="dsff-modal-title">').text(opts.title).appendTo($dlg);
  if (opts.body)  $('<div class="dsff-modal-body">').html(opts.body).appendTo($dlg);

  var $input = null;
  if (opts.input) {
    $input = $('<input type="text" class="dsff-modal-input">')
      .attr("placeholder", opts.input.placeholder || "")
      .val(opts.input.value || "");
    $dlg.append($input);
  }

  var $btns = $('<div class="dsff-modal-btns">').appendTo($dlg);
  var bmap  = {};

  (opts.buttons || []).forEach(function (b) {
    var $b = $('<button class="red-ui-button">').text(b.label);
    if (b.cls) $b.addClass(b.cls);
    $b.on("click", function () {
      close();
      if (typeof b.action === "function") b.action($input ? $input.val() : undefined);
    });
    $btns.append($b);
    if (b.key) bmap[b.key] = $b;
  });

  function close() {
    $overlay.remove();
    $(document).off("keydown." + ns);
  }

  $overlay.on("click", function (e) {
    if (e.target === $overlay[0]) {
      if (bmap.Escape) bmap.Escape.trigger("click"); else close();
    }
  });

  $(document).on("keydown." + ns, function (e) {
    if (e.key === "Escape") {
      if (bmap.Escape) bmap.Escape.trigger("click"); else close();
    } else if (e.key === "Enter" && (!$input || document.activeElement === $input[0])) {
      e.preventDefault();
      if (bmap.Enter) bmap.Enter.trigger("click");
    }
  });

  setTimeout(function () {
    if ($input) { $input.focus(); $input[0].select(); }
    else if (bmap.Enter) bmap.Enter.focus();
  }, 0);
}

// Text-input prompt.
// opts: { title, body?, placeholder?, value?, confirmLabel?, onConfirm }
function dsffPrompt(opts) {
  dsffModal({
    title:   opts.title,
    body:    opts.body || null,
    input:   { placeholder: opts.placeholder || "", value: opts.value || "" },
    buttons: [
      { label: "Cancel", key: "Escape" },
      { label:  opts.confirmLabel || "OK",
        cls:    "dsff-modal-btn-primary",
        key:    "Enter",
        action: function (val) {
          var v = (val || "").trim();
          if (v) opts.onConfirm(v);
        }
      }
    ]
  });
}

// Confirmation dialog.
// opts: { title, body, confirmLabel?, cancelLabel?, danger?, onConfirm, onCancel? }
function dsffConfirm(opts) {
  dsffModal({
    title:   opts.title,
    body:    opts.body,
    buttons: [
      { label:  opts.cancelLabel || "Cancel",
        key:    "Escape",
        action: opts.onCancel
      },
      { label:  opts.confirmLabel || "Confirm",
        cls:    opts.danger ? "dsff-modal-btn-danger" : "dsff-modal-btn-primary",
        key:    "Enter",
        action: opts.onConfirm
      }
    ]
  });
}
