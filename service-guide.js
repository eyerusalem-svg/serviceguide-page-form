<!-- OTP SERVICE MODULE — thin client for the "GoodayOn - OTP Public Proxy"
     n8n workflow. Loaded before the page script so window.OTPService is
     ready when the wizard initializes. -->
<script>
  (function () {
    "use strict";

    var OTP_API_BASE = "https://goodayon.app.n8n.cloud/webhook";

    // Verifies the customer's own phone before their Service Guide request is
    // submitted. Distinct purpose string from every other page so they don't
    // share rate-limit/cooldown state for the same number, per the workflow's
    // own contract ("pass a distinct purpose per flow").
    var OTP_PURPOSE = "service_guide_service_request";

    // Calls the "GoodayOn - OTP Public Proxy" n8n workflow, not the Etalem OTP
    // webhooks directly - the proxy forwards to Etalem server-side, attaching
    // X-OTP-Key from n8n's own credential store so the key is never shipped here.
    function otpRequest(path, body) {
      return fetch(OTP_API_BASE + "/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            return { ok: response.ok, status: response.status, data: data };
          });
      });
    }

    function sendOtp(phone) {
      return otpRequest("goodayon-provider-otp-send", {
        phone: phone,
        purpose: OTP_PURPOSE,
      });
    }

    function verifyOtp(phone, code) {
      return otpRequest("goodayon-provider-otp-verify", {
        phone: phone,
        code: code,
        purpose: OTP_PURPOSE,
      });
    }

    function formatWait(seconds) {
      seconds = Math.max(0, Math.round(seconds || 0));
      if (seconds < 60) return seconds + "s";
      var m = Math.floor(seconds / 60),
        s = seconds % 60;
      return m + "m" + (s ? " " + s + "s" : "");
    }

    // res is { ok, status, data } from otpRequest, or undefined/null on a
    // shape we didn't expect. data.reason follows the workflow's documented
    // values; a 403 with no JSON body (bad/missing key) falls to the default.
    function describeSendError(res) {
      var data = (res && res.data) || {};
      switch (data.reason) {
        case "invalid_phone":
          return "Enter a valid Ethiopian mobile number.";
        case "cooldown":
          return "Please wait " + formatWait(data.retryAfterSeconds) + " before requesting another code.";
        case "too_many_requests":
          return "Too many code requests. Try again in " + formatWait(data.retryAfterSeconds) + ".";
        case "locked_out":
          return "Too many incorrect attempts. Try again in " + formatWait(data.retryAfterSeconds) + ".";
        case "delivery_failed":
          return "We couldn't deliver the code right now. Please try again shortly.";
        default:
          if (res && res.status === 403) return "We couldn't verify this request. Please refresh the page and try again.";
          return "Something went wrong sending the code. Please try again.";
      }
    }

    function describeVerifyError(res) {
      var data = (res && res.data) || {};
      switch (data.reason) {
        case "no_active_code":
          return "This code has expired or wasn't found. Request a new one.";
        case "expired":
          return "This code has expired. Request a new one.";
        case "incorrect_code":
          var left = data.attemptsRemaining;
          return "Incorrect code." + (left !== undefined ? " " + left + " attempt" + (left === 1 ? "" : "s") + " left." : "");
        case "too_many_attempts":
          return "Too many incorrect attempts for this code. Request a new one.";
        case "already_used":
          return "This code was already used. Request a new one.";
        case "locked_out":
          return "Too many incorrect attempts. Try again in " + formatWait(data.retryAfterSeconds) + ".";
        case "invalid_phone":
          return "Something went wrong with your phone number. Please go back and re-enter it.";
        case "invalid_code_format":
          return "Enter the 6-digit code.";
        default:
          if (res && res.status === 403) return "We couldn't verify this request. Please refresh the page and try again.";
          return "Something went wrong verifying the code. Please try again.";
      }
    }

    window.OTPService = {
      sendOtp: sendOtp,
      verifyOtp: verifyOtp,
      describeSendError: describeSendError,
      describeVerifyError: describeVerifyError,
    };
  })();
</script>

<script>
  /* ============================================================
   PAGE INTERACTIONS
   - Single smooth-scroll controller for on-page anchor links
     (skips #request, which now opens the journey wizard)
   - FAQ accordion
   - Etalem journey wizard (service request modal)
   ============================================================ */

  (() => {
    let scrollAnimationFrame = null;

    const getScrollOffset = () => {
      const nav = document.getElementById("siteNav");
      return nav ? nav.getBoundingClientRect().height : 0;
    };

    const easeInOutCubic = (progress) => {
      return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    };

    const stopSmoothScroll = () => {
      if (scrollAnimationFrame !== null) {
        cancelAnimationFrame(scrollAnimationFrame);
        scrollAnimationFrame = null;
      }
    };

    const smoothScrollTo = (target) => {
      if (!target) return;
      stopSmoothScroll();
      const startY = window.scrollY;
      const targetRect = target.getBoundingClientRect();
      const offset = getScrollOffset();
      const targetY = Math.max(0, targetRect.top + startY - offset);
      const distance = targetY - startY;

      if (Math.abs(distance) < 2) {
        window.scrollTo(0, targetY);
        return;
      }

      const duration = Math.min(850, Math.max(450, Math.abs(distance) * 0.45));
      const startTime = performance.now();

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(progress);
        window.scrollTo(0, startY + distance * easedProgress);
        if (progress < 1) {
          scrollAnimationFrame = requestAnimationFrame(animate);
        } else {
          scrollAnimationFrame = null;
          window.scrollTo(0, targetY);
        }
      };

      scrollAnimationFrame = requestAnimationFrame(animate);
    };

    // Capture the click before any built-in browser anchor scrolling applies.
    // Links to "#request" are excluded — they open the journey wizard modal
    // instead of scrolling, and that's handled by the wizard script below.
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        const href = link.getAttribute("href");
        if (!href || href === "#" || href === "#request") return;
        const target = document.getElementById(href.slice(1));
        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        smoothScrollTo(target);
        history.pushState(null, "", href);
      },
      true,
    );

    window.addEventListener("wheel", stopSmoothScroll, { passive: true });
    window.addEventListener("touchstart", stopSmoothScroll, { passive: true });
    window.addEventListener("keydown", (event) => {
      const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
      if (scrollKeys.includes(event.key)) stopSmoothScroll();
    });

    window.addEventListener("popstate", () => {
      const id = window.location.hash.slice(1);
      if (!id || id === "request") return;
      const target = document.getElementById(id);
      if (target) smoothScrollTo(target);
    });
  })();

  function toggleAccordion(index) {
    const content = document.getElementById(`faq-${index}`);
    if (!content) return;
    const isActive = content.classList.contains("active");
    document.querySelectorAll(".accordion-content").forEach((el) => el.classList.remove("active"));
    if (!isActive) content.classList.add("active");
  }

    /* ---------------- Etalem journey wizard ---------------- */
  (function () {
    var WEBHOOK_URL = "https://goodayon.app.n8n.cloud/webhook/etalem-service-request";
    var $ = function (id) { return document.getElementById(id); };
    var qa = function (s) { return document.querySelectorAll(s); };

    /* ---- Character counters ---- */
    function bindCharCounter(tid, cid) {
      var f = $(tid), c = $(cid);
      if (!f || !c) return;
      var max = parseInt(f.getAttribute("maxlength"), 10) || 500;
      f.addEventListener("input", function () {
        c.textContent = f.value.length + "/" + max + " characters used";
      });
    }
    var taskField = $("etlTask"), charCount = $("etlCharCount");
    var maxLength = (taskField && parseInt(taskField.getAttribute("maxlength"), 10)) || 500;
    bindCharCounter("etlTask", "etlCharCount");
    bindCharCounter("etlCateringMenu", "etlCateringMenuCount");
    bindCharCounter("etlPreferences", "etlPreferencesCount");

    var modal = $("request");
    if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
    var form = $("etlRequestForm"), formWrap = $("etlFormWrap"),
      formSuccess = $("etlFormSuccess"), formError = $("etlFormError");

    /* ---- Service copy ---- */
    var SERVICE_META = {
      cooking: { label: "Cooking", description: "Just a few quick questions about your cooking needs — it takes less than a minute.", branchTitle: "Tell us about your cooking needs." },
      cleaning: { label: "Cleaning", description: "Just a few quick questions about your cleaning needs — it takes less than a minute.", branchTitle: "Tell us about your cleaning needs." },
      nanny: { label: "Babysitting", description: "Just a few quick questions about your child's needs — it takes less than a minute.", branchTitle: "Tell us about your little one(s)." },
      catering: { label: "Catering", description: "Just a couple of quick questions about your event — it takes less than a minute.", branchTitle: "" },
    };
    var branchSections = {
      cooking: $("etlCookingSection"),
      cleaning: $("etlCleaningSection"),
      nanny: $("etlBabysittingSection"),
    };
    var branchTitleEl = $("etlBranchTitle"), transitionPillEl = $("etlTransitionPill"), transitionTextEl = $("etlTransitionText");

    function getSelectedService() {
      var c = document.querySelector('input[name="service"]:checked');
      return c ? c.value : "";
    }
    function checkedValues(name) {
      return Array.prototype.map.call(qa('input[name="' + name + '"]:checked'), function (el) { return el.value; });
    }
    function checkedValue(name) {
      var el = document.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : "";
    }
    function numOrUndef(id) {
      var v = $(id).value;
      return v === "" ? undefined : Number(v);
    }

    /* ---- Cleaning-only frequency option + disabled half-day slots ---- */
    function updateCleaningFrequencyUI() {
      var svc = getSelectedService(), isCleaning = svc === "cleaning";
      var deep = document.querySelector('input[name="weeklyFrequency"][value="Deep Cleaning (One-Time)"]');
      var once = document.querySelector('input[name="weeklyFrequency"][value="Task-based(Once)"]');
      var deepCard = deep && deep.closest(".etlw-option-card"), onceCard = once && once.closest(".etlw-option-card");
      if (deepCard) deepCard.style.display = isCleaning ? "" : "none";
      if (onceCard) onceCard.style.display = "";
      if (!isCleaning && deep) deep.checked = false;
      var f = checkedValue("weeklyFrequency");
      var oneTime = f === "Task-based(Once)" || f === "Deep Cleaning (One-Time)";
      var low = f === "1 Day/Week" || f === "2 Days/Week" || f === "3 Days/Week";
      var off = ((svc === "cleaning" || svc === "cooking") && (oneTime || low)) || (svc === "nanny" && low);
      ["Half Day - Morning", "Half Day - Afternoon"].forEach(function (v) {
        var o = document.querySelector('input[name="dailyServiceDuration"][value="' + v + '"]');
        if (!o) return;
        var card = o.closest(".etlw-option-card");
        o.disabled = off;
        if (card) {
          card.style.opacity = off ? "0.45" : "";
          card.style.cursor = off ? "not-allowed" : "";
        }
        if (off && o.checked) o.checked = false;
      });
    }
    qa('input[name="weeklyFrequency"]').forEach(function (i) {
      i.addEventListener("change", updateCleaningFrequencyUI);
    });

    function clearSectionFields(el) {
      if (!el) return;
      el.querySelectorAll("input, select, textarea").forEach(function (x) {
        if (x.type === "checkbox" || x.type === "radio") x.checked = false;
        else x.value = "";
      });
    }
    function updateApartmentVisibility(name, groupEl, selectEl) {
      var c = document.querySelector('input[name="' + name + '"]:checked');
      var isApt = c && String(c.value).toLowerCase() === "apartment";
      if (groupEl) groupEl.style.display = isApt ? "" : "none";
      if (selectEl) {
        selectEl.required = !!isApt;
        if (!isApt) selectEl.value = "";
      }
    }
    var apartmentSizeGroup = $("etlApartmentSizeGroup"), apartmentSizeSelect = $("etlApartmentSize");
    document.addEventListener("change", function (e) {
      if (e.target.matches('input[name="houseType"]')) updateApartmentVisibility("houseType", apartmentSizeGroup, apartmentSizeSelect);
    });

    /* ---- Everything that depends on the chosen service ---- */
    function updateServiceDependentUI() {
      var selected = getSelectedService(), meta = SERVICE_META[selected];
      Object.keys(branchSections).forEach(function (k) {
        var el = branchSections[k];
        if (!el) return;
        if (k === selected) el.style.display = "";
        else { el.style.display = "none"; clearSectionFields(el); }
      });
      updateApartmentVisibility("houseType", apartmentSizeGroup, apartmentSizeSelect);
      updateCleaningFrequencyUI();
      if (transitionPillEl) transitionPillEl.textContent = meta ? meta.label + " selected" : "";
      if (transitionTextEl) transitionTextEl.textContent = meta ? meta.description : "";
      if (branchTitleEl) branchTitleEl.textContent = meta ? meta.branchTitle : "";
      var isCatering = selected === "catering";
      if (isCatering) updateCateringDateLimits();
      applyCateringWording(isCatering);
      applyPreferencesCopy(selected);
    }
    qa('input[name="service"]').forEach(function (r) {
      r.addEventListener("change", updateServiceDependentUI);
    });

    /* ---- Preferred date / weekdays ---- */
    var MIN_LEAD_DAYS = 3;
    var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var serviceDateInput = $("etlServiceDate"), weekendDatesNote = $("etlWeekendDatesNote"), weekendDatesText = $("etlWeekendDatesText");
    var preferredDaysLabel = $("etlPreferredDaysLabel"), preferredWeekdaysGroupWrap = $("etlPreferredWeekdaysGroupWrap"), preferredWeekdaysCountText = $("etlPreferredWeekdaysCountText");

    function requiredWeekdayCount(v) {
      var m = /^(\d) Days?\/Week$/.exec(v || "");
      return m ? parseInt(m[1], 10) : null;
    }
    function addDays(date, n) { var d = new Date(date); d.setDate(d.getDate() + n); return d; }
    function toDateInputValue(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    function parseDateInputValue(v) { var p = v.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
    function formatDateLabel(d) {
      return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    function minSelectableDate() { return addDays(new Date(), MIN_LEAD_DAYS); }
    function firstSaturdayOnOrAfter(from) {
      var d = new Date(from);
      while (d.getDay() !== 6) d = addDays(d, 1);
      return d;
    }
    function isPreferredDateValid() {
      if (!serviceDateInput || !serviceDateInput.value) return false;
      if (checkedValue("weeklyFrequency") === "Weekend") return parseDateInputValue(serviceDateInput.value).getDay() === 6 && serviceDateInput.value >= serviceDateInput.min;
      return serviceDateInput.value >= toDateInputValue(minSelectableDate());
    }
    function isPreferredScheduleValid() {
      if (!isPreferredDateValid()) return false;
      var r = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      return r === null ? true : checkedValues("preferredWeekday").length === r;
    }
    function updateWeekendConfirmation() {
      if (!weekendDatesNote) return;
      var isWeekend = checkedValue("weeklyFrequency") === "Weekend";
      if (!isWeekend || !serviceDateInput || !serviceDateInput.value) { weekendDatesNote.style.display = "none"; return; }
      var sat = parseDateInputValue(serviceDateInput.value);
      weekendDatesNote.style.display = "flex";
      if (weekendDatesText) weekendDatesText.textContent = formatDateLabel(sat) + " – " + formatDateLabel(addDays(sat, 1));
    }
    function updatePreferredDaysUI() {
      var isWeekend = checkedValue("weeklyFrequency") === "Weekend";
      if (serviceDateInput) {
        if (isWeekend) {
          serviceDateInput.min = toDateInputValue(firstSaturdayOnOrAfter(minSelectableDate()));
          serviceDateInput.step = 7;
          if (serviceDateInput.value && !isPreferredDateValid()) serviceDateInput.value = "";
        } else {
          serviceDateInput.removeAttribute("step");
          serviceDateInput.min = toDateInputValue(minSelectableDate());
          if (serviceDateInput.value && serviceDateInput.value < serviceDateInput.min) serviceDateInput.value = "";
        }
      }
      if (preferredDaysLabel) preferredDaysLabel.textContent = isWeekend ? "Preferred weekend (pick a Saturday)" : "Preferred service date";
      updateWeekendConfirmation();
      var n = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      if (preferredWeekdaysGroupWrap) preferredWeekdaysGroupWrap.style.display = n !== null ? "" : "none";
      qa('input[name="preferredWeekday"]').forEach(function (b) { b.checked = false; });
      enforcePreferredWeekdayLimit();
      updateContinueState(stepEls[currentStep]);
    }
    function enforcePreferredWeekdayLimit() {
      var req = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      var count = qa('input[name="preferredWeekday"]:checked').length;
      qa('input[name="preferredWeekday"]').forEach(function (b) {
        if (!b.checked) b.disabled = req !== null && count >= req;
      });
      if (preferredWeekdaysCountText) preferredWeekdaysCountText.textContent = req !== null ? count + " of " + req + " selected" : "";
      updateContinueState(stepEls[currentStep]);
    }
    qa('input[name="preferredWeekday"]').forEach(function (b) {
      b.addEventListener("change", enforcePreferredWeekdayLimit);
    });
    if (serviceDateInput) {
      serviceDateInput.addEventListener("change", function () {
        updateWeekendConfirmation();
        if (serviceDateInput.value && !isPreferredDateValid()) {
          showFormError(checkedValue("weeklyFrequency") === "Weekend" ? "Weekend service is only available on Saturdays - please pick a Saturday." : "Please select a valid service date.", serviceDateInput);
        } else hideFormError();
      });
    }
    qa('input[name="weeklyFrequency"]').forEach(function (r) {
      r.addEventListener("change", updatePreferredDaysUI);
    });

    function buildWorkDays() {
      var dur = checkedValue("dailyServiceDuration") || "Full Day", freq = checkedValue("weeklyFrequency");
      if (freq === "Weekend") return ["Saturday " + dur, "Sunday " + dur];
      if (requiredWeekdayCount(freq) !== null) {
        return checkedValues("preferredWeekday").slice()
          .sort(function (a, b) { return WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b); })
          .map(function (d) { return d + " " + dur; });
      }
      if (serviceDateInput && serviceDateInput.value) return [WEEKDAY_NAMES[parseDateInputValue(serviceDateInput.value).getDay()] + " " + dur];
      return [];
    }
    function buildPreferredServiceDateLabel() {
      if (!serviceDateInput || !serviceDateInput.value) return "";
      var p = parseDateInputValue(serviceDateInput.value);
      return checkedValue("weeklyFrequency") === "Weekend" ? formatDateLabel(p) + " – " + formatDateLabel(addDays(p, 1)) : formatDateLabel(p);
    }

    /* ---- Number steppers ---- */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".etlw-stepper-btn");
      if (!btn) return;
      var t = $(btn.getAttribute("data-step-target"));
      if (!t) return;
      var min = parseInt(t.getAttribute("min"), 10) || 1;
      var next = (parseInt(t.value, 10) || min) + (parseInt(btn.getAttribute("data-step-dir"), 10) || 0);
      t.value = next < min ? min : next;
    });

    /* ===== CATERING HELPERS (steps 12-19) ===== */
    var CATERING_MAX_LEAD_DAYS = 7;
    var cateringDateInput = $("etlCateringDate");
    function updateCateringDateLimits() {
      var now = new Date();
      cateringDateInput.min = toDateInputValue(now);
      cateringDateInput.max = toDateInputValue(addDays(now, CATERING_MAX_LEAD_DAYS));
    }
    function prepareCateringSessionStep() {
      var period = checkedValue("dayPeriod");
      $("etlCateringSessionTitle").textContent = "Which " + period.toLowerCase() + " session do you need?";
      qa("#etlCateringSessionList .etlw-option-card[data-period]").forEach(function (card) {
        var show = card.getAttribute("data-period") === period;
        card.hidden = !show;
        if (!show) card.querySelector("input").checked = false;
      });
    }
    qa('input[name="dayPeriod"]').forEach(function (r) {
      r.addEventListener("change", function () {
        qa('input[name="sessionType"]').forEach(function (o) { o.checked = false; });
      });
    });
    function applyCateringWording(isCatering) {
      $("etlLocationTitle").textContent = isCatering ? "Where is the event?" : "Where in Addis do you live?";
      if (taskField) taskField.placeholder = isCatering ? "Venue access, serving equipment, allergies, dates for a multi-day event, or any special requests..." : "Allergies, pets, access instructions, or any special requests...";
    }
    function bad(msg, el) { showFormError(msg, el); return false; }
    function validateCateringStep(step) {
      if (step === 12) {
        if (!cateringDateInput.value) return bad("Please pick a date.", cateringDateInput);
        if (cateringDateInput.value < cateringDateInput.min || cateringDateInput.value > cateringDateInput.max) return bad("Please pick a date within the next 7 days.", cateringDateInput);
      }
      if (step === 13 && !radioGroupChecked("dayPeriod")) return bad("Please choose the suitable time for your catering service.", $("etlCateringPeriodList"));
      if (step === 14 && !radioGroupChecked("sessionType")) return bad("Please choose one session.", $("etlCateringSessionList"));
      if (step === 15 && !(parseInt($("etlCateringGuests").value, 10) >= 1)) return bad("Enter at least 1 person.", $("etlCateringGuests"));
      if (step === 16 && !checkboxGroupChecked("cateringMenuSelection")) return bad("Please select at least one option.", $("etlCateringIncludesGroup"));
      if (step === 17 && !checkboxGroupChecked("cuisineType")) return bad("Please select at least one menu type.", $("etlCateringMenuTypeGroup"));
      if (step === 18 && !$("etlCateringMenu").value.trim()) return bad("Please tell us what you have in mind for the menu.", $("etlCateringMenu"));
      if (step === 19 && !(parseFloat($("etlCateringBudget").value) > 0)) return bad("Enter a budget per person greater than 0.", $("etlCateringBudget"));
      return true;
    }
    function addCateringFields(p) {
      var period = checkedValue("dayPeriod");
      delete p.weeklyFrequency;
      delete p.dailyServiceDuration;
      delete p.preferredDays;
      delete p.preferredServiceDate;
      p.serviceDate = cateringDateInput.value;
      p.sessionPeriod = period;
      p.sessionType = [period === "Full Day" ? "Full Day" : checkedValue("sessionType")];
      p.numberOfPeople = Number($("etlCateringGuests").value);
      p.cateringMenuSelection = checkedValues("cateringMenuSelection");
      p.cuisineType = checkedValues("cuisineType");
      p.employerBudget = Number($("etlCateringBudget").value);
      p.notes = p.taskDetails;
      p.taskDetails = $("etlCateringMenu").value.trim();
    }

    /* ===== PREFERENCES HELPERS (step 20) ===== */
    var PREFERENCES_META = {
      cooking: { title: "What are 3–5 dishes you'd love your Etalem cook to be great at?", placeholder: "e.g. Doro Wat, Shiro, Pasta with Red Sauce, Pancakes, Grilled Chicken" },
      cleaning: { title: "What should your Etalem cleaner focus on, and is there anything they should avoid or know about?", placeholder: "e.g. deep clean the kitchen and bathrooms, do laundry and ironing, avoid strong-smelling products, we have pets" },
      nanny: { title: "What should your Etalem nanny help with day-to-day?", placeholder: "e.g. diaper changing, meal prep, homework help, nap schedule, no screen time before dinner" },
    };
    function applyPreferencesCopy(service) {
      var meta = PREFERENCES_META[service], f = $("etlPreferences");
      f.value = "";
      $("etlPreferencesCount").textContent = "0/" + (parseInt(f.getAttribute("maxlength"), 10) || 500) + " characters used";
      if (!meta) return;
      $("etlPreferencesTitle").textContent = meta.title;
      f.placeholder = meta.placeholder;
    }

    /* ---- OTP step UI ---- */
    var otpInputs = Array.prototype.slice.call(qa(".etlw-otp-input"));
    var otpSubtitle = $("etlOtpSubtitle"), otpResendBtn = $("etlOtpResendBtn"), otpCountdownEl = $("etlOtpCountdown"), otpCountdownTimer = null;

    function maskPhoneDisplay() {
      var d = $("etlPhone").value.replace(/\D/g, "");
      return d.length < 9 ? "+251 9** *** ***" : "+251 " + d.charAt(0) + "** *** " + d.slice(6, 9);
    }
    function updateOtpSubtitle() {
      if (otpSubtitle) otpSubtitle.textContent = "We sent a 6-digit code to " + maskPhoneDisplay() + ".";
    }
    function resetOtpInputs() {
      otpInputs.forEach(function (i) { i.value = ""; i.classList.remove("etl-otp-filled"); });
    }
    function getOtpValue() {
      return otpInputs.map(function (i) { return i.value; }).join("");
    }
    function setOtpBackDisabled(disabled) {
      var b = document.querySelector('.etlw-step[data-step="11"] .etlw-back-inline');
      if (!b) return;
      b.disabled = disabled;
      b.style.opacity = disabled ? "0.4" : "";
      b.style.pointerEvents = disabled ? "none" : "";
      b.style.cursor = disabled ? "not-allowed" : "";
    }
    function formatMinutesSeconds(t) {
      var s = Math.max(0, Math.round(t));
      return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    function startOtpCountdown(duration) {
      var seconds = duration || 60;
      if (otpCountdownTimer) clearInterval(otpCountdownTimer);
      if (otpResendBtn) {
        otpResendBtn.disabled = true;
        otpResendBtn.innerHTML = 'Resend in <span id="etlOtpCountdown">' + formatMinutesSeconds(seconds) + "</span>";
        otpCountdownEl = $("etlOtpCountdown");
      }
      setOtpBackDisabled(true);
      otpCountdownTimer = setInterval(function () {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(otpCountdownTimer);
          otpCountdownTimer = null;
          if (otpResendBtn) { otpResendBtn.disabled = false; otpResendBtn.textContent = "Resend code"; }
          setOtpBackDisabled(false);
          return;
        }
        if (otpCountdownEl) otpCountdownEl.textContent = formatMinutesSeconds(seconds);
      }, 1000);
    }
    function isOtpFailure(res) {
      if (!res || !res.ok) return true;
      var d = res.data;
      return !!(d && (d.reason || d.success === false || d.verified === false));
    }
    function sendOtpRequest() {
      return window.OTPService.sendOtp("+251" + $("etlPhone").value.trim()).then(function (res) {
        if (isOtpFailure(res)) {
          var err = new Error(window.OTPService.describeSendError(res));
          err.retryAfterSeconds = res && res.data && res.data.retryAfterSeconds;
          throw err;
        }
        return res;
      });
    }
    otpInputs.forEach(function (input, idx) {
      input.addEventListener("input", function () {
        input.value = input.value.replace(/\D/g, "").slice(0, 1);
        input.classList.toggle("etl-otp-filled", !!input.value);
        if (input.value && otpInputs[idx + 1]) otpInputs[idx + 1].focus();
        updateContinueState(stepEls[currentStep]);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !input.value && otpInputs[idx - 1]) otpInputs[idx - 1].focus();
      });
      input.addEventListener("paste", function (e) {
        var pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
        if (!pasted) return;
        e.preventDefault();
        pasted.split("").slice(0, otpInputs.length).forEach(function (digit, i) {
          if (otpInputs[i]) { otpInputs[i].value = digit; otpInputs[i].classList.add("etl-otp-filled"); }
        });
        var last = Math.min(pasted.length, otpInputs.length) - 1;
        if (otpInputs[last]) otpInputs[last].focus();
        updateContinueState(stepEls[currentStep]);
      });
    });

    /* ===== WIZARD ENGINE ===== */
    var DEFAULT_SEQUENCE = [1, 11, 2, 3, 4, 20, 5, 6, 7, 8, 9, 10];
    var CATERING_SEQUENCE = [1, 11, 2, 3, 12, 13, 14, 15, 16, 17, 18, 19, 7, 8, 9, 10];
    var CATERING_SESSION_STEP = 14;

    var currentStep = 1, stepEls = {};
    qa(".etlw-step").forEach(function (el) {
      stepEls[parseInt(el.getAttribute("data-step"), 10)] = el;
    });
    var backChevron = $("etlBackChevron"), progressLabel = $("etlProgressLabel"), progressFill = $("etlProgressFill");

    function getSequence() {
      if (getSelectedService() !== "catering") return DEFAULT_SEQUENCE;
      if (checkedValue("dayPeriod") === "Full Day")
        return CATERING_SEQUENCE.filter(function (s) { return s !== CATERING_SESSION_STEP; });
      return CATERING_SEQUENCE;
    }
    function renderStep() {
      Object.keys(stepEls).forEach(function (key) {
        var num = parseInt(key, 10);
        stepEls[key].classList.toggle("etlw-step-active", num === currentStep);
        var actions = stepEls[key].querySelector(".etlw-step-actions");
        if (actions) {
          var b = actions.querySelector(".etlw-back-inline");
          if (b) b.style.display = num === 1 ? "none" : "";
        }
      });
      var seq = getSequence(), idx = seq.indexOf(currentStep);
      if (idx === -1) idx = 0;
      if (progressLabel) progressLabel.textContent = "Step " + (idx + 1) + " of " + seq.length;
      if (progressFill) progressFill.style.width = ((idx + 1) / seq.length) * 100 + "%";
      if (backChevron) backChevron.style.display = "none";
      if (currentStep === 11) updateOtpSubtitle();
      hideFormError();
      updateContinueState(stepEls[currentStep]);
    }
    function goToStep(step) {
      currentStep = step;
      if (step === CATERING_SESSION_STEP) prepareCateringSessionStep();
      renderStep();
      if (formWrap) formWrap.scrollTop = 0;
    }
    function goNext() {
      if (!validateStep(stepEls[currentStep])) return;
      var seq = getSequence(), idx = seq.indexOf(currentStep);
      if (idx === -1 || idx === seq.length - 1) return;
      goToStep(seq[idx + 1]);
    }
    function goBack() {
      var seq = getSequence(), idx = seq.indexOf(currentStep);
      if (idx > 0) goToStep(seq[idx - 1]);
    }
    if (backChevron) backChevron.addEventListener("click", goBack);

    function setButtonLoading(btn, on, text) {
      if (!btn) return;
      if (on) {
        if (btn.dataset.originalText === undefined) btn.dataset.originalText = btn.textContent;
        btn.textContent = text;
        btn.disabled = true;
      } else {
        if (btn.dataset.originalText !== undefined) btn.textContent = btn.dataset.originalText;
        btn.disabled = false;
      }
    }
    function handleStep1Continue(btn) {
      if (!validateStep(stepEls[1])) return;
      hideFormError();
      setButtonLoading(btn, true, "Sending verification code...");
      sendOtpRequest()
        .then(function () {
          setButtonLoading(btn, false);
          resetOtpInputs();
          startOtpCountdown();
          var seq = getSequence();
          goToStep(seq[seq.indexOf(1) + 1]);
        })
        .catch(function (err) {
          setButtonLoading(btn, false);
          showFormError(err.message, $("etlPhone"));
          if (err.retryAfterSeconds) startOtpCountdown(err.retryAfterSeconds);
        });
    }
    function handleOtpVerify(btn) {
      if (!validateStep(stepEls[11])) return;
      hideFormError();
      setButtonLoading(btn, true, "Verifying...");
      window.OTPService.verifyOtp("+251" + $("etlPhone").value.trim(), getOtpValue())
        .then(function (res) {
          setButtonLoading(btn, false);
          if (isOtpFailure(res)) {
            showFormError(window.OTPService.describeVerifyError(res), $("etlOtpRow"));
            resetOtpInputs();
            if (otpInputs[0]) otpInputs[0].focus();
            updateContinueState(stepEls[11]);
            if (res && res.data && res.data.reason === "locked_out" && res.data.retryAfterSeconds) startOtpCountdown(res.data.retryAfterSeconds);
            return;
          }
          var seq = getSequence();
          goToStep(seq[seq.indexOf(11) + 1]);
        })
        .catch(function () {
          setButtonLoading(btn, false);
          showFormError("Something went wrong verifying the code. Please try again.", $("etlOtpRow"));
        });
    }
    document.addEventListener("click", function (e) {
      if (e.target.closest(".etlw-back-inline")) { goBack(); return; }
      var nb = e.target.closest("[data-next]");
      if (nb && form.contains(nb)) {
        if (currentStep === 1) handleStep1Continue(nb);
        else if (currentStep === 11) handleOtpVerify(nb);
        else goNext();
      }
    });
    function ensureInlineBackButtons() {
      qa(".etlw-step").forEach(function (step) {
        var btn = step.querySelector("[data-next]");
        if (!btn || step.querySelector(".etlw-step-actions")) return;
        var actions = document.createElement("div");
        actions.className = "etlw-step-actions";
        var back = document.createElement("button");
        back.type = "button";
        back.className = "etlw-back etlw-back-inline";
        back.setAttribute("aria-label", "Go back");
        back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>';
        step.insertBefore(actions, btn);
        actions.appendChild(back);
        actions.appendChild(btn);
        back.style.display = "none";
      });
    }
    ensureInlineBackButtons();

    /* ---- Validation ---- */
    function showFormError(message, target) {
      hideFormError();
      var host = target && target.closest ? target.closest(".etl-form-group, .etlw-option-list, .etlw-service-cards, .etlw-segmented, .etl-conditional-section, .etlw-otp-row") : target;
      if (target && target.classList) target.classList.add("etl-input-error");
      if (host && host.classList) host.classList.add("etl-has-error");
      if (host) {
        var n = document.createElement("div");
        n.className = "etl-field-error";
        n.textContent = message;
        host.appendChild(n);
        if (host.scrollIntoView) host.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (formError) {
        formError.textContent = message;
        formError.style.display = "block";
      }
    }
    function hideFormError() {
      if (formError) { formError.style.display = "none"; formError.textContent = ""; }
      qa(".etl-field-error").forEach(function (el) { el.remove(); });
      qa(".etl-input-error").forEach(function (el) { el.classList.remove("etl-input-error"); });
      qa(".etl-has-error").forEach(function (el) { el.classList.remove("etl-has-error"); });
    }
    function radioGroupChecked(name, scope) {
      return !!(scope || document).querySelector('input[name="' + name + '"]:checked');
    }
    function checkboxGroupChecked(name, scope) {
      return (scope || document).querySelectorAll('input[name="' + name + '"]:checked').length > 0;
    }
    function stepList(n) {
      return document.querySelector('.etlw-step[data-step="' + n + '"] .etlw-option-list');
    }

    function validateStep(stepEl) {
      if (!stepEl) return true;
      var step = parseInt(stepEl.getAttribute("data-step"), 10);
      if (step >= 12 && step <= 19) return validateCateringStep(step);
      if (step === 20) {
        var prefs = $("etlPreferences");
        return prefs.value.trim() ? true : bad("Please tell us your preferences so we can match you with the right Etalem.", prefs);
      }
      if (step === 1) {
        var name = $("etlName"), phone = $("etlPhone"), consent = $("etlPrivacyConsent");
        if (!name.checkValidity()) return bad("Please enter your full name.", name);
        if (!phone.checkValidity()) return bad("Enter a valid Ethiopian mobile number: 9 digits starting with 9 or 7.", phone);
        if (!consent.checked) return bad("Please agree to the Privacy Policy to continue.", consent.closest(".etlw-consent-row"));
        return true;
      }
      if (step === 11) return getOtpValue().length < 6 ? bad("Please enter the 6-digit code we sent you.", $("etlOtpRow")) : true;
      if (step === 2) return radioGroupChecked("service") ? true : bad("Please choose a service.", $("etlServiceCards"));
      if (step === 4) {
        var sel = getSelectedService();
        if (sel === "cooking") {
          if (!$("etlNumberOfPeople").value) return bad("Let us know how many people you usually cook for.", $("etlNumberOfPeople"));
          if (!checkboxGroupChecked("cuisinePreference", branchSections.cooking)) return bad("Please select at least one cuisine preference.", $("etlCuisineGroup"));
        } else if (sel === "cleaning") {
          if (!$("etlNumberOfRooms").value) return bad("Let us know how many rooms need cleaning.", $("etlNumberOfRooms"));
          if (!radioGroupChecked("houseType", branchSections.cleaning)) return bad("Please select your home type.", $("etlHouseTypeGroup"));
          if (apartmentSizeSelect.required && !apartmentSizeSelect.value) return bad("Please select your apartment size.", apartmentSizeSelect);
        } else if (sel === "nanny") {
          if (!$("etlNumberOfChildren").value) return bad("Let us know how many children need care.", $("etlNumberOfChildren"));
          if (!radioGroupChecked("childAge", branchSections.nanny)) return bad("Please select your child's age group.", $("etlChildAgeGroup"));
        }
        return true;
      }
      if (step === 5) return radioGroupChecked("weeklyFrequency") ? true : bad("Please select how often you'd like your Etalem to come.", stepList(5));
      if (step === 6) {
        if (!radioGroupChecked("dailyServiceDuration")) return bad("Please select a time of day.", stepList(6));
        if (!isPreferredDateValid()) return bad(checkedValue("weeklyFrequency") === "Weekend" ? "Please select a Saturday for your weekend service." : "Please select a valid service date.", $("etlServiceDate"));
        var rw = requiredWeekdayCount(checkedValue("weeklyFrequency"));
        if (rw !== null && checkedValues("preferredWeekday").length !== rw) return bad("Please select " + rw + " preferred day(s).", $("etlPreferredWeekdaysGroup"));
        return true;
      }
      if (step === 7) {
        var loc = $("etlLocation");
        if (!loc.value.trim()) return bad("Please enter your area.", loc);
        if (!$("etlLandmark").value.trim()) return bad("Please enter a nearby landmark.", $("etlLandmark"));
        return true;
      }
      if (step === 8) return radioGroupChecked("marketingChannel") ? true : bad("Please let us know how you found Etalem.", stepList(8));
      if (step === 9) return radioGroupChecked("preferredCommunicationChannel") ? true : bad("Please select how you'd like us to reach you.", stepList(9));
      return true;
    }

    function updateContinueState(stepEl) {
      if (!stepEl) return;
      var btn = stepEl.querySelector("[data-next]");
      if (!btn) return;
      var step = parseInt(stepEl.getAttribute("data-step"), 10), ok = true;
      if (step === 1) {
        var c = $("etlPrivacyConsent");
        ok = !!($("etlName").value.trim() && $("etlPhone").value.trim() && c && c.checked);
      } else if (step === 11) ok = getOtpValue().length === 6;
      else if (step === 2) ok = radioGroupChecked("service");
      else if (step === 5) ok = radioGroupChecked("weeklyFrequency");
      else if (step === 6) ok = radioGroupChecked("dailyServiceDuration") && isPreferredScheduleValid();
      else if (step === 7) ok = !!($("etlLocation").value.trim() && $("etlLandmark").value.trim());
      else if (step === 8) ok = radioGroupChecked("marketingChannel");
      else if (step === 9) ok = radioGroupChecked("preferredCommunicationChannel");
      if (btn.dataset.originalText !== undefined) return;
      btn.disabled = !ok;
    }
    form.addEventListener("input", function () { updateContinueState(stepEls[currentStep]); });
    form.addEventListener("change", function () { updateContinueState(stepEls[currentStep]); });

    /* ---- Modal open / close / reset ---- */
    function resetWizard() {
      form.reset();
      Object.keys(branchSections).forEach(function (k) {
        clearSectionFields(branchSections[k]);
        branchSections[k].style.display = "none";
      });
      if (charCount) charCount.textContent = "0/" + maxLength + " characters used";
      var mc = $("etlCateringMenuCount");
      if (mc) mc.textContent = "0/500 characters used";
      resetOtpInputs();
      if (otpCountdownTimer) { clearInterval(otpCountdownTimer); otpCountdownTimer = null; }
      if (otpResendBtn) {
        otpResendBtn.disabled = true;
        otpResendBtn.innerHTML = 'Resend in <span id="etlOtpCountdown">01:00</span>';
        otpCountdownEl = $("etlOtpCountdown");
      }
      setOtpBackDisabled(false);
      currentStep = 1;
      goToStep(1);
    }
    function resetModalView() {
      if (formWrap) formWrap.style.display = "";
      if (formSuccess) formSuccess.style.display = "none";
      hideFormError();
    }
    function closeModal() {
      modal.classList.remove("etl-open");
      document.body.style.overflow = "";
    }
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest('a[href="#request"]');
      if (trigger) {
        e.preventDefault();
        if (modal.classList.contains("etl-open")) { closeModal(); return; }
        resetModalView();
        resetWizard();
        var pre = trigger.getAttribute("data-link");
        if (pre) {
          var radio = document.querySelector('input[name="service"][value="' + pre + '"]');
          if (radio) { radio.checked = true; updateServiceDependentUI(); }
        }
        modal.classList.add("etl-open");
        document.body.style.overflow = "hidden";
        return;
      }
      if (e.target.closest(".etl-request-close")) closeModal();
    });

    /* ---- Submit ---- */
    function buildPayload() {
      var svc = getSelectedService();
      var p = {
        sourcePage: "service-guide",
        service: svc,
        fullName: $("etlName").value.trim(),
        phone: "+251" + $("etlPhone").value.trim(),
        weeklyFrequency: checkedValue("weeklyFrequency"),
        dailyServiceDuration: checkedValue("dailyServiceDuration"),
        preferredDays: buildWorkDays(),
        preferredServiceDate: buildPreferredServiceDateLabel(),
        serviceDate: serviceDateInput && serviceDateInput.value ? serviceDateInput.value : "",
        location: $("etlLocation").value.trim(),
        landmark: $("etlLandmark").value.trim(),
        marketingChannel: checkedValue("marketingChannel"),
        preferredCommunicationChannel: checkedValue("preferredCommunicationChannel"),
        taskDetails: $("etlTask").value.trim(),
      };
      if (svc === "cooking") {
        p.numberOfPeople = numOrUndef("etlNumberOfPeople");
        p.cuisinePreference = checkedValues("cuisinePreference");
      } else if (svc === "cleaning") {
        var ht = checkedValue("houseType");
        p.numberOfRooms = numOrUndef("etlNumberOfRooms");
        p.houseType = ht;
        if (String(ht).toLowerCase() === "apartment") p.apartmentSize = apartmentSizeSelect.value;
        p.extraCleaningServices = checkedValues("extraCleaningServices");
      } else if (svc === "nanny") {
        p.numberOfChildren = numOrUndef("etlNumberOfChildren");
        p.childAge = checkedValue("childAge");
      } else if (svc === "catering") {
        addCateringFields(p);
      }
      if (svc !== "catering") {
        p.preferences = $("etlPreferences").value.trim();
        var dur = document.querySelector('input[name="dailyServiceDuration"]:checked');
        if (dur && dur.dataset.start) {
          p.sessionStartTime = dur.dataset.start;
          p.sessionEndTime = dur.dataset.end;
        }
      }
      return p;
    }

    function submitRequest() {
      var btn = $("etlSubmitBtn"), label = btn.textContent;
      hideFormError();
      btn.disabled = true;
      btn.textContent = "Sending...";
      var payload = buildPayload();
      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Request failed with status " + res.status);
          var msg = $("etlConfirmText");
          if (msg) msg.textContent = payload.service === "catering" ? "Thanks! Our team will review your request and reach out shortly with a menu and pricing." : "Our team is putting together your personalized quote and will send it to you shortly.";
          if (formWrap) formWrap.style.display = "none";
          if (formSuccess) formSuccess.style.display = "block";
          resetWizard();
        })
        .catch(function () {
          showFormError("Sorry, we could not submit your request. Please try again or call 9675.");
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = label;
        });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (currentStep !== 10) return;
      submitRequest();
    });

    renderStep();
  })();
</script>
