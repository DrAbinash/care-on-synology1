import React, { useState } from "react";

export interface SelfRegistrationFormProps {
  mode: "online" | "kiosk" | "qr";
  initialValues: {
    firstName: string;
    lastName: string;
    phone: string;
    gender: "male" | "female" | "other" | "";
    ageValue: string;
    ageUnit: "years" | "months" | "days";
    email?: string;
    date?: string;
    timeSlot?: string;
    notes?: string;
    isVip?: boolean;
  };
  vipEnabled?: boolean;
  submitButtonText?: string;
  submitButtonClass?: string;
  submitting?: boolean;
  onSubmit: (data: {
    firstName: string;
    lastName: string;
    phone: string;
    gender: "male" | "female" | "other";
    ageValue: number;
    ageUnit: "years" | "months" | "days";
    email?: string;
    date?: string;
    timeSlot?: string;
    notes?: string;
    isVip?: boolean;
  }) => void;
  onBack?: () => void;
}

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

export const SelfRegistrationForm: React.FC<SelfRegistrationFormProps> = ({
  mode,
  initialValues,
  vipEnabled = false,
  submitButtonText,
  submitButtonClass = "",
  onSubmit,
  onBack,
}) => {
  const isKiosk = mode === "kiosk";

  const [firstName, setFirstName] = useState(initialValues.firstName);
  const [lastName, setLastName] = useState(initialValues.lastName);
  const [phone, setPhone] = useState(initialValues.phone);
  const [gender, setGender] = useState<"male" | "female" | "other" | "">(initialValues.gender);
  const [ageValue, setAgeValue] = useState(initialValues.ageValue);
  const [ageUnit, setAgeUnit] = useState<"years" | "months" | "days">(initialValues.ageUnit);

  // Online booking only fields
  const [email, setEmail] = useState(initialValues.email || "");
  const [date, setDate] = useState(initialValues.date || "");
  const [timeSlot, setTimeSlot] = useState(initialValues.timeSlot || "");
  const [notes, setNotes] = useState(initialValues.notes || "");
  const [isVip, setIsVip] = useState(!!initialValues.isVip);

  const [error, setError] = useState("");
  const [errFields, setErrFields] = useState<string[]>([]);

  const handleGenderSelect = (val: "male" | "female" | "other") => {
    setGender(val);
    setErrFields(f => f.filter(x => x !== "gender"));
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

    onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      gender: gender as "male" | "female" | "other",
      ageValue: Number(ageValue),
      ageUnit,
      email,
      date,
      timeSlot,
      notes,
      isVip,
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
                  onClick={() => handleGenderSelect(g.value as "male" | "female" | "other")}
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
            onClick={() => handleGenderSelect(g.value as "male" | "female" | "other")}
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
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
        min={new Date().toISOString().slice(0, 10)}
      />

      <select
        className="input-soft"
        required
        value={timeSlot}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTimeSlot(e.target.value)}
      >
        <option value="">Select time slot</option>
        <option value="07:00 – 10:00">Morning (7:00 – 10:00 AM)</option>
        <option value="10:00 – 13:00">Late Morning (10:00 AM – 1:00 PM)</option>
        <option value="13:00 – 16:00">Afternoon (1:00 – 4:00 PM)</option>
        <option value="16:00 – 19:00">Evening (4:00 – 7:00 PM)</option>
        <option value="19:00 – 21:00">Night (7:00 – 9:00 PM)</option>
      </select>

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
