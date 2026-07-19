import { Router } from "express";
import tileImages from "./tile";

const router = Router();
router.post("/tile", tileImages);

export default router;
