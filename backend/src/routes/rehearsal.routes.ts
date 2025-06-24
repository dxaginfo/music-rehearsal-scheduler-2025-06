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
 *               - startDatetime
 *               - endDatetime
 *               - location
 *             properties:
 *               bandId:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               startDatetime:
 *                 type: string
 *                 format: date-time
 *               endDatetime:
 *                 type: string
 *                 format: date-time
 *               location:
 *                 type: string
 *               isRecurring:
 *                 type: boolean
 *               recurrencePattern:
 *                 type: object
 *     responses:
 *       201:
 *         description: Rehearsal created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to create rehearsals
 */
router.post(
  '/',
  authenticate,
  [
    body('bandId').isUUID().withMessage('Valid band ID is required'),
    body('title').notEmpty().withMessage('Title is required'),
    body('startDatetime').isISO8601().toDate().withMessage('Valid start date/time is required'),
    body('endDatetime').isISO8601().toDate().withMessage('Valid end date/time is required'),
    body('location').notEmpty().withMessage('Location is required'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('isRecurring').optional().isBoolean().withMessage('isRecurring must be a boolean'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { 
        bandId, 
        title, 
        description, 
        startDatetime, 
        endDatetime, 
        location,
        isRecurring = false,
        recurrencePattern = null
      } = req.body;

      // Check if user is a band member
      const userMembership = await prisma.bandMember.findFirst({
        where: {
          bandId,
          userId: req.user!.id,
          status: 'ACTIVE',
        },
      });

      if (!userMembership) {
        return res.status(403).json({
          success: false,
          message: 'You must be a band member to create rehearsals',
          error: 'Forbidden',
        });
      }

      // Validate times
      if (new Date(startDatetime) >= new Date(endDatetime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time',
          error: 'Bad Request',
        });
      }

      // Create rehearsal
      const rehearsal = await prisma.rehearsal.create({
        data: {
          bandId,
          title,
          description,
          startDatetime: new Date(startDatetime),
          endDatetime: new Date(endDatetime),
          location,
          isRecurring,
          recurrencePattern: recurrencePattern ? JSON.stringify(recurrencePattern) : null,
          createdById: req.user!.id,
        },
      });

      // Create attendance records for all band members
      const bandMembers = await prisma.bandMember.findMany({
        where: {
          bandId,
          status: 'ACTIVE',
        },
        select: {
          userId: true,
        },
      });

      await prisma.rehearsalAttendance.createMany({
        data: bandMembers.map((member) => ({
          rehearsalId: rehearsal.id,
          userId: member.userId,
          status: 'PENDING',
        })),
      });

      // Create notifications for all band members
      await prisma.notification.createMany({
        data: bandMembers
          .filter((member) => member.userId !== req.user!.id) // Don't notify creator
          .map((member) => ({
            userId: member.userId,
            type: 'NEW_REHEARSAL',
            content: `New rehearsal: ${title}`,
            relatedId: rehearsal.id,
          })),
      });

      res.status(201).json({
        success: true,
        message: 'Rehearsal created successfully',
        data: rehearsal,
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
 *     summary: Get rehearsals for the current user
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: bandId
 *         schema:
 *           type: string
 *       - in: query
 *         name: upcoming
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: past
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
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
    query('bandId').optional().isUUID().withMessage('Invalid band ID'),
    query('upcoming').optional().isBoolean().withMessage('Upcoming must be a boolean'),
    query('past').optional().isBoolean().withMessage('Past must be a boolean'),
    query('start').optional().isISO8601().withMessage('Invalid start date'),
    query('end').optional().isISO8601().withMessage('Invalid end date'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { bandId, upcoming, past, start, end } = req.query;

      // Get bands where the user is a member
      const userBands = await prisma.bandMember.findMany({
        where: {
          userId: req.user!.id,
          status: 'ACTIVE',
          ...(bandId && { bandId: bandId as string }),
        },
        select: {
          bandId: true,
        },
      });

      if (userBands.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      // Build query filters
      const bandIds = userBands.map((band) => band.bandId);

      const dateFilter: any = {};
      const now = new Date();

      if (upcoming === 'true') {
        dateFilter.startDatetime = { gte: now };
      } else if (past === 'true') {
        dateFilter.endDatetime = { lt: now };
      } else if (start && end) {
        dateFilter.AND = [
          { startDatetime: { gte: new Date(start as string) } },
          { endDatetime: { lte: new Date(end as string) } },
        ];
      }

      // Get rehearsals
      const rehearsals = await prisma.rehearsal.findMany({
        where: {
          bandId: { in: bandIds },
          ...dateFilter,
        },
        include: {
          band: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: { attendances: true },
          },
          attendances: {
            where: {
              userId: req.user!.id,
            },
            select: {
              status: true,
            },
          },
        },
        orderBy: {
          startDatetime: upcoming === 'true' ? 'asc' : 'desc',
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
 *     summary: Get a rehearsal by ID
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
 *         description: Not authorized to view this rehearsal
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

      // Get rehearsal with band info
      const rehearsal = await prisma.rehearsal.findUnique({
        where: { id },
        include: {
          band: {
            include: {
              members: {
                where: {
                  userId: req.user!.id,
                  status: 'ACTIVE',
                },
              },
            },
          },
          attendances: {
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
          materials: true,
        },
      });

      if (!rehearsal) {
        return res.status(404).json({
          success: false,
          message: 'Rehearsal not found',
          error: 'Not Found',
        });
      }

      // Check if user is a band member
      if (rehearsal.band.members.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view this rehearsal',
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
 *   put:
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
 *                 enum: [ATTENDING, NOT_ATTENDING, MAYBE, PENDING]
 *               comment:
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
router.put(
  '/:id/attendance',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid rehearsal ID'),
    body('status')
      .isIn(['ATTENDING', 'NOT_ATTENDING', 'MAYBE', 'PENDING'])
      .withMessage('Status must be one of: ATTENDING, NOT_ATTENDING, MAYBE, PENDING'),
    body('comment').optional().isString().withMessage('Comment must be a string'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, comment } = req.body;

      // Find attendance record
      const attendance = await prisma.rehearsalAttendance.findFirst({
        where: {
          rehearsalId: id,
          userId: req.user!.id,
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
          comment,
          updatedAt: new Date(),
        },
      });

      // Notify band leader if user is not attending
      if (status === 'NOT_ATTENDING') {
        // Find band leader
        const bandLeader = await prisma.bandMember.findFirst({
          where: {
            bandId: attendance.rehearsal.bandId,
            role: 'LEADER',
            status: 'ACTIVE',
          },
          select: {
            userId: true,
          },
        });

        if (bandLeader && bandLeader.userId !== req.user!.id) {
          await prisma.notification.create({
            data: {
              userId: bandLeader.userId,
              type: 'ATTENDANCE_UPDATE',
              content: `${req.user!.name} can't attend ${attendance.rehearsal.title}`,
              relatedId: id,
            },
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

/**
 * @swagger
 * /api/rehearsals/suggested-times:
 *   get:
 *     summary: Get suggested rehearsal times for a band
 *     tags: [Rehearsals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: bandId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of suggested times
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not a member of this band
 */
router.get(
  '/suggested-times',
  authenticate,
  [
    query('bandId').isUUID().withMessage('Valid band ID is required'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { bandId } = req.query;

      // Check if user is a band member
      const userMembership = await prisma.bandMember.findFirst({
        where: {
          bandId: bandId as string,
          userId: req.user!.id,
          status: 'ACTIVE',
        },
      });

      if (!userMembership) {
        return res.status(403).json({
          success: false,
          message: 'You must be a band member to get suggested times',
          error: 'Forbidden',
        });
      }

      // Get band members availability
      // This is a simplified placeholder - in a real implementation,
      // you would analyze members' availability, past attendance patterns,
      // and preferences to suggest optimal times

      // Generate sample suggested times
      const now = new Date();
      const suggestedTimes = [
        // Next Saturday, 7 PM
        {
          startDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((6 - now.getDay() + 7) % 7),
            19, 0, 0
          ),
          endDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((6 - now.getDay() + 7) % 7),
            22, 0, 0
          ),
          confidence: 0.9,
          message: 'All members are typically available',
        },
        // Next Sunday, 2 PM
        {
          startDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((0 - now.getDay() + 7) % 7),
            14, 0, 0
          ),
          endDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((0 - now.getDay() + 7) % 7),
            17, 0, 0
          ),
          confidence: 0.8,
          message: 'Most members are typically available',
        },
        // Next Tuesday, 6 PM
        {
          startDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((2 - now.getDay() + 7) % 7),
            18, 0, 0
          ),
          endDatetime: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + ((2 - now.getDay() + 7) % 7),
            21, 0, 0
          ),
          confidence: 0.7,
          message: 'Some members might have conflicts',
        },
      ];

      res.status(200).json({
        success: true,
        data: suggestedTimes,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;