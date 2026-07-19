import { z } from "zod";

export const SelfRegistrationSchema = z.object({
  firstName: z.string().min(1, { message: "Please enter first name." }),
  lastName: z.string().max(100).default(""),
  phone: z.string().refine((val: string) => val.replace(/\D/g, "").length === 10, { message: "Please enter a valid mobile number." }),
  gender: z.enum(["male", "female"], { message: "Please select gender." }),
  ageValue: z.number().int().min(0, { message: "Please enter age." }),
  ageUnit: z.enum(["years", "months", "days"], { message: "Please select a valid age unit." }),
  isVip: z.boolean().optional(),
});

export type SelfRegistrationData = z.infer<typeof SelfRegistrationSchema>;
