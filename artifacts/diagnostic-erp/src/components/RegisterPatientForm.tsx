import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus } from "lucide-react";

export interface NewPatientData {
  firstName: string;
  lastName: string;
  phone: string;
  gender: "male" | "female" | "other";
  ageValue: string | number;
  ageUnit: "years" | "months" | "days";
  email?: string;
  address?: string;
}

const GENDERS = ["male", "female", "other"];

interface RegisterPatientFormProps {
  newPatient: NewPatientData;
  onPatientChange: (data: NewPatientData) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

export function RegisterPatientForm({
  newPatient,
  onPatientChange,
  onSubmit,
  isLoading = false,
}: RegisterPatientFormProps) {
  // Only a name is required. Single-word names like "Ramesh" fill firstName only
  // and leave lastName empty — that must not block registration.
  // Phone, age, and sex are strongly encouraged but not required to submit.
  const hasName = !!(newPatient.firstName?.trim() || newPatient.lastName?.trim());
  const isFormValid = hasName && !isLoading;

  // The Name textbox shows exactly what the user is typing — including a
  // trailing space while they're in the middle of typing a surname. This is
  // intentionally NOT derived from firstName/lastName on every render (that
  // was the bug: reconstructing "firstName + lastName" and trimming it
  // erased any space the instant it was typed, making the spacebar appear
  // broken). It's reset from the parent only when the parent's name changes
  // out from under us (e.g. clearing the form after registration).
  const [nameText, setNameText] = useState(`${newPatient.firstName} ${newPatient.lastName}`.trim());
  const lastSyncedName = useRef(nameText);
  useEffect(() => {
    const parentName = `${newPatient.firstName} ${newPatient.lastName}`.trim();
    // Only overwrite local text if the parent's name changed for a reason
    // OTHER than our own onChange below (e.g. form reset, patient search
    // picked a different record) — otherwise this would fight the user's
    // typing the same way the old derived-value bug did.
    if (parentName !== lastSyncedName.current) {
      setNameText(parentName);
      lastSyncedName.current = parentName;
    }
  }, [newPatient.firstName, newPatient.lastName]);

  return (
    <div className="space-y-3">
      {/* LINE 1: Name / Age / Sex */}
      <div className="flex flex-wrap gap-2">
        {/* Name */}
        <div className="flex-1 min-w-[140px] space-y-0.5">
          <Label className="text-xs font-extrabold">Name *</Label>
          <Input
            value={nameText}
            onChange={(e) => {
              const raw = e.target.value;
              setNameText(raw);
              const trimmed = raw.trim();
              const parts = trimmed.split(/\s+/);
              const first = parts[0] || "";
              const last = parts.slice(1).join(" ") || "";
              lastSyncedName.current = trimmed;
              onPatientChange({
                ...newPatient,
                firstName: first,
                lastName: last,
              });
            }}
            placeholder="Full name (e.g. Rohit Kumar)"
            className="h-8 text-xs"
          />
        </div>

        {/* Age with dropdown — widened per Dr. Abinash's request for easier entry/reading */}
        <div className="w-[165px] space-y-0.5">
          <Label className="text-xs font-extrabold">Age</Label>
          <div className="flex gap-1">
            <Input
              type="number"
              min={0}
              max={newPatient.ageUnit === "years" ? 120 : 365}
              value={newPatient.ageValue}
              onChange={(e) =>
                onPatientChange({
                  ...newPatient,
                  ageValue: e.target.value,
                })
              }
              placeholder="0"
              className="h-8 text-xs flex-[1.3]"
            />
            <Select
              value={newPatient.ageUnit}
              onValueChange={(v) =>
                onPatientChange({
                  ...newPatient,
                  ageUnit: v as "years" | "months" | "days",
                })
              }
            >
              <SelectTrigger className="h-8 text-xs w-[68px] px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="years">Years</SelectItem>
                <SelectItem value="months">Months</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Sex — reduced width, it's just a 1-word dropdown */}
        <div className="w-[78px] space-y-0.5">
          <Label className="text-xs font-extrabold">Sex</Label>
          <Select
            value={newPatient.gender}
            onValueChange={(v) =>
              onPatientChange({
                ...newPatient,
                gender: v as "male" | "female" | "other",
              })
            }
          >
            <SelectTrigger className="h-8 text-xs px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENDERS.map((g) => (
                <SelectItem key={g} value={g} className="capitalize">
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* LINE 2: Phone + Address — combined into one row to save vertical
          space on small screens. Address becomes a single-line input here
          (was a 3-row textarea); full multi-line address can still be
          edited later from the patient's profile if ever needed. Both
          fields remain optional, matching prior behavior. */}
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[120px] space-y-0.5">
          <Label className="text-xs font-extrabold">Phone <span className="text-[10px] font-normal text-slate-400">(optional)</span></Label>
          <Input
            value={newPatient.phone}
            onChange={(e) =>
              onPatientChange({ ...newPatient, phone: e.target.value })
            }
            placeholder="Mobile (optional for walk-in)"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1 min-w-[140px] space-y-0.5">
          <Label className="text-xs font-extrabold">Address <span className="text-[10px] font-normal text-slate-400">(optional)</span></Label>
          <Input
            value={newPatient.address || ""}
            onChange={(e) =>
              onPatientChange({ ...newPatient, address: e.target.value })
            }
            placeholder="Optional - Patient's address"
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Submit Button */}
      <Button
        onClick={onSubmit}
        disabled={!isFormValid}
        className="w-full h-9 bg-indigo-900 hover:bg-indigo-950 text-white font-semibold text-sm"
      >
        {isLoading ? "Registering…" : <><UserPlus size={14} className="mr-2" /> Register & Select</>}
      </Button>
    </div>
  );
}
