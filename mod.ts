import { Connection } from './deps.ts';
import {
  Query,
  QueryArrayResult,
  QueryObjectResult,
  QueryResult,
  ResultType,
} from './deps.ts';

let transactionId = 0;
let connection: Connection | undefined;
let prependStartTransaction = false;

const { startup, query } = Connection.prototype;

export const patchPostgresForTransactions = () => {
  Connection.prototype.startup = function (
    this: Connection,
    is_reconnection: boolean,
  ) {
    if (!connection) {
      connection = this;
    }

    return startup.call(this, is_reconnection);
  };

  Connection.prototype.query = async function (
    this: Connection,
    queryArg: Query<ResultType>,
  ): Promise<QueryResult> {
    if (prependStartTransaction) {
      prependStartTransaction = false;
      await this.query(new Query('BEGIN', ResultType.ARRAY));
    }

    const sql = queryArg.text.trim().toUpperCase();
    let replacingSql: string | undefined;

    if (sql.startsWith('START TRANSACTION') || sql.startsWith('BEGIN')) {
      if (transactionId > 0) {
        replacingSql = `SAVEPOINT "${transactionId++}"`;
      } else {
        transactionId = 1;
      }
    } else {
      const isCommit = sql.startsWith('COMMIT');
      const isRollback = !isCommit && sql.startsWith('ROLLBACK');
      if (isCommit || isRollback) {
        if (transactionId === 0) {
          throw new Error(
            `Trying to ${
              isCommit ? 'COMMIT' : 'ROLLBACK'
            } outside of transaction`,
          );
        }

        if (transactionId > 1) {
          const savePoint = --transactionId;
          replacingSql = `${
            isCommit ? 'RELEASE' : 'ROLLBACK TO'
          } SAVEPOINT "${savePoint}"`;
        } else {
          transactionId = 0;
        }
      }
    }

    if (replacingSql) {
      queryArg.text = replacingSql;
    }

    const response = await query.call(this, queryArg);
    return response;
  } as
    & ((
      this: Connection,
      queryArg: Query<ResultType.ARRAY>,
    ) => Promise<QueryArrayResult>)
    & ((
      this: Connection,
      queryArg: Query<ResultType.OBJECT>,
    ) => Promise<QueryObjectResult>);
};

export const unpatchPostgresForTranscations = () => {
  transactionId = 0;
  connection = undefined;

  Connection.prototype.startup = startup;
  Connection.prototype.query = query;
};

export const startTransaction = () => {
  prependStartTransaction = true;
};

export const rollbackTransaction = async () => {
  if (transactionId > 0) {
    await connection?.query(new Query('ROLLBACK', ResultType.ARRAY));
  }
};
