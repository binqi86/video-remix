import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export function validateFields(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        next(new Error(`参数校验失败: ${messages}`));
      } else {
        next(err);
      }
    }
  };
}

export function success(res: Response, data: any = null, message: string = "ok") {
  return res.json({ success: true, message, data });
}

export function fail(res: Response, message: string = "error", statusCode: number = 400) {
  return res.status(statusCode).json({ success: false, message });
}
