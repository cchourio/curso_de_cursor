import type { Company, CreateCompanyInput, UpdateCompanyInput } from "@ff/domain";
import { listCompanies as listCompanyRows, schema, type Db } from "@ff/db";
import { eq } from "drizzle-orm";
import { ApiError } from "../http/errors";

function isConstraintError(error: unknown): boolean {
  const messages: string[] = [];
  if (error instanceof Error) {
    messages.push(error.message);
    if (error.cause instanceof Error) {
      messages.push(error.cause.message);
    }
  }
  return /constraint/i.test(messages.join("\n"));
}

export async function listCompanies(db: Db): Promise<Company[]> {
  return listCompanyRows(db);
}

export async function createCompany(db: Db, input: CreateCompanyInput, clock: () => Date): Promise<Company> {
  const existing = await db.select().from(schema.companies).where(eq(schema.companies.id, input.id));
  if (existing.length > 0) {
    throw new ApiError(409, "CONFLICT", "Ya existe una empresa con este id");
  }
  const now = clock().toISOString();
  try {
    await db.insert(schema.companies).values({
      id: input.id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isConstraintError(error)) {
      throw new ApiError(409, "CONFLICT", "Ya existe una empresa con este id");
    }
    throw error;
  }
  return { id: input.id, name: input.name, createdAt: now, updatedAt: now };
}

export async function updateCompany(
  db: Db,
  id: string,
  input: UpdateCompanyInput,
  clock: () => Date,
): Promise<Company> {
  const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  const current = rows[0];
  if (current === undefined) {
    throw new ApiError(404, "NOT_FOUND", "Empresa no encontrada");
  }
  const now = clock().toISOString();
  await db.update(schema.companies).set({ name: input.name, updatedAt: now }).where(eq(schema.companies.id, id));
  return { id: current.id, name: input.name, createdAt: current.createdAt, updatedAt: now };
}
