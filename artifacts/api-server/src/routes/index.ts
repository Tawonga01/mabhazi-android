import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import journeysRouter from "./journeys";
import associationsRouter from "./associations";
import adminRouter from "./admin";
import busCompaniesRouter from "./busCompanies";
import legalRouter from "./legal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(journeysRouter);
router.use(associationsRouter);
router.use(busCompaniesRouter);
router.use(adminRouter);
router.use(legalRouter);

export default router;
