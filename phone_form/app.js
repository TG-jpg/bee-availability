// Bee visit form. Plain JavaScript, no libraries.
// Customer details only ever come from the trip pack (fetched from your own private Google script, or loaded from a file);
// entries are saved in this phone's storage and sent only when you tap Send to desktop.
(function () {
  "use strict";

  var KEY_PACK = "bee.pack", KEY_ENTRIES = "bee.entries", KEY_USED = "bee.usedMax", KEY_RELAY = "bee.relay";
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ storage
  function load(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { say("This phone could not save that. Free up some space and try again.", "bad"); return false; }
  }
  var pack = load(KEY_PACK, null);
  var entries = load(KEY_ENTRIES, []);
  var usedMax = load(KEY_USED, 0);
  var relay = load(KEY_RELAY, null);          // {u: script address, k: secret key}, set by the setup link
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }

  // ------------------------------------------------------------ small helpers
  function say(text, kind) {
    var box = $("message");
    box.textContent = text;
    box.className = "message" + (kind ? " " + kind : "");
    box.hidden = !text;
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function nextNumber() {
    if (!pack) return null;
    return Math.max(pack.next_hive_number, usedMax + 1);
  }
  function hiveByNumber(n) {
    if (!pack) return null;
    for (var i = 0; i < pack.hives.length; i++) if (pack.hives[i].number === n) return pack.hives[i];
    return null;
  }
  var views = ["home", "pick", "visit", "delivery", "entries"];
  function show(name) {
    views.forEach(function (v) { $("view-" + v).hidden = v !== name; });
    window.scrollTo(0, 0);
    if (name === "home") renderHome();
    if (name === "pick") renderPick();
    if (name === "entries") renderEntries();
    if (name === "delivery") renderDelivery();
  }
  function unsent() { return entries.filter(function (e) { return !e.sentAt; }); }

  // ------------------------------------------------------------ segmented buttons (taps instead of typing)
  var segs = [];
  function makeSeg(id, options, get, set, optional) {
    var box = $(id);
    function draw() {
      box.textContent = "";
      options.forEach(function (o) {
        var label = typeof o[1] === "function" ? o[1]() : o[1];
        var b = el("button", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(get() === o[0]));
        b.addEventListener("click", function () {
          set(optional && get() === o[0] ? null : o[0]);
          refreshAll();
        });
        box.appendChild(b);
      });
    }
    segs.push(draw);
    draw();
  }
  function refreshAll() { segs.forEach(function (d) { d(); }); renderVisit(); }

  // ------------------------------------------------------------ home
  function renderHome() {
    var status = $("pack-status");
    if (pack) {
      var built = pack.built_at ? pack.built_at.replace("T", " ").slice(0, 16) : "unknown time";
      status.textContent = "Trip pack: " + pack.hives.length + " hives, built " + built;
    } else {
      status.textContent = "No trip pack loaded yet.";
    }
    $("demo-banner").hidden = !(pack && pack.database === "demo");
    $("btn-get-pack").hidden = !relay;
    $("link-status").textContent = relay ? "Linked to your computer through Google." :
      "Not linked yet: open 'Link to computer' below and paste the setup link.";
    $("link-box").open = !relay;
    $("count-unsent").textContent = String(unsent().length);
  }

  // ------------------------------------------------------------ trip pack
  function loadPackText(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { say("That file isn't a trip pack (it could not be read).", "bad"); return; }
    if (!data || data.format !== 1 || !Array.isArray(data.hives) || !Array.isArray(data.customers) ||
        typeof data.next_hive_number !== "number") {
      say("That file isn't a trip pack made by Bee Tracker.", "bad");
      return;
    }
    pack = data;
    if (save(KEY_PACK, pack)) {
      say("Trip pack loaded: " + pack.hives.length + " hives, " + (pack.stops || []).length + " stops.", "ok");
    }
    renderHome();
  }

  // ------------------------------------------------------------ the Google link
  function parseLink(text) {
    var i = String(text || "").indexOf("#");
    if (i < 0) return null;
    var q = new URLSearchParams(text.slice(i + 1));
    var u = q.get("u"), k = q.get("k");
    if (!u || !k || u.indexOf("https://script.google.com/") !== 0) return null;
    return { u: u, k: k };
  }
  function setRelay(link) {
    relay = link;
    if (!save(KEY_RELAY, relay)) return false;
    renderHome();
    return true;
  }
  // One request to the Google script. Resolves with its answer; rejects with a sentence you can show.
  function ask(action, extra) {
    if (!relay) return Promise.reject(new Error("This phone isn't linked yet."));
    var body = Object.assign({ action: action, key: relay.k }, extra || {});
    return fetch(relay.u, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (answer) {
        if (!answer || !answer.ok) {
          throw new Error(answer && answer.error === "bad key" ? "The key doesn't match. Link the phone again from the computer's setup link."
                                                                : "The script said: " + ((answer && answer.error) || "something went wrong") + ".");
        }
        return answer;
      }, function () { throw new Error("Couldn't reach Google. Check your signal and try again. Nothing has been lost."); });
  }
  function getPack() {
    say("Getting the trip pack...", "");
    ask("get_pack").then(function (a) { loadPackText(a.pack); }).catch(function (err) { say(err.message, "bad"); });
  }

  // ------------------------------------------------------------ pick a hive
  function hiveLabel(h) {
    var text = "#" + h.number + "  " + (h.customer || "In my stock");
    if (h.address) text += "  -  " + h.address;
    return text;
  }
  function renderPick() {
    var list = $("hive-list");
    list.textContent = "";
    if (!pack) {
      list.appendChild(el("p", "No trip pack is loaded, so use 'A hive that isn't in the list' below, or load a pack first.", "notice"));
      return;
    }
    var q = $("hive-search").value.trim().toLowerCase();
    var f = $("hive-filter").value;
    var shown = pack.hives.filter(function (h) {
      if (q && hiveLabel(h).toLowerCase().indexOf(q) === -1) return false;
      if (f === "all") return true;
      if (f === "followup") return !!h.followup;
      return h.year_status === f;
    });
    if (!shown.length) list.appendChild(el("p", "Nothing here. Change 'Show' above to see other hives.", "notice"));
    shown.forEach(function (h) {
      var mark = h.followup ? "↻ " : h.year_status === "visited" ? "✔ " : h.year_status === "skip" ? "– " : "";
      var b = el("button", mark + hiveLabel(h) + (h.painted ? "" : "   (no number painted yet)") +
                 (h.followup ? "   (second visit: " + h.followup + ")" : ""));
      b.type = "button";
      b.addEventListener("click", function () { startVisit(h.number); });
      list.appendChild(b);
    });
  }

  // ------------------------------------------------------------ visit form
  var draft = null;
  var counter = { timer: null, left: 60 };

  function startVisit(number) {
    stopCount();
    draft = { hive_number: number, date: today(), weight: null, shanks: null, activity: null, insulation: false,
              winter: "none", condition: null, outcome: null, notes: "", painted: false,
              split_to: null, split_customer: null, leaving: "new", unusual: false, new_painted: false,
              followup: false, followup_note: "", weight_parent: null, weight_new: null };
    $("weight-parent").value = "";
    $("weight-new").value = "";
    $("followup-note").value = "";
    $("visit-date").value = draft.date;
    $("weight").value = "";
    $("notes").value = "";
    $("painted").checked = false;
    $("new-painted").checked = false;
    refreshAll();
    show("visit");
  }

  function renderVisit() {
    if (!draft) return;
    var hive = hiveByNumber(draft.hive_number);
    $("visit-title").textContent = "Hive #" + draft.hive_number;
    $("visit-where").textContent = hive ? ((hive.customer || "In my stock") + (hive.address ? "  -  " + hive.address : "")) : "Not in the trip pack";
    var last = hive && hive.last_note ? "Last note (" + (hive.last_visit || "earlier") + "): " + hive.last_note : "";
    $("visit-last").textContent = last;
    var unpainted = hive && !hive.painted;
    $("paint-box").hidden = !unpainted;
    $("paint-number").textContent = String(draft.hive_number);
    $("weight-out").textContent = draft.weight === null ? "not weighed" : draft.weight + " kg";
    $("act-out").textContent = draft.activity === null ? "not counted" : String(draft.activity);
    $("act-tap").disabled = !counter.timer;
    $("act-start").textContent = counter.timer ? ("Counting... " + counter.left + " s left") : "Start 60 second count";
    $("insulation").setAttribute("aria-pressed", String(draft.insulation));
    $("unusual").setAttribute("aria-pressed", String(draft.unusual));
    $("followup").setAttribute("aria-pressed", String(draft.followup));
    $("followup-note").hidden = !draft.followup;
    var isSplit = draft.outcome === "split";
    $("split-panel").hidden = !isSplit;
    $("weight-label").textContent = isSplit ? "Weight BEFORE splitting" : "Weight";
    if (isSplit) {
      var n = nextNumber();
      $("split-numbers").textContent = n === null
        ? "Load a trip pack so new boxes can be numbered correctly."
        : "The box you add gets #" + n + ". The original box keeps #" + draft.hive_number + ".";
      $("split-customer-box").hidden = !(draft.split_to === "sold" || draft.split_to === "replaced_dead");
      $("pw-label").textContent = "Original box #" + draft.hive_number;
      $("nw-label").textContent = "New box " + (n === null ? "" : "#" + n);
      $("new-painted-label").textContent = "I've painted " + (n === null ? "the number" : "#" + n) + " on the new box";
    }
  }

  function fillCustomerSelect() {
    var select = $("split-customer");
    select.textContent = "";
    var first = el("option", "Choose a customer..."); first.value = ""; select.appendChild(first);
    var owed = {};
    ((pack && pack.stops) || []).forEach(function (s) { if (s.kind === "replacement") owed[s.customer_id] = true; });
    var customers = (pack ? pack.customers : []).slice();
    if (draft && draft.split_to === "replaced_dead") {
      customers.sort(function (a, b) { return (owed[b.id] ? 1 : 0) - (owed[a.id] ? 1 : 0); });
    }
    customers.forEach(function (c) {
      var o = el("option", (owed[c.id] && draft.split_to === "replaced_dead" ? "(owed a replacement) " : "") + c.name +
                 (c.address ? "  -  " + c.address : ""));
      o.value = String(c.id);
      select.appendChild(o);
    });
    select.value = draft && draft.split_customer ? String(draft.split_customer) : "";
  }

  // 60 second activity count
  function stopCount() {
    if (counter.timer) { clearInterval(counter.timer); counter.timer = null; }
    counter.left = 60;
  }
  function startCount() {
    if (counter.timer) return;
    draft.activity = 0;
    counter.left = 60;
    counter.timer = setInterval(function () {
      counter.left -= 1;
      if (counter.left <= 0) { clearInterval(counter.timer); counter.timer = null; counter.left = 60; }
      renderVisit();
    }, 1000);
    renderVisit();
  }

  function saveVisit() {
    if (!draft) return;
    if (!draft.date) { say("Pick the date first.", "bad"); return; }
    var split = null;
    if (draft.outcome === "split" && draft.split_to) {
      if ((draft.split_to === "sold" || draft.split_to === "replaced_dead") && !draft.split_customer) {
        say("Choose the customer the new box goes to.", "bad");
        return;
      }
      if (nextNumber() === null) { say("Load a trip pack first so the new box gets a valid number.", "bad"); return; }
      if (draft.weight === null) { say("Weigh the hive before you split it and type that weight in first.", "bad"); return; }
      var cust = null;
      (pack.customers || []).forEach(function (c) { if (c.id === draft.split_customer) cust = c; });
      split = { goes_to: draft.split_to, customer_id: draft.split_customer, site_id: cust ? cust.site_id : null,
                box_leaving: draft.leaving, new_number: nextNumber(),
                new_old_box_position: draft.unusual ? "bottom" : "top", new_painted: draft.new_painted,
                weight_parent_kg: draft.weight_parent, weight_new_kg: draft.weight_new };
      usedMax = split.new_number;
      save(KEY_USED, usedMax);
    }
    var entry = { id: uid(), kind: "visit", created: new Date().toISOString(), pack_id: pack ? pack.pack_id : null,
                  hive_number: draft.hive_number, date: draft.date, weight_kg: draft.weight, shanks: draft.shanks,
                  activity: draft.activity, insulation: draft.insulation, winter: draft.winter,
                  condition: draft.condition, outcome: draft.outcome, notes: draft.notes.trim() || null,
                  painted: draft.painted };
    if (draft.followup && draft.outcome !== "dead") {
      entry.followup = true;
      entry.followup_note = draft.followup_note.trim() || null;
    }
    if (split) entry.split = split;
    entries.push(entry);
    if (!save(KEY_ENTRIES, entries)) { entries.pop(); return; }
    // keep the trip pack's "visited this year" marks up to date on the phone, so the list shrinks as you go
    var visited = hiveByNumber(draft.hive_number);
    if (visited && visited.status === "active") {
      visited.year_status = "visited";
      visited.followup = entry.followup ? (entry.followup_note || "Check on it") : null;
      save(KEY_PACK, pack);
    }
    stopCount();
    draft = null;
    say("Saved. " + unsent().length + " entries waiting to be sent.", "ok");
    show("home");
  }

  // ------------------------------------------------------------ delivery
  function renderDelivery() {
    var stops = (pack && pack.stops) || [];
    var stock = pack ? pack.hives.filter(function (h) { return h.status === "in_stock"; }) : [];
    var empty = !stops.length;
    $("delivery-empty").hidden = !empty;
    $("delivery-fields").hidden = empty;
    if (empty) return;
    var stopSel = $("stop-select"); stopSel.textContent = "";
    stops.forEach(function (s, i) {
      var text = (s.kind === "replacement" ? "Replacement: " : "New customer: ") + s.name +
                 (s.address ? "  -  " + s.address : "") + (s.kind === "replacement" && s.dead_hive ? "  (dead hive #" + s.dead_hive + ")" : "");
      var o = el("option", text); o.value = String(i); stopSel.appendChild(o);
    });
    $("stock-hint").textContent = stock.length
      ? "Hives in my stock: " + stock.map(function (h) { return "#" + h.number; }).join(", ")
      : "No hives are listed in my stock in this trip pack.";
    $("deliv-number").value = "";
    $("deliv-date").value = today();
    $("deliv-notes").value = "";
    $("deliv-painted").checked = false;
  }
  function saveDelivery() {
    var stops = (pack && pack.stops) || [];
    var stop = stops[parseInt($("stop-select").value, 10)];
    var number = parseInt($("deliv-number").value, 10);
    if (!stop || !number || number < 1) { say("Choose where, and type the number of the hive you dropped off.", "bad"); return; }
    var date = $("deliv-date").value;
    if (!date) { say("Pick the date first.", "bad"); return; }
    entries.push({ id: uid(), kind: "delivery", created: new Date().toISOString(), pack_id: pack.pack_id,
                   hive_number: number, date: date, notes: $("deliv-notes").value.trim() || null,
                   painted: $("deliv-painted").checked,
                   delivery: { stop_kind: stop.kind, stop_id: stop.id } });
    if (!save(KEY_ENTRIES, entries)) { entries.pop(); return; }
    say("Delivery saved.", "ok");
    show("home");
  }

  // ------------------------------------------------------------ saved entries
  var OUTCOMES = { split: "split", too_weak: "too weak", wait: "wait", replaced: "replaced", dead: "dead" };
  function describe(e) {
    var text = (e.kind === "delivery" ? "Delivery" : "Visit") + " - hive #" + e.hive_number + " - " + e.date;
    if (e.kind === "visit" && e.outcome) text += " - " + OUTCOMES[e.outcome];
    if (e.split) text += " - new box #" + e.split.new_number;
    return text;
  }
  function renderEntries() {
    var list = $("entry-list");
    list.textContent = "";
    $("entries-empty").hidden = entries.length > 0;
    entries.slice().reverse().forEach(function (e) {
      var item = el("div", undefined, "item");
      item.appendChild(el("div", describe(e)));
      item.appendChild(el("div", e.sentAt ? "Sent" : "Not sent yet", e.sentAt ? "sent" : "unsent"));
      if (!e.sentAt) {
        var del = el("button", "Delete", "small");
        del.type = "button";
        del.addEventListener("click", function () {
          if (window.confirm("Delete this entry?")) {
            entries = entries.filter(function (x) { return x.id !== e.id; });
            save(KEY_ENTRIES, entries);
            renderEntries();
          }
        });
        item.appendChild(del);
      }
      list.appendChild(item);
    });
  }

  // ------------------------------------------------------------ send to desktop
  function sendEntries() {
    var pending = unsent();
    if (!pending.length) { say("Nothing new to send.", ""); return; }
    if (relay) {
      var db = pack ? pack.database : "real";
      say("Sending...", "");
      ask("put_inbox", { entries: pending.map(function (e) { return Object.assign({}, e, { database: db }); }) })
        .then(function () {
          var now = new Date().toISOString();
          pending.forEach(function (e) { e.sentAt = now; });
          save(KEY_ENTRIES, entries);
          renderHome(); renderEntries();
          say("Sent " + pending.length + (pending.length === 1 ? " entry" : " entries") + " to your computer. On the computer, press Fetch visits from my phone.", "ok");
        }).catch(function (err) { say(err.message + " (The entries are still saved on this phone.)", "bad"); });
      return;
    }
    var name = "bee-entries-" + stamp() + ".json";
    var text = JSON.stringify({ format: 1, database: pack ? pack.database : "real", created: new Date().toISOString(),
                                entries: pending }, null, 1);
    function markSent() {
      var now = new Date().toISOString();
      pending.forEach(function (e) { e.sentAt = now; });
      save(KEY_ENTRIES, entries);
      renderHome();
      renderEntries();
    }
    function download() {
      var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      markSent();
      say("Saved the file " + name + ". Move it into iCloud Drive > BeeTracker > Inbox if it isn't there.", "ok");
    }
    var file;
    try { file = new File([text], name, { type: "application/json" }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Bee entries" }).then(function () {
        markSent();
        say("Sent " + pending.length + " entries. Make sure you chose iCloud Drive > BeeTracker > Inbox.", "ok");
      }).catch(function (err) {
        if (err && err.name === "AbortError") { say("Cancelled. Nothing was marked as sent.", ""); } else { download(); }
      });
    } else {
      download();
    }
  }

  // ------------------------------------------------------------ wire everything up
  function init() {
    $("btn-new-visit").addEventListener("click", function () { show("pick"); });
    $("btn-new-delivery").addEventListener("click", function () { show("delivery"); });
    $("btn-entries").addEventListener("click", function () { show("entries"); });
    $("btn-send").addEventListener("click", sendEntries);
    $("btn-send-2").addEventListener("click", sendEntries);
    $("btn-load-pack").addEventListener("click", function () { $("pack-file").click(); });
    $("btn-get-pack").addEventListener("click", getPack);
    $("btn-link").addEventListener("click", function () {
      var link = parseLink($("link-input").value);
      if (!link) { say("That doesn't look like the setup link. Copy the whole link from the Phone link screen.", "bad"); return; }
      if (setRelay(link)) { $("link-input").value = ""; say("Linked. Now tap Get trip pack.", "ok"); }
    });
    function adoptLinkFromAddress() {                    // opening the setup link in Safari also works
      var fromHash = parseLink(window.location.href);
      if (!fromHash) return;
      setRelay(fromHash);
      try { history.replaceState(null, "", window.location.pathname); } catch (e) { /* not important */ }
      say("Linked. Now tap Get trip pack.", "ok");
    }
    adoptLinkFromAddress();
    window.addEventListener("hashchange", adoptLinkFromAddress);
    $("pack-file").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { loadPackText(String(reader.result)); };
      reader.onerror = function () { say("Could not read that file.", "bad"); };
      reader.readAsText(f);
      ev.target.value = "";
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (b) {
      b.addEventListener("click", function () { stopCount(); say("", ""); show(b.getAttribute("data-go")); });
    });
    $("hive-search").addEventListener("input", renderPick);
    $("btn-other-number").addEventListener("click", function () { $("other-number-box").hidden = false; });
    $("btn-use-number").addEventListener("click", function () {
      var n = parseInt($("other-number").value, 10);
      if (!n || n < 1) { say("Enter the hive number.", "bad"); return; }
      startVisit(n);
    });
    $("visit-date").addEventListener("input", function (e) { draft.date = e.target.value; });
    $("weight").addEventListener("input", function (e) {
        var w = parseFloat(e.target.value);
        draft.weight = (isNaN(w) || w < 0) ? null : w;
        renderVisit();
    });
    $("weight-clear").addEventListener("click", function () { draft.weight = null; $("weight").value = ""; renderVisit(); });
    $("act-start").addEventListener("click", startCount);
    $("act-tap").addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (counter.timer) { draft.activity += 1; renderVisit(); }
    });
    $("act-minus").addEventListener("click", function () { if (draft.activity) { draft.activity -= 1; renderVisit(); } });
    $("act-reset").addEventListener("click", function () { stopCount(); draft.activity = null; renderVisit(); });
    $("insulation").addEventListener("click", function () { draft.insulation = !draft.insulation; renderVisit(); });
    $("unusual").addEventListener("click", function () { draft.unusual = !draft.unusual; renderVisit(); });
    $("weight-parent").addEventListener("input", function (e) {
      var w = parseFloat(e.target.value); draft.weight_parent = (isNaN(w) || w < 0) ? null : w; });
    $("weight-new").addEventListener("input", function (e) {
      var w = parseFloat(e.target.value); draft.weight_new = (isNaN(w) || w < 0) ? null : w; });
    $("followup").addEventListener("click", function () { draft.followup = !draft.followup; renderVisit(); });
    $("followup-note").addEventListener("input", function (e) { draft.followup_note = e.target.value; });
    $("hive-filter").addEventListener("change", renderPick);
    $("painted").addEventListener("change", function (e) { draft.painted = e.target.checked; });
    $("new-painted").addEventListener("change", function (e) { draft.new_painted = e.target.checked; });
    $("notes").addEventListener("input", function (e) { draft.notes = e.target.value; });
    $("split-customer").addEventListener("change", function (e) { draft.split_customer = e.target.value ? parseInt(e.target.value, 10) : null; });
    $("save-visit").addEventListener("click", saveVisit);
    $("save-delivery").addEventListener("click", saveDelivery);

    $("btn-clear-sent").addEventListener("click", function () {
      entries = entries.filter(function (e) { return !e.sentAt; });
      save(KEY_ENTRIES, entries);
      renderEntries();
      renderHome();
    });

    var shanks = [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]];
    makeSeg("seg-shanks", shanks, function () { return draft ? draft.shanks : null; }, function (v) { draft.shanks = v; }, true);
    makeSeg("seg-winter", [["none", "None"], ["check", "Check"], ["feed", "Feed"]],
            function () { return draft ? draft.winter : "none"; }, function (v) { draft.winter = v || "none"; }, false);
    makeSeg("seg-condition", [["weak", "Weak"], ["ok", "OK"], ["strong", "Strong"]],
            function () { return draft ? draft.condition : null; }, function (v) { draft.condition = v; }, true);
    makeSeg("seg-outcome", [["split", "Split"], ["too_weak", "Too weak"], ["wait", "Wait"], ["replaced", "Replaced"], ["dead", "Dead"]],
            function () { return draft ? draft.outcome : null; }, function (v) { draft.outcome = v; if (v !== "split") { draft.split_to = null; } }, true);
    makeSeg("seg-split-to", [["sold", "Sold to a customer"], ["replaced_dead", "Replaces a dead hive"], ["kept_in_stock", "Keep in my stock"]],
            function () { return draft ? draft.split_to : null; },
            function (v) { draft.split_to = v; fillCustomerSelect(); }, true);
    makeSeg("seg-leaving", [["new", function () { return "The new box (#" + (nextNumber() || "?") + ")"; }],
                            ["parent", function () { return "The original box (#" + (draft ? draft.hive_number : "?") + ")"; }]],
            function () { return draft ? draft.leaving : "new"; }, function (v) { draft.leaving = v || "new"; }, false);

    if ("serviceWorker" in navigator) { navigator.serviceWorker.register("sw.js").catch(function () {}); }
    show("home");
  }
  init();
})();
