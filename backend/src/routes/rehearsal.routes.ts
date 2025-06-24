import express from 'express';
import { body, param, query } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/rehearsals:
 *   post:
 *     summary: Create a new rehearsal
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bandId
 *               - title
 *               - location
 *               - startDatetime
 *               - endDatetime
 *             properties:
 *               bandId:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               location:
 *                 type: string
 *               startDatetime:
 *                 type: string
 *                 format: date-time
 *               endDatetime:
 *                 type: string
 *                 format: date-time
 *               isRecurring:
 *                 type: boolean
 *               recurrencePattern:
 *                 type: string
 *     responses:
 *       201:
 *         description: Rehearsal created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to create rehearsals for this band
 *       404:
 *         description: Band not found
 */
router.post(
  '/',
  authenticate,
  [
    body('bandId').isUUID().withMessage('Valid band ID is required'),
    body('title').notEmpty().withMessage('Title is required'),
    body('location').notEmpty().withMessage('Location is required'),
    body('startDatetime').isISO8601().toDate().withMessage('Valid start date and time required'),
    body('endDatetime').isISO8601().toDate().withMessage('Valid end date and time required'),
    body('isRecurring').optional().isBoolean().withMessage('isRecurring must be a boolean'),
    body('recurrencePattern').optional().isString().withMessage('recurrencePattern must be a string'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const {
        bandId,
        title,
        description,
        location,
        startDatetime,
        endDatetime,
        isRecurring,
        recurrencePattern,
      } = req.body;

      // Check if start is before end
      if (new Date(startDatetime) >= new Date(endDatetime)) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be before end time',
          error: 'Bad Request',
        });
      }

      // Check if user is a member of the band with leader role
      const membership = await prisma.bandMember.findFirst({
        where: {
          bandId,
          userId: req.user!.id,
          role: 'LEADER',
        },
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'You must be a band leader to create rehearsals',
          error: 'Forbidden',
        });
      }

      // Create rehearsal
      const rehearsal = await prisma.rehearsal.create({
        data: {
          bandId,
          title,
          description,
          location,
          startDatetime: new Date(startDatetime),
          endDatetime: new Date(endDatetime),
          isRecurring: isRecurring || false,
          recurrencePattern,
          createdById: req.user!.id,
        },
      });

      // Get all band members
      const bandMembers = await prisma.bandMember.findMany({
        where: { bandId, status: 'ACTIVE' },
        select: { userId: true },
      });

      // Create attendance records for all members
      const attendanceData = bandMembers.map((member) => ({
        rehearsalId: rehearsal.id,
        userId: member.userId,
      }));

      await prisma.rehearsalAttendance.createMany({
        data: attendanceData,
      });

      // Create notifications for all members
      const notificationsData = bandMembers
        .filter((member) => member.userId !== req.user!.id) // Don't notify the creator
        .map((member) => ({
          userId: member.userId,
          type: 'NEW_REHEARSAL',
          content: `New rehearsal: ${title} on ${new Date(startDatetime).toLocaleString()}`,
          relatedId: rehearsal.id,
        }));

      if (notificationsData.length > 0) {
        await prisma.notification.createMany({
          data: notificationsData,
        });
      }

      // Get the created rehearsal with attendance
      const createdRehearsal = await prisma.rehearsal.findUnique({
        where: { id: rehearsal.id },
        include: {
          attendance: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: 'Rehearsal created successfully',
        data: createdRehearsal,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/rehearsals:
 *   get:
 *     summary: Get rehearsals for user's bands
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: bandId
 *         schema:
 *           type: string
 *         description: Optional band ID to filter rehearsals
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional start date to filter rehearsals
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional end date to filter rehearsals
 *     responses:
 *       200:
 *         description: List of rehearsals
 *       401:
 *         description: Not authenticated
 */
router.get(
  '/',
  authenticate,
  [
    query('bandId').optional().isUUID().withMessage('Invalid band ID format'),
    query('from').optional().isISO8601().withMessage('Invalid from date format'),
    query('to').optional().isISO8601().withMessage('Invalid to date format'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { bandId, from, to } = req.query;

      // Get all bands the user is a member of
      const userBands = await prisma.bandMember.findMany({
        where: {
          userId: req.user!.id,
          status: 'ACTIVE',
        },
        select: { bandId: true },
      });

      const bandIds = userBands.map((b) => b.bandId);

      if (bandIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      // Build filter
      const filter: any = {
        bandId: bandId ? { equals: bandId as string } : { in: bandIds },
      };

      if (from || to) {
        filter.startDatetime = {};

        if (from) {
          filter.startDatetime.gte = new Date(from as string);
        }

        if (to) {
          filter.startDatetime.lte = new Date(to as string);
        }
      }

      // Get rehearsals
      const rehearsals = await prisma.rehearsal.findMany({
        where: filter,
        include: {
          band: {
            select: {
              name: true,
            },
          },
          attendance: {
            where: {
              userId: req.user!.id,
            },
            select: {
              status: true,
            },
          },
        },
        orderBy: {
          startDatetime: 'asc',
        },
      });

      res.status(200).json({
        success: true,
        data: rehearsals,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/rehearsals/{id}:
 *   get:
 *     summary: Get a single rehearsal by ID
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rehearsal details
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to access this rehearsal
 *       404:
 *         description: Rehearsal not found
 */
router.get(
  '/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid rehearsal ID'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const rehearsal = await prisma.rehearsal.findUnique({
        where: { id },
        include: {
          band: true,
          attendance: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profileImageUrl: true,
                },
              },
            },
          },
          materials: {
            include: {
              uploadedBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!rehearsal) {
        return res.status(404).json({
          success: false,
          message: 'Rehearsal not found',
          error: 'Not Found',
        });
      }

      // Check if user is a member of the band
      const membership = await prisma.bandMember.findFirst({
        where: {
          bandId: rehearsal.bandId,
          userId: req.user!.id,
        },
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this rehearsal',
          error: 'Forbidden',
        });
      }

      res.status(200).json({
        success: true,
        data: rehearsal,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/rehearsals/{id}/attendance:
 *   post:
 *     summary: Update attendance status for a rehearsal
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [CONFIRMED, MAYBE, DECLINED]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Attendance updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Rehearsal or attendance record not found
 */
router.post(
  '/:id/attendance',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid rehearsal ID'),
    body('status').isIn(['CONFIRMED', 'MAYBE', 'DECLINED']).withMessage('Status must be CONFIRMED, MAYBE, or DECLINED'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      // Find the attendance record
      const attendance = await prisma.rehearsalAttendance.findUnique({
        where: {
          rehearsalId_userId: {
            rehearsalId: id,
            userId: req.user!.id,
          },
        },
      });

      if (!attendance) {
        return res.status(404).json({
          success: false,
          message: 'Attendance record not found',
          error: 'Not Found',
        });
      }

      // Update attendance
      const updatedAttendance = await prisma.rehearsalAttendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status,
          reason,
          responseTime: new Date(),
        },
        include: {
          rehearsal: {
            select: {
              title: true,
              bandId: true,
            },
          },
        },
      });

      // Notify band leader if declined
      if (status === 'DECLINED') {
        const bandLeaders = await prisma.bandMember.findMany({
          where: {
            bandId: updatedAttendance.rehearsal.bandId,
            role: 'LEADER',
          },
          select: {
            userId: true,
          },
        });

        const user = await prisma.user.findUnique({
          where: { id: req.user!.id },
          select: { name: true },
        });

        const notificationsData = bandLeaders
          .filter((leader) => leader.userId !== req.user!.id)
          .map((leader) => ({
            userId: leader.userId,
            type: 'ATTENDANCE_UPDATE',
            content: `${user?.name} can't make it to "${updatedAttendance.rehearsal.title}"${reason ? `: ${reason}` : ''}`,
            relatedId: id,
          }));

        if (notificationsData.length > 0) {
          await prisma.notification.createMany({
            data: notificationsData,
          });
        }
      }

      res.status(200).json({
        success: true,
        message: 'Attendance updated successfully',
        data: updatedAttendance,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;