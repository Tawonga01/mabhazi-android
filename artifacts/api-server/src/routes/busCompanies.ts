import { Router, type IRouter, type Request, type Response } from "express";
import { db, busCompaniesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/bus-companies", async (_req: Request, res: Response) => {
  const companies = await db
    .select({ id: busCompaniesTable.id, name: busCompaniesTable.name })
    .from(busCompaniesTable)
    .where(eq(busCompaniesTable.active, true))
    .orderBy(asc(busCompaniesTable.name));
  res.json({ companies });
});

export default router;
