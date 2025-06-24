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
 *               genre:
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
    body('description').optional().isString().withMessage('Description must be a string'),
    body('genre').optional().isString().withMessage('Genre must be a string'),
    validate,
  ],
  async (req, res, next) => {
    try {
      const { name, description, genre } = req.body;

      // Create band
      const band = await prisma.band.create({
        data: {
          name,
          description,
          genre,
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
    // Get all bands where the user is a member
    const bands = await prisma.band.findMany({
      where: {
        members: {
          some: {
            userId: req.user!.id,
            status: 'ACTIVE',
          },
        },
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
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
 *     summary: Get a band by ID
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
 *         description: Not a member of this band
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

      // Check if band exists and user is a member
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

      // Check if the user is a member of this band
      const isMember = band.members.some(
        (member) => member.userId === req.user!.id && member.status === 'ACTIVE'
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this band',
          error: 'Forbidden',
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
 *               role:
 *                 type: string
 *                 enum: [LEADER, MEMBER]
 *     responses:
 *       201:
 *         description: Member added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized to add members
 *       404:
 *         description: Band or user not found
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
      const { email, role = 'MEMBER' } = req.body;

      // Check if the current user is a band leader
      const userMembership = await prisma.bandMember.findFirst({
        where: {
          bandId: id,
          userId: req.user!.id,
          role: 'LEADER',
          status: 'ACTIVE',
        },
      });

      if (!userMembership) {
        return res.status(403).json({
          success: false,
          message: 'Only band leaders can add members',
          error: 'Forbidden',
        });
      }

      // Find the user by email
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'Not Found',
        });
      }

      // Check if the user is already a member
      const existingMembership = await prisma.bandMember.findFirst({
        where: {
          bandId: id,
          userId: user.id,
        },
      });

      if (existingMembership) {
        // If already a member but inactive, reactivate
        if (existingMembership.status === 'INACTIVE') {
          const updatedMembership = await prisma.bandMember.update({
            where: { id: existingMembership.id },
            data: { status: 'ACTIVE', role },
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

          return res.status(200).json({
            success: true,
            message: 'Member reactivated successfully',
            data: updatedMembership,
          });
        }

        return res.status(409).json({
          success: false,
          message: 'User is already a member of this band',
          error: 'Conflict',
        });
      }

      // Add the user as a member
      const newMembership = await prisma.bandMember.create({
        data: {
          bandId: id,
          userId: user.id,
          role,
          status: 'ACTIVE',
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

      // Create a notification for the new member
      const band = await prisma.band.findUnique({
        where: { id },
        select: { name: true },
      });

      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'BAND_INVITATION',
          content: `You have been added to ${band?.name}`,
          relatedId: id,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Member added successfully',
        data: newMembership,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;