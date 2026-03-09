import { prisma } from '../../src/config/database';

const contractEnabled = process.env.FLOCK_RUN_DB_CONTRACT_TESTS === 'true';
const describeIfContracts = contractEnabled ? describe : describe.skip;

describeIfContracts('database contract checks', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies required tables and columns exist', async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'OrderFlowEvent' AND column_name = 'id')
          OR (table_name = 'QueueEntry' AND column_name = 'displayRef')
          OR (table_name = 'PartySession' AND column_name = 'joinToken')
          OR (table_name = 'PartyParticipant' AND column_name = 'isPayer')
          OR (table_name = 'PartyBucketItem' AND column_name = 'updatedByParticipantId')
        )
    `;

    expect(columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: 'OrderFlowEvent', column_name: 'id' }),
      expect.objectContaining({ table_name: 'QueueEntry', column_name: 'displayRef' }),
      expect.objectContaining({ table_name: 'PartySession', column_name: 'joinToken' }),
      expect.objectContaining({ table_name: 'PartyParticipant', column_name: 'isPayer' }),
      expect.objectContaining({ table_name: 'PartyBucketItem', column_name: 'updatedByParticipantId' }),
    ]));
  });

  it('verifies indexes and RLS are present on hardened tables', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; tablename: string }>>`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND (
          (tablename = 'QueueEntry' AND indexname = 'QueueEntry_venueId_position_idx')
          OR (tablename = 'OrderFlowEvent')
        )
    `;

    const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('PartySession', 'PartyParticipant', 'PartyBucketItem', 'OrderFlowEvent')
    `;

    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ tablename: 'QueueEntry', indexname: 'QueueEntry_venueId_position_idx' }),
    ]));
    expect(rls).toEqual(expect.arrayContaining([
      expect.objectContaining({ relname: 'PartySession', relrowsecurity: true }),
      expect.objectContaining({ relname: 'PartyParticipant', relrowsecurity: true }),
      expect.objectContaining({ relname: 'PartyBucketItem', relrowsecurity: true }),
      expect.objectContaining({ relname: 'OrderFlowEvent', relrowsecurity: true }),
    ]));
  });
});
