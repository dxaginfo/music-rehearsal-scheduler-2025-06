import express from 'express';
import { body, param } from 'express-validator';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/bands:
 *   post:
 *     summary: Create a new band
 *     tags: [Bands]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               logoUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Band created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 */
router.post(
  '/',
  authenticate,
  [
    body('name').notEmpty().withMessage('Band name is required'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { name, description, logoUrl } = req.body;

      const band = await prisma.band.create({
        data: {
          name,
          description,
          logoUrl,
          createdById: req.user!.id,
          members: {
            create: {
              userId: req.user!.id,
              role: 'LEADER',
              status: 'ACTIVE',
            },
          },
        },
        include: {
          members: {
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
        message: 'Band created successfully',
        data: band,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/bands:
 *   get:
 *     summary: Get all bands for the current user
 *     tags: [Bands]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of bands
 *       401:
 *         description: Not authenticated
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const bands = await prisma.band.findMany({
      where: {
        members: {
          some: {
            userId: req.user!.id,
          },
        },
      },
      include: {
        _count: {
          select: {
            members: true,
            rehearsals: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: bands,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/bands/{id}:
 *   get:
 *     summary: Get a single band by ID
 *     tags: [Bands]
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
 *         description: Band details
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to access this band
 *       404:
 *         description: Band not found
 */
router.get(
  '/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid band ID'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if user is a member of the band
      const membership = await prisma.bandMember.findFirst({
        where: {
          bandId: id,
          userId: req.user!.id,
        },
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this band',
          error: 'Forbidden',
        });
      }

      const band = await prisma.band.findUnique({
        where: { id },
        include: {
          members: {
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
          rehearsals: {
            where: {
              startDatetime: {
                gte: new Date(),
              },
            },
            orderBy: {
              startDatetime: 'asc',
            },
            take: 5,
          },
        },
      });

      if (!band) {
        return res.status(404).json({
          success: false,
          message: 'Band not found',
          error: 'Not Found',
        });
      }

      res.status(200).json({
        success: true,
        data: band,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/bands/{id}/members:
 *   post:
 *     summary: Add a member to a band
 *     tags: [Bands]
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
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [LEADER, MEMBER]
 *               instrument:
 *                 type: string
 *     responses:
 *       201:
 *         description: Member added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to add members to this band
 *       404:
 *         description: Band or user not found
 *       409:
 *         description: User is already a member of this band
 */
router.post(
  '/:id/members',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid band ID'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('role').optional().isIn(['LEADER', 'MEMBER']).withMessage('Role must be LEADER or MEMBER'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { email, role = 'MEMBER', instrument } = req.body;

      // Check if user is a leader of the band
      const userMembership = await prisma.bandMember.findFirst({
        where: {
          bandId: id,
          userId: req.user!.id,
          role: 'LEADER',
        },
      });

      if (!userMembership) {
        return res.status(403).json({
          success: false,
          message: 'You must be a band leader to add members',
          error: 'Forbidden',
        });
      }

      // Find user by email
      const userToAdd = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
      });

      if (!userToAdd) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'Not Found',
        });
      }

      // Check if user is already a member
      const existingMembership = await prisma.bandMember.findFirst({
        where: {
          bandId: id,
          userId: userToAdd.id,
        },
      });

      if (existingMembership) {
        return res.status(409).json({
          success: false,
          message: 'User is already a member of this band',
          error: 'Conflict',
        });
      }

      // Add user to band
      const membership = await prisma.bandMember.create({
        data: {
          bandId: id,
          userId: userToAdd.id,
          role,
          instrument,
          status: 'INVITED',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Create notification for the invited user
      await prisma.notification.create({
        data: {
          userId: userToAdd.id,
          type: 'BAND_INVITATION',
          content: `You have been invited to join the band as a ${role.toLowerCase()}`,
          relatedId: id,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Band invitation sent successfully',
        data: membership,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;