import { z } from "zod";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const nameSchema = z.string().trim().min(1).max(100);

const descriptionSchema = z.string().trim().max(500);

export const flagKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/);

export const reasonSchema = z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres");

export const isoDateSchema = z.string().regex(ISO_DATE, "Fecha inválida").refine((value) => {
  const match = ISO_DATE.exec(value);
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "Fecha inválida");

export const createFlagInputSchema = z.object({
  key: flagKeySchema,
  name: nameSchema,
  description: descriptionSchema.optional().transform((value): string | null => {
    if (value === undefined || value === "") {
      return null;
    }
    return value;
  }),
  owner: nameSchema,
  expiresAt: isoDateSchema,
  reason: reasonSchema,
});

export const updateFlagInputSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional().transform((value): string | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === "") {
        return null;
      }
      return value;
    }),
    owner: nameSchema.optional(),
    expiresAt: isoDateSchema.optional(),
    reason: reasonSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.name === undefined &&
      value.description === undefined &&
      value.owner === undefined &&
      value.expiresAt === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Debe incluir al menos un campo además del motivo",
        path: ["name"],
      });
    }
  });

export const killSwitchInputSchema = z.object({
  enabled: z.boolean(),
  reason: reasonSchema,
});

export const reasonOnlyInputSchema = z.object({
  reason: reasonSchema,
});

export const companyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);

export const createCompanyInputSchema = z.object({
  id: companyIdSchema,
  name: nameSchema,
});

export const updateCompanyInputSchema = z.object({
  name: nameSchema,
});

export type CreateFlagInput = z.infer<typeof createFlagInputSchema>;
export type UpdateFlagInput = z.infer<typeof updateFlagInputSchema>;
export type KillSwitchInput = z.infer<typeof killSwitchInputSchema>;
export type ReasonOnlyInput = z.infer<typeof reasonOnlyInputSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>;
