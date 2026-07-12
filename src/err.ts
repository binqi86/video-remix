import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("[Error]", err.message);
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: err.message });
  } else {
    res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
  }
}
