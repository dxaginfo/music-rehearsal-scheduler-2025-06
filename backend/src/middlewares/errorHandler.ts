import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface CustomError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  
  // Log the error details
  logger.error(`${statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  
  // Handle specific error types
  if (err.code === 'P2002') {
    // Prisma unique constraint violation
    return res.status(409).json({
      success: false,
      message: 'A record with this data already exists',
      error: 'Conflict',
    });
  }
  
  if (err.code === 'P2025') {
    // Prisma record not found
    return res.status(404).json({
      success: false,
      message: 'The requested resource was not found',
      error: 'Not Found',
    });
  }
  
  // Handle general errors
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Something went wrong on the server',
    error: statusCode >= 500 ? 'Server Error' : err.name,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};