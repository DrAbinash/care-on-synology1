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

  return (
    <div className="space-y-3">
      {/* LINE 1: Name / Age / Sex */}
      <div className="flex flex-wrap gap-2">
        {/* Name */}
        <div className="flex-1 min-w-[200px] space-y-0.5">
          <Label className="text-xs font-extrabold">Name *</Label>
          <Input
            value={`${newPatient.firstName} ${newPatient.lastName}`.trim()}
            onChange={(e) => {
              const parts = e.target.value.trim().split(/\s+/);
              const first = parts[0] || "";
              const last = parts.slice(1).join(" ") || "";
              onPatientChange({
                ...newPatient,
                firstName: first,
                lastName: last,
              });
            }}
            placeholder="Full name"
            className="h-8 text-xs"
          />
        </div>

        {/* Age with dropdown */}
        <div className="w-[120px] space-y-0.5">
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
              className="h-8 text-xs flex-1"
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
              <SelectTrigger className="h-8 text-xs w-[60px] px-2">
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

        {/* Sex */}
        <div className="w-[90px] space-y-0.5">
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

      {/* LINE 2: Phone */}
      <div className="space-y-0.5">
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

      {/* LINE 3: Address (3 lines of text) */}
      <div className="space-y-0.5">
        <Label className="text-xs font-extrabold">Address</Label>
        <textarea
          value={newPatient.address || ""}
          onChange={(e) =>
            onPatientChange({ ...newPatient, address: e.target.value })
          }
          placeholder="Optional - Patient's full address"
          rows={3}
          className="w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
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
