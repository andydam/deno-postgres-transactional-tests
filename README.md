# Deno Postgres Transactional Tests

![Build workflow](https://github.com/andydam/deno-postgres-transactional-tests/actions/workflows/build.yaml/badge.svg)

[@romeerez's](https://github.com/romeerez) [pg-transactional-tests](https://github.com/romeerez/pg-transactional-tests) modified to work with Deno and deno-postgres.

Patches [deno-postgres](https://deno.land/x/postgres@v0.17.0) to allow transactional tests.

The purpose of this lib is to make each of your test to run in a separate transaction, rollback after each test, so every change you're making in database disappears.

This allows to focus on testing logic without thinking about clearing database, and this is performed much faster than clearing tables.

## Get started

```typescript
import { patchPostgresForTransactions } from "https://deno.land/x/postgres_transactional_tests@v1.0.0/mod.ts";
```

## Use in tests

You can define a test "hook" and call it in the beginning of your test files.

```ts
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
} from "https://deno.land/std@0.180.0/testing/bdd.ts";
import {
  patchPostgresForTransactions,
  rollbackTransaction,
  startTransaction,
} from "https://deno.land/x/postgres_transactional_tests@v1.0.0/mod.ts";

// import instance of your query builder, ORM, something which has `.close` or `.end` or `.destroy` method
import db from "./path-to-your-db";

export const useTestDatabase = () => {
  beforeAll(async () => {
    patchPgForTransactions();
    await startTransaction();
  });
  beforeEach(startTransaction);
  afterEach(rollbackTransaction);
  afterAll(async () => {
    await rollbackTransaction();
    unpatchPgForTransactions();
    await db.close();
  });
};
```

## How it works

Every test which performs a query is wrapped into a transaction:

```typescript
test("create record", async () => {
  await db.queryObject("INSERT INTO sample(...) VALUES (...)");
  const sample = await db.queryObject("SELECT * FROM sample WHERE ...");
});
```

This test is producing such SQL:

```sql
BEGIN;
  INSERT INTO sample(...) VALUES (...);
  SELECT * FROM sample WHERE ...;
ROLLBACK;
```

Under the hood this lib is replacing some of SQL commands:

- `START TRANSACTION` and `BEGIN` command is replaced with `SAVEPOINT "id"`, where id is incremented number
- `COMMIN` becomes `RELEASE SAVEPOINT "id"`
- `ROLLBACK` becomes `ROLLBACK TO SAVEPOINT "id"`

This allows to handle even nested transactions:

```ts
test("nested transactions", async () => {
  await db.transaction(async (t) => {
    await t.query("INSERT INTO sample(...) VALUES (...)");
  });
});
```

Becomes:

```sql
BEGIN;
  SAVEPOINT "1";
  INSERT INTO sample(...) VALUES (...);
  RELEASE SAVEPOINT "1";
ROLLBACK;
```

Note that `startTransaction` in `beforeEach` hook doesn't start it immediately, but it waits for a db query to prepend it with `BEGIN` statement.

As the result, if a test case doesn't perform any requests, it won't make transactions in vain.

## Parallel queries

Since every test has own transaction, this library ensures that only 1 connection will be created, because single transaction requires single connection.

## Why to choose it over truncating tables?

Transactions are faster than truncating, but we are talking about milliseconds which doesn't really count.

Main benefit is that it is simpler to use. With this library you can create persisted seed data, such as record of current user to use across the tests, while if you choose truncating, you'll also need to recreate seed data for each test.
