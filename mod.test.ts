import {
  afterAll,
  afterEach,
  assertEquals,
  assertRejects,
  beforeAll,
  beforeEach,
  describe,
  it,
  Pool,
  PoolClient,
} from './dev_deps.ts';
import {
  patchPostgresForTransactions,
  rollbackTransaction,
  startTransaction,
} from './mod.ts';

['PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT', 'PGHOST'].forEach((envVar) => {
  if (!Deno.env.has(envVar)) {
    throw new Error(`Missing ${envVar} environment variable!`);
  }
});

patchPostgresForTransactions();

const insertSql = `INSERT INTO sample ("text") VALUES ('value')`;

describe('postgres-transactional-tests', () => {
  let pool: Pool;
  let poolClient: PoolClient;

  const getCount = async () => {
    const { rows: [{ count }] } = await poolClient.queryObject<
      { count: number }
    >(
      'SELECT COUNT(*) FROM sample',
    );
    return Number(count);
  };

  beforeAll(async () => {
    pool = new Pool(undefined, 1, true);
    poolClient = await pool.connect();
    await poolClient.queryObject(
      `CREATE TABLE IF NOT EXISTS sample ("text" text)`,
    );
  });
  afterAll(async () => {
    await poolClient.queryObject(`DROP TABLE IF EXISTS sample`);
    await poolClient.release();
    await pool.end();
  });

  describe('patch database client', () => {
    beforeAll(startTransaction);
    beforeEach(startTransaction);
    afterEach(rollbackTransaction);
    afterAll(rollbackTransaction);

    it('should leave db empty after running this test', async () => {
      await Promise.all([
        poolClient.queryObject(insertSql),
        poolClient.queryObject(insertSql),
      ]);
      const count = await getCount();
      assertEquals(count, 2);
    });

    it('should have an empty db now', async () => {
      const count = await getCount();
      assertEquals(count, 0);
    });

    describe('nested describe', () => {
      beforeAll(async () => {
        await startTransaction();
        await poolClient.queryObject(insertSql);
      });

      afterAll(async () => {
        await rollbackTransaction();
      });

      it('should have record created in beforeAll', async () => {
        const count = await getCount();
        assertEquals(count, 1);
      });
    });

    it('should support nested transactions, case insensitive', async () => {
      await poolClient.queryObject('STaRT TRANSaCTION');
      await poolClient.queryObject('COmMIT');
      await poolClient.queryObject('BeGiN');
      await poolClient.queryObject('ROLlBaCK');
    });

    it('should still have an empty db', async () => {
      const count = await getCount();
      assertEquals(count, 0);
    });

    it('should handle errors in pool', async () => {
      await assertRejects(() =>
        poolClient.queryObject('SELECT * FROM nonExistingTable')
      );
    });
  });
});
