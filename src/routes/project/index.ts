import { Router } from "express";
import addProject from "./addProject";
import getProject from "./getProject";
import listProjects from "./listProjects";
import editProject from "./editProject";
import delProject from "./delProject";

const router = Router();
router.post("/addProject", addProject);
router.get("/getProject", getProject);
router.get("/listProjects", listProjects);
router.put("/editProject", editProject);
router.delete("/delProject", delProject);

export default router;
