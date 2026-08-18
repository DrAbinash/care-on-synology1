import React, { useEffect, useRef, useState } from "react";
// Relative import, not the "@/" alias: this file is reached into directly
// by clinic-site (see book.tsx) whose "@" alias points at its OWN src, not
// diagnostic-erp's — an aliased import here would resolve to the wrong
// (non-existent) path when clinic-site's bundler processes it.
import { detectGenderFromName } from "../lib/nameGender";

/** A selectable appointment time slot in the online booking form. */
export type BookingTimeSlot = {
  value: string;
  label: string;
  maxBookings?: number | null;
  modality?: string;
  remaining?: number | null;
  available?: boolean;
};

/** Minimal referring-doctor option for the booking form's doctor picker. */
export type ReferringDoctorOption = { id: number; name: string; specialization?: string | null };

// Built-in fallback used when no configured slots are supplied (e.g. an older
// backend, or an admin who cleared the list). Kept in sync with the DB default
// in lib/db/src/schema/clinicSettings.ts (DEFAULT_BOOKING_TIME_SLOTS).
const DEFAULT_TIME_SLOTS: BookingTimeSlot[] = [
  { value: "07:00 – 10:00", label: "Morning (7:00 – 10:00 AM)" },
  { value: "10:00 – 13:00", label: "Late Morning (10:00 AM – 1:00 PM)" },
  { value: "13:00 – 16:00", label: "Afternoon (1:00 – 4:00 PM)" },
  { value: "16:00 – 19:00", label: "Evening (4:00 – 7:00 PM)" },
  { value: "19:00 – 21:00", label: "Night (7:00 – 9:00 PM)" },
];

export interface SelfRegistrationFormProps {
  mode: "online" | "kiosk" | "qr";
  initialValues: {
    firstName: string;
    lastName: string;
    phone: string;
    gender: "male" | "female" | "";
    ageValue: string;
    ageUnit: "years" | "months" | "days";
    email?: string;
    date?: string;
    timeSlot?: string;
    notes?: string;
    isVip?: boolean;
    referringDoctorId?: number | null;
    referringDoctorName?: string;
  };
  vipEnabled?: boolean;
  submitButtonText?: string;
  submitButtonClass?: string;
  submitting?: boolean;
  /** Configurable time-slot options for online booking; falls back to defaults. */
  timeSlots?: BookingTimeSlot[];
  /** Referring-doctor options; when provided, a "Referring Doctor" picker shows. */
  doctors?: ReferringDoctorOption[];
  onSubmit: (data: {
    firstName: string;
    lastName: string;
    phone: string;
    gender: "male" | "female";
    ageValue: number;
    ageUnit: "years" | "months" | "days";
    email?: string;
    date?: string;
    timeSlot?: string;
    slotModality?: string;
    notes?: string;
    isVip?: boolean;
    referringDoctorId?: number | null;
    referringDoctorName?: string;
  }) => void;
  /** Called when the appointment date changes so the parent can refresh slot occupancy. */
  onDateChange?: (date: string) => void;
  onBack?: () => void;
}

function slotOptionValue(s: BookingTimeSlot): string {
  return s.modality ? `${s.modality}::${s.value}` : s.value;
}

function parseSlotOption(raw: string): { timeSlot: string; slotModality: string } {
  const idx = raw.indexOf("::");
  if (idx > 0) return { slotModality: raw.slice(0, idx), timeSlot: raw.slice(idx + 2) };
  return { timeSlot: raw, slotModality: "" };
}

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export const SelfRegistrationForm: React.FC<SelfRegistrationFormProps> = ({
  mode,
  initialValues,
  vipEnabled = false,
  submitButtonText,
  submitButtonClass = "",
  timeSlots,
  doctors,
  onSubmit,
  onDateChange,
  onBack,
}) => {
  const isKiosk = mode === "kiosk";

  // Time-slot options: admin-configured list when supplied & non-empty,
  // otherwise the built-in defaults.
  const slotOptions: BookingTimeSlot[] =
    timeSlots && timeSlots.length > 0 ? timeSlots : DEFAULT_TIME_SLOTS;

  // Referring doctor picker (mirrors the Billing Desk picker). Only rendered
  // when a doctor list is provided. Optional — a walk-in has no referrer.
  const doctorList = doctors ?? [];
  const showDoctorPicker = doctorList.length > 0;
  const [referringDoctorId, setReferringDoctorId] = useState<number | null>(
    initialValues.referringDoctorId ?? null,
  );
  const [doctorSearch, setDoctorSearch] = useState("");
  const [doctorSearchOpen, setDoctorSearchOpen] = useState(false);
  const doctorRef = useRef<HTMLDivElement>(null);
  const selectedDoctor = doctorList.find((d) => d.id === referringDoctorId) || null;

  // Close the doctor dropdown when clicking outside the picker.
  useEffect(() => {
    if (!doctorSearchOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (doctorRef.current && !doctorRef.current.contains(e.target as Node)) {
        setDoctorSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [doctorSearchOpen]);

  const [firstName, setFirstName] = useState(initialValues.firstName);
  const [lastName, setLastName] = useState(initialValues.lastName);
  const [phone, setPhone] = useState(initialValues.phone);
  const [gender, setGender] = useState<"male" | "female" | "">(initialValues.gender);
  const [ageValue, setAgeValue] = useState(initialValues.ageValue);
  const [ageUnit, setAgeUnit] = useState<"years" | "months" | "days">(initialValues.ageUnit);

  // Suggestion, not a decision: auto-fill Gender from the name as it's
  // typed, but stop once the person picks a gender button themselves.
  const genderTouched = useRef(!!initialValues.gender);
  useEffect(() => {
    if (genderTouched.current) return;
    const suggested = detectGenderFromName(firstName);
    if (suggested) setGender(suggested);
  }, [firstName]);

  // Online booking only fields
  const [email, setEmail] = useState(initialValues.email || "");
  const [date, setDate] = useState(initialValues.date || "");
  const [timeSlot, setTimeSlot] = useState(initialValues.timeSlot || "");
  const [notes, setNotes] = useState(initialValues.notes || "");
  const [isVip, setIsVip] = useState(!!initialValues.isVip);

  const [error, setError] = useState("");
  const [errFields, setErrFields] = useState<string[]>([]);

  const handleGenderSelect = (val: "male" | "female") => {
    genderTouched.current = true;
    setGender(val);
    setErrFields(f => f.filter(x => x !== "gender"));
  };

  const doctorMatches = doctorSearch.trim()
    ? doctorList
        .filter((d) => d.name.toLowerCase().includes(doctorSearch.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  const selectDoctor = (d: ReferringDoctorOption) => {
    setReferringDoctorId(d.id);
    setDoctorSearch("");
    setDoctorSearchOpen(false);
  };
  const clearDoctor = () => {
    setReferringDoctorId(null);
    setDoctorSearch("");
    setDoctorSearchOpen(false);
  };

  // Referring-doctor picker, shared by both the kiosk and online layouts. The
  // caller passes the field/input classes so it blends with each form's styling.
  const renderDoctorPicker = (opts: {
    fieldClass: string;
    labelClass: string;
    inputClass: string;
    labelStyle?: React.CSSProperties;
  }) => {
    if (!showDoctorPicker) return null;
    return (
      <div className={opts.fieldClass} ref={doctorRef} style={{ position: "relative" }}>
        <label className={opts.labelClass} style={opts.labelStyle}>Referring Doctor</label>
        {selectedDoctor ? (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              padding: "0.5rem 0.75rem", background: "#eff6ff",
              border: "1px solid #bfdbfe", borderRadius: "8px",
            }}
          >
            <span style={{ fontWeight: 600, color: "#1e3a5f", flex: 1 }}>
              Dr. {selectedDoctor.name}
              {selectedDoctor.specialization ? (
                <span style={{ fontWeight: 400, color: "#64748b", marginLeft: "0.4rem", fontSize: "0.85em" }}>
                  {selectedDoctor.specialization}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={clearDoctor}
              aria-label="Clear referring doctor"
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <input
              className={opts.inputClass}
              placeholder="Search doctor (optional)…"
              value={doctorSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDoctorSearch(e.target.value); setDoctorSearchOpen(true); }}
              onFocus={() => setDoctorSearchOpen(true)}
              autoComplete="off"
            />
            {doctorSearchOpen && doctorSearch.trim() !== "" && (
              <div
                style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40,
                  marginTop: "4px", background: "#fff", border: "1px solid #dde3ec",
                  borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  maxHeight: "220px", overflowY: "auto",
                }}
              >
                {doctorMatches.length > 0 ? (
                  doctorMatches.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => selectDoctor(d)}
                      style={{
                        display: "flex", width: "100%", textAlign: "left",
                        alignItems: "center", gap: "0.5rem", padding: "0.55rem 0.75rem",
                        background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem",
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <span style={{ flex: 1 }}>Dr. {d.name}</span>
                      {d.specialization ? (
                        <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{d.specialization}</span>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div style={{ padding: "0.55rem 0.75rem", color: "#94a3b8", fontSize: "0.9rem" }}>
                    No doctor found
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const validate = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrFields([]);

    const prefixId = isKiosk ? "kiosk-" : "pd-";

    if (!firstName.trim()) {
      const msg = isKiosk ? "Please enter first name." : "Please enter your name.";
      setError(msg);
      setErrFields(["firstName"]);
      const el = document.getElementById(`${prefixId}firstName`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (!phone.trim() || cleanPhone.length !== 10) {
      setError("Please enter a valid mobile number.");
      setErrFields(["phone"]);
      const el = document.getElementById(`${prefixId}phone`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    if (!gender) {
      setError("Please select gender.");
      setErrFields(["gender"]);
      const el = document.getElementById(`${prefixId}gender`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    if (!ageValue || Number(ageValue) < 0) {
      setError("Please enter age.");
      setErrFields(["ageValue"]);
      const el = document.getElementById(`${prefixId}ageValue`);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const parsedSlot = parseSlotOption(timeSlot);
    onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      gender: gender as "male" | "female",
      ageValue: Number(ageValue),
      ageUnit,
      email,
      date,
      timeSlot: parsedSlot.timeSlot,
      slotModality: parsedSlot.slotModality,
      notes,
      isVip,
      referringDoctorId,
      referringDoctorName: selectedDoctor?.name || "",
    });
  };

  if (isKiosk) {
    return (
      <form onSubmit={validate} className="kiosk-form">
        <div className="kiosk-form-row">
          <div className="kiosk-field">
            <label className="kiosk-label">First Name *</label>
            <input
              id="kiosk-firstName"
              className="kiosk-input"
              placeholder="e.g. Ravi"
              value={firstName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setFirstName(e.target.value);
                setErrFields(f => f.filter(x => x !== "firstName"));
              }}
              maxLength={60}
              style={{ borderColor: errFields.includes("firstName") ? "red" : "" }}
            />
          </div>
          <div className="kiosk-field">
            <label className="kiosk-label">Last Name</label>
            <input
              className="kiosk-input"
              placeholder="e.g. Kumar"
              value={lastName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
              maxLength={60}
            />
          </div>
        </div>

        <div className="kiosk-form-row">
          <div className="kiosk-field">
            <label className="kiosk-label">Mobile Number *</label>
            <input
              id="kiosk-phone"
              className="kiosk-input"
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setPhone(e.target.value);
                setErrFields(f => f.filter(x => x !== "phone"));
              }}
              maxLength={15}
              inputMode="tel"
              style={{ borderColor: errFields.includes("phone") ? "red" : "" }}
            />
          </div>
          <div className="kiosk-field">
            <label className="kiosk-label">Gender *</label>
            <div
              id="kiosk-gender"
              className="kiosk-gender-row"
              style={{ outline: errFields.includes("gender") ? "2px solid red" : "", borderRadius: "4px" }}
            >
              {GENDERS.map(g => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => handleGenderSelect(g.value as "male" | "female")}
                  className={`kiosk-gender-btn${gender === g.value ? " kiosk-gender-active" : ""}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="kiosk-form-row">
          <div className="kiosk-field">
            <label className="kiosk-label">Age *</label>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "stretch" }}>
              <input
                id="kiosk-ageValue"
                className="kiosk-input"
                type="number"
                min="0"
                max="125"
                placeholder="Age Value *"
                value={ageValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setAgeValue(e.target.value);
                  setErrFields(f => f.filter(x => x !== "ageValue"));
                }}
                style={{ flex: 1, borderColor: errFields.includes("ageValue") ? "red" : "" }}
              />
              <select
                id="kiosk-ageUnit"
                className="kiosk-input"
                value={ageUnit}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAgeUnit(e.target.value as "years" | "months" | "days")}
                style={{ width: "140px", cursor: "pointer", appearance: "auto" }}
              >
                <option value="years">Years</option>
                <option value="months">Months</option>
                <option value="days">Days</option>
              </select>
            </div>
            <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>Enter age value and select unit. For newborns, use Months or Days.</p>
          </div>
        </div>

        {showDoctorPicker && (
          <div className="kiosk-form-row">
            {renderDoctorPicker({ fieldClass: "kiosk-field", labelClass: "kiosk-label", inputClass: "kiosk-input" })}
          </div>
        )}

        {vipEnabled && (
          <div className="kiosk-form-row">
            <div className="kiosk-field">
              <label className="kiosk-label" style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={isVip}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsVip(e.target.checked)}
                  style={{ width: "24px", height: "24px", cursor: "pointer" }}
                />
                <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>⭐ VIP Queue Priority (Priority Calling & Fast-track)</span>
              </label>
            </div>
          </div>
        )}

        {error && <p className="kiosk-error-msg">{error}</p>}

        <div className="kiosk-action-row">
          <button type="submit" className="kiosk-btn-primary kiosk-btn-lg">
            {submitButtonText || "Next: Select Tests →"}
          </button>
        </div>
      </form>
    );
  }

  // Online booking mode
  return (
    <form onSubmit={validate} className="card-soft grid gap-3" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h3 style={{ fontWeight: 700, marginBottom: ".25rem" }}>Your Details</h3>
      
      {error && (
        <div style={{ color: "red", fontSize: ".85rem", padding: ".5rem .75rem", background: "hsl(0 85% 95%)", borderRadius: "var(--site-radius)" }}>
          {error}
        </div>
      )}

      <input
        id="pd-firstName"
        className="input-soft"
        placeholder="Full name *"
        required
        value={firstName}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setFirstName(e.target.value.toUpperCase());
          setErrFields(f => f.filter(x => x !== "firstName"));
        }}
        style={{ borderColor: errFields.includes("firstName") ? "red" : "" }}
      />

      <input
        id="pd-phone"
        className="input-soft"
        placeholder="Phone number *"
        required
        value={phone}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setPhone(e.target.value);
          setErrFields(f => f.filter(x => x !== "phone"));
        }}
        style={{ borderColor: errFields.includes("phone") ? "red" : "" }}
      />

      <input
        className="input-soft"
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
      />

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          id="pd-ageValue"
          className="input-soft"
          type="number"
          min="0"
          max="125"
          placeholder="Age Value *"
          required
          value={ageValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setAgeValue(e.target.value);
            setErrFields(f => f.filter(x => x !== "ageValue"));
          }}
          style={{ flex: 1, borderColor: errFields.includes("ageValue") ? "red" : "" }}
        />
        <select
          id="pd-ageUnit"
          className="input-soft"
          value={ageUnit}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAgeUnit(e.target.value as "years" | "months" | "days")}
          style={{ width: "120px" }}
        >
          <option value="years">Years</option>
          <option value="months">Months</option>
          <option value="days">Days</option>
        </select>
      </div>

      <div id="pd-gender" style={{ display: "flex", gap: "0.5rem" }}>
        {GENDERS.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => handleGenderSelect(g.value as "male" | "female")}
            style={{
              flex: 1,
              padding: "0.7rem 0.5rem",
              borderRadius: "8px",
              border: gender === g.value ? "2px solid #2563eb" : "1px solid " + (errFields.includes("gender") ? "red" : "#d1d5db"),
              background: gender === g.value ? "#eff6ff" : "#fff",
              color: gender === g.value ? "#1d4ed8" : "#374151",
              fontWeight: gender === g.value ? 700 : 500,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      <input
        className="input-soft"
        type="date"
        required
        value={date}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setDate(e.target.value);
          onDateChange?.(e.target.value);
        }}
        min={new Date().toISOString().slice(0, 10)}
      />

      <select
        className="input-soft"
        required
        value={timeSlot}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTimeSlot(e.target.value)}
      >
        <option value="">Select time slot</option>
        {slotOptions.map((s) => (
          <option key={slotOptionValue(s)} value={slotOptionValue(s)} disabled={s.available === false}>
            {s.label}{s.remaining != null ? ` (${s.remaining} left)` : ""}{s.available === false ? " — full" : ""}
          </option>
        ))}
      </select>

      {renderDoctorPicker({ fieldClass: "", labelClass: "", inputClass: "input-soft", labelStyle: { display: "block", marginBottom: "0.25rem", fontSize: "0.9rem", fontWeight: 500 } })}

      <textarea
        className="input-soft"
        placeholder="Special instructions (optional)"
        rows={2}
        value={notes}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
      />

      {vipEnabled && (
        <label style={{ display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer", fontSize: ".92rem" }}>
          <input
            type="checkbox"
            checked={isVip}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsVip(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span>⭐ VIP Queue — priority service</span>
        </label>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="input-soft"
            style={{ width: "auto", cursor: "pointer" }}
          >
            Back
          </button>
        )}
        <button
          type="submit"
          className={submitButtonClass}
          style={{ flex: 1, justifyContent: "center" }}
        >
          {submitButtonText || "Next: Choose Tests →"}
        </button>
      </div>
    </form>
  );
};
