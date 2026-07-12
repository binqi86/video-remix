import { Router } from "express";
import listTasks from "./listTasks";
import getTaskStatus from "./getTaskStatus";

const router = Router();
router.get("/listTasks", listTasks);
router.get("/getTaskStatus", getTaskStatus);

export default router;
