// Availability form. The link carries the date range (?from=2026-12-02&to=2026-12-20).
// The answer goes only to the owner's own Google Sheet; the page contains no customer data.
(function () {
  "use strict";
  var FIRST_HOUR = 7, LAST_HOUR = 19;           // slots 7-8am ... 7-8pm
  var MAX_DAYS = 62;
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function $(id) { return document.getElementById(id); }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function say(text, kind) {
    var m = $("message");
    m.hidden = !text;
    m.textContent = text || "";
    m.className = "message" + (kind ? " " + kind : "");
    if (text) window.scrollTo(0, 0);
  }

  function parseDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function niceDate(d) { return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }
  function hourLabel(h) {
    var a = h % 12 === 0 ? 12 : h % 12;
    return a + (h < 12 ? "am" : "pm");
  }

  var query = new URLSearchParams(window.location.search);
  var from = parseDate(query.get("from")), to = parseDate(query.get("to"));
  var days = [];                 // ["2026-12-02", ...]
  var chosen = {};               // {"2026-12-02": {7: true, 8: true}}
  var notHere = false;
  var sending = false;

  if (from && to && from <= to) {
    for (var d = new Date(from); d <= to && days.length <= MAX_DAYS; d = new Date(d.getTime() + 86400000)) {
      days.push(iso(d));
    }
  }

  function countHours(day) { return Object.keys(chosen[day] || {}).length; }
  function allHours() { return LAST_HOUR - FIRST_HOUR + 1; }

  function draw() {
    var box = $("days");
    box.textContent = "";
    days.forEach(function (day) {
      var card = el("div", undefined, "day");
      card.appendChild(el("h3", niceDate(parseDate(day))));
      var whole = el("button", "Whole day (7am to 8pm)", "whole");
      whole.type = "button";
      whole.setAttribute("aria-pressed", String(countHours(day) === allHours()));
      whole.addEventListener("click", function () {
        if (countHours(day) === allHours()) { delete chosen[day]; }
        else { chosen[day] = {}; for (var h = FIRST_HOUR; h <= LAST_HOUR; h++) chosen[day][h] = true; }
        draw();
      });
      card.appendChild(whole);
      var grid = el("div", undefined, "hours");
      for (var h = FIRST_HOUR; h <= LAST_HOUR; h++) {
        (function (hour) {
          var b = el("button", hourLabel(hour));
          b.type = "button";
          b.title = hourLabel(hour) + " to " + hourLabel(hour + 1);
          b.setAttribute("aria-pressed", String(!!(chosen[day] && chosen[day][hour])));
          b.addEventListener("click", function () {
            chosen[day] = chosen[day] || {};
            if (chosen[day][hour]) delete chosen[day][hour]; else chosen[day][hour] = true;
            if (!countHours(day)) delete chosen[day];
            draw();
          });
          grid.appendChild(b);
        })(h);
      }
      card.appendChild(grid);
      box.appendChild(card);
    });
    $("not-here").setAttribute("aria-pressed", String(notHere));
    $("days-box").className = notHere ? "faded" : "";
  }

  function payload() {
    var slots = {};
    days.forEach(function (day) {
      var hours = Object.keys(chosen[day] || {}).map(Number).sort(function (a, b) { return a - b; });
      if (hours.length) slots[day] = hours;
    });
    return { v: 1, phone: $("phone").value.trim(), name: $("name").value.trim(), not_here: notHere,
             slots: notHere ? {} : slots, note: $("note").value.trim(), from: days[0], to: days[days.length - 1] };
  }

  function send() {
    if (sending) return;
    var p = payload();
    var digits = p.phone.replace(/\D/g, "");
    if (digits.length < 8) { say("Please type your mobile number so I know who you are.", "bad"); return; }
    if (!p.name) { say("Please type your name.", "bad"); return; }
    if (!p.not_here && !Object.keys(p.slots).length) {
      say("Please tap the times you'll be home, or choose \"You can visit when I'm not here\".", "bad");
      return;
    }
    var url = window.SURVEY_SCRIPT_URL;
    if (!url) { say("This form isn't connected to its sheet yet.", "bad"); return; }
    sending = true;
    $("send").disabled = true;
    $("send").textContent = "Sending...";
    // Google's script answers from another address, so the reply can't be read: a completed request is the best sign we get.
    fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
                 body: JSON.stringify(p) }).then(function () {
      var days_n = Object.keys(p.slots).length;
      $("done-text").textContent = p.not_here
        ? "You said I can visit when you're not home. I'll be in touch to let you know the day."
        : "Got it: " + days_n + (days_n === 1 ? " day" : " days") + " with times that suit you. I'll be in touch to confirm.";
      $("view-form").hidden = true;
      $("view-done").hidden = false;
      say("");
      window.scrollTo(0, 0);
    }).catch(function () {
      sending = false;
      $("send").disabled = false;
      $("send").textContent = "Send my answer";
      say("That didn't send. Please check your signal and try again.", "bad");
    });
  }

  function init() {
    if (days.length < 1 || days.length > MAX_DAYS) {
      $("view-form").hidden = true;
      $("view-bad").hidden = false;
      return;
    }
    $("range-text").textContent = "I'm planning to visit between " + niceDate(parseDate(days[0])) + " and " +
      niceDate(parseDate(days[days.length - 1])) + ".";
    $("not-here").addEventListener("click", function () { notHere = !notHere; draw(); });
    $("send").addEventListener("click", send);
    draw();
  }
  init();
})();
