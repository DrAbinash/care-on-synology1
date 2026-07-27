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
import { detectGenderFromName } from "@/lib/nameGender";

export interface NewPatientData {
  firstName: string;
  lastName: string;
  phone: string;
  gender: "male" | "female" | "";
  ageValue: string | number;
  ageUnit: "years" | "months" | "days";
  email?: string;
  address?: string;
}

const GENDERS = ["male", "female"];

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
  const hasName = !!(newPatient.firstName?.trim() || newPatient.lastName?.trim());
  const isFormValid = hasName && !!newPatient.gender && !isLoading;

  const [nameText, setNameText] = useState(`${newPatient.firstName} ${newPatient.lastName}`.trim());
  const lastSyncedName = useRef(nameText);
  const genderTouched = useRef(false);
  const patientRef = useRef(newPatient);
  patientRef.current = newPatient;

  useEffect(() => {
    const parentName = `${newPatient.firstName} ${newPatient.lastName}`.trim();
    if (parentName !== lastSyncedName.current) {
      setNameText(parentName);
      lastSyncedName.current = parentName;
      if (!parentName) {
        genderTouched.current = false;
      }
    }
  }, [newPatient.firstName, newPatient.lastName]);

  // Auto-detect sex from the full name as it is typed (same pattern as kiosk /
  // self-registration). Default gender is empty — not "male" — so a successful
  // suggestion is always visible to staff.
  useEffect(() => {
    if (genderTouched.current) return;
    const trimmed = nameText.trim();
    if (!trimmed) return;
    const suggested = detectGenderFromName(trimmed);
    if (suggested && suggested !== patientRef.current.gender) {
      onPatientChange({ ...patientRef.current, gender: suggested });
    }
  }, [nameText, onPatientChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
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

        <div className="w-[78px] space-y-0.5">
          <Label className="text-xs font-extrabold">Sex *</Label>
          <Select
            value={newPatient.gender || undefined}
            onValueChange={(v) => {
              genderTouched.current = true;
              onPatientChange({
                ...newPatient,
                gender: v as "male" | "female",
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs px-2">
              <SelectValue placeholder="—" />
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
