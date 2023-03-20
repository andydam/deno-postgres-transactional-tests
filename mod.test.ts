import {
  afterAll,
  afterEach,
  assertEquals,
  assertRejects,
  beforeAll,
  beforeEach,
  Client,
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
  const client = new Client();
  let pool: Pool;
  let poolClient: PoolClient;

  const getCount = async () => {
    const { rows: [{ count }] } = await client.queryObject<
      { count: number }
    >(
      'SELECT COUNT(*) FROM sample',
    );
    return Number(count);
  };

  beforeAll(async () => {
    await client.connect();
    pool = new Pool(undefined, 1, true);
    poolClient = await pool.connect();
    await client.queryObject(
      `CREATE TABLE sample ("text" text)`,
    );
  });
  afterAll(async () => {
    await client.queryObject(`DROP TABLE sample`);
    await poolClient.release();
    await pool.end();
    await client.end();
  });

  describe('patch database client', () => {
    beforeAll(startTransaction);
    beforeEach(startTransaction);
    afterEach(rollbackTransaction);
    afterAll(rollbackTransaction);

    it('should leave db empty after running this test', async () => {
      await Promise.all([
        client.queryObject(insertSql),
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
        await client.queryObject(insertSql);
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
      await client.queryObject('STaRT TRANSaCTION');
      await client.queryObject('COmMIT');
      await client.queryObject('BeGiN');
      await client.queryObject('ROLlBaCK');
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
