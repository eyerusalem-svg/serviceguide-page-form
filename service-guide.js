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

    var taskField = document.getElementById("etlTask");
    var charCount = document.getElementById("etlCharCount");
    var maxLength = (taskField && parseInt(taskField.getAttribute("maxlength"), 10)) || 500;
    if (taskField && charCount) {
      taskField.addEventListener("input", function () {
        charCount.textContent = taskField.value.length + "/" + maxLength + " characters used";
      });
    }

    var modal = document.getElementById("request");
    if (modal && modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    var form = document.getElementById("etlRequestForm");
    var formWrap = document.getElementById("etlFormWrap");
    var formSuccess = document.getElementById("etlFormSuccess");
    var formError = document.getElementById("etlFormError");

    var SERVICE_META = {
      cooking: {
        label: "Cooking",
        description: "Just a few quick questions about your cooking needs — it takes less than a minute.",
        branchTitle: "Tell us about your cooking needs.",
      },
      cleaning: {
        label: "Cleaning",
        description: "Just a few quick questions about your cleaning needs — it takes less than a minute.",
        branchTitle: "Tell us about your cleaning needs.",
      },
      nanny: {
        label: "Babysitting",
        description: "Just a few quick questions about your child's needs — it takes less than a minute.",
        branchTitle: "Tell us about your little one(s).",
      },
      catering: {
        label: "Catering",
        description: "Just a couple of quick questions about your event — it takes less than a minute.",
        branchTitle: "",
      },
    };

    var serviceRadios = document.querySelectorAll('input[name="service"]');
    var branchSections = {
      cooking: document.getElementById("etlCookingSection"),
      cleaning: document.getElementById("etlCleaningSection"),
      nanny: document.getElementById("etlBabysittingSection"),
    };
    var branchTitleEl = document.getElementById("etlBranchTitle");
    var transitionPillEl = document.getElementById("etlTransitionPill");
    var transitionTextEl = document.getElementById("etlTransitionText");

    function getSelectedService() {
      var checked = document.querySelector('input[name="service"]:checked');
      return checked ? checked.value : "";
    }

    function updateCleaningFrequencyUI() {
      var selectedService = getSelectedService();
      var isCleaning = selectedService === "cleaning";
      var deepOption = document.querySelector('input[name="weeklyFrequency"][value="Deep Cleaning (One-Time)"]');
      var oneTimeOption = document.querySelector('input[name="weeklyFrequency"][value="Task-based(Once)"]');
      var deepCard = deepOption && deepOption.closest(".etlw-option-card");
      var oneTimeCard = oneTimeOption && oneTimeOption.closest(".etlw-option-card");
      if (deepCard) deepCard.style.display = isCleaning ? "" : "none";
      if (oneTimeCard) oneTimeCard.style.display = "";
      if (!isCleaning && deepOption) deepOption.checked = false;

      var selectedFrequency = document.querySelector('input[name="weeklyFrequency"]:checked');
      var selectedFrequencyValue = selectedFrequency ? selectedFrequency.value : "";
      var isOneTimeSelection = selectedFrequencyValue === "Task-based(Once)" || selectedFrequencyValue === "Deep Cleaning (One-Time)";
      var isLowFrequencySelection = selectedFrequencyValue === "1 Day/Week" || selectedFrequencyValue === "2 Days/Week" || selectedFrequencyValue === "3 Days/Week";
      var isNannyLowFrequencySelection = isLowFrequencySelection || selectedFrequencyValue === "3 Days/Week";
      var disableMorningAfternoon = ((selectedService === "cleaning" || selectedService === "cooking") && isOneTimeSelection) || ((selectedService === "cleaning" || selectedService === "cooking") && isLowFrequencySelection) || (selectedService === "nanny" && isNannyLowFrequencySelection);
      var morningOption = document.querySelector('input[name="dailyServiceDuration"][value="Half Day - Morning"]');
      var afternoonOption = document.querySelector('input[name="dailyServiceDuration"][value="Half Day - Afternoon"]');
      [morningOption, afternoonOption].forEach(function (option) {
        if (!option) return;
        var optionCard = option.closest(".etlw-option-card");
        option.disabled = disableMorningAfternoon;
        if (optionCard) optionCard.style.opacity = disableMorningAfternoon ? "0.45" : "";
        if (optionCard) optionCard.style.cursor = disableMorningAfternoon ? "not-allowed" : "";
        if (disableMorningAfternoon && option.checked) option.checked = false;
      });
    }

    function updateTimeSlotStatusOnFrequencyChange() {
      var frequencyInputs = document.querySelectorAll('input[name="weeklyFrequency"]');
      frequencyInputs.forEach(function (input) {
        input.addEventListener("change", function () {
          updateCleaningFrequencyUI();
        });
      });
    }

    function clearSectionFields(sectionEl) {
      if (!sectionEl) return;
      sectionEl.querySelectorAll("input, select, textarea").forEach(function (el) {
        if (el.type === "checkbox" || el.type === "radio") el.checked = false;
        else el.value = "";
      });
    }

    function updateApartmentVisibility(houseGroupName, groupEl, selectEl) {
      var checked = document.querySelector('input[name="' + houseGroupName + '"]:checked');
      var isApartment = checked && String(checked.value).toLowerCase() === "apartment";
      if (groupEl) groupEl.style.display = isApartment ? "" : "none";
      if (selectEl) {
        selectEl.required = !!isApartment;
        if (!isApartment) selectEl.value = "";
      }
    }

    var apartmentSizeGroup = document.getElementById("etlApartmentSizeGroup");
    var apartmentSizeSelect = document.getElementById("etlApartmentSize");

    document.addEventListener("change", function (e) {
      if (e.target.matches('input[name="houseType"]')) {
        updateApartmentVisibility("houseType", apartmentSizeGroup, apartmentSizeSelect);
      }
    });

    // .etlw-segmented relies on native <label> click delegation to check its
    // zero-size input (same visually-hidden-radio pattern as .etlw-service-card
    // and .etlw-option-card, which both also set .checked explicitly on click
    // instead of relying on delegation alone) - add the same explicit handler
    // here so a click always registers even if native delegation doesn't fire.
    document.querySelectorAll(".etlw-segmented label").forEach(function (label) {
      var input = label.querySelector('input[type="radio"]');
      if (!input) return;
      label.addEventListener("click", function () {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    function updateServiceDependentUI() {
      var selected = getSelectedService();
      var meta = SERVICE_META[selected];

      Object.keys(branchSections).forEach(function (key) {
        var el = branchSections[key];
        if (!el) return;
        if (key === selected) el.style.display = "";
        else {
          el.style.display = "none";
          clearSectionFields(el);
        }
      });
      updateApartmentVisibility("houseType", apartmentSizeGroup, apartmentSizeSelect);
      updateCleaningFrequencyUI();

      var fullDayHoursEl = document.getElementById("etlFullDayHours");
      if (fullDayHoursEl) fullDayHoursEl.textContent = selected === "nanny" ? "7:00 AM – 6:00 PM" : "7:00 AM – 4:00 PM";

      if (transitionPillEl) transitionPillEl.textContent = meta ? meta.label + " selected" : "";
      if (transitionTextEl) transitionTextEl.textContent = meta ? meta.description : "";
      if (branchTitleEl) branchTitleEl.textContent = meta ? meta.branchTitle : "";
    }

    serviceRadios.forEach(function (r) {
      r.addEventListener("change", updateServiceDependentUI);

      var card = r.closest(".etlw-service-card");
      if (card) {
        card.addEventListener("click", function () {
          r.checked = true;
          updateServiceDependentUI();
          updateContinueState(stepEls[2]);
        });
      }
    });

    updateTimeSlotStatusOnFrequencyChange();

    // ---- Preferred service date - Weekend constrains picker to Saturdays; Sunday is derived ----
    var MIN_LEAD_DAYS = 3;
    var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var serviceDateInput = document.getElementById("etlServiceDate");
    var weekendDatesNote = document.getElementById("etlWeekendDatesNote");
    var weekendDatesText = document.getElementById("etlWeekendDatesText");
    var preferredDaysLabel = document.getElementById("etlPreferredDaysLabel");
    var preferredWeekdaysGroupWrap = document.getElementById("etlPreferredWeekdaysGroupWrap");
    var preferredWeekdaysCountText = document.getElementById("etlPreferredWeekdaysCountText");
    var WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    function requiredWeekdayCount(freqValue) {
      var match = /^(\d) Days?\/Week$/.exec(freqValue || "");
      return match ? parseInt(match[1], 10) : null;
    }

    function addDays(date, days) {
      var d = new Date(date);
      d.setDate(d.getDate() + days);
      return d;
    }

    function toDateInputValue(date) {
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, "0");
      var d = String(date.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }

    function parseDateInputValue(value) {
      var parts = value.split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function formatDateLabel(date) {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }

    function minSelectableDate() {
      return addDays(new Date(), MIN_LEAD_DAYS);
    }

    function firstSaturdayOnOrAfter(from) {
      var d = new Date(from);
      while (d.getDay() !== 6) d = addDays(d, 1);
      return d;
    }

    function isPreferredDateValid() {
      if (!serviceDateInput || !serviceDateInput.value) return false;
      if (checkedValue("weeklyFrequency") === "Weekend") {
        return parseDateInputValue(serviceDateInput.value).getDay() === 6 && serviceDateInput.value >= serviceDateInput.min;
      }
      return serviceDateInput.value >= toDateInputValue(minSelectableDate());
    }

    function isPreferredScheduleValid() {
      if (!isPreferredDateValid()) return false;
      var required = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      if (required === null) return true;
      return checkedValues("preferredWeekday").length === required;
    }

    function updateWeekendConfirmation() {
      if (!weekendDatesNote) return;
      var isWeekend = checkedValue("weeklyFrequency") === "Weekend";
      if (!isWeekend || !serviceDateInput || !serviceDateInput.value) {
        weekendDatesNote.style.display = "none";
        return;
      }
      var saturday = parseDateInputValue(serviceDateInput.value);
      weekendDatesNote.style.display = "flex";
      if (weekendDatesText) weekendDatesText.textContent = formatDateLabel(saturday) + " – " + formatDateLabel(addDays(saturday, 1));
    }

    function updatePreferredDaysUI() {
      var isWeekend = checkedValue("weeklyFrequency") === "Weekend";
      if (serviceDateInput) {
        if (isWeekend) {
          var minSaturday = firstSaturdayOnOrAfter(minSelectableDate());
          serviceDateInput.min = toDateInputValue(minSaturday);
          serviceDateInput.step = 7;
          if (serviceDateInput.value && !isPreferredDateValid()) {
            serviceDateInput.value = "";
          }
        } else {
          serviceDateInput.removeAttribute("step");
          serviceDateInput.min = toDateInputValue(minSelectableDate());
          if (serviceDateInput.value && serviceDateInput.value < serviceDateInput.min) {
            serviceDateInput.value = "";
          }
        }
      }
      if (preferredDaysLabel) preferredDaysLabel.textContent = isWeekend ? "Preferred weekend (pick a Saturday)" : "Preferred service date";
      updateWeekendConfirmation();

      var requiredDays = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      if (preferredWeekdaysGroupWrap) preferredWeekdaysGroupWrap.style.display = requiredDays !== null ? "" : "none";
      document.querySelectorAll('input[name="preferredWeekday"]').forEach(function (box) {
        box.checked = false;
      });
      enforcePreferredWeekdayLimit();

      updateContinueState(stepEls[currentStep]);
    }

    function enforcePreferredWeekdayLimit() {
      var required = requiredWeekdayCount(checkedValue("weeklyFrequency"));
      var boxes = document.querySelectorAll('input[name="preferredWeekday"]');
      var checkedCount = document.querySelectorAll('input[name="preferredWeekday"]:checked').length;
      boxes.forEach(function (box) {
        if (!box.checked) box.disabled = required !== null && checkedCount >= required;
      });
      if (preferredWeekdaysCountText) preferredWeekdaysCountText.textContent = required !== null ? checkedCount + " of " + required + " selected" : "";
      updateContinueState(stepEls[currentStep]);
    }

    document.querySelectorAll('input[name="preferredWeekday"]').forEach(function (box) {
      box.addEventListener("change", enforcePreferredWeekdayLimit);
    });

    if (serviceDateInput) {
      serviceDateInput.addEventListener("change", function () {
        updateWeekendConfirmation();
        if (serviceDateInput.value && !isPreferredDateValid()) {
          showFormError(checkedValue("weeklyFrequency") === "Weekend" ? "Weekend service is only available on Saturdays - please pick a Saturday." : "Please select a valid service date.", serviceDateInput);
        } else {
          hideFormError();
        }
      });
    }

    document.querySelectorAll('input[name="weeklyFrequency"]').forEach(function (r) {
      r.addEventListener("change", updatePreferredDaysUI);
    });

    function buildWorkDays() {
      var duration = checkedValue("dailyServiceDuration") || "Full Day";
      var freq = checkedValue("weeklyFrequency");
      if (freq === "Weekend") {
        return ["Saturday " + duration, "Sunday " + duration];
      }
      if (requiredWeekdayCount(freq) !== null) {
        return checkedValues("preferredWeekday")
          .slice()
          .sort(function (a, b) {
            return WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b);
          })
          .map(function (day) {
            return day + " " + duration;
          });
      }
      if (serviceDateInput && serviceDateInput.value) {
        var dayName = WEEKDAY_NAMES[parseDateInputValue(serviceDateInput.value).getDay()];
        return [dayName + " " + duration];
      }
      return [];
    }

    function buildPreferredServiceDateLabel() {
      if (!serviceDateInput || !serviceDateInput.value) return "";
      var picked = parseDateInputValue(serviceDateInput.value);
      if (checkedValue("weeklyFrequency") === "Weekend") {
        return formatDateLabel(picked) + " – " + formatDateLabel(addDays(picked, 1));
      }
      return formatDateLabel(picked);
    }

    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".etlw-stepper-btn");
      if (!btn) return;
      var target = document.getElementById(btn.getAttribute("data-step-target"));
      if (!target) return;
      var dir = parseInt(btn.getAttribute("data-step-dir"), 10) || 0;
      var min = parseInt(target.getAttribute("min"), 10) || 1;
      var current = parseInt(target.value, 10) || min;
      var next = current + dir;
      if (next < min) next = min;
      target.value = next;
    });

    var otpInputs = Array.prototype.slice.call(document.querySelectorAll(".etlw-otp-input"));
    var otpSubtitle = document.getElementById("etlOtpSubtitle");
    var otpResendBtn = document.getElementById("etlOtpResendBtn");
    var otpCountdownEl = document.getElementById("etlOtpCountdown");
    var otpCountdownTimer = null;

    function maskPhoneDisplay() {
      var digits = document.getElementById("etlPhone").value.replace(/\D/g, "");
      if (digits.length < 9) return "+251 9** *** ***";
      return "+251 " + digits.charAt(0) + "** *** " + digits.slice(6, 9);
    }

    function updateOtpSubtitle() {
      if (otpSubtitle) otpSubtitle.textContent = "We sent a 6-digit code to " + maskPhoneDisplay() + ".";
    }

    function resetOtpInputs() {
      otpInputs.forEach(function (input) {
        input.value = "";
        input.classList.remove("etl-otp-filled");
      });
    }

    function getOtpValue() {
      return otpInputs
        .map(function (input) {
          return input.value;
        })
        .join("");
    }

    function setOtpBackDisabled(disabled) {
      var backBtn = document.querySelector('.etlw-step[data-step="11"] .etlw-back-inline');
      if (!backBtn) return;
      backBtn.disabled = disabled;
      backBtn.style.opacity = disabled ? "0.4" : "";
      backBtn.style.pointerEvents = disabled ? "none" : "";
      backBtn.style.cursor = disabled ? "not-allowed" : "";
    }

    function startOtpCountdown(durationSeconds) {
      var seconds = durationSeconds || 60;
      if (otpCountdownTimer) clearInterval(otpCountdownTimer);
      if (otpResendBtn) {
        otpResendBtn.disabled = true;
        otpResendBtn.innerHTML = 'Resend in <span id="etlOtpCountdown">' + formatMinutesSeconds(seconds) + "</span>";
        otpCountdownEl = document.getElementById("etlOtpCountdown");
      }
      setOtpBackDisabled(true);
      function render() {
        if (otpCountdownEl) otpCountdownEl.textContent = formatMinutesSeconds(seconds);
      }
      render();
      otpCountdownTimer = setInterval(function () {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(otpCountdownTimer);
          otpCountdownTimer = null;
          if (otpResendBtn) {
            otpResendBtn.disabled = false;
            otpResendBtn.textContent = "Resend code";
          }
          setOtpBackDisabled(false);
          return;
        }
        render();
      }, 1000);
    }

    function formatMinutesSeconds(totalSeconds) {
      var s = Math.max(0, Math.round(totalSeconds));
      var m = Math.floor(s / 60)
        .toString()
        .padStart(2, "0");
      var r = (s % 60).toString().padStart(2, "0");
      return m + ":" + r;
    }

    function isOtpFailure(res) {
      if (!res || !res.ok) return true;
      var data = res.data;
      if (!data) return false;
      if (data.reason) return true;
      if (data.success === false) return true;
      if (data.verified === false) return true;
      return false;
    }

    function sendOtpRequest() {
      var phone = "+251" + document.getElementById("etlPhone").value.trim();
      return window.OTPService.sendOtp(phone).then(function (res) {
        if (isOtpFailure(res)) {
          var message = window.OTPService.describeSendError(res);
          var err = new Error(message);
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
        pasted
          .split("")
          .slice(0, otpInputs.length)
          .forEach(function (digit, i) {
            if (otpInputs[i]) {
              otpInputs[i].value = digit;
              otpInputs[i].classList.add("etl-otp-filled");
            }
          });
        var lastFilled = Math.min(pasted.length, otpInputs.length) - 1;
        if (otpInputs[lastFilled]) otpInputs[lastFilled].focus();
        updateContinueState(stepEls[currentStep]);
      });
    });

    var DEFAULT_SEQUENCE = [1, 11, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    var CATERING_SEQUENCE = [1, 11, 2, 3, 6, 7, 8, 9, 10];

    var currentStep = 1;
    var stepEls = {};
    document.querySelectorAll(".etlw-step").forEach(function (el) {
      stepEls[parseInt(el.getAttribute("data-step"), 10)] = el;
    });
    var backChevron = document.getElementById("etlBackChevron");
    var progressLabel = document.getElementById("etlProgressLabel");
    var progressFill = document.getElementById("etlProgressFill");

    function getSequence() {
      return getSelectedService() === "catering" ? CATERING_SEQUENCE : DEFAULT_SEQUENCE;
    }

    function renderStep() {
      Object.keys(stepEls).forEach(function (key) {
        var num = parseInt(key, 10);
        stepEls[key].classList.toggle("etlw-step-active", num === currentStep);
        var actions = stepEls[key].querySelector(".etlw-step-actions");
        if (actions) {
          var backBtn = actions.querySelector(".etlw-back-inline");
          if (backBtn) backBtn.style.display = num === 1 ? "none" : "";
        }
      });
      var seq = getSequence();
      var idx = seq.indexOf(currentStep);
      if (idx === -1) idx = 0;
      var total = seq.length;
      if (progressLabel) progressLabel.textContent = "Step " + (idx + 1) + " of " + total;
      if (progressFill) progressFill.style.width = ((idx + 1) / total) * 100 + "%";
      if (backChevron) backChevron.style.display = "none";
      if (currentStep === 11) updateOtpSubtitle();
      hideFormError();
      updateContinueState(stepEls[currentStep]);
    }

    function goToStep(step) {
      currentStep = step;
      renderStep();
      if (formWrap) formWrap.scrollTop = 0;
    }

    function goNext() {
      if (!validateStep(stepEls[currentStep])) return;
      var seq = getSequence();
      var idx = seq.indexOf(currentStep);
      if (idx === -1 || idx === seq.length - 1) return;
      goToStep(seq[idx + 1]);
    }

    function goBack() {
      var seq = getSequence();
      var idx = seq.indexOf(currentStep);
      if (idx <= 0) return;
      goToStep(seq[idx - 1]);
    }

    if (backChevron) backChevron.addEventListener("click", goBack);

    function setButtonLoading(btn, isLoading, loadingText) {
      if (!btn) return;
      if (isLoading) {
        if (btn.dataset.originalText === undefined) btn.dataset.originalText = btn.textContent;
        btn.textContent = loadingText;
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
          var idx = seq.indexOf(1);
          goToStep(seq[idx + 1]);
        })
        .catch(function (err) {
          setButtonLoading(btn, false);
          showFormError(err.message, document.getElementById("etlPhone"));
          if (err.retryAfterSeconds) startOtpCountdown(err.retryAfterSeconds);
        });
    }

    function handleOtpVerify(btn) {
      if (!validateStep(stepEls[11])) return;
      var phone = "+251" + document.getElementById("etlPhone").value.trim();
      var code = getOtpValue();
      hideFormError();
      setButtonLoading(btn, true, "Verifying...");
      window.OTPService.verifyOtp(phone, code)
        .then(function (res) {
          setButtonLoading(btn, false);
          if (isOtpFailure(res)) {
            showFormError(window.OTPService.describeVerifyError(res), document.getElementById("etlOtpRow"));
            resetOtpInputs();
            if (otpInputs[0]) otpInputs[0].focus();
            updateContinueState(stepEls[11]);
            if (res && res.data && res.data.reason === "locked_out" && res.data.retryAfterSeconds) {
              startOtpCountdown(res.data.retryAfterSeconds);
            }
            return;
          }
          var seq = getSequence();
          var idx = seq.indexOf(11);
          goToStep(seq[idx + 1]);
        })
        .catch(function () {
          setButtonLoading(btn, false);
          showFormError("Something went wrong verifying the code. Please try again.", document.getElementById("etlOtpRow"));
        });
    }

    document.addEventListener("click", function (e) {
      var inlineBack = e.target.closest(".etlw-back-inline");
      if (inlineBack) {
        goBack();
        return;
      }
      var nextBtn = e.target.closest("[data-next]");
      if (nextBtn && form.contains(nextBtn)) {
        if (currentStep === 1) handleStep1Continue(nextBtn);
        else if (currentStep === 11) handleOtpVerify(nextBtn);
        else goNext();
      }
    });

    function ensureInlineBackButtons() {
      document.querySelectorAll(".etlw-step").forEach(function (step) {
        var btn = step.querySelector("[data-next]");
        if (!btn || step.querySelector(".etlw-step-actions")) return;
        var actions = document.createElement("div");
        actions.className = "etlw-step-actions";
        var backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "etlw-back etlw-back-inline";
        backBtn.setAttribute("aria-label", "Go back");
        backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>';
        step.insertBefore(actions, btn);
        actions.appendChild(backBtn);
        actions.appendChild(btn);
        backBtn.style.display = "none";
      });
    }

    ensureInlineBackButtons();

    function showFormError(message, target) {
      hideFormError();
      var targetEl = target && target.closest ? target.closest(".etl-form-group, .etlw-option-list, .etlw-service-cards, .etlw-segmented, .etl-conditional-section, .etlw-otp-row") : target;
      if (target && target.classList) target.classList.add("etl-input-error");
      if (targetEl && targetEl.classList) targetEl.classList.add("etl-has-error");
      if (targetEl) {
        var errorNode = document.createElement("div");
        errorNode.className = "etl-field-error";
        errorNode.textContent = message;
        targetEl.appendChild(errorNode);
        if (targetEl.scrollIntoView) targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (!targetEl && formError) {
        formError.textContent = message;
        formError.style.display = "block";
      }
    }

    function hideFormError() {
      if (formError) {
        formError.style.display = "none";
        formError.textContent = "";
      }
      document.querySelectorAll(".etl-field-error").forEach(function (el) {
        el.remove();
      });
      document.querySelectorAll(".etl-input-error").forEach(function (el) {
        el.classList.remove("etl-input-error");
      });
      document.querySelectorAll(".etl-has-error").forEach(function (el) {
        el.classList.remove("etl-has-error");
      });
    }

    function radioGroupChecked(name, scopeEl) {
      var scope = scopeEl || document;
      return !!scope.querySelector('input[name="' + name + '"]:checked');
    }
    function checkboxGroupChecked(name, scopeEl) {
      var scope = scopeEl || document;
      return scope.querySelectorAll('input[name="' + name + '"]:checked').length > 0;
    }

    function validateStep(stepEl) {
      if (!stepEl) return true;
      var step = parseInt(stepEl.getAttribute("data-step"), 10);

      if (step === 1) {
        var name = document.getElementById("etlName");
        var phone = document.getElementById("etlPhone");
        var consent = document.getElementById("etlPrivacyConsent");
        if (!name.checkValidity()) {
          showFormError("Please enter your full name.", name);
          return false;
        }
        if (!phone.checkValidity()) {
          showFormError("Enter a valid Ethiopian mobile number: 9 digits starting with 9 or 7.", phone);
          return false;
        }
        if (!consent.checked) {
          showFormError("Please agree to the Privacy Policy to continue.", consent.closest(".etlw-consent-row"));
          return false;
        }
        return true;
      }
      if (step === 11) {
        if (getOtpValue().length < 6) {
          showFormError("Please enter the 6-digit code we sent you.", document.getElementById("etlOtpRow"));
          return false;
        }
        return true;
      }
      if (step === 2) {
        if (!radioGroupChecked("service")) {
          showFormError("Please choose a service.", document.getElementById("etlServiceCards"));
          return false;
        }
        return true;
      }
      if (step === 3) return true;
      if (step === 4) {
        var selected = getSelectedService();
        if (selected === "cooking") {
          if (!document.getElementById("etlNumberOfPeople").value) {
            showFormError("Let us know how many people you usually cook for.", document.getElementById("etlNumberOfPeople"));
            return false;
          }
          if (!checkboxGroupChecked("cuisinePreference", branchSections.cooking)) {
            showFormError("Please select at least one cuisine preference.", document.getElementById("etlCuisineGroup"));
            return false;
          }
        } else if (selected === "cleaning") {
          if (!document.getElementById("etlNumberOfRooms").value) {
            showFormError("Let us know how many rooms need cleaning.", document.getElementById("etlNumberOfRooms"));
            return false;
          }
          if (!radioGroupChecked("houseType", branchSections.cleaning)) {
            showFormError("Please select your home type.", document.getElementById("etlHouseTypeGroup"));
            return false;
          }
          if (apartmentSizeSelect.required && !apartmentSizeSelect.value) {
            showFormError("Please select your apartment size.", apartmentSizeSelect);
            return false;
          }
        } else if (selected === "nanny") {
          if (!document.getElementById("etlNumberOfChildren").value) {
            showFormError("Let us know how many children need care.", document.getElementById("etlNumberOfChildren"));
            return false;
          }
          if (!radioGroupChecked("childAge", branchSections.nanny)) {
            showFormError("Please select your child's age group.", document.getElementById("etlChildAgeGroup"));
            return false;
          }
        }
        return true;
      }
      if (step === 5) {
        if (!radioGroupChecked("weeklyFrequency")) {
          showFormError("Please select how often you'd like your Etalem to come.", document.querySelector('.etlw-step[data-step="5"] .etlw-option-list'));
          return false;
        }
        return true;
      }
      if (step === 6) {
        if (!radioGroupChecked("dailyServiceDuration")) {
          showFormError("Please select a time of day.", document.querySelector('.etlw-step[data-step="6"] .etlw-option-list'));
          return false;
        }
        if (!isPreferredDateValid()) {
          showFormError(checkedValue("weeklyFrequency") === "Weekend" ? "Please select a Saturday for your weekend service." : "Please select a valid service date.", document.getElementById("etlServiceDate"));
          return false;
        }
        var requiredWeekdays = requiredWeekdayCount(checkedValue("weeklyFrequency"));
        if (requiredWeekdays !== null && checkedValues("preferredWeekday").length !== requiredWeekdays) {
          showFormError("Please select " + requiredWeekdays + " preferred day(s).", document.getElementById("etlPreferredWeekdaysGroup"));
          return false;
        }
        return true;
      }
      if (step === 7) {
        var location = document.getElementById("etlLocation");
        if (!location.checkValidity()) {
          showFormError("Please enter your area.", location);
          return false;
        }
        return true;
      }
      if (step === 8) {
        if (!radioGroupChecked("marketingChannel")) {
          showFormError("Please let us know how you found Etalem.", document.querySelector('.etlw-step[data-step="8"] .etlw-option-list'));
          return false;
        }
        return true;
      }
      if (step === 9) {
        if (!radioGroupChecked("preferredCommunicationChannel")) {
          showFormError("Please select how you'd like us to reach you.", document.querySelector('.etlw-step[data-step="9"] .etlw-option-list'));
          return false;
        }
        return true;
      }
      return true;
    }

    function updateContinueState(stepEl) {
      if (!stepEl) return;
      var btn = stepEl.querySelector("[data-next]");
      if (!btn) return;
      var step = parseInt(stepEl.getAttribute("data-step"), 10);
      var ok = true;
      if (step === 1) {
        var consentBox = document.getElementById("etlPrivacyConsent");
        ok = !!(document.getElementById("etlName").value.trim() && document.getElementById("etlPhone").value.trim() && consentBox && consentBox.checked);
      } else if (step === 11) {
        ok = getOtpValue().length === 6;
      } else if (step === 2) {
        ok = radioGroupChecked("service");
      } else if (step === 5) {
        ok = radioGroupChecked("weeklyFrequency");
      } else if (step === 6) {
        ok = radioGroupChecked("dailyServiceDuration") && isPreferredScheduleValid();
      } else if (step === 7) {
        ok = !!document.getElementById("etlLocation").value.trim();
      } else if (step === 8) {
        ok = radioGroupChecked("marketingChannel");
      } else if (step === 9) {
        ok = radioGroupChecked("preferredCommunicationChannel");
      }
      if (btn.dataset.originalText !== undefined) return;
      btn.disabled = !ok;
    }

    form.addEventListener("input", function (e) {
      updateContinueState(stepEls[currentStep]);
    });
    form.addEventListener("change", function (e) {
      updateContinueState(stepEls[currentStep]);
    });

    function resetWizard() {
      form.reset();
      Object.keys(branchSections).forEach(function (key) {
        clearSectionFields(branchSections[key]);
        branchSections[key].style.display = "none";
      });
      if (charCount) charCount.textContent = "0/" + maxLength + " characters used";
      resetOtpInputs();
      if (otpCountdownTimer) {
        clearInterval(otpCountdownTimer);
        otpCountdownTimer = null;
      }
      if (otpResendBtn) {
        otpResendBtn.disabled = true;
        otpResendBtn.innerHTML = 'Resend in <span id="etlOtpCountdown">01:00</span>';
        otpCountdownEl = document.getElementById("etlOtpCountdown");
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
        if (modal.classList.contains("etl-open")) {
          closeModal();
        } else {
          resetModalView();
          resetWizard();
          var preselect = trigger.getAttribute("data-link");
          if (preselect) {
            var radio = document.querySelector('input[name="service"][value="' + preselect + '"]');
            if (radio) {
              radio.checked = true;
              updateServiceDependentUI();
            }
          }
          modal.classList.add("etl-open");
          document.body.style.overflow = "hidden";
        }
        return;
      }
      if (e.target.closest(".etl-request-close")) closeModal();
    });

    function checkedValues(name) {
      return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (el) {
        return el.value;
      });
    }
    function checkedValue(name) {
      var el = document.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : "";
    }

    function buildPayload() {
      var selectedService = getSelectedService();
      var payload = {
        sourcePage: "service-guide",
        service: selectedService,
        fullName: document.getElementById("etlName").value.trim(),
        phone: "+251" + document.getElementById("etlPhone").value.trim(),
        weeklyFrequency: checkedValue("weeklyFrequency"),
        dailyServiceDuration: checkedValue("dailyServiceDuration"),
        preferredDays: buildWorkDays(),
        preferredServiceDate: buildPreferredServiceDateLabel(),
        serviceDate: serviceDateInput && serviceDateInput.value ? serviceDateInput.value : "",
        location: document.getElementById("etlLocation").value.trim(),
        landmark: document.getElementById("etlLandmark").value.trim(),
        marketingChannel: checkedValue("marketingChannel"),
        preferredCommunicationChannel: checkedValue("preferredCommunicationChannel"),
        taskDetails: document.getElementById("etlTask").value.trim(),
      };

      if (selectedService === "cooking") {
        var people = document.getElementById("etlNumberOfPeople").value;
        payload.numberOfPeople = people === "" ? undefined : Number(people);
        payload.cuisinePreference = checkedValues("cuisinePreference");
      } else if (selectedService === "cleaning") {
        var houseType = checkedValue("houseType");
        var rooms = document.getElementById("etlNumberOfRooms").value;
        payload.numberOfRooms = rooms === "" ? undefined : Number(rooms);
        payload.houseType = houseType;
        if (String(houseType).toLowerCase() === "apartment") payload.apartmentSize = apartmentSizeSelect.value;
        payload.extraCleaningServices = checkedValues("extraCleaningServices");
      } else if (selectedService === "nanny") {
        var childCount = document.getElementById("etlNumberOfChildren").value;
        payload.numberOfChildren = childCount === "" ? undefined : Number(childCount);
        payload.childAge = checkedValue("childAge");
      }
      return payload;
    }

    function submitRequest() {
      if (!validateStep(stepEls[10])) return;
      var submitBtn = document.getElementById("etlSubmitBtn");
      var originalLabel = submitBtn.textContent;
      hideFormError();
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";

      var payload = buildPayload();

      fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Request failed with status " + res.status);
          if (formWrap) formWrap.style.display = "none";
          if (formSuccess) formSuccess.style.display = "block";
          resetWizard();
        })
        .catch(function () {
          showFormError("Sorry, we could not submit your request. Please try again or call 9675.");
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      // Enter/mobile "Go" on an earlier step's input also fires this native submit
      // event (etlSubmitBtn is type="submit" and shares this <form> with every
      // step) - only treat it as a real submission once the wizard is on step 10.
      if (currentStep !== 10) return;
      submitRequest();
    });

    renderStep();
  })();
</script>
