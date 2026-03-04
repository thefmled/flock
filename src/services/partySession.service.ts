import { randomBytes } from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { GuestAuthContext } from '../types';
import { signGuestToken } from '../utils/jwt';
import { PartyParticipantRole, PartySessionStatus } from '@prisma/client';

function generateJoinToken(): string {
  return randomBytes(8).toString('hex');
}

export async function ensurePartySessionForQueueEntry(params: {
  queueEntryId: string;
  venueId: string;
  guestName?: string;
  guestPhone: string;
}) {
  const existing = await prisma.partySession.findUnique({
    where: { queueEntryId: params.queueEntryId },
    include: {
      participants: {
        where: { role: PartyParticipantRole.HOST, isActive: true },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
  });

  if (existing) {
    let hostParticipant = existing.participants[0];

    if (!hostParticipant) {
      hostParticipant = await prisma.partyParticipant.create({
        data: {
          partySessionId: existing.id,
          displayName: params.guestName,
          guestPhone: params.guestPhone,
          role: PartyParticipantRole.HOST,
          isPayer: true,
          lastSeenAt: new Date(),
        },
      });
    }

    return { session: existing, hostParticipant };
  }

  const session = await prisma.partySession.create({
    data: {
      queueEntryId: params.queueEntryId,
      venueId: params.venueId,
      joinToken: generateJoinToken(),
      participants: {
        create: {
          displayName: params.guestName,
          guestPhone: params.guestPhone,
          role: PartyParticipantRole.HOST,
          isPayer: true,
          lastSeenAt: new Date(),
        },
      },
    },
    include: {
      participants: {
        take: 1,
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  return {
    session,
    hostParticipant: session.participants[0],
  };
}

async function resolveAccessibleParticipant(
  sessionId: string,
  guest: GuestAuthContext
) {
  if (guest.partySessionId && guest.participantId) {
    const participant = await prisma.partyParticipant.findFirst({
      where: {
        id: guest.participantId,
        partySessionId: sessionId,
        isActive: true,
      },
      include: {
        partySession: {
          include: {
            queueEntry: {
              select: {
                id: true,
                status: true,
                venueId: true,
                guestName: true,
                guestPhone: true,
              },
            },
          },
        },
      },
    });

    if (!participant) {
      throw new AppError('Party session participant not found', 404, 'PARTICIPANT_NOT_FOUND');
    }

    if (participant.partySession.queueEntry.venueId !== guest.venueId || participant.partySession.queueEntry.id !== guest.queueEntryId) {
      throw new AppError('Guest session does not match this party session', 403, 'PARTY_SESSION_FORBIDDEN');
    }

    if (
      participant.partySession.status !== PartySessionStatus.ACTIVE &&
      participant.partySession.status !== PartySessionStatus.LOCKED
    ) {
      throw new AppError('Party session is not active', 400, 'PARTY_SESSION_CLOSED');
    }

    return participant;
  }

  const { session, hostParticipant } = await ensurePartySessionForQueueEntry({
    queueEntryId: guest.queueEntryId,
    venueId: guest.venueId,
    guestPhone: guest.guestPhone,
  });

  if (session.id !== sessionId) {
    throw new AppError('Guest session does not match this party session', 403, 'PARTY_SESSION_FORBIDDEN');
  }

  const participant = await prisma.partyParticipant.findUnique({
    where: { id: hostParticipant.id },
    include: {
      partySession: {
        include: {
          queueEntry: {
            select: {
              id: true,
              status: true,
              venueId: true,
              guestName: true,
              guestPhone: true,
            },
          },
        },
      },
    },
  });

  if (!participant) {
    throw new AppError('Party session participant not found', 404, 'PARTICIPANT_NOT_FOUND');
  }

  return participant;
}

function buildGuestParticipantToken(params: {
  queueEntryId: string;
  venueId: string;
  guestPhone: string;
  partySessionId: string;
  participantId: string;
}) {
  return signGuestToken({
    kind: 'guest',
    queueEntryId: params.queueEntryId,
    venueId: params.venueId,
    guestPhone: params.guestPhone,
    partySessionId: params.partySessionId,
    participantId: params.participantId,
  });
}

export async function joinPartySessionByToken(params: {
  joinToken: string;
  displayName?: string;
}) {
  const session = await prisma.partySession.findFirst({
    where: {
      joinToken: params.joinToken,
      status: { in: [PartySessionStatus.ACTIVE, PartySessionStatus.LOCKED] },
      queueEntry: {
        status: { in: ['WAITING', 'NOTIFIED', 'SEATED'] },
      },
    },
    include: {
      queueEntry: {
        select: {
          id: true,
          venueId: true,
          guestPhone: true,
        },
      },
    },
  });

  if (!session) {
    throw new AppError('Party session invite is invalid or expired', 404, 'PARTY_SESSION_JOIN_INVALID');
  }

  const participant = await prisma.partyParticipant.create({
    data: {
      partySessionId: session.id,
      displayName: params.displayName?.trim() || null,
      guestPhone: null,
      role: PartyParticipantRole.MEMBER,
      isPayer: false,
      lastSeenAt: new Date(),
    },
  });

  return {
    sessionId: session.id,
    queueEntryId: session.queueEntry.id,
    venueId: session.queueEntry.venueId,
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role,
      isPayer: participant.isPayer,
    },
    guestToken: buildGuestParticipantToken({
      queueEntryId: session.queueEntry.id,
      venueId: session.queueEntry.venueId,
      guestPhone: session.queueEntry.guestPhone,
      partySessionId: session.id,
      participantId: participant.id,
    }),
  };
}

export async function getPartySessionSummary(sessionId: string, guest: GuestAuthContext) {
  const participant = await resolveAccessibleParticipant(sessionId, guest);

  await prisma.partyParticipant.update({
    where: { id: participant.id },
    data: { lastSeenAt: new Date() },
  });

  const participantCount = await prisma.partyParticipant.count({
    where: { partySessionId: sessionId, isActive: true },
  });

  return {
    id: participant.partySession.id,
    status: participant.partySession.status,
    joinToken: participant.partySession.joinToken,
    queueEntryId: participant.partySession.queueEntry.id,
    queueStatus: participant.partySession.queueEntry.status,
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role,
      isPayer: participant.isPayer,
    },
    participantCount,
  };
}

export async function getPartyParticipants(sessionId: string, guest: GuestAuthContext) {
  await resolveAccessibleParticipant(sessionId, guest);

  const participants = await prisma.partyParticipant.findMany({
    where: { partySessionId: sessionId, isActive: true },
    orderBy: { joinedAt: 'asc' },
    select: {
      id: true,
      displayName: true,
      role: true,
      isPayer: true,
      joinedAt: true,
      lastSeenAt: true,
    },
  });

  return participants;
}

export async function getPartyBucket(sessionId: string, guest: GuestAuthContext) {
  await resolveAccessibleParticipant(sessionId, guest);

  const bucketItems = await prisma.partyBucketItem.findMany({
    where: { partySessionId: sessionId },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      menuItemId: true,
      quantity: true,
      updatedAt: true,
      menuItem: {
        select: {
          name: true,
          description: true,
          priceExGst: true,
          gstPercent: true,
          isAvailable: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          displayName: true,
          role: true,
          isPayer: true,
        },
      },
    },
  });

  return bucketItems.map((item) => ({
    id: item.id,
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    updatedAt: item.updatedAt,
    menuItem: item.menuItem,
    updatedBy: item.updatedBy,
  }));
}

export async function updatePartyBucket(
  sessionId: string,
  guest: GuestAuthContext,
  items: Array<{ menuItemId: string; quantity: number }>
) {
  const participant = await resolveAccessibleParticipant(sessionId, guest);

  const queueStatus = participant.partySession.queueEntry.status;
  if (!['WAITING', 'NOTIFIED', 'SEATED'].includes(queueStatus)) {
    throw new AppError('Party session is no longer editable', 400, 'PARTY_SESSION_NOT_EDITABLE');
  }

  const requestedMenuItemIds = [...new Set(items.map((item) => item.menuItemId))];
  if (!requestedMenuItemIds.length && items.length) {
    throw new AppError('Bucket payload invalid', 400, 'PARTY_BUCKET_INVALID');
  }

  if (requestedMenuItemIds.length) {
    const menuItems = await prisma.menuItem.findMany({
      where: {
        venueId: guest.venueId,
        id: { in: requestedMenuItemIds },
      },
      select: {
        id: true,
        isAvailable: true,
      },
    });

    const availableIds = new Set(menuItems.filter((item) => item.isAvailable).map((item) => item.id));

    if (availableIds.size !== requestedMenuItemIds.length) {
      throw new AppError('One or more bucket items are unavailable', 400, 'PARTY_BUCKET_ITEM_UNAVAILABLE');
    }
  }

  const normalisedItems = items
    .filter((item) => item.quantity >= 0)
    .map((item) => ({
      menuItemId: item.menuItemId,
      quantity: Math.min(99, Math.floor(item.quantity)),
    }));

  await prisma.$transaction(async (tx) => {
    const retainedIds = normalisedItems.filter((item) => item.quantity > 0).map((item) => item.menuItemId);

    if (!retainedIds.length) {
      await tx.partyBucketItem.deleteMany({ where: { partySessionId: sessionId } });
      return;
    }

    await tx.partyBucketItem.deleteMany({
      where: {
        partySessionId: sessionId,
        menuItemId: { notIn: retainedIds },
      },
    });

    for (const item of normalisedItems) {
      if (item.quantity <= 0) continue;

      await tx.partyBucketItem.upsert({
        where: {
          partySessionId_menuItemId: {
            partySessionId: sessionId,
            menuItemId: item.menuItemId,
          },
        },
        update: {
          quantity: item.quantity,
          updatedByParticipantId: participant.id,
        },
        create: {
          partySessionId: sessionId,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          updatedByParticipantId: participant.id,
        },
      });
    }
  });

  return getPartyBucket(sessionId, guest);
}
