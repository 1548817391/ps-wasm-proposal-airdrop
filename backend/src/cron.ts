import { CronJob } from "cron";
import { AirdropStatus } from "./models/user";
import { dateToSqlString } from "./lib/sql-utils";
import { SqlModelStatus } from "./models/base-sql-model";
import { MysqlConnectionManager } from "./lib/mysql-connection-manager";
import { SmtpSendTemplate } from "./lib/node-mailer";
import { env } from "./config/env";
import { generateEmailAirdropToken } from "./lib/jwt";
import { LogType, writeLog } from "./lib/logger";
import { LogLevel, Nft } from "@apillon/sdk";

export class Cron {
  private cronJobs: CronJob[] = [];

  constructor() {
    this.cronJobs.push(new CronJob("* * * * *", this.airdrop, null, false));
  }

  async start() {
    for (const cronJob of this.cronJobs) {
      cronJob.start();
    }
  }

  async stop() {
    for (const cronJob of this.cronJobs) {
      cronJob.stop();
    }
    await MysqlConnectionManager.destroyInstance();
  }

  async airdrop() {
    const mysql = await MysqlConnectionManager.getInstance();
    const conn = await mysql.start();

    const collection = new Nft({
      key: env.APILLON_KEY,
      secret: env.APILLON_SECRET,
      logLevel: LogLevel.VERBOSE,
    }).collection(env.COLLECTION_UUID);

    for (let i = 0; i < 100; i++) {
      try {
        const res = await conn.execute(
          `SELECT * FROM user WHERE
          airdrop_status = ${AirdropStatus.PENDING}
          AND status = ${SqlModelStatus.ACTIVE}
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        ;
       `
        );
        const user = res[0] as any;

        if (!user) {
          break;
        }

        const response = await collection.mint({
          receivingAddress: user.wallet,
          quantity: 1,
        });

        const sql = `
        UPDATE user (airdrop_status)
        VALUES (${
          response.success
            ? AirdropStatus.AIRDROP_COMPLETED
            : AirdropStatus.AIRDROP_ERROR
        })
        WHERE wallet = ${user.wallet}`;

        await conn.execute(sql);
        await conn.commit();
      } catch (e) {
        writeLog(LogType.ERROR, e, "cron.ts", "airdrop");
        await conn.rollback();
      }
    }

    MysqlConnectionManager.destroyInstance();
  }
}
